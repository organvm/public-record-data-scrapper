import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import type { Express } from 'express'
import { getResolvedDataTier } from '../../middleware/dataTier'

const { mockDeliverLead, mockGetById } = vi.hoisted(() => ({
  mockDeliverLead: vi.fn(),
  mockGetById: vi.fn()
}))

vi.mock('../../services/DeliveryService', () => ({
  DeliveryService: class MockDeliveryService {
    deliverLead = mockDeliverLead
  }
}))

vi.mock('../../middleware/dataTier', async () => {
  const actual = await vi.importActual('../../middleware/dataTier')
  return {
    ...actual,
    getResolvedDataTier: vi.fn()
  }
})

vi.mock('../../services/ProspectsService', () => ({
  ProspectsService: class MockProspectsService {
    getById = mockGetById
  }
}))

const PROSPECT_A = '550e8400-e29b-41d4-a716-446655440000'
const MISSING = '00000000-0000-0000-0000-000000000000'

describe('POST /api/prospects/:id/deliver', () => {
  let app: Express
  let authHeader: string
  let freeAuthHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    authHeader = createAuthHeader('user-pro', { orgId: 'org-pro', tier: 'pro' })
    freeAuthHeader = createAuthHeader('user-free', { orgId: 'org-free', tier: 'free' })
    vi.mocked(getResolvedDataTier).mockReturnValue('starter-tier')
  })

  it('delivers a prospect to zapier and returns the result', async () => {
    mockGetById.mockResolvedValueOnce({ id: PROSPECT_A, companyName: 'Acme Co' })
    mockDeliverLead.mockResolvedValueOnce({ success: true, providerId: 'mock-123' })

    const response = await request(app)
      .post(`/api/prospects/${PROSPECT_A}/deliver`)
      .set('Authorization', authHeader)
      .send({ integration: 'zapier', webhookUrl: 'https://hooks.zapier.com/foo' })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.providerId).toBe('mock-123')
    expect(mockDeliverLead).toHaveBeenCalledWith(expect.objectContaining({ id: PROSPECT_A }), {
      integration: 'zapier',
      webhookUrl: 'https://hooks.zapier.com/foo'
    })
  })

  it('requires a pro tier', async () => {
    vi.mocked(getResolvedDataTier).mockReturnValue('free-tier')
    const response = await request(app)
      .post(`/api/prospects/${PROSPECT_A}/deliver`)
      .set('Authorization', freeAuthHeader)
      .send({ integration: 'zapier', webhookUrl: 'https://hooks.zapier.com/foo' })

    expect(response.status).toBe(402)
    expect(response.body.error.code).toBe('TIER_UPGRADE_REQUIRED')
  })

  it('returns 404 if prospect not found', async () => {
    mockGetById.mockResolvedValueOnce(null)
    const response = await request(app)
      .post(`/api/prospects/${MISSING}/deliver`)
      .set('Authorization', authHeader)
      .send({ integration: 'zapier', webhookUrl: 'https://hooks.zapier.com/foo' })

    expect(response.status).toBe(404)
  })

  it('validates the payload', async () => {
    const response = await request(app)
      .post(`/api/prospects/${PROSPECT_A}/deliver`)
      .set('Authorization', authHeader)
      .send({ integration: 'invalid-integration', webhookUrl: 'not-a-url' })

    expect(response.status).toBe(400)
  })

  it('returns 502 if delivery fails', async () => {
    mockGetById.mockResolvedValueOnce({ id: PROSPECT_A, companyName: 'Acme Co' })
    mockDeliverLead.mockResolvedValueOnce({ success: false, error: 'Network timeout' })

    const response = await request(app)
      .post(`/api/prospects/${PROSPECT_A}/deliver`)
      .set('Authorization', authHeader)
      .send({ integration: 'zapier', webhookUrl: 'https://hooks.zapier.com/foo' })

    expect(response.status).toBe(502)
    expect(response.body.error.message).toBe('Network timeout')
  })
})
