import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { authMiddleware } from '../../middleware/authMiddleware'
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler'
import { createAuthHeader } from '../helpers/testApp'

// Mock the executor + database before importing the router under test.
const mocks = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockDbQuery: vi.fn()
}))

vi.mock('../../services/ImprovementExecutor', () => ({
  ImprovementExecutor: class MockImprovementExecutor {
    execute = mocks.mockExecute
  }
}))

vi.mock('../../database/connection', () => ({
  database: { query: mocks.mockDbQuery }
}))

import agenticRouter from '../../routes/agentic'

const mockOrgId = '550e8400-e29b-41d4-a716-446655440000'
const cycleId = '550e8400-e29b-41d4-a716-4466554400aa'

function buildApp(): Express {
  const app = express()
  // Use a generous express body limit (above the route's own 128KB cap) so the
  // route-level size guard — not express's parser — is the gate under test.
  app.use(express.json({ limit: '2mb' }))
  app.use('/api/agentic', authMiddleware, agenticRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('Agentic Routes', () => {
  let app: Express
  let authHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
    authHeader = createAuthHeader('test-user-123', { orgId: mockOrgId })
  })

  describe('POST /api/agentic/execute', () => {
    const improvement = {
      id: 'imp-1',
      category: 'performance',
      title: 'Re-enrich stale prospects',
      prospectIds: [mockOrgId]
    }

    it('returns the executor result verbatim (200) for a real action', async () => {
      const result = {
        executed: true,
        action: 're-enrichment',
        details: { jobId: 'job-42', queueName: 'data-enrichment' }
      }
      mocks.mockExecute.mockResolvedValueOnce(result)

      const response = await request(app)
        .post('/api/agentic/execute')
        .set('Authorization', authHeader)
        .send(improvement)

      expect(response.status).toBe(200)
      expect(response.body).toEqual(result)
      expect(mocks.mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'imp-1', category: 'performance' }),
        mockOrgId
      )
    })

    it('passes through a fail-closed executed:false result without an HTTP error', async () => {
      const result = {
        executed: false,
        action: 'none',
        details: {},
        reason: 'no server-side action for category usability'
      }
      mocks.mockExecute.mockResolvedValueOnce(result)

      const response = await request(app)
        .post('/api/agentic/execute')
        .set('Authorization', authHeader)
        .send({ id: 'imp-2', category: 'usability', title: 'Tidy the dashboard' })

      expect(response.status).toBe(200)
      expect(response.body.executed).toBe(false)
      expect(response.body.reason).toContain('no server-side action')
    })

    it('fails closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .post('/api/agentic/execute')
        .set('Authorization', noOrgHeader)
        .send(improvement)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
      expect(mocks.mockExecute).not.toHaveBeenCalled()
    })

    it('rejects a mismatched org_id (403)', async () => {
      const response = await request(app)
        .post('/api/agentic/execute')
        .set('Authorization', authHeader)
        .send({ ...improvement, org_id: '550e8400-e29b-41d4-a716-4466554409ff' })

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('rejects an invalid body (400)', async () => {
      const response = await request(app)
        .post('/api/agentic/execute')
        .set('Authorization', authHeader)
        .send({ id: 'imp-3' }) // missing category + title

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
      expect(mocks.mockExecute).not.toHaveBeenCalled()
    })

    it('requires authentication (401)', async () => {
      const response = await request(app).post('/api/agentic/execute').send(improvement)

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/agentic/callbacks', () => {
    const payload = {
      review: { id: cycleId, status: 'completed' },
      executedImprovements: [{ id: 'imp-1' }],
      pendingImprovements: [{ id: 'imp-2' }, { id: 'imp-3' }]
    }

    it('persists the cycle payload and returns 202', async () => {
      mocks.mockDbQuery.mockResolvedValueOnce([])

      const response = await request(app)
        .post('/api/agentic/callbacks')
        .set('Authorization', authHeader)
        .send(payload)

      expect(response.status).toBe(202)
      expect(response.body).toMatchObject({
        status: 'accepted',
        cycleId,
        executed: 1,
        pending: 2
      })

      expect(mocks.mockDbQuery).toHaveBeenCalledTimes(1)
      const [, params] = mocks.mockDbQuery.mock.calls[0]
      expect(params[0]).toBe(mockOrgId) // org_id
      expect(params[3]).toBe('agentic_cycle') // entity_type
      expect(params[4]).toBe(cycleId) // entity_id
    })

    it('rejects a non-UUID cycle id (400) — fails closed before the DB', async () => {
      const response = await request(app)
        .post('/api/agentic/callbacks')
        .set('Authorization', authHeader)
        .send({ ...payload, review: { id: 'not-a-uuid' } })

      expect(response.status).toBe(400)
      expect(mocks.mockDbQuery).not.toHaveBeenCalled()
    })

    it('fails closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .post('/api/agentic/callbacks')
        .set('Authorization', noOrgHeader)
        .send(payload)

      expect(response.status).toBe(403)
      expect(mocks.mockDbQuery).not.toHaveBeenCalled()
    })

    it('rejects an oversized payload (413) before persisting to audit_logs', async () => {
      // Build a payload whose serialized form comfortably exceeds the 128KB cap
      // (each pending improvement id is ~200 bytes; 2000 of them clears it).
      const oversizedPending = Array.from({ length: 2000 }, (_, i) => ({
        id: `imp-${i}`,
        blob: 'x'.repeat(200)
      }))

      const response = await request(app)
        .post('/api/agentic/callbacks')
        .set('Authorization', authHeader)
        .send({ ...payload, pendingImprovements: oversizedPending })

      expect(response.status).toBe(413)
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE')
      expect(response.body.error.message).toContain('too large')
      // Nothing reaches the durable audit sink.
      expect(mocks.mockDbQuery).not.toHaveBeenCalled()
    })
  })
})
