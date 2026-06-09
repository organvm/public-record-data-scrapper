import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { type Express } from 'express'
import { createAuthHeader } from '../helpers/testApp'
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler'
import { authMiddleware } from '../../middleware/authMiddleware'
import { NotFoundError, ValidationError } from '../../errors'

// The three compliance services are singletons imported by the route. Mock the
// exported instances so the route layer is exercised without a database.
const {
  // DisclosureService
  mockDisclosureList,
  mockDisclosureGetById,
  mockDisclosureGetByDealId,
  mockDisclosureGenerate,
  mockDisclosureMarkAsSent,
  mockDisclosureRecordSignature,
  // ConsentService
  mockConsentGetForContact,
  mockConsentGetStats,
  mockConsentRecord,
  mockConsentRevoke,
  // AuditService
  mockAuditSearch,
  mockAuditExport,
  mockAuditEntityHistory
} = vi.hoisted(() => ({
  mockDisclosureList: vi.fn(),
  mockDisclosureGetById: vi.fn(),
  mockDisclosureGetByDealId: vi.fn(),
  mockDisclosureGenerate: vi.fn(),
  mockDisclosureMarkAsSent: vi.fn(),
  mockDisclosureRecordSignature: vi.fn(),
  mockConsentGetForContact: vi.fn(),
  mockConsentGetStats: vi.fn(),
  mockConsentRecord: vi.fn(),
  mockConsentRevoke: vi.fn(),
  mockAuditSearch: vi.fn(),
  mockAuditExport: vi.fn(),
  mockAuditEntityHistory: vi.fn()
}))

vi.mock('../../services/DisclosureService', () => ({
  disclosureService: {
    list: mockDisclosureList,
    getById: mockDisclosureGetById,
    getByDealId: mockDisclosureGetByDealId,
    generate: mockDisclosureGenerate,
    markAsSent: mockDisclosureMarkAsSent,
    recordSignature: mockDisclosureRecordSignature
  }
}))

vi.mock('../../services/ConsentService', () => ({
  consentService: {
    getForContact: mockConsentGetForContact,
    getStats: mockConsentGetStats,
    recordConsent: mockConsentRecord,
    revokeConsent: mockConsentRevoke
  }
}))

vi.mock('../../services/AuditService', () => ({
  auditService: {
    searchAuditLogs: mockAuditSearch,
    exportForCompliance: mockAuditExport,
    getEntityHistory: mockAuditEntityHistory
  }
}))

// Import the router AFTER the mocks are registered.
import complianceRouter from '../../routes/compliance'

// The shared testApp factory does not mount the compliance router (route
// mounting is an integration step). Build a minimal app here that mounts it
// behind the real authMiddleware, mirroring the production mount.
function createComplianceTestApp(): Express {
  const app = express()
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))
  app.use('/api/compliance', authMiddleware, complianceRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}

