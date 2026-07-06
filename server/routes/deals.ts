import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { DealsService } from '../services/DealsService'

const router = Router()

/**
 * Resolves the caller's tenant (org) from the authenticated JWT and enforces
 * multi-tenant isolation. The org is ALWAYS derived from `req.user.orgId` —
 * never trusted from the client. If a client supplies an `org_id` (query or
 * body) it must match the token's org or the request is rejected (403).
 *
 * Returns the resolved orgId on success, or null after writing an error
 * response (the caller must return immediately when null is returned).
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

// Validation schemas
const dealPriorityEnum = z.enum(['low', 'normal', 'high', 'urgent'])
const documentTypeEnum = z.enum([
  'application', 'bank_statement', 'tax_return', 'voided_check',
  'drivers_license', 'business_license', 'landlord_letter',
  'contract', 'signed_contract', 'disclosure', 'signed_disclosure',
  'other'
])
const useOfFundsEnum = z.enum([
  'working_capital', 'inventory', 'equipment', 'expansion',
  'payroll', 'marketing', 'debt_consolidation', 'real_estate', 'other'
])

const listDealsQuerySchema = z.object({
  // org_id is derived from the authenticated token; if present it is only used
  // to cross-check against the token (see resolveOrgId). Never trusted as-is.
  org_id: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
  stage_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  prospect_id: z.string().uuid().optional(),
  priority: dealPriorityEnum.optional(),
  search: z.string().optional(),
  sort_by: z.enum(['created_at', 'updated_at', 'amount_requested', 'expected_close_date']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
}).strict()

const createDealSchema = z.object({
  org_id: z.string().uuid().optional(),
  prospect_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  amount_requested: z.number().positive().optional(),
  term_months: z.number().int().positive().optional(),
  use_of_funds: useOfFundsEnum.optional(),
  use_of_funds_details: z.string().optional(),
  priority: dealPriorityEnum.default('normal'),
  expected_close_date: z.string().datetime().optional()
}).strict()

const updateDealSchema = z.object({
  prospect_id: z.string().uuid().optional().nullable(),
  contact_id: z.string().uuid().optional().nullable(),
  lender_id: z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  amount_requested: z.number().positive().optional(),
  amount_approved: z.number().positive().optional().nullable(),
  term_months: z.number().int().positive().optional(),
  factor_rate: z.number().positive().optional().nullable(),
  daily_payment: z.number().positive().optional().nullable(),
  weekly_payment: z.number().positive().optional().nullable(),
  use_of_funds: useOfFundsEnum.optional(),
  use_of_funds_details: z.string().optional().nullable(),
  average_daily_balance: z.number().optional().nullable(),
  monthly_revenue: z.number().positive().optional().nullable(),
  nsf_count: z.number().int().min(0).optional(),
  existing_positions: z.number().int().min(0).optional(),
  priority: dealPriorityEnum.optional(),
  probability: z.number().min(0).max(100).optional(),
  expected_close_date: z.string().datetime().optional().nullable(),
  lost_reason: z.string().optional().nullable(),
  lost_notes: z.string().optional().nullable()
})

const moveStageSchema = z.object({
  stage_id: z.string().uuid(),
  notes: z.string().optional(),
  changed_by: z.string().uuid().optional()
})

const uploadDocumentSchema = z.object({
  document_type: documentTypeEnum,
  file_name: z.string().min(1),
  file_path: z.string().min(1),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
  is_required: z.boolean().default(false),
  uploaded_by: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).default({})
})

const idParamSchema = z.object({
  id: z.string().uuid()
})

const documentParamsSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid()
})

const verifyDocumentSchema = z.object({
  verified_by: z.string().min(1)
})

// org_id is optional here: the value is derived from the token by resolveOrgId.
// When supplied it is validated as a UUID and cross-checked against the token.
const orgIdQuerySchema = z.object({
  org_id: z.string().uuid().optional()
})

// GET /api/deals - List deals with pipeline view and stage grouping
router.get(
  '/',
  validateRequest({ query: listDealsQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const query = req.query as z.infer<typeof listDealsQuerySchema>

    const result = await dealsService.list({
      orgId,
      page: query.page,
      limit: query.limit,
      stageId: query.stage_id,
      assignedTo: query.assigned_to,
      prospectId: query.prospect_id,
      priority: query.priority,
      search: query.search,
      sortBy: query.sort_by,
      sortOrder: query.sort_order
    })

    res.json({
      deals: result.deals,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// GET /api/deals/pipeline - Get pipeline view with deals grouped by stage
router.get(
  '/pipeline',
  validateRequest({ query: orgIdQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()

    const pipeline = await dealsService.getPipelineView(orgId)

    res.json(pipeline)
  })
)

// GET /api/deals/stages - Get all stages for an organization
router.get(
  '/stages',
  validateRequest({ query: orgIdQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()

    const stages = await dealsService.getStages(orgId)

    res.json({ stages })
  })
)

// GET /api/deals/stats - Get pipeline statistics
router.get(
  '/stats',
  validateRequest({ query: orgIdQuerySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()

    const stats = await dealsService.getStats(orgId)

    res.json(stats)
  })
)

// POST /api/deals - Create deal (often from a prospect)
router.post(
  '/',
  requireRole('user', 'admin'),
  validateRequest({ body: createDealSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const body = req.body as z.infer<typeof createDealSchema>

    const deal = await dealsService.create({
      orgId,
      prospectId: body.prospect_id,
      contactId: body.contact_id,
      stageId: body.stage_id,
      assignedTo: body.assigned_to,
      amountRequested: body.amount_requested,
      termMonths: body.term_months,
      useOfFunds: body.use_of_funds,
      useOfFundsDetails: body.use_of_funds_details,
      priority: body.priority,
      expectedCloseDate: body.expected_close_date
    })

    res.status(201).json(deal)
  })
)

// GET /api/deals/:id - Get deal details
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params

    const deal = await dealsService.getById(id, orgId)

    if (!deal) {
      return res.status(404).json({
        error: {
          message: `Deal ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    // Fetch documents for the deal
    const documents = await dealsService.getDocuments(id)
    const checklist = await dealsService.getDocumentChecklist(id)

    res.json({
      ...deal,
      documents,
      documentChecklist: checklist
    })
  })
)

// PUT /api/deals/:id - Update deal
router.put(
  '/:id',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: updateDealSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params

    const body = req.body as z.infer<typeof updateDealSchema>

    const deal = await dealsService.update(id, orgId, {
      prospectId: body.prospect_id ?? undefined,
      contactId: body.contact_id ?? undefined,
      lenderId: body.lender_id ?? undefined,
      assignedTo: body.assigned_to ?? undefined,
      amountRequested: body.amount_requested,
      amountApproved: body.amount_approved ?? undefined,
      termMonths: body.term_months,
      factorRate: body.factor_rate ?? undefined,
      dailyPayment: body.daily_payment ?? undefined,
      weeklyPayment: body.weekly_payment ?? undefined,
      useOfFunds: body.use_of_funds,
      useOfFundsDetails: body.use_of_funds_details ?? undefined,
      averageDailyBalance: body.average_daily_balance ?? undefined,
      monthlyRevenue: body.monthly_revenue ?? undefined,
      nsfCount: body.nsf_count,
      existingPositions: body.existing_positions,
      priority: body.priority,
      probability: body.probability,
      expectedCloseDate: body.expected_close_date ?? undefined,
      lostReason: body.lost_reason ?? undefined,
      lostNotes: body.lost_notes ?? undefined
    })

    res.json(deal)
  })
)

// PATCH /api/deals/:id/stage - Move deal to a new stage
router.patch(
  '/:id/stage',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: moveStageSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params

    const body = req.body as z.infer<typeof moveStageSchema>

    const deal = await dealsService.moveToStage(id, orgId, body.stage_id, {
      notes: body.notes,
      changedBy: body.changed_by
    })

    res.json(deal)
  })
)

// POST /api/deals/:id/documents - Upload document to deal
router.post(
  '/:id/documents',
  requireRole('user', 'admin'),
  validateRequest({ params: idParamSchema, body: uploadDocumentSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params
    const body = req.body as z.infer<typeof uploadDocumentSchema>

    // Enforce that the deal belongs to the caller's org before attaching docs.
    const deal = await dealsService.getById(id, orgId)
    if (!deal) {
      return res.status(404).json({
        error: {
          message: `Deal ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const document = await dealsService.uploadDocument({
      dealId: id,
      documentType: body.document_type,
      fileName: body.file_name,
      filePath: body.file_path,
      fileSize: body.file_size,
      mimeType: body.mime_type,
      isRequired: body.is_required,
      uploadedBy: body.uploaded_by,
      metadata: body.metadata
    })

    res.status(201).json(document)
  })
)

// GET /api/deals/:id/documents - Get documents for a deal
router.get(
  '/:id/documents',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params

    // Confirm the deal belongs to the caller's org before exposing documents.
    const deal = await dealsService.getById(id, orgId)
    if (!deal) {
      return res.status(404).json({
        error: {
          message: `Deal ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const documents = await dealsService.getDocuments(id)

    res.json({ documents })
  })
)

// GET /api/deals/:id/documents/checklist - Get document checklist for a deal
router.get(
  '/:id/documents/checklist',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id } = req.params

    // Confirm the deal belongs to the caller's org before exposing documents.
    const deal = await dealsService.getById(id, orgId)
    if (!deal) {
      return res.status(404).json({
        error: {
          message: `Deal ${id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const checklist = await dealsService.getDocumentChecklist(id)

    res.json({ checklist })
  })
)

/**
 * Confirms a document belongs to a deal owned by the caller's org.
 *
 * The DealsService document methods (verifyDocument/deleteDocument) are NOT
 * org-scoped at the SQL layer, so ownership MUST be enforced here before any
 * mutation. We verify the parent deal belongs to `orgId`, then confirm the
 * document id is one of that deal's documents.
 *
 * Returns true if ownership is confirmed; otherwise writes a 404 and returns
 * false (the caller must return immediately).
 *
 * TODO(security): push org scoping into DealsService.verifyDocument /
 * deleteDocument (e.g. JOIN deals on org_id) so ownership is enforced in a
 * single atomic query rather than read-then-write in the route layer.
 */
