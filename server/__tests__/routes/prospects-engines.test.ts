import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import type { Express } from 'express'

// Hoisted mocks so vi.mock factories can reference them.
const { mockGetById, mockUpdate, mockScoreProspect, mockQualify, mockExtractFeatures } = vi.hoisted(
  () => ({
    mockGetById: vi.fn(),
    mockUpdate: vi.fn(),
    mockScoreProspect: vi.fn(),
    mockQualify: vi.fn(),
    mockExtractFeatures: vi.fn()
  })
)

vi.mock('../../services/ProspectsService', () => ({
  ProspectsService: class MockProspectsService {
    getById = mockGetById
    update = mockUpdate
  }
}))

vi.mock('../../services/ScoringService', () => ({
  ScoringService: class MockScoringService {
    scoreProspect = mockScoreProspect
  }
}))

vi.mock('../../services/QualificationService', () => ({
  QualificationService: class MockQualificationService {
    qualify = mockQualify
  }
}))

vi.mock('../../services/UnderwritingService', () => ({
  UnderwritingService: class MockUnderwritingService {
    extractFeatures = mockExtractFeatures
  }
}))

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000'

// A complete UnderwritingFeatures-shaped payload carrying every input the
// QualificationService genuinely reads.
function completeBankFeatures() {
  return {
    averageDailyBalance: 22000,
    minimumDailyBalance: 1500,
    maximumDailyBalance: 60000,
    currentBalance: 18000,
    nsfCount: 1,
    nsfFeeTotal: 35,
    negativeDays: 2,
    negativeDaysPercentage: 1.1,
    balanceAnchored: true,
    lenderPayments: [],
    estimatedPositionCount: 1,
    estimatedPaymentObligations: 200,
    revenueTrend: {
      direction: 'increasing',
      percentageChange: 12,
      averageMonthlyRevenue: 40000,
      medianMonthlyRevenue: 38000,
      seasonalityScore: 20,
      monthlyData: []
    },
    averageMonthlyDeposits: 40000,
    totalDeposits: 240000,
    depositConsistencyScore: 80,
    daysSinceLastDeposit: 2,
    analysisStartDate: '2026-01-01',
    analysisEndDate: '2026-06-01',
    totalDaysAnalyzed: 180,
    totalTransactionsAnalyzed: 520,
    primaryAccountId: 'acc-1',
    primaryAccountType: 'depository/checking'
  }
}

function scoringResult() {
  return {
    intentScore: 80,
    healthScore: 70,
    positionScore: 75,
    compositeScore: 76,
    grade: 'A',
    confidence: 85,
    factors: [],
    recommendation: 'high_priority',
    narrative: 'Acme shows strong MCA potential.'
  }
}

