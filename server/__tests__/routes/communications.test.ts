import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'
import { createAuthHeader } from '../helpers/testApp'
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler'
import { authMiddleware } from '../../middleware/authMiddleware'
import { ForbiddenError, ExternalServiceError } from '../../errors'

// Mock the CommunicationsService. The route instantiates it per-request
// (new CommunicationsService()), so a class whose methods are the shared mocks
// captures every call. Real constructor side effects (Twilio/SendGrid clients,
// compliance services) are bypassed entirely.
const {
  mockGetHistory,
  mockGetById,
  mockSendEmail,
  mockSendSMS,
  mockInitiateCall,
  mockListTemplates,
  mockScheduleFollowUp,
  mockGetPendingFollowUps,
  mockCancelFollowUp
} = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
  mockGetById: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendSMS: vi.fn(),
  mockInitiateCall: vi.fn(),
  mockListTemplates: vi.fn(),
  mockScheduleFollowUp: vi.fn(),
  mockGetPendingFollowUps: vi.fn(),
  mockCancelFollowUp: vi.fn()
}))

vi.mock('../../services/CommunicationsService', () => ({
  CommunicationsService: class MockCommunicationsService {
    getHistory = mockGetHistory
    getById = mockGetById
    sendEmail = mockSendEmail
    sendSMS = mockSendSMS
    initiateCall = mockInitiateCall
    listTemplates = mockListTemplates
    scheduleFollowUp = mockScheduleFollowUp
    getPendingFollowUps = mockGetPendingFollowUps
    cancelFollowUp = mockCancelFollowUp
  }
}))

// Import the router AFTER the mock is registered.
import communicationsRouter from '../../routes/communications'

