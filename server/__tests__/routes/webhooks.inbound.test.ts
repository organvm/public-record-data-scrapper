import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock the database singleton before importing the router. Every DB call in the
// inbound paths goes through database.query; we script it per-test.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock the deal + suppression singletons so we can assert the loop-closing
// side effects without a real database. Export the class shapes too: other
// modules in the import graph (CommunicationsService, deals route) pull in the
// class exports, so the mocks must satisfy them as well.
vi.mock('../../services/DealsService', () => {
  const dealsService = { create: vi.fn() }
  class DealsService {
    create = dealsService.create
  }
  return { dealsService, DealsService }
})
vi.mock('../../services/SuppressionService', () => {
  const suppressionService = { addToSuppressionList: vi.fn() }
  class SuppressionService {
    addToSuppressionList = suppressionService.addToSuppressionList
  }
  return { suppressionService, SuppressionService }
})

import { database } from '../../database/connection'
import { dealsService } from '../../services/DealsService'
import { suppressionService } from '../../services/SuppressionService'
import webhooksRouter from '../../routes/webhooks'

const mockedQuery = vi.mocked(database.query)
const mockedCreateDeal = vi.mocked(dealsService.create)
const mockedSuppress = vi.mocked(suppressionService.addToSuppressionList)

// The router reads INBOUND_PARSE_TOKEN lazily (per request), so a test just sets
// the env var before issuing the request — no module reset required.
function buildApp(token: string | undefined): Express {
  if (token === undefined) {
    delete process.env.INBOUND_PARSE_TOKEN
  } else {
    process.env.INBOUND_PARSE_TOKEN = token
  }
  const app = express()
  // Mirror production: urlencoded body parsing for webhooks. The inbound route's
  // own multipart middleware handles multipart/form-data; urlencoded posts are
  // parsed here.
  app.use('/api/webhooks', express.urlencoded({ extended: true, limit: '1mb' }))
  app.use('/api/webhooks', webhooksRouter)
  return app
}