async function assertDocumentBelongsToOrg(
  dealsService: DealsService,
  dealId: string,
  documentId: string,
  orgId: string,
  res: Response
): Promise<boolean> {
  const deal = await dealsService.getById(dealId, orgId)
  if (!deal) {
    res.status(404).json({
      error: {
        message: `Deal ${dealId} not found`,
        code: 'NOT_FOUND',
        statusCode: 404
      }
    })
    return false
  }

  const documents = await dealsService.getDocuments(dealId)
  const owns = documents.some((doc) => doc.id === documentId)
  if (!owns) {
    res.status(404).json({
      error: {
        message: `Document ${documentId} not found`,
        code: 'NOT_FOUND',
        statusCode: 404
      }
    })
    return false
  }

  return true
}

// PATCH /api/deals/:id/documents/:documentId/verify - Verify a document
router.patch(
  '/:id/documents/:documentId/verify',
  requireRole('user', 'admin'),
  validateRequest({ params: documentParamsSchema, body: verifyDocumentSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id, documentId } = req.params
    const { verified_by: verifiedBy } = req.body as z.infer<typeof verifyDocumentSchema>

    if (!(await assertDocumentBelongsToOrg(dealsService, id, documentId, orgId, res))) {
      return
    }

    const document = await dealsService.verifyDocument(documentId, verifiedBy)

    res.json(document)
  })
)

// DELETE /api/deals/:id/documents/:documentId - Delete a document
router.delete(
  '/:id/documents/:documentId',
  requireRole('user', 'admin'),
  validateRequest({ params: documentParamsSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const dealsService = new DealsService()
    const { id, documentId } = req.params

    if (!(await assertDocumentBelongsToOrg(dealsService, id, documentId, orgId, res))) {
      return
    }

    const deleted = await dealsService.deleteDocument(documentId)

    if (!deleted) {
      return res.status(404).json({
        error: {
          message: `Document ${documentId} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.status(204).send()
  })
)

export default router
