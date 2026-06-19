import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock the Stripe integration before importing the router. The tier→price
// mapping is exercised through the real env-backed implementation in a separate
// unit test; here we mock it so route behavior (status codes, session creation)
// is tested in isolation.
vi.mock('../../integrations/stripe', () => ({
  createCheckoutSession: vi.fn(async () => ({ url: 'https://checkout.stripe.test/session' })),
  constructWebhookEvent: vi.fn(),
  isStripeConfigured: vi.fn(() => true),
  mapPriceToTier: vi.fn(() => null),
  mapTierToPrice: vi.fn((tier: string) => {
    const prices: Record<string, string | null> = {
      starter: 'price_starter',
      professional: 'price_pro',
      enterprise: null // recognized tier, deliberately not wired up
    }
    return prices[tier] ?? null
  }),
  normalizeCheckoutTier: vi.fn((value: unknown) => {
    if (typeof value !== 'string') return null
    const v = value.trim().toLowerCase()
    const map: Record<string, string> = {
      starter: 'starter',
      pro: 'professional',
      professional: 'professional',
      enterprise: 'enterprise'
    }
    return map[v] ?? null
  })
}))

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

import {
  createCheckoutSession,
  isStripeConfigured,
  mapTierToPrice
} from '../../integrations/stripe'
import billingRouter from '../../routes/billing'

function buildApp(): Express {
  const app = express()
  // Match production mounting: raw body for the Stripe webhook.
  app.use('/api/billing', express.raw({ type: 'application/json', limit: '1mb' }))
  app.use('/api/billing', billingRouter)
  return app
}

const mockedCreate = vi.mocked(createCheckoutSession)
const mockedConfigured = vi.mocked(isStripeConfigured)
const mockedMapTier = vi.mocked(mapTierToPrice)

describe('Billing checkout — tier selection', () => {
  let app: Express

  beforeEach(() => {
    vi.clearAllMocks()
    mockedConfigured.mockReturnValue(true)
    app = buildApp()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defaults to the starter plan when no tier is given (backward compatible)', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://checkout.stripe.test/session')
    expect(mockedMapTier).toHaveBeenCalledWith('starter')
    expect(mockedCreate).toHaveBeenCalledTimes(1)
    const opts = mockedCreate.mock.calls[0][0]
    expect(opts.priceId).toBe('price_starter')
    expect(opts.metadata).toMatchObject({ tier: 'starter' })
  })

  it('resolves the requested tier to its configured price', async () => {
    const res = await request(app)
      .post('/api/billing/checkout?tier=professional')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(200)
    expect(mockedMapTier).toHaveBeenCalledWith('professional')
    expect(mockedCreate.mock.calls[0][0].priceId).toBe('price_pro')
    expect(mockedCreate.mock.calls[0][0].metadata).toMatchObject({ tier: 'professional' })
  })

  it('accepts the `plan` alias as well as `tier`', async () => {
    const res = await request(app)
      .post('/api/billing/checkout?plan=pro')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(200)
    expect(mockedMapTier).toHaveBeenCalledWith('professional')
  })

  it('rejects an unknown plan with 400 and never creates a session', async () => {
    const res = await request(app)
      .post('/api/billing/checkout?tier=platinum')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Unknown plan')
    expect(res.body.details.supportedTiers).toContain('professional')
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('returns 503 when the tier is recognized but no price is configured', async () => {
    const res = await request(app)
      .post('/api/billing/checkout?tier=enterprise')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/enterprise/)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('returns 503 when Stripe is not configured', async () => {
    mockedConfigured.mockReturnValue(false)

    const res = await request(app)
      .post('/api/billing/checkout?tier=starter')
      .set('origin', 'https://app.example.com')

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('Billing not configured')
    expect(mockedCreate).not.toHaveBeenCalled()
  })
})
