import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { ContactsService } from '../services/ContactsService'

const router = Router()

/**
 * Resolves the caller's tenant (org) from the authenticated JWT and enforces
 * multi-tenant isolation. Org is ALWAYS derived from `req.user.orgId` — never
 * trusted from the client. A client-supplied `org_id` must match the token's
 * org (else 403). A token with no org binding fails closed (403).
 *
 * Returns the resolved orgId, or null after writing an error response (caller
 * must return immediately when null is returned).
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

// Validation schemas
const contactRoleEnum = z.enum(['owner', 'ceo', 'cfo', 'controller', 'manager', 'bookkeeper', 'other'])
const contactMethodEnum = z.enum(['email', 'phone', 'mobile', 'sms'])
const contactRelationshipEnum = z.enum(['owner', 'decision_maker', 'influencer', 'employee', 'advisor', 'other'])
const activityTypeEnum = z.enum([
  'call_outbound', 'call_inbound', 'call_missed',
  'email_sent', 'email_received', 'email_opened', 'email_clicked',
  'sms_sent', 'sms_received',
  'meeting_scheduled', 'meeting_completed', 'meeting_cancelled',
  'note', 'task_created', 'task_completed',
  'status_change', 'document_sent', 'document_signed'
])

const listContactsQuerySchema = z.object({
  // org_id is derived from the authenticated token; if present it is only used
  // to cross-check against the token (see resolveOrgId). Never trusted as-is.
  org_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
  search: z.string().max(255).optional(),
  role: contactRoleEnum.optional(),
  tags: z.string().max(500).transform(v => v.split(',')).optional(),
  is_active: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  sort_by: z.enum(['first_name', 'last_name', 'created_at', 'last_contacted_at']).default('last_name'),
  sort_order: z.enum(['asc', 'desc']).default('asc')
})

const createContactSchema = z.object({
  org_id: z.string().uuid().optional(),
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(20).optional(),
  phone_ext: z.string().max(10).optional(),
  mobile: z.string().max(20).optional(),
  title: z.string().max(100).optional(),
  role: contactRoleEnum.optional(),
  preferred_contact_method: contactMethodEnum.default('email'),
  timezone: z.string().max(100).default('America/New_York'),
  notes: z.string().max(4096).optional(),
  tags: z.array(z.string().max(100)).default([]).max(50),
  source: z.string().max(100).optional(),
  created_by: z.string().uuid().optional()
}).strict()

const updateContactSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(254).optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
  phone_ext: z.string().max(10).optional().nullable(),
  mobile: z.string().max(20).optional().nullable(),
  title: z.string().max(100).optional().nullable(),
  role: contactRoleEnum.optional().nullable(),
  preferred_contact_method: contactMethodEnum.optional(),
  timezone: z.string().max(100).optional(),
  notes: z.string().max(4096).optional().nullable(),
  tags: z.array(z.string().max(100)).max(50).optional(),
  is_active: z.boolean().optional()
}).strict()

const idParamSchema = z.object({
  id: z.string().uuid()
})

const linkContactParamsSchema = z.object({
  id: z.string().uuid(),
  prospectId: z.string().uuid()
})

const linkContactBodySchema = z.object({
  is_primary: z.boolean().default(false),
  relationship: contactRelationshipEnum.default('employee')
}).strict()

const logActivitySchema = z.object({
  prospect_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  activity_type: activityTypeEnum,
  subject: z.string().optional(),
  description: z.string().optional(),
  outcome: z.string().optional(),
  duration_seconds: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  scheduled_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().optional()
}).strict()

// GET /api/contacts - List contacts with filters (org_id required)
router.get(
  '/',
  validateRequest({ query: listContactsQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const contactsService = new ContactsService()
    const query = req.query as z.infer<typeof listContactsQuerySchema>

    const result = await contactsService.list({
      orgId,
      page: query.page,
      limit: query.limit,
      search: query.search,
      role: query.role,
      tags: query.tags,
      isActive: query.is_active,
      sortBy: query.sort_by,
      sortOrder: query.sort_order
    })

    res.json({
      contacts: result.contacts,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// POST /api/contacts - Create contact
router.post(
  '/',
  requireRole('user', 'admin'),
  validateRequest({ body: createContactSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const contactsService = new ContactsService()
    const body = req.body as z.infer<typeof createContactSchema>

    const contact = await contactsService.create({
      orgId,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      phone: body.phone,
      phoneExt: body.phone_ext,
      mobile: body.mobile,
      title: body.title,
      role: body.role,
      preferredContactMethod: body.preferred_contact_method,
      timezone: body.timezone,
      notes: body.notes,
      tags: body.tags,
      source: body.source,
      createdBy: body.created_by
    })

    res.status(201).json(contact)
  })
)

// GET /api/contacts/:id - Get contact with activity timeline
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const contactsService = new ContactsService()
    const { id } = req.params

    const contact = await contactsService.getById(id, orgId)

    if (!contact) {
      return res.status(404).json({
        error: {
          message: `Contact ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    // Fetch activity timeline
    const activities = await contactsService.getActivityTimeline(id, { limit: 50 })

    res.json({
      ...contact,
      activities
    })
  })
)

// PUT /api/contacts/:id - Update contact
router.put(
  '/:id',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: updateContactSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const contactsService = new ContactsService()
    const { id } = req.params

    const body = req.body as z.infer<typeof updateContactSchema>

    const contact = await contactsService.update(id, orgId, {
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email ?? undefined,
      phone: body.phone ?? undefined,
      phoneExt: body.phone_ext ?? undefined,
      mobile: body.mobile ?? undefined,
      title: body.title ?? undefined,
      role: body.role ?? undefined,
      preferredContactMethod: body.preferred_contact_method,
      timezone: body.timezone,
      notes: body.notes ?? undefined,
      tags: body.tags,
      isActive: body.is_active
    })

    res.json(contact)
  })
)

// POST /api/contacts/:id/link/:prospectId - Link contact to prospect
router.post(
  '/:id/link/:prospectId',
  requireRole('user', 'admin'),
  validateRequest({ params: linkContactParamsSchema, body: linkContactBodySchema }),
  asyncHandler(async (req, res) => {
    const contactsService = new ContactsService()
    const { id, prospectId } = req.params
    const body = req.body as z.infer<typeof linkContactBodySchema>

    const link = await contactsService.linkToProspect({
      contactId: id,
      prospectId: prospectId,
      isPrimary: body.is_primary,
      relationship: body.relationship
    })

    res.status(201).json(link)
  })
)

// DELETE /api/contacts/:id/link/:prospectId - Unlink contact from prospect
router.delete(
  '/:id/link/:prospectId',
  requireRole('user', 'admin'),
  validateRequest({ params: linkContactParamsSchema }),
  asyncHandler(async (req, res) => {
    const contactsService = new ContactsService()
    const { id, prospectId } = req.params

    const unlinked = await contactsService.unlinkFromProspect(prospectId, id)

    if (!unlinked) {
      return res.status(404).json({
        error: {
          message: 'Link not found',
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.status(204).send()
  })
)

// POST /api/contacts/:id/activities - Log activity for contact
router.post(
  '/:id/activities',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: logActivitySchema }),
  asyncHandler(async (req, res) => {
    const contactsService = new ContactsService()
    const { id } = req.params
    const body = req.body as z.infer<typeof logActivitySchema>

    const activity = await contactsService.logActivity({
      contactId: id,
      prospectId: body.prospect_id,
      userId: body.user_id,
      activityType: body.activity_type,
      subject: body.subject,
      description: body.description,
      outcome: body.outcome,
      durationSeconds: body.duration_seconds,
      metadata: body.metadata,
      scheduledAt: body.scheduled_at,
      completedAt: body.completed_at
    })

    res.status(201).json(activity)
  })
)

// GET /api/contacts/:id/activities - Get activity timeline for contact
router.get(
  '/:id/activities',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const contactsService = new ContactsService()
    const { id } = req.params
    // Parse with explicit radix, guard NaN/non-positive, and cap to a sane max.
    const parsedLimit = parseInt(req.query.limit as string, 10)
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 50
    const before = req.query.before as string | undefined

    const activities = await contactsService.getActivityTimeline(id, { limit, before })

    res.json({ activities })
  })
)

// GET /api/contacts/by-prospect/:prospectId - Get contacts for a prospect
router.get(
  '/by-prospect/:prospectId',
  asyncHandler(async (req, res) => {
    const contactsService = new ContactsService()
    const { prospectId } = req.params

    const contacts = await contactsService.getContactsForProspect(prospectId)

    res.json({ contacts })
  })
)

export default router
