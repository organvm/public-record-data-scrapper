import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'
import { createAuthHeader } from '../helpers/testApp'

// Mock LeadDiscoveryService so route tests never touch channels/DB.
const { mockRun, mockListChannels } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockListChannels: vi.fn()
}))

vi.mock('../../services/LeadDiscoveryService', () => ({
  LeadDiscoveryService: class MockLeadDiscoveryService {
    run = mockRun
    listChannels = mockListChannels
  }
}))

import discoveryRouter from '../../routes/discovery'
import { authMiddleware } from '../../middleware/authMiddleware'
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler'

/**
 * Local test app. The shared testApp helper does not (yet) mount the discovery
 * router — and route mounting is a later integration step — so we build a
 * minimal app here mirroring its auth + error wiring.
 */
function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/api/discovery', authMiddleware, discoveryRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('Discovery API', () => {
  let app: Express
  let authHeader: string
  const ORG_ID = '550e8400-e29b-41d4-a716-446655440000'

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
    authHeader = createAuthHeader('test-user-123', { orgId: ORG_ID })
  })

  describe('POST /api/discovery/run', () => {
    it('runs discovery and returns the aggregated report', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 3,
        inserted: 2,
        duplicates: 1,
        per_channel: [
          { channel: 'sec-edgar-registrants', configured: true, candidates_found: 2, error: null },
          { channel: 'sba-7a-loans', configured: true, candidates_found: 1, error: null }
        ]
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ state: 'CA', limit: 10 })

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        candidates_found: 3,
        inserted: 2,
        duplicates: 1
      })
      expect(response.body.per_channel).toHaveLength(2)
      // Org derived from the token; state uppercased; limit forwarded.
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: ORG_ID, state: 'CA', limit: 10 })
      )
    })

    it('forwards a channels filter to the service', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 0,
        inserted: 0,
        duplicates: 0,
        per_channel: []
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ channels: ['sba-7a-loans'] })

      expect(response.status).toBe(200)
      expect(mockRun).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: ORG_ID, channels: ['sba-7a-loans'] })
      )
    })

    it('uppercases a lowercase state on the wire', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 0,
        inserted: 0,
        duplicates: 0,
        per_channel: []
      })

      await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ state: 'ny' })

      expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ state: 'NY' }))
    })

    it('rejects an invalid state (not 2 letters) with 400', async () => {
      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ state: 'California' })

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(mockRun).not.toHaveBeenCalled()
    })

    it('rejects unknown body fields (strict schema) with 400', async () => {
      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ bogus: true })

      expect(response.status).toBe(400)
      expect(mockRun).not.toHaveBeenCalled()
    })

    it('fails closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', noOrgHeader)
        .send({})

      expect(response.status).toBe(403)
      expect(mockRun).not.toHaveBeenCalled()
    })

    it('rejects a body org_id that does not match the token (403)', async () => {
      // A structurally-valid UUID that differs from the token's org so the
      // request clears zod validation and is rejected by the org cross-check.
      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ org_id: '550e8400-e29b-41d4-a716-446655440099' })

      expect(response.status).toBe(403)
      expect(mockRun).not.toHaveBeenCalled()
    })

    it('requires authentication (401 without a token)', async () => {
      const response = await request(app).post('/api/discovery/run').send({})
      expect(response.status).toBe(401)
      expect(mockRun).not.toHaveBeenCalled()
    })

    it('fails closed (502) when EVERY attempted channel errored and nothing was collected', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 0,
        inserted: 0,
        duplicates: 0,
        per_channel: [
          {
            channel: 'sec-edgar-registrants',
            configured: true,
            candidates_found: 0,
            error: 'sec-edgar-registrants: SEC EDGAR unreachable'
          },
          {
            channel: 'sba-7a-loans',
            configured: true,
            candidates_found: 0,
            error: 'sba-7a-loans: SBA CSV returned HTTP 503 Service Unavailable'
          }
        ]
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('DISCOVERY_ALL_CHANNELS_FAILED')
      // The per-channel errors are surfaced in the envelope, not swallowed.
      expect(response.body.per_channel).toHaveLength(2)
      expect(
        response.body.per_channel.every((c: { error: string | null }) => c.error !== null)
      ).toBe(true)
    })

    it('treats an unconfigured-only run as all-channels-failed (502)', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 0,
        inserted: 0,
        duplicates: 0,
        per_channel: [
          {
            channel: 'sba-7a-loans',
            configured: false,
            candidates_found: 0,
            error: 'sba-7a-loans: not configured'
          }
        ]
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ channels: ['sba-7a-loans'] })

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('DISCOVERY_ALL_CHANNELS_FAILED')
    })

    it('keeps a PARTIAL failure at 200 (some channels answered)', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 2,
        inserted: 2,
        duplicates: 0,
        per_channel: [
          { channel: 'sec-edgar-registrants', configured: true, candidates_found: 2, error: null },
          {
            channel: 'sba-7a-loans',
            configured: true,
            candidates_found: 0,
            error: 'sba-7a-loans: SBA CSV returned HTTP 503 Service Unavailable'
          }
        ]
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({})

      expect(response.status).toBe(200)
      expect(response.body.inserted).toBe(2)
      expect(response.body.per_channel).toHaveLength(2)
    })

    it('returns 200 when no channels were attempted (empty per_channel)', async () => {
      mockRun.mockResolvedValueOnce({
        candidates_found: 0,
        inserted: 0,
        duplicates: 0,
        per_channel: []
      })

      const response = await request(app)
        .post('/api/discovery/run')
        .set('Authorization', authHeader)
        .send({ channels: ['nonexistent-channel'] })

      expect(response.status).toBe(200)
      expect(response.body.inserted).toBe(0)
    })
  })

  describe('GET /api/discovery/channels', () => {
    it('lists channels and their configured state', async () => {
      mockListChannels.mockReturnValueOnce([
        { name: 'sec-edgar-registrants', configured: true },
        { name: 'socrata-building-permits', configured: true },
        { name: 'sba-7a-loans', configured: true }
      ])

      const response = await request(app)
        .get('/api/discovery/channels')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.channels).toHaveLength(3)
      expect(response.body.channels[0]).toEqual({
        name: 'sec-edgar-registrants',
        configured: true
      })
    })

    it('fails closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })
      const response = await request(app)
        .get('/api/discovery/channels')
        .set('Authorization', noOrgHeader)

      expect(response.status).toBe(403)
      expect(mockListChannels).not.toHaveBeenCalled()
    })
  })
})