describe('Prospect engine routes', () => {
  let app: Express
  let authHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    authHeader = createAuthHeader()
  })

  describe('POST /api/prospects/:id/score', () => {
    it('computes the score, persists it, and returns the result', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme', state: 'CA' })
      mockScoreProspect.mockResolvedValueOnce(scoringResult())
      mockUpdate.mockResolvedValueOnce({
        id: VALID_ID,
        company_name: 'Acme',
        priority_score: 76,
        narrative: 'Acme shows strong MCA potential.'
      })

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/score`)
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(200)
      expect(response.body.scoring.compositeScore).toBe(76)
      expect(response.body.prospect.priority_score).toBe(76)
      // Persisted composite as priority_score + narrative.
      expect(mockUpdate).toHaveBeenCalledWith(
        VALID_ID,
        expect.objectContaining({
          priorityScore: 76,
          narrative: 'Acme shows strong MCA potential.'
        })
      )
    })

    it('returns 404 when the prospect does not exist', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/score`)
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
      expect(mockScoreProspect).not.toHaveBeenCalled()
    })

    it('validates the UUID', async () => {
      const response = await request(app)
        .post('/api/prospects/not-a-uuid/score')
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(400)
    })

    it('requires authentication', async () => {
      const response = await request(app).post(`/api/prospects/${VALID_ID}/score`).send({})
      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/prospects/:id/qualify', () => {
    it('qualifies when complete bank features are supplied', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })
      mockQualify.mockResolvedValueOnce({ qualified: true, tier: 'B', maxAmount: 50000 })

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/qualify`)
        .set('Authorization', authHeader)
        .send({ bankFeatures: completeBankFeatures(), timeInBusinessMonths: 18 })

      expect(response.status).toBe(200)
      expect(response.body.qualification.tier).toBe('B')
      expect(mockQualify).toHaveBeenCalledWith(
        VALID_ID,
        expect.objectContaining({ averageDailyBalance: 22000 }),
        expect.objectContaining({ timeInBusinessMonths: 18 })
      )
    })

    it('fails closed with 422 naming missing inputs when bankFeatures is absent', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/qualify`)
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('MISSING_QUALIFICATION_INPUTS')
      expect(response.body.error.details.missing).toContain('averageDailyBalance')
      expect(response.body.error.details.missing).toContain('revenueTrend')
      expect(mockQualify).not.toHaveBeenCalled()
    })

    it('fails closed with 422 naming exactly the partially-missing inputs', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })
      const features = completeBankFeatures() as Record<string, unknown>
      delete features.nsfCount
      delete features.depositConsistencyScore

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/qualify`)
        .set('Authorization', authHeader)
        .send({ bankFeatures: features })

      expect(response.status).toBe(422)
      expect(response.body.error.details.missing).toEqual(
        expect.arrayContaining(['nsfCount', 'depositConsistencyScore'])
      )
      expect(response.body.error.details.missing).not.toContain('averageDailyBalance')
      expect(mockQualify).not.toHaveBeenCalled()
    })

    it('returns 404 for a missing prospect', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/qualify`)
        .set('Authorization', authHeader)
        .send({ bankFeatures: completeBankFeatures() })

      expect(response.status).toBe(404)
      expect(mockQualify).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/prospects/:id/underwrite', () => {
    it('extracts features when an access token is supplied', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })
      mockExtractFeatures.mockResolvedValueOnce(completeBankFeatures())

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/underwrite`)
        .set('Authorization', authHeader)
        .send({ accessToken: 'access-sandbox-123' })

      expect(response.status).toBe(200)
      expect(response.body.features.averageDailyBalance).toBe(22000)
      expect(mockExtractFeatures).toHaveBeenCalledWith('access-sandbox-123', expect.anything())
    })

    it('chains into qualification when qualify=true', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })
      mockExtractFeatures.mockResolvedValueOnce(completeBankFeatures())
      mockQualify.mockResolvedValueOnce({ qualified: true, tier: 'A' })

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/underwrite`)
        .set('Authorization', authHeader)
        .send({ accessToken: 'access-sandbox-123', qualify: true })

      expect(response.status).toBe(200)
      expect(response.body.qualification.tier).toBe('A')
      expect(mockQualify).toHaveBeenCalledWith(
        VALID_ID,
        expect.objectContaining({ averageDailyBalance: 22000 }),
        expect.anything()
      )
    })

    it('fails closed with 422 naming accessToken when missing', async () => {
      mockGetById.mockResolvedValueOnce({ id: VALID_ID, company_name: 'Acme' })

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/underwrite`)
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe('MISSING_UNDERWRITING_INPUTS')
      expect(response.body.error.details.missing).toEqual(['accessToken'])
      expect(mockExtractFeatures).not.toHaveBeenCalled()
    })

    it('returns 404 for a missing prospect', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .post(`/api/prospects/${VALID_ID}/underwrite`)
        .set('Authorization', authHeader)
        .send({ accessToken: 'access-sandbox-123' })

      expect(response.status).toBe(404)
      expect(mockExtractFeatures).not.toHaveBeenCalled()
    })
  })
})
