import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { disclosureService } from '../services/DisclosureService'
import { consentService } from '../services/ConsentService'
import { auditService } from '../services/AuditService'

const router = Router()

/**
 * Resolves the caller's tenant (org) from the authenticated JWT and enforces
 * multi-tenant isolation. Org is ALWAYS derived from `req.user.orgId` — never
 * trusted from the client. A client-supplied `org_id` must match the token's
 * org (else 403). A token with no org binding fails closed (403).
 *
 * Returns the resolved orgId, or null after writing an error response (caller
 * must return immediately when null is returned).
 *
 * NOTE: This helper is intentionally duplicated from contacts.ts / deals.ts —
 * those copies are not exported, and this route keeps the same fail-closed
 * contract local rather than reaching across modules.
 */
function resolveOrgId(req: AuthenticatedRequest, res: Response): string | null {
  const tokenOrgId = req.user?.orgId

  if (!tokenOrgId) {
    res.status(403).json({
      error: {
        message: 'No organization associated with this account',
        code: 'FORBIDDEN',
        statusCode: 403
      }
    })
    return null
  }

  const suppliedOrgId =
    (req.query?.org_id as string | undefined) ??
    (req.body && typeof req.body === 'object' ? (req.body.org_id as string | undefined) : undefined)

  if (suppliedOrgId !== undefined && suppliedOrgId !== tokenOrgId) {
    res.status(403).json({
      error: {
        message: 'org_id does not match authenticated organization',
        code: 'FORBIDDEN',
        statusCode: 403
      }
    })
    return null
  }

  return tokenOrgId
}

// ---------------------------------------------------------------------------
// Shared enums / param schemas
// ---------------------------------------------------------------------------

const disclosureStatusEnum = z.enum([
  'draft',
  'generated',
  'sent',
  'viewed',
  'signed',
  'expired',
  'superseded'
])

const consentTypeEnum = z.enum([
  'express_written',
  'prior_express',
  'transactional',
  'marketing_email',
  'marketing_sms',
  'marketing_call',
  'data_sharing',
  'terms_of_service',
  'privacy_policy'
])

const collectionMethodEnum = z.enum([
  'web_form',
  'phone_recording',
  'signed_document',
  'email_opt_in',
  'sms_opt_in',
  'verbal',
  'imported'
])

// ConsentChannel = CommunicationChannel ('email'|'sms'|'call') | 'mail' | 'all'
const consentChannelEnum = z.enum(['email', 'sms', 'call', 'mail', 'all'])

const idParamSchema = z.object({ id: z.string().uuid() })

// =============================================================================
// DISCLOSURES
// =============================================================================

const listDisclosuresQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  status: disclosureStatusEnum.optional(),
  state: z.string().length(2).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20)
})

