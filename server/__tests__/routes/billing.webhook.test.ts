import { beforeEach, describe, expect, it, vi } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock the DB and Stripe integration before importing the router, mirroring the
// existing billing route test conventions: constructWebhookEvent returns a
// pre-built event so signature verification is bypassed in the test.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

vi.mock('../../integrations/stripe', () => ({
  createCheckoutSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
  // Real-ish mapping: price_pro -> professional, anything else -> null.
  mapPriceToTier: vi.fn((priceId: string | null | undefined) =>
    priceId === 'price_pro' ? 'professional' : null
  )
}))

// The webhook handler fails closed unless a signing secret is configured. The
// config module reads STRIPE_WEBHOOK_SECRET at import time, so set it first.
vi.mock('../../config', async () => {
  const actual = await vi.importActual<typeof import('../../config')>('../../config')
  return {
    ...actual,
    config: {
      ...actual.config,
      stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test' },
      cors: { origin: ['https://app.example.com'] }
    }
  }
})

import { database } from '../../database/connection'
import { constructWebhookEvent } from '../../integrations/stripe'
import billingRouter from '../../routes/billing'

function buildApp(): Express {
  const app = express()
  // Match production mounting: raw body for the Stripe webhook.
  app.use('/api/billing', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use('/api/billing', billingRouter)
  return app
}

const mockedQuery = vi.mocked(database.query)
const mockedConstruct = vi.mocked(constructWebhookEvent)

describe('Billing webhook persistence', () => {
  let app: Express

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
  })

  it('rejects a webhook with a missing signature header', async () => {
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(400)
    expect(mockedConstruct).not.toHaveBeenCalled()
  })

  it('persists subscription state on customer.subscription.updated', async () => {
    // resolveOrgId -> org found by stripe_customer_id; then the UPDATE.
    mockedQuery
      .mockResolvedValueOnce([{ id: 'org-1' }]) // SELECT id FROM organizations WHERE stripe_customer_id
      .mockResolvedValueOnce([]) // UPDATE organizations ...

    mockedConstruct.mockResolvedValue({
      id: 'evt_1',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          current_period_end: 1893456000,
          items: { data: [{ price: { id: 'price_pro' } }] }
        }
      }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, handled: true })

    // The org row was updated with the mapped tier (professional).
    const updateCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE organizations')
    )
    expect(updateCall).toBeDefined()
    const params = updateCall![1] as unknown[]
    expect(params[0]).toBe('org-1') // org id
    expect(params[1]).toBe('cus_123') // stripe_customer_id
    expect(params[2]).toBe('sub_123') // stripe_subscription_id
    expect(params[3]).toBe('active') // subscription_status
    expect(params[4]).toBe('price_pro') // stripe_price_id
    expect(params[6]).toBe('professional') // mapped tier
  })

  it('downgrades the org to free on customer.subscription.deleted', async () => {
    mockedQuery
      .mockResolvedValueOnce([{ id: 'org-2' }]) // resolveOrgId by customer
      .mockResolvedValueOnce([]) // UPDATE -> canceled / free

    mockedConstruct.mockResolvedValue({
      id: 'evt_2',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_999', customer: 'cus_999', status: 'canceled' } }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    expect(res.body.handled).toBe(true)
    const call = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes("subscription_tier = 'free'")
    )
    expect(call).toBeDefined()
    expect((call![1] as unknown[])[0]).toBe('org-2')
  })

  it('fails closed (no tier change) for an unmapped price id', async () => {
    mockedQuery.mockResolvedValueOnce([{ id: 'org-3' }]).mockResolvedValueOnce([])

    mockedConstruct.mockResolvedValue({
      id: 'evt_3',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_unmapped',
          customer: 'cus_3',
          status: 'active',
          items: { data: [{ price: { id: 'price_unknown' } }] }
        }
      }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const updateCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE organizations')
    )
    const params = updateCall![1] as unknown[]
    expect(params[4]).toBe('price_unknown') // raw price stored
    expect(params[6]).toBeNull() // tier NOT changed (COALESCE keeps existing)
  })

  it('returns 200 handled=false and does not update when no org can be resolved', async () => {
    // resolveOrgId: not found by customer, and no client_reference_id hint.
    mockedQuery.mockResolvedValueOnce([]) // SELECT by stripe_customer_id -> none

    mockedConstruct.mockResolvedValue({
      id: 'evt_4',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_x',
          customer: 'cus_orphan',
          status: 'active',
          items: { data: [{ price: { id: 'price_pro' } }] }
        }
      }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    expect(res.body.handled).toBe(false)
    expect(mockedQuery.mock.calls.some((c) => String(c[0]).includes('UPDATE organizations'))).toBe(
      false
    )
  })

  it('marks the org past_due on invoice.payment_failed', async () => {
    mockedQuery.mockResolvedValueOnce([{ id: 'org-5' }]).mockResolvedValueOnce([])

    mockedConstruct.mockResolvedValue({
      id: 'evt_5',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_5', subscription: 'sub_5' } }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const updateCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE organizations')
    )
    expect((updateCall![1] as unknown[])[3]).toBe('past_due')
  })

  it('returns 500 (so Stripe retries) when persistence throws', async () => {
    mockedQuery
      .mockResolvedValueOnce([{ id: 'org-6' }]) // resolve org
      .mockRejectedValueOnce(new Error('db down')) // UPDATE fails

    mockedConstruct.mockResolvedValue({
      id: 'evt_6',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_6',
          customer: 'cus_6',
          status: 'active',
          items: { data: [{ price: { id: 'price_pro' } }] }
        }
      }
    } as never)

    const res = await request(app)
      .post('/api/billing/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=abc')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(500)
  })
})
