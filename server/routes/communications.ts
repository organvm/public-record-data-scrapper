import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { CommunicationsService } from '../services/CommunicationsService'

const router = Router()

/**
 * Resolves the caller's tenant (org) from the authenticated JWT and enforces
 * multi-tenant isolation. The org is ALWAYS derived from `req.user.orgId` —
 * never trusted from the client. If a client supplies an `org_id` (query or
 * body) it must match the token's org or the request is rejected (403).
 *
 * Returns the resolved orgId on success, or null after writing an error
 * response (the caller must return immediately when null is returned).
 *
 * NOTE: copied verbatim from routes/deals.ts (and contacts.ts) — the tenant
 * resolution contract is identical across every org-scoped route.
 */
function resolveOrgId(req: AuthenticatedRequest, res: Response): string | null {
  const tokenOrgId = req.user?.orgId

  // Fail closed: a token without a tenant binding cannot access org-scoped data.
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

  // If the client supplied an org_id, it must equal the token's org.
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

// ============================================
// Validation schemas
// ============================================

const channelEnum = z.enum(['email', 'sms', 'call'])
const directionEnum = z.enum(['inbound', 'outbound'])
const statusEnum = z.enum([
  'pending',
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
  'answered',
  'no_answer',
  'voicemail',
  'busy',
  'received'
])

// GET /api/communications — history list with filters + pagination.
// org_id is derived from the token; if present it is only cross-checked
// (see resolveOrgId). page/limit map to the service's offset/limit.
const listQuerySchema = z
  .object({
    org_id: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(200).default(50),
    contact_id: z.string().uuid().optional(),
    prospect_id: z.string().uuid().optional(),
    deal_id: z.string().uuid().optional(),
    channel: channelEnum.optional(),
    direction: directionEnum.optional(),
    status: statusEnum.optional()
  })
  .strict()

const idParamSchema = z.object({
  id: z.string().uuid()
})

const orgIdQuerySchema = z.object({
  org_id: z.string().uuid().optional()
})

const templatesQuerySchema = z
  .object({
    org_id: z.string().uuid().optional(),
    channel: channelEnum.optional()
  })
  .strict()

const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url().max(2048),
  size: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(100)
})

const sendEmailSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    prospect_id: z.string().uuid().optional(),
    deal_id: z.string().uuid().optional(),
    template_id: z.string().uuid().optional(),
    sent_by: z.string().uuid().optional(),
    to_address: z.string().email().max(254),
    cc_addresses: z.array(z.string().email().max(254)).max(50).optional(),
    bcc_addresses: z.array(z.string().email().max(254)).max(50).optional(),
    subject: z.string().min(1).max(255),
    body: z.string().min(1).max(65536),
    body_html: z.string().max(65536).optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
    scheduled_for: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

const sendSmsSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    prospect_id: z.string().uuid().optional(),
    deal_id: z.string().uuid().optional(),
    template_id: z.string().uuid().optional(),
    sent_by: z.string().uuid().optional(),
    to_phone: z.string().min(1).max(20),
    body: z.string().min(1).max(4096),
    scheduled_for: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

const initiateCallSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    prospect_id: z.string().uuid().optional(),
    deal_id: z.string().uuid().optional(),
    sent_by: z.string().uuid().optional(),
    to_phone: z.string().min(1).max(20),
    call_script: z.string().max(4096).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

const followUpQuerySchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid()
  })
  .strict()

const createFollowUpSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    contact_id: z.string().uuid(),
    deal_id: z.string().uuid().optional(),
    channel: channelEnum,
    template_id: z.string().uuid().optional(),
    scheduled_for: z.string().datetime(),
    created_by: z.string().uuid().optional()
  })
  .strict()

// ============================================
// Communication history
// ============================================

// GET /api/communications — list communications for the org with filters.
router.get(
  '/',
  validateRequest({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    // Re-parse via the schema rather than reading req.query directly: under
    // Express 5 the lazy req.query getter re-derives string values from the URL,
    // so the coercion validateRequest applied (page/limit -> number) does not
    // persist on the request object. Re-parsing yields the coerced types.
    const query = listQuerySchema.parse(req.query)

    // The service paginates by offset/limit; the route exposes page/limit to
    // match the deals/contacts list convention.
    const offset = (query.page - 1) * query.limit

    const result = await communicationsService.getHistory({
      orgId,
      contactId: query.contact_id,
      prospectId: query.prospect_id,
      dealId: query.deal_id,
      channel: query.channel,
      direction: query.direction,
      status: query.status,
      limit: query.limit,
      offset
    })

    res.json({
      communications: result.communications,
      total: result.total,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit)
      }
    })
  })
)

// GET /api/communications/templates — list templates for the org.
// Declared before /:id so the literal path is not captured by the param route.
router.get(
  '/templates',
  validateRequest({ query: templatesQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const query = templatesQuerySchema.parse(req.query)

    const templates = await communicationsService.listTemplates(orgId, query.channel)

    res.json({ templates })
  })
)