// GET /api/compliance/disclosures — list disclosures for the org
router.get(
  '/disclosures',
  validateRequest({ query: listDisclosuresQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const query = req.query as z.infer<typeof listDisclosuresQuerySchema>

    // Express 5's `req.query` is a getter that returns a freshly-parsed object on
    // each access, so the zod `.default()`/`.coerce` values applied by
    // validateRequest do not survive onto `req.query`. Re-apply the contract's
    // defaults here so pagination is explicit and not reliant on a service
    // internal default.
    const page = query.page ? Number(query.page) : 1
    const limit = query.limit ? Number(query.limit) : 20

    const result = await disclosureService.list(orgId, {
      status: query.status,
      state: query.state,
      startDate: query.start_date ? new Date(query.start_date) : undefined,
      endDate: query.end_date ? new Date(query.end_date) : undefined,
      page,
      limit
    })

    res.json({
      disclosures: result.disclosures,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

const byDealParamSchema = z.object({ dealId: z.string().uuid() })

// GET /api/compliance/disclosures/by-deal/:dealId — all disclosures for a deal
router.get(
  '/disclosures/by-deal/:dealId',
  validateRequest({ params: byDealParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const { dealId } = req.params

    // getByDealId is not org-scoped at the service layer; filter to the caller's
    // org here so a tenant cannot read another tenant's disclosures by deal id.
    const all = await disclosureService.getByDealId(dealId)
    const disclosures = all.filter((d) => d.orgId === orgId)

    res.json({ disclosures })
  })
)

// GET /api/compliance/disclosures/:id — single disclosure (org-scoped)
router.get(
  '/disclosures/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const { id } = req.params
    const disclosure = await disclosureService.getById(id, orgId)

    if (!disclosure) {
      return res.status(404).json({
        error: {
          message: `Disclosure ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(disclosure)
  })
)

const generateDisclosureSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    deal_id: z.string().uuid(),
    state: z.string().length(2),
    generated_by: z.string().uuid().optional(),
    signature_required: z.boolean().optional(),
    expires_in_days: z.number().int().positive().max(365).optional()
  })
  .strict()

// POST /api/compliance/disclosures — generate a disclosure for a deal
router.post(
  '/disclosures',
  requireRole('user', 'admin'),
  validateRequest({ body: generateDisclosureSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const body = req.body as z.infer<typeof generateDisclosureSchema>

    const disclosure = await disclosureService.generate({
      dealId: body.deal_id,
      orgId,
      state: body.state,
      generatedBy: body.generated_by ?? (req as AuthenticatedRequest).user?.id,
      signatureRequired: body.signature_required,
      expiresInDays: body.expires_in_days
    })

    res.status(201).json(disclosure)
  })
)

// POST /api/compliance/disclosures/:id/sent — mark disclosure as sent
router.post(
  '/disclosures/:id/sent',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const { id } = req.params
    const disclosure = await disclosureService.markAsSent(id, orgId)
    res.json(disclosure)
  })
)

const recordSignatureSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    signed_by: z.string().min(1),
    signed_ip: z.string().optional(),
    signature_image_url: z.string().url().optional(),
    signature_id: z.string().optional()
  })
  .strict()

// POST /api/compliance/disclosures/:id/signature — record a signature
router.post(
  '/disclosures/:id/signature',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: recordSignatureSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const { id } = req.params
    const body = req.body as z.infer<typeof recordSignatureSchema>

    // recordSignature() bypasses org scoping internally (it looks the disclosure
    // up with an empty orgId). Verify org ownership here BEFORE recording so a
    // tenant cannot sign another tenant's disclosure.
    const owned = await disclosureService.getById(id, orgId)
    if (!owned) {
      return res.status(404).json({
        error: {
          message: `Disclosure ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const disclosure = await disclosureService.recordSignature({
      disclosureId: id,
      signedBy: body.signed_by,
      signedIp: body.signed_ip,
      signatureImageUrl: body.signature_image_url,
      signatureId: body.signature_id
    })

    res.json(disclosure)
  })
)

// =============================================================================
// CONSENTS
// =============================================================================

const listConsentsQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  include_revoked: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional()
})

// GET /api/compliance/consents — list consent records for a contact.
// The ConsentService only supports per-contact listing (getForContact); there
// is no org-wide consent listing. Without a contact_id we fail closed (422)
// naming the required input rather than inventing a list.
router.get(
  '/consents',
  validateRequest({ query: listConsentsQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const query = req.query as z.infer<typeof listConsentsQuerySchema>

    if (!query.contact_id) {
      return res.status(422).json({
        error: {
          message:
            'Listing consent records requires a contact_id — consent is stored and retrieved per contact, not org-wide',
          code: 'UNPROCESSABLE_ENTITY',
          statusCode: 422,
          details: { requiredFields: ['contact_id'] }
        }
      })
    }

    const consents = await consentService.getForContact(orgId, query.contact_id, {
      includeRevoked: query.include_revoked ?? false
    })

    res.json({ consents })
  })
)

// GET /api/compliance/consents/stats — org-wide consent statistics
router.get(
  '/consents/stats',
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const stats = await consentService.getStats(orgId)
    res.json(stats)
  })
)

const recordConsentSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid(),
    consent_type: consentTypeEnum,
    channel: consentChannelEnum.optional(),
    is_granted: z.boolean().optional(),
    consent_text: z.string().optional(),
    consent_version: z.string().optional(),
    collection_method: collectionMethodEnum,
    collection_url: z.string().url().optional(),
    recording_url: z.string().url().optional(),
    document_url: z.string().url().optional(),
    ip_address: z.string().optional(),
    user_agent: z.string().optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
    expires_in_days: z.number().int().positive().max(3650).optional(),
    collected_by: z.string().uuid().optional()
  })
  .strict()

// POST /api/compliance/consents — record a consent grant/denial
router.post(
  '/consents',
  requireRole('user', 'admin'),
  validateRequest({ body: recordConsentSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const body = req.body as z.infer<typeof recordConsentSchema>

    const consent = await consentService.recordConsent({
      orgId,
      contactId: body.contact_id,
      consentType: body.consent_type,
      channel: body.channel,
      isGranted: body.is_granted,
      consentText: body.consent_text,
      consentVersion: body.consent_version,
      collectionMethod: body.collection_method,
      collectionUrl: body.collection_url,
      recordingUrl: body.recording_url,
      documentUrl: body.document_url,
      ipAddress: body.ip_address,
      userAgent: body.user_agent,
      evidence: body.evidence,
      expiresInDays: body.expires_in_days,
      collectedBy: body.collected_by ?? (req as AuthenticatedRequest).user?.id
    })

    res.status(201).json(consent)
  })
)

const revokeConsentSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid(),
    channel: consentChannelEnum.default('all'),
    reason: z.string().optional()
  })
  .strict()

