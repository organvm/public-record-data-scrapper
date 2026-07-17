import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'

// Mock the database: QualificationService's prospect lookup misses (empty
// result) and the tier claim path never reaches the DB — so the REAL analyzer
// and REAL qualifier run end-to-end here with no infrastructure.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn().mockResolvedValue([])
  }
}))

import { createAuthHeader } from '../helpers/testApp'
import { authMiddleware } from '../../middleware/authMiddleware'
import { dataTierRouter } from '../../middleware/dataTier'
import { errorHandler } from '../../middleware/errorHandler'
import underwritingRouter from '../../routes/underwriting'

function createUnderwritingApp(): Express {
  const app = express()
  app.use(express.json())
  // Production mount order minus orgContext (which needs a live DB pool).
  app.use('/api/underwriting', authMiddleware, dataTierRouter, underwritingRouter)
  app.use(errorHandler)
  return app
}

/** A minimal statement: daily lender debit + weekly lender debit + deposits. */
function sampleBody() {
  const transactions: Array<{
    date: string
    description: string
    amount: number
    running_balance?: number
  }> = []
  const cursor = new Date('2026-06-01T00:00:00Z')
  let balance = 15000
  for (let i = 0; i < 28; i++) {
    const day = cursor.toISOString().slice(0, 10)
    const weekday = cursor.getUTCDay()
    if (weekday >= 1 && weekday <= 5) {
      balance -= 400
      transactions.push({
        date: day,
        description: 'LENDER A ACH DEBIT',
        amount: 400,
        running_balance: balance
      })
    }
    if (weekday === 1) {
      balance -= 900
      transactions.push({
        date: day,
        description: 'LENDER B FUNDING PMT',
        amount: 900,
        running_balance: balance
      })
    }
    if (weekday === 2 || weekday === 4) {
      balance += 6000
      transactions.push({
        date: day,
        description: 'CUSTOMER PAYMENT ACH',
        amount: -6000,
        running_balance: balance
      })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { transactions, time_in_business_months: 30, industry: 'restaurant', state: 'fl' }
}

describe('POST /api/underwriting/analyze-statement', () => {
  let app: Express

  beforeEach(() => {
    app = createUnderwritingApp()
  })

  it('requires authentication', async () => {
    const response = await request(app)
      .post('/api/underwriting/analyze-statement')
      .send(sampleBody())

    expect(response.status).toBe(401)
  })

  it('returns a 402 upsell for free-tier callers', async () => {
    const freeAuth = createAuthHeader('free-user', { orgId: 'free-org', tier: 'free' })

    const response = await request(app)
      .post('/api/underwriting/analyze-statement')
      .set('Authorization', freeAuth)
      .send(sampleBody())

    expect(response.status).toBe(402)
    expect(response.body.error.code).toBe('TIER_UPGRADE_REQUIRED')
    expect(response.body.error.details.requiredTier).toBe('starter')
  })

  it('analyzes a statement end-to-end for a paid tier', async () => {
    const paidAuth = createAuthHeader('pro-user', { orgId: 'pro-org', tier: 'professional' })

    const response = await request(app)
      .post('/api/underwriting/analyze-statement')
      .set('Authorization', paidAuth)
      .send(sampleBody())

    expect(response.status).toBe(200)
    expect(response.headers['x-data-tier-resolved']).toBe('starter-tier')

    const { features, qualification, stackingDetected, capacityEstimate } = response.body.data
    expect(features.estimatedPositionCount).toBe(2)
    expect(stackingDetected).toBe(true)
    expect(features.balanceAnchored).toBe(true)
    expect(features.nsfCount).toBe(0)
    expect(typeof capacityEstimate).toBe('number')
    // The real QualificationService ran: a graded verdict with reasons.
    expect(qualification.tier).toBeDefined()
    expect(Array.isArray(qualification.reasons)).toBe(true)
    expect(qualification.reasons.length).toBeGreaterThan(0)
  })

  it('rejects a body without transactions', async () => {
    const paidAuth = createAuthHeader('pro-user', { orgId: 'pro-org', tier: 'professional' })

    const response = await request(app)
      .post('/api/underwriting/analyze-statement')
      .set('Authorization', paidAuth)
      .send({ industry: 'restaurant' })

    expect(response.status).toBe(400)
  })

  it('rejects transactions with a malformed date', async () => {
    const paidAuth = createAuthHeader('pro-user', { orgId: 'pro-org', tier: 'professional' })

    const response = await request(app)
      .post('/api/underwriting/analyze-statement')
      .set('Authorization', paidAuth)
      .send({
        transactions: [{ date: '06/01/2026', description: 'DEPOSIT', amount: -100 }]
      })

    expect(response.status).toBe(400)
  })
})