describe('SendGrid Inbound Parse webhook', () => {
  const ORIGINAL_TOKEN = process.env.INBOUND_PARSE_TOKEN

  beforeEach(() => {
    vi.clearAllMocks()
    mockedQuery.mockResolvedValue([])
  })

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.INBOUND_PARSE_TOKEN
    else process.env.INBOUND_PARSE_TOKEN = ORIGINAL_TOKEN
  })

  it('rejects with 401 when INBOUND_PARSE_TOKEN is unset (fail closed)', async () => {
    const app = buildApp(undefined)

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound')
      .field('from', 'owner@acme.com')
      .field('text', 'hello')

    expect(res.status).toBe(401)
    // No persistence attempted.
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the provided token does not match', async () => {
    const app = buildApp('s3cret')

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=wrong')
      .field('from', 'owner@acme.com')
      .field('text', 'hello')

    expect(res.status).toBe(401)
    expect(mockedQuery).not.toHaveBeenCalled()
  })

  it('persists an inbound email and attaches the reply to an active sequence', async () => {
    const app = buildApp('s3cret')

    mockedQuery
      // 1: resolve contact by from-address (single, unambiguous match)
      .mockResolvedValueOnce([{ id: 'contact-1', org_id: 'org-1' }])
      // 2: INSERT communications RETURNING id
      .mockResolvedValueOnce([{ id: 'comm-1' }])
      // 3: resolveContactProspect -> prospect + company
      .mockResolvedValueOnce([{ prospect_id: 'prospect-1', company_name: 'Acme LLC' }])
      // 4: OutreachSequenceService.getActiveSequenceIds
      .mockResolvedValueOnce([{ id: 'seq-1', triggerType: 'termination', status: 'active' }])
      // 5: recordReply UPDATE outreach_sequences
      .mockResolvedValueOnce([])
      // 6: recordReply UPDATE outreach_steps
      .mockResolvedValueOnce([])

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=s3cret')
      .field('from', 'Owner <owner@acme.com>')
      .field('to', 'sales@brokeros.com')
      .field('subject', 'Re: your message')
      .field('text', 'Just following up, nothing urgent')

    expect(res.status).toBe(200)

    // The communications INSERT was inbound/email/received.
    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO communications')
    )
    expect(insertCall).toBeDefined()
    const params = insertCall![1] as unknown[]
    expect(params[0]).toBe('org-1') // org_id from resolved contact
    expect(params[1]).toBe('contact-1') // contact_id
    expect(params[2]).toBe('email') // channel
    expect(params[3]).toBe('inbound') // direction
    expect(params[4]).toBe('owner@acme.com') // from_address (parsed out of display form)
    expect(params[9]).toBe('received') // status

    // The reply was attached to the active sequence (recordReply ran).
    const recordReplyCall = mockedQuery.mock.calls.find(
      (c) =>
        String(c[0]).includes('UPDATE outreach_sequences') &&
        String(c[0]).includes("status = 'cancelled'")
    )
    expect(recordReplyCall).toBeDefined()
  })

  it('records suppression on an opt-out email (TCPA / CAN-SPAM)', async () => {
    const app = buildApp('s3cret')

    mockedQuery
      .mockResolvedValueOnce([{ id: 'contact-2', org_id: 'org-2' }]) // resolve contact
      .mockResolvedValueOnce([{ id: 'comm-2' }]) // INSERT communications
      .mockResolvedValueOnce([{ prospect_id: 'prospect-2', company_name: 'Beta Co' }]) // prospect
      .mockResolvedValueOnce([]) // getActiveSequenceIds -> none

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=s3cret')
      .field('from', 'owner@beta.co')
      .field('text', 'Please unsubscribe me from all future emails')

    expect(res.status).toBe(200)
    expect(mockedSuppress).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-2', email: 'owner@beta.co', channel: 'email' })
    )
    expect(mockedCreateDeal).not.toHaveBeenCalled()
  })

  it('creates a deal on a positive email reply', async () => {
    const app = buildApp('s3cret')
    mockedCreateDeal.mockResolvedValue({ id: 'deal-9' } as never)

    mockedQuery
      .mockResolvedValueOnce([{ id: 'contact-3', org_id: 'org-3' }]) // resolve contact
      .mockResolvedValueOnce([{ id: 'comm-3' }]) // INSERT communications
      .mockResolvedValueOnce([{ prospect_id: 'prospect-3', company_name: 'Gamma Inc' }]) // prospect
      .mockResolvedValueOnce([]) // getActiveSequenceIds -> none

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=s3cret')
      .field('from', 'owner@gamma.com')
      .field('text', 'Yes, I am very interested — what are the rates?')

    expect(res.status).toBe(200)
    expect(mockedCreateDeal).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-3', prospectId: 'prospect-3', contactId: 'contact-3' })
    )
  })

  it('isolates a deal-creation failure: the inbound row is still persisted (200)', async () => {
    const app = buildApp('s3cret')
    mockedCreateDeal.mockRejectedValue(new Error('DealStage not found'))

    mockedQuery
      .mockResolvedValueOnce([{ id: 'contact-4', org_id: 'org-4' }]) // resolve contact
      .mockResolvedValueOnce([{ id: 'comm-4' }]) // INSERT communications
      .mockResolvedValueOnce([{ prospect_id: 'prospect-4', company_name: 'Delta' }]) // prospect
      .mockResolvedValueOnce([]) // getActiveSequenceIds -> none

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=s3cret')
      .field('from', 'owner@delta.com')
      .field('text', 'Interested, please call me')

    // Inbound persistence is the primary obligation; deal failure must not 500.
    expect(res.status).toBe(200)
    const insertCall = mockedQuery.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO communications')
    )
    expect(insertCall).toBeDefined()
  })

  it('returns 400 on a payload with no from-address', async () => {
    const app = buildApp('s3cret')

    const res = await request(app)
      .post('/api/webhooks/sendgrid/inbound?token=s3cret')
      .field('text', 'orphaned body, no from')

    expect(res.status).toBe(400)
    expect(mockedQuery).not.toHaveBeenCalled()
  })
})