describe('Compliance API', () => {
  let app: Express
  let authHeader: string

  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const dealId = '550e8400-e29b-41d4-a716-446655440010'
  const disclosureId = '550e8400-e29b-41d4-a716-446655440011'
  const contactId = '550e8400-e29b-41d4-a716-446655440020'

  beforeEach(() => {
    vi.clearAllMocks()
    app = createComplianceTestApp()
    authHeader = createAuthHeader('test-user-123', { orgId })
  })

  // ---------------------------------------------------------------------------
  // DISCLOSURES
  // ---------------------------------------------------------------------------
  describe('Disclosures', () => {
    it('GET /disclosures returns a paginated, org-scoped list (happy path)', async () => {
      mockDisclosureList.mockResolvedValueOnce({
        disclosures: [{ id: disclosureId, orgId, dealId, status: 'generated' }],
        total: 1,
        page: 1,
        limit: 20
      })

      const res = await request(app)
        .get('/api/compliance/disclosures')
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.disclosures).toHaveLength(1)
      expect(res.body.pagination.total).toBe(1)
      expect(mockDisclosureList).toHaveBeenCalledWith(orgId, expect.objectContaining({ page: 1 }))
    })

    it('GET /disclosures fails closed (403) when the token carries no org', async () => {
      const noOrgHeader = createAuthHeader('test-user-123', { orgId: null })

      const res = await request(app)
        .get('/api/compliance/disclosures')
        .set('Authorization', noOrgHeader)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
      expect(mockDisclosureList).not.toHaveBeenCalled()
    })

    it('GET /disclosures/by-deal/:dealId filters foreign-org rows out (failure isolation)', async () => {
      mockDisclosureGetByDealId.mockResolvedValueOnce([
        { id: disclosureId, orgId, dealId },
        { id: 'other', orgId: 'different-org', dealId }
      ])

      const res = await request(app)
        .get(`/api/compliance/disclosures/by-deal/${dealId}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.disclosures).toHaveLength(1)
      expect(res.body.disclosures[0].id).toBe(disclosureId)
    })

    it('POST /disclosures generates a disclosure (happy path)', async () => {
      mockDisclosureGenerate.mockResolvedValueOnce({
        id: disclosureId,
        orgId,
        dealId,
        status: 'generated'
      })

      const res = await request(app)
        .post('/api/compliance/disclosures')
        .set('Authorization', authHeader)
        .send({ deal_id: dealId, state: 'CA' })

      expect(res.status).toBe(201)
      expect(res.body.id).toBe(disclosureId)
      expect(mockDisclosureGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ dealId, orgId, state: 'CA' })
      )
    })

    it('POST /disclosures surfaces a service ValidationError as 400 (failure path)', async () => {
      mockDisclosureGenerate.mockRejectedValueOnce(
        new ValidationError('Deal must have amountRequested and factorRate to generate disclosure')
      )

      const res = await request(app)
        .post('/api/compliance/disclosures')
        .set('Authorization', authHeader)
        .send({ deal_id: dealId, state: 'CA' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('POST /disclosures rejects an invalid state length (zod 400)', async () => {
      const res = await request(app)
        .post('/api/compliance/disclosures')
        .set('Authorization', authHeader)
        .send({ deal_id: dealId, state: 'California' })

      expect(res.status).toBe(400)
      expect(mockDisclosureGenerate).not.toHaveBeenCalled()
    })

    it('POST /disclosures/:id/sent marks a disclosure sent (happy path)', async () => {
      mockDisclosureMarkAsSent.mockResolvedValueOnce({ id: disclosureId, orgId, status: 'sent' })

      const res = await request(app)
        .post(`/api/compliance/disclosures/${disclosureId}/sent`)
        .set('Authorization', authHeader)
        .send({})

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('sent')
      expect(mockDisclosureMarkAsSent).toHaveBeenCalledWith(disclosureId, orgId)
    })

    it('POST /disclosures/:id/signature verifies org ownership first (404 when not owned)', async () => {
      mockDisclosureGetById.mockResolvedValueOnce(null)

      const res = await request(app)
        .post(`/api/compliance/disclosures/${disclosureId}/signature`)
        .set('Authorization', authHeader)
        .send({ signed_by: 'merchant@example.com' })

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
      // Must NOT call the org-bypassing recordSignature if ownership check fails.
      expect(mockDisclosureRecordSignature).not.toHaveBeenCalled()
    })

    it('POST /disclosures/:id/signature records a signature when owned (happy path)', async () => {
      mockDisclosureGetById.mockResolvedValueOnce({ id: disclosureId, orgId, status: 'sent' })
      mockDisclosureRecordSignature.mockResolvedValueOnce({
        id: disclosureId,
        orgId,
        status: 'signed'
      })

      const res = await request(app)
        .post(`/api/compliance/disclosures/${disclosureId}/signature`)
        .set('Authorization', authHeader)
        .send({ signed_by: 'merchant@example.com', signed_ip: '203.0.113.7' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('signed')
      expect(mockDisclosureRecordSignature).toHaveBeenCalledWith(
        expect.objectContaining({ disclosureId, signedBy: 'merchant@example.com' })
      )
    })
  })

  // ---------------------------------------------------------------------------
  // CONSENTS
  // ---------------------------------------------------------------------------
  describe('Consents', () => {
    it('GET /consents lists records for a contact (happy path)', async () => {
      mockConsentGetForContact.mockResolvedValueOnce([
        { id: 'c1', orgId, contactId, consentType: 'express_written', isGranted: true }
      ])

      const res = await request(app)
        .get(`/api/compliance/consents?contact_id=${contactId}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.consents).toHaveLength(1)
      expect(mockConsentGetForContact).toHaveBeenCalledWith(
        orgId,
        contactId,
        expect.objectContaining({ includeRevoked: false })
      )
    })

    it('GET /consents without contact_id fails closed (422 naming the input)', async () => {
      const res = await request(app)
        .get('/api/compliance/consents')
        .set('Authorization', authHeader)

      expect(res.status).toBe(422)
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY')
      expect(res.body.error.details.requiredFields).toContain('contact_id')
      expect(mockConsentGetForContact).not.toHaveBeenCalled()
    })

    it('POST /consents records a consent grant (happy path)', async () => {
      mockConsentRecord.mockResolvedValueOnce({
        id: 'c1',
        orgId,
        contactId,
        consentType: 'marketing_email',
        isGranted: true
      })

      const res = await request(app)
        .post('/api/compliance/consents')
        .set('Authorization', authHeader)
        .send({
          contact_id: contactId,
          consent_type: 'marketing_email',
          collection_method: 'web_form',
          channel: 'email'
        })

      expect(res.status).toBe(201)
      expect(res.body.consentType).toBe('marketing_email')
      expect(mockConsentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ orgId, contactId, consentType: 'marketing_email' })
      )
    })

    it('POST /consents rejects an invalid consent_type (zod 400, failure path)', async () => {
      const res = await request(app)
        .post('/api/compliance/consents')
        .set('Authorization', authHeader)
        .send({
          contact_id: contactId,
          consent_type: 'not_a_real_type',
          collection_method: 'web_form'
        })

      expect(res.status).toBe(400)
      expect(mockConsentRecord).not.toHaveBeenCalled()
    })

    it('DELETE /consents revokes consent (happy path)', async () => {
      mockConsentRevoke.mockResolvedValueOnce(2)

      const res = await request(app)
        .delete('/api/compliance/consents')
        .set('Authorization', authHeader)
        .send({ contact_id: contactId, channel: 'sms', reason: 'opt-out' })

      expect(res.status).toBe(200)
      expect(res.body.revoked).toBe(2)
      expect(mockConsentRevoke).toHaveBeenCalledWith(orgId, contactId, 'sms', 'opt-out')
    })
  })

  // ---------------------------------------------------------------------------
  // AUDIT
  // ---------------------------------------------------------------------------
  describe('Audit', () => {
    it('GET /audit searches logs scoped to the org (happy path)', async () => {
      mockAuditSearch.mockResolvedValueOnce({
        logs: [{ id: 'a1', orgId, action: 'create', entityType: 'deal' }],
        total: 1,
        page: 1,
        limit: 50
      })

      const res = await request(app)
        .get('/api/compliance/audit?action=create')
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.logs).toHaveLength(1)
      expect(res.body.pagination.total).toBe(1)
      expect(mockAuditSearch).toHaveBeenCalledWith(
        expect.objectContaining({ orgId, action: 'create' }),
        expect.objectContaining({ page: 1, sortOrder: 'desc' })
      )
    })

    it('GET /audit/export?format=csv returns a CSV buffer (happy path)', async () => {
      mockAuditExport.mockResolvedValueOnce(Buffer.from('ID,Action\na1,create', 'utf-8'))

      const res = await request(app)
        .get(
          `/api/compliance/audit/export?format=csv&start_date=${encodeURIComponent(
            '2025-01-01T00:00:00.000Z'
          )}&end_date=${encodeURIComponent('2025-02-01T00:00:00.000Z')}`
        )
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toContain('text/csv')
      expect(res.text).toContain('a1,create')
    })

    it('GET /audit/export surfaces a service ValidationError as 400 (failure path)', async () => {
      mockAuditExport.mockRejectedValueOnce(
        new ValidationError('Export date range cannot exceed 1 year')
      )

      const res = await request(app)
        .get(
          `/api/compliance/audit/export?start_date=${encodeURIComponent(
            '2020-01-01T00:00:00.000Z'
          )}&end_date=${encodeURIComponent('2025-01-01T00:00:00.000Z')}`
        )
        .set('Authorization', authHeader)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('GET /audit/entity/:entityType/:entityId returns entity history (happy path)', async () => {
      mockAuditEntityHistory.mockResolvedValueOnce([
        { id: 'a1', orgId, entityType: 'disclosure', entityId: disclosureId, action: 'create' }
      ])

      const res = await request(app)
        .get(`/api/compliance/audit/entity/disclosure/${disclosureId}`)
        .set('Authorization', authHeader)

      expect(res.status).toBe(200)
      expect(res.body.logs).toHaveLength(1)
      expect(mockAuditEntityHistory).toHaveBeenCalledWith(
        'disclosure',
        disclosureId,
        expect.objectContaining({ orgId })
      )
    })

    it('GET /audit requires authentication (401)', async () => {
      const res = await request(app).get('/api/compliance/audit')
      expect(res.status).toBe(401)
    })

    // NotFoundError mapping is covered generically; assert it maps to 404 too.
    it('maps a thrown NotFoundError to 404', async () => {
      mockDisclosureMarkAsSent.mockRejectedValueOnce(new NotFoundError('Disclosure', disclosureId))

      const res = await request(app)
        .post(`/api/compliance/disclosures/${disclosureId}/sent`)
        .set('Authorization', authHeader)
        .send({})

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })
})