// DELETE /api/compliance/consents — revoke consent (opt-out).
// Consent is keyed by (contact, channel), not by record id, so revocation
// takes a body identifying the contact + channel rather than an id param.
router.delete(
  '/consents',
  requireRole('user', 'admin'),
  validateRequest({ body: revokeConsentSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const body = req.body as z.infer<typeof revokeConsentSchema>

    const revoked = await consentService.revokeConsent(
      orgId,
      body.contact_id,
      body.channel,
      body.reason
    )

    res.json({ revoked })
  })
)

// =============================================================================
// AUDIT LOGS (read-only — logs are immutable)
// =============================================================================

const searchAuditQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  user_id: z.string().optional(),
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  action: z.string().optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  ip_address: z.string().optional(),
  request_id: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  sort_order: z.enum(['asc', 'desc']).default('desc')
})

// GET /api/compliance/audit — search audit logs (always scoped to caller org)
router.get(
  '/audit',
  validateRequest({ query: searchAuditQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const query = req.query as z.infer<typeof searchAuditQuerySchema>

    // See note in GET /disclosures: Express 5 query-getter semantics drop the
    // zod defaults/coercion, so re-apply the pagination contract here.
    const page = query.page ? Number(query.page) : 1
    const limit = query.limit ? Number(query.limit) : 50
    const sortOrder = query.sort_order === 'asc' ? 'asc' : 'desc'

    const result = await auditService.searchAuditLogs(
      {
        orgId,
        userId: query.user_id,
        entityType: query.entity_type,
        entityId: query.entity_id,
        action: query.action,
        startDate: query.start_date ? new Date(query.start_date) : undefined,
        endDate: query.end_date ? new Date(query.end_date) : undefined,
        ipAddress: query.ip_address,
        requestId: query.request_id
      },
      {
        page,
        limit,
        sortOrder
      }
    )

    res.json({
      logs: result.logs,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

const exportAuditQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  format: z.enum(['json', 'csv']).default('json'),
  entity_type: z.string().optional(),
  user_id: z.string().optional(),
  action: z.string().optional()
})

// GET /api/compliance/audit/export — export audit trail (JSON or CSV)
router.get(
  '/audit/export',
  validateRequest({ query: exportAuditQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const query = req.query as z.infer<typeof exportAuditQuerySchema>

    // Express 5 drops the zod default; treat anything other than an explicit
    // 'csv' as the default 'json' format.
    const format = query.format === 'csv' ? 'csv' : 'json'

    const result = await auditService.exportForCompliance(
      orgId,
      { start: new Date(query.start_date), end: new Date(query.end_date) },
      format,
      {
        entityType: query.entity_type,
        userId: query.user_id,
        action: query.action
      }
    )

    if (format === 'csv' && Buffer.isBuffer(result)) {
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', 'attachment; filename="audit-export.csv"')
      return res.send(result)
    }

    res.json({ logs: result })
  })
)

const entityHistoryParamSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1)
})

const entityHistoryQuerySchema = z.object({
  org_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
})

// GET /api/compliance/audit/entity/:entityType/:entityId — full entity history
router.get(
  '/audit/entity/:entityType/:entityId',
  validateRequest({ params: entityHistoryParamSchema, query: entityHistoryQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const { entityType, entityId } = req.params
    const query = req.query as z.infer<typeof entityHistoryQuerySchema>

    // Express 5 drops the zod default; re-apply the contract default of 100.
    const limit = query.limit ? Number(query.limit) : 100

    const logs = await auditService.getEntityHistory(entityType, entityId, {
      orgId,
      limit
    })

    res.json({ logs })
  })
)

export default router
