import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import { authMiddleware } from '../../middleware/authMiddleware'
import { dataTierRouter } from '../../middleware/dataTier'
import prospectsRouter from '../../routes/prospects'
import { errorHandler } from '../../middleware/errorHandler'
import type { Express } from 'express'

const { mockExportLeads, mockSerializeLeadExportCsv } = vi.hoisted(() => ({
  mockExportLeads: vi.fn(),
  mockSerializeLeadExportCsv: vi.fn()
}))

vi.mock('../../services/LeadExportService', () => ({
  LeadExportService: class MockLeadExportService {
    exportLeads = mockExportLeads
  },
  serializeLeadExportCsv: mockSerializeLeadExportCsv
}))

function leadExportBatch() {
  return {
    batch: {
      id: 'lead-export-2026-06-19T00-00-00-000Z',
      generated_at: '2026-06-19T00:00:00.000Z',
      filters: { state: 'CA', min_score: 80 },
      limit: 5,
      offset: 10,
      count: 1,
      total: 11,
      next_offset: null
    },
    leads: [
      {
        prospect_id: 'prospect-1',
        company_name: 'Acme Bistro',
        state: 'CA',
        industry: 'restaurant',
        status: 'new',
        mca_score: 91,
        score_grade: 'A',
        recommendation: 'high_priority',
        score_confidence: 90,
        estimated_revenue: 350000,
        default_date: '2026-01-01',
        days_since_default: 50,
        last_filing_date: '2026-02-01',
        ucc_filing_count: 2,
        active_ucc_count: 1,
        terminated_ucc_count: 1,
        lapsed_ucc_count: 0,
        secured_parties: ['Rapid Funding LLC'],
        narrative: 'Recommended for immediate outreach.'
      }
    ]
  }
}

describe('Lead export API', () => {
  let app: Express
  let authHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    authHeader = createAuthHeader()
  })

  it('returns a JSON lead export batch', async () => {
    mockExportLeads.mockResolvedValueOnce(leadExportBatch())

    const response = await request(app)
      .get('/api/prospects/export/leads?state=ca&min_score=80&limit=5&offset=10&status=new')
      .set('Authorization', authHeader)

    expect(response.status).toBe(200)
    expect(response.body.batch.id).toBe('lead-export-2026-06-19T00-00-00-000Z')
    expect(response.body.leads[0].mca_score).toBe(91)
    expect(mockExportLeads).toHaveBeenCalledWith({
      state: 'CA',
      industry: undefined,
      status: 'new',
      minScore: 80,
      maxScore: undefined,
      limit: 5,
      offset: 10
    })
  })

  it('returns a CSV lead export batch', async () => {
    const batch = leadExportBatch()
    mockExportLeads.mockResolvedValueOnce(batch)
    mockSerializeLeadExportCsv.mockReturnValueOnce('prospect_id,company_name\nprospect-1,Acme Bistro')

    const response = await request(app)
      .get('/api/prospects/export/leads?format=csv')
      .set('Authorization', authHeader)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toContain(
      'filename="lead-export-2026-06-19T00-00-00-000Z.csv"'
    )
    expect(response.text).toContain('prospect_id,company_name')
    expect(mockSerializeLeadExportCsv).toHaveBeenCalledWith(batch)
  })

  it('validates score range parameters', async () => {
    const response = await request(app)
      .get('/api/prospects/export/leads?min_score=90&max_score=80')
      .set('Authorization', authHeader)

    expect(response.status).toBe(400)
    expect(mockExportLeads).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const response = await request(app).get('/api/prospects/export/leads')

    expect(response.status).toBe(401)
  })
})

// Tier gating through the REAL auth → dataTier chain (production mount order,
// per #353): a verified `tier` claim resolves without any DB lookup, so these
// tests exercise genuine server-side tier resolution, not a mocked accessor.
describe('Lead export tier gating', () => {
  let app: Express

  function createTieredApp(): Express {
    const tiered = express()
    tiered.use(express.json())
    tiered.use('/api/prospects', authMiddleware, dataTierRouter, prospectsRouter)
    tiered.use(errorHandler)
    return tiered
  }

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTieredApp()
  })

  it('free-tier: floors min_score to 70 and caps limit at the list parity cap', async () => {
    mockExportLeads.mockResolvedValueOnce(leadExportBatch())
    const freeAuth = createAuthHeader('free-user', { orgId: 'free-org', tier: 'free' })

    const response = await request(app)
      .get('/api/prospects/export/leads?min_score=0&limit=500')
      .set('Authorization', freeAuth)

    expect(response.status).toBe(200)
    expect(mockExportLeads).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 70, limit: 20 })
    )
  })

  it('free-tier: respects a caller min_score already above the floor', async () => {
    mockExportLeads.mockResolvedValueOnce(leadExportBatch())
    const freeAuth = createAuthHeader('free-user', { orgId: 'free-org', tier: 'free' })

    const response = await request(app)
      .get('/api/prospects/export/leads?min_score=85')
      .set('Authorization', freeAuth)

    expect(response.status).toBe(200)
    expect(mockExportLeads).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 85, limit: 20 })
    )
  })

  it('starter-tier: passes an explicit min_score=0 and full limit through unchanged', async () => {
    mockExportLeads.mockResolvedValueOnce(leadExportBatch())
    const paidAuth = createAuthHeader('pro-user', { orgId: 'pro-org', tier: 'professional' })

    const response = await request(app)
      .get('/api/prospects/export/leads?min_score=0&limit=1000')
      .set('Authorization', paidAuth)

    expect(response.status).toBe(200)
    expect(mockExportLeads).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 0, limit: 1000 })
    )
  })

  it('fails closed to free-tier when the chain omits dataTierRouter', async () => {
    mockExportLeads.mockResolvedValueOnce(leadExportBatch())
    const bare = express()
    bare.use(express.json())
    bare.use('/api/prospects', authMiddleware, prospectsRouter)
    bare.use(errorHandler)
    const paidAuth = createAuthHeader('pro-user', { orgId: 'pro-org', tier: 'professional' })

    const response = await request(bare)
      .get('/api/prospects/export/leads?min_score=0&limit=1000')
      .set('Authorization', paidAuth)

    expect(response.status).toBe(200)
    expect(mockExportLeads).toHaveBeenCalledWith(
      expect.objectContaining({ minScore: 70, limit: 20 })
    )
  })
})