function buildApp(): Express {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use('/api/communications', authMiddleware, communicationsRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('Communications API', () => {
  let app: Express
  let authHeader: string

  const mockOrgId = '550e8400-e29b-41d4-a716-446655440000'
  const mockCommId = '550e8400-e29b-41d4-a716-446655440001'
  const mockContactId = '550e8400-e29b-41d4-a716-446655440002'

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
    authHeader = createAuthHeader('test-user-123', { orgId: mockOrgId })
  })

  describe('GET /api/communications', () => {
    it('should return a paginated list of communications', async () => {
      mockGetHistory.mockResolvedValueOnce({
        communications: [
          { id: mockCommId, channel: 'email', direction: 'outbound', status: 'sent' },
          { id: '2', channel: 'sms', direction: 'inbound', status: 'received' }
        ],
        total: 2
      })

      const response = await request(app)
        .get(`/api/communications?org_id=${mockOrgId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('communications')
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.communications.length).toBe(2)
      expect(response.body.pagination.total).toBe(2)
      // page 1, default limit 50 -> offset 0.
      expect(mockGetHistory).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: mockOrgId, limit: 50, offset: 0 })
      )
    })

    it('should derive org from the token when no org_id is given', async () => {
      mockGetHistory.mockResolvedValueOnce({ communications: [], total: 0 })

      const response = await request(app)
        .get('/api/communications')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(mockGetHistory).toHaveBeenCalledWith(expect.objectContaining({ orgId: mockOrgId }))
    })

    it('should map page/limit to offset (page 2)', async () => {
      mockGetHistory.mockResolvedValueOnce({ communications: [], total: 0 })

      await request(app)
        .get(`/api/communications?org_id=${mockOrgId}&page=2&limit=10`)
        .set('Authorization', authHeader)

      expect(mockGetHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 10 })
      )
    })

    it('should forward channel/direction/contact filters to the service', async () => {
      mockGetHistory.mockResolvedValueOnce({ communications: [], total: 0 })

      await request(app)
        .get(
          `/api/communications?org_id=${mockOrgId}&channel=sms&direction=inbound&contact_id=${mockContactId}`
        )
        .set('Authorization', authHeader)

      expect(mockGetHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'sms',
          direction: 'inbound',
          contactId: mockContactId
        })
      )
    })

    it('should fail closed (403) when the token has no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const response = await request(app)
        .get('/api/communications')
        .set('Authorization', noOrgHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
      expect(mockGetHistory).not.toHaveBeenCalled()
    })

    it('should reject a mismatched org_id query param (403)', async () => {
      const otherOrg = '550e8400-e29b-41d4-a716-4466554409ff'

      const response = await request(app)
        .get(`/api/communications?org_id=${otherOrg}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })

    it('should require authentication', async () => {
      const response = await request(app).get('/api/communications')
      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/communications/templates', () => {
    it('should return templates wrapped in a { templates } envelope', async () => {
      mockListTemplates.mockResolvedValueOnce([{ id: 't1', name: 'Welcome', channel: 'email' }])

      const response = await request(app)
        .get(`/api/communications/templates?org_id=${mockOrgId}&channel=email`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.templates).toBeInstanceOf(Array)
      expect(response.body.templates.length).toBe(1)
      expect(mockListTemplates).toHaveBeenCalledWith(mockOrgId, 'email')
      // The literal /templates path must not be captured by GET /:id.
      expect(mockGetById).not.toHaveBeenCalled()
    })
  })

  describe('GET /api/communications/:id', () => {
    it('should return a communication by id', async () => {
      mockGetById.mockResolvedValueOnce({ id: mockCommId, channel: 'email', status: 'sent' })

      const response = await request(app)
        .get(`/api/communications/${mockCommId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe(mockCommId)
      expect(mockGetById).toHaveBeenCalledWith(mockCommId, mockOrgId)
    })

    it('should return 404 for a non-existent communication', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get(`/api/communications/${mockCommId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/communications/not-a-uuid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(response.body.error.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('POST /api/communications/send-email', () => {
    const validEmail = {
      contact_id: '550e8400-e29b-41d4-a716-446655440002',
      to_address: 'jane@example.com',
      subject: 'Hello',
      body: 'Hi there'
    }

    it('should send an email and return 201 with the persisted record', async () => {
      mockSendEmail.mockResolvedValueOnce({
        id: mockCommId,
        channel: 'email',
        status: 'sent',
        toAddress: 'jane@example.com'
      })

      const response = await request(app)
        .post('/api/communications/send-email')
        .set('Authorization', authHeader)
        .send(validEmail)

      expect(response.status).toBe(201)
      expect(response.body.id).toBe(mockCommId)
      expect(response.body.status).toBe('sent')
      expect(mockSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: mockOrgId,
          toAddress: 'jane@example.com',
          subject: 'Hello',
          body: 'Hi there'
        })
      )
    })

    it('should surface a compliance/suppression block as 403 (never a fake success)', async () => {
      mockSendEmail.mockRejectedValueOnce(
        new ForbiddenError('Recipient email is on the suppression (DNC) list')
      )

      const response = await request(app)
        .post('/api/communications/send-email')
        .set('Authorization', authHeader)
        .send(validEmail)

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
      expect(response.body.error.message).toMatch(/suppression/i)
    })

    it('should surface a provider-returned send failure as a named 502', async () => {
      // sendEmail throws ExternalServiceError('SendGrid', ...) when the provider
      // returns a failure — the service never fabricates a success.
      mockSendEmail.mockRejectedValueOnce(
        new ExternalServiceError('SendGrid', 'Failed to send email: 451 mailbox unavailable')
      )

      const response = await request(app)
        .post('/api/communications/send-email')
        .set('Authorization', authHeader)
        .send(validEmail)

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('EXTERNAL_SERVICE_ERROR')
      expect(response.body.error.details).toEqual(expect.objectContaining({ service: 'SendGrid' }))
    })

    it('should reject a malformed email address (400)', async () => {
      const response = await request(app)
        .post('/api/communications/send-email')
        .set('Authorization', authHeader)
        .send({ ...validEmail, to_address: 'not-an-email' })

      expect(response.status).toBe(400)
      expect(mockSendEmail).not.toHaveBeenCalled()
    })

    it('should reject a body org_id that does not match the token (403)', async () => {
      const response = await request(app)
        .post('/api/communications/send-email')
        .set('Authorization', authHeader)
        .send({ ...validEmail, org_id: '550e8400-e29b-41d4-a716-4466554409ff' })

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
      expect(mockSendEmail).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/communications/send-sms', () => {
    const validSms = {
      contact_id: '550e8400-e29b-41d4-a716-446655440002',
      to_phone: '+15551234567',
      body: 'Hi there'
    }

    it('should surface an unconfigured/unreachable provider as a named 502', async () => {
      // sendSMS throws ExternalServiceError('Twilio', ...) when the provider is
      // unconfigured/unreachable — the service never fabricates a success.
      mockSendSMS.mockRejectedValueOnce(new ExternalServiceError('Twilio', 'Failed to send SMS'))

      const response = await request(app)
        .post('/api/communications/send-sms')
        .set('Authorization', authHeader)
        .send(validSms)

      expect(response.status).toBe(502)
      expect(response.body.error.code).toBe('EXTERNAL_SERVICE_ERROR')
      // The named failing service is carried in the structured details.
      expect(response.body.error.details).toEqual(expect.objectContaining({ service: 'Twilio' }))
    })

    it('should send an SMS and return 201 on success', async () => {
      mockSendSMS.mockResolvedValueOnce({ id: mockCommId, channel: 'sms', status: 'sent' })

      const response = await request(app)
        .post('/api/communications/send-sms')
        .set('Authorization', authHeader)
        .send(validSms)

      expect(response.status).toBe(201)
      expect(response.body.status).toBe('sent')
      expect(mockSendSMS).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: mockOrgId, toPhone: '+15551234567' })
      )
    })

    it('should require a body (400)', async () => {
      const response = await request(app)
        .post('/api/communications/send-sms')
        .set('Authorization', authHeader)
        .send({ contact_id: validSms.contact_id, to_phone: validSms.to_phone })

      expect(response.status).toBe(400)
      expect(mockSendSMS).not.toHaveBeenCalled()
    })
  })

  describe('follow-ups', () => {
    it('GET /follow-ups should return pending follow-ups for a contact', async () => {
      mockGetPendingFollowUps.mockResolvedValueOnce([
        { id: 'f1', scheduledFor: '2026-07-01T00:00:00.000Z', channel: 'email' }
      ])

      const response = await request(app)
        .get(`/api/communications/follow-ups?contact_id=${mockContactId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.followUps.length).toBe(1)
      // The resolved tenant orgId is forwarded so the lookup is org-scoped.
      expect(mockGetPendingFollowUps).toHaveBeenCalledWith(mockContactId, mockOrgId)
    })

    it('POST /follow-ups should schedule and return 201', async () => {
      mockScheduleFollowUp.mockResolvedValueOnce({
        id: 'f1',
        scheduledFor: '2026-07-01T00:00:00.000Z',
        channel: 'sms'
      })

      const response = await request(app)
        .post('/api/communications/follow-ups')
        .set('Authorization', authHeader)
        .send({
          contact_id: mockContactId,
          channel: 'sms',
          scheduled_for: '2026-07-01T00:00:00.000Z'
        })

      expect(response.status).toBe(201)
      expect(response.body.id).toBe('f1')
      expect(mockScheduleFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: mockOrgId, contactId: mockContactId, channel: 'sms' })
      )
    })

    it('DELETE /follow-ups/:id should return 404 when nothing was cancelled', async () => {
      mockCancelFollowUp.mockResolvedValueOnce(false)

      const response = await request(app)
        .delete(`/api/communications/follow-ups/${mockCommId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('DELETE /follow-ups/:id should return 204 on success', async () => {
      mockCancelFollowUp.mockResolvedValueOnce(true)

      const response = await request(app)
        .delete(`/api/communications/follow-ups/${mockCommId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(204)
      // The resolved tenant orgId is forwarded so the cancel is org-scoped.
      expect(mockCancelFollowUp).toHaveBeenCalledWith(mockCommId, mockOrgId)
    })

    it('DELETE /follow-ups/:id cannot cancel another org follow-up (404)', async () => {
      // The service applies an org_id predicate, so a cross-org id deletes
      // nothing and returns false -> the route surfaces a 404 (the foreign
      // follow-up is uncancellable and indistinguishable from not-found).
      mockCancelFollowUp.mockResolvedValueOnce(false)

      const response = await request(app)
        .delete(`/api/communications/follow-ups/${mockCommId}`)
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(mockCancelFollowUp).toHaveBeenCalledWith(mockCommId, mockOrgId)
    })
  })
})