// GET /api/communications/follow-ups?contact_id= — pending follow-ups for a contact.
// Declared before /:id for the same literal-vs-param reason.
router.get(
  '/follow-ups',
  validateRequest({ query: followUpQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const query = followUpQuerySchema.parse(req.query)

    const followUps = await communicationsService.getPendingFollowUps(query.contact_id, orgId)

    res.json({ followUps })
  })
)

// POST /api/communications/follow-ups — schedule a channel-aware follow-up.
router.post(
  '/follow-ups',
  requireRole('user', 'admin'),
  validateRequest({ body: createFollowUpSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const body = req.body as z.infer<typeof createFollowUpSchema>

    const followUp = await communicationsService.scheduleFollowUp({
      orgId,
      contactId: body.contact_id,
      dealId: body.deal_id,
      channel: body.channel,
      templateId: body.template_id,
      scheduledFor: body.scheduled_for,
      createdBy: body.created_by
    })

    res.status(201).json(followUp)
  })
)

// DELETE /api/communications/follow-ups/:id — cancel a scheduled follow-up.
router.delete(
  '/follow-ups/:id',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    // Re-parse the param via its schema to recover the validated `string` type
    // (Express 5 types req.params values as `string | string[]`).
    const { id } = idParamSchema.parse(req.params)

    const cancelled = await communicationsService.cancelFollowUp(id, orgId)

    if (!cancelled) {
      return res.status(404).json({
        error: {
          message: `Follow-up ${id} not found or already sent`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.status(204).send()
  })
)

// ============================================
// Send communications
// ============================================

// POST /api/communications/send-email — delegates to the TCPA/DNC/consent-gated
// service send. A compliance block surfaces as 403 (ForbiddenError) and an
// unconfigured/unreachable provider surfaces as 502 (ExternalServiceError),
// both mapped by the global error handler. Never a fabricated success.
router.post(
  '/send-email',
  requireRole('user', 'admin'),
  validateRequest({ body: sendEmailSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const body = req.body as z.infer<typeof sendEmailSchema>

    const communication = await communicationsService.sendEmail({
      orgId,
      contactId: body.contact_id,
      prospectId: body.prospect_id,
      dealId: body.deal_id,
      templateId: body.template_id,
      sentBy: body.sent_by,
      toAddress: body.to_address,
      ccAddresses: body.cc_addresses,
      bccAddresses: body.bcc_addresses,
      subject: body.subject,
      body: body.body,
      bodyHtml: body.body_html,
      attachments: body.attachments,
      scheduledFor: body.scheduled_for,
      metadata: body.metadata
    })

    res.status(201).json(communication)
  })
)

// POST /api/communications/send-sms — delegates to the TCPA/DNC/consent-gated
// service send. Same failure mapping as send-email.
router.post(
  '/send-sms',
  requireRole('user', 'admin'),
  validateRequest({ body: sendSmsSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const body = req.body as z.infer<typeof sendSmsSchema>

    const communication = await communicationsService.sendSMS({
      orgId,
      contactId: body.contact_id,
      prospectId: body.prospect_id,
      dealId: body.deal_id,
      templateId: body.template_id,
      sentBy: body.sent_by,
      toPhone: body.to_phone,
      body: body.body,
      scheduledFor: body.scheduled_for,
      metadata: body.metadata
    })

    res.status(201).json(communication)
  })
)

// POST /api/communications/initiate-call — delegates to the TCPA/DNC/consent-gated
// service call. Same failure mapping as send-email.
router.post(
  '/initiate-call',
  requireRole('user', 'admin'),
  validateRequest({ body: initiateCallSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    const body = req.body as z.infer<typeof initiateCallSchema>

    const communication = await communicationsService.initiateCall({
      orgId,
      contactId: body.contact_id,
      prospectId: body.prospect_id,
      dealId: body.deal_id,
      sentBy: body.sent_by,
      toPhone: body.to_phone,
      callScript: body.call_script,
      metadata: body.metadata
    })

    res.status(201).json(communication)
  })
)

// ============================================
// Single communication
// ============================================

// GET /api/communications/:id — fetch one communication for the org.
// Declared LAST so its `:id` param does not shadow /templates and /follow-ups.
router.get(
  '/:id',
  validateRequest({ params: idParamSchema, query: orgIdQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const communicationsService = new CommunicationsService()
    // Re-parse the param via its schema to recover the validated `string` type
    // (Express 5 types req.params values as `string | string[]`).
    const { id } = idParamSchema.parse(req.params)

    const communication = await communicationsService.getById(id, orgId)

    if (!communication) {
      return res.status(404).json({
        error: {
          message: `Communication ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(communication)
  })
)

export default router
