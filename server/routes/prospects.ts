import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { ProspectsService } from '../services/ProspectsService'
import { ScoringService } from '../services/ScoringService'
import { QualificationService } from '../services/QualificationService'
import { UnderwritingService } from '../services/UnderwritingService'
import type { UnderwritingFeatures } from '../services/UnderwritingService'
import { LeadExportService, serializeLeadExportCsv } from '../services/LeadExportService'
import { getResolvedDataTier, type ResolvedDataTier } from '../middleware/dataTier'
import { tierGate } from '../middleware/tierGate'

const router = Router()

// Validation schemas
const MAX_PAGE_LIMIT = 200

const querySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  // Clamp limit to a sane maximum before it reaches the DB (tier constraints
  // may reduce it further) to bound query cost.
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => Math.min(Math.max(Number(v), 1), MAX_PAGE_LIMIT))
    .default('20'),
  state: z.string().length(2).optional(),
  industry: z.string().optional(),
  min_score: z.string().regex(/^\d+$/).transform(Number).optional(),
  max_score: z.string().regex(/^\d+$/).transform(Number).optional(),
  status: z.enum(['all', 'unclaimed', 'claimed', 'contacted']).optional(),
  sort_by: z.enum(['priority_score', 'created_at', 'company_name']).default('priority_score'),
  sort_order: z.enum(['asc', 'desc']).default('desc')
})

const exportQuerySchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => Math.min(Math.max(Number(v), 1), 1000))
      .default('100'),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => Math.max(Number(v), 0))
      .default('0'),
    state: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase())
      .optional(),
    industry: z.string().optional(),
    status: z
      .enum([
        'new',
        'claimed',
        'contacted',
        'qualified',
        'dead',
        'closed-won',
        'closed-lost',
        'unclaimed'
      ])
      .optional(),
    min_score: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .default('70'),
    max_score: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .optional()
  })
  .refine((query) => query.min_score >= 0 && query.min_score <= 100, {
    message: 'min_score must be between 0 and 100',
    path: ['min_score']
  })
  .refine((query) => query.max_score === undefined || query.max_score <= 100, {
    message: 'max_score must be between 0 and 100',
    path: ['max_score']
  })
  .refine((query) => query.max_score === undefined || query.max_score >= query.min_score, {
    message: 'max_score must be greater than or equal to min_score',
    path: ['max_score']
  })

const createProspectSchema = z.object({
  company_name: z.string().min(1),
  state: z.string().length(2),
  industry: z.enum([
    'restaurant',
    'retail',
    'construction',
    'healthcare',
    'manufacturing',
    'services',
    'technology'
  ]),
  lien_amount: z.number().positive().optional(),
  filing_date: z.string().datetime().optional()
})

const updateProspectSchema = createProspectSchema.partial()

const idParamSchema = z.object({
  id: z.string().uuid()
})

// A claiming user identifier. The dashboard sends a display name ('Current
// User') rather than a UUID, so this is a non-empty string, not z.uuid().
const claimBodySchema = z.object({
  user: z.string().min(1)
})

const MAX_BATCH_SIZE = 100

const batchClaimBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE),
  user: z.string().min(1)
})

const batchDeleteBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(MAX_BATCH_SIZE)
})

// Optional scoring modifiers. The scoring service falls back to the prospect's
// own industry/state when these are omitted, so the body is fully optional.
const scoreBodySchema = z
  .object({
    industry: z.string().optional(),
    state: z.string().length(2).optional()
  })
  .optional()

// Revenue-trend sub-shape required by UnderwritingFeatures.
const revenueTrendSchema = z.object({
  direction: z.enum(['increasing', 'stable', 'decreasing', 'volatile']),
  percentageChange: z.number(),
  averageMonthlyRevenue: z.number(),
  medianMonthlyRevenue: z.number(),
  seasonalityScore: z.number(),
  monthlyData: z.array(z.unknown()).default([])
})

// The fields QualificationService.qualify actually reads off UnderwritingFeatures.
// These are the genuine inputs the engine needs; anything not supplied makes the
// qualification non-deterministic, so we fail closed (422) rather than fabricate.
const REQUIRED_BANK_FEATURE_FIELDS = [
  'averageDailyBalance',
  'nsfCount',
  'negativeDaysPercentage',
  'estimatedPositionCount',
  'averageMonthlyDeposits',
  'depositConsistencyScore',
  'daysSinceLastDeposit',
  'estimatedPaymentObligations',
  'totalTransactionsAnalyzed',
  'totalDaysAnalyzed',
  'revenueTrend'
] as const

const qualifyBodySchema = z.object({
  bankFeatures: z.record(z.string(), z.unknown()).optional(),
  timeInBusinessMonths: z.number().int().nonnegative().optional(),
  industry: z.string().optional(),
  state: z.string().length(2).optional()
})

// Underwriting (feature extraction) requires a Plaid access token for the
// prospect's linked bank account. No token => no bank data => fail closed.
const underwriteBodySchema = z.object({
  accessToken: z.string().min(1).optional(),
  monthsToAnalyze: z.number().int().positive().max(24).optional(),
  timeInBusinessMonths: z.number().int().nonnegative().optional(),
  qualify: z.boolean().optional()
})

type ProspectsQuery = z.infer<typeof querySchema>
type LeadExportQuery = z.infer<typeof exportQuerySchema>

const PROSPECT_TIER_LIMITS: Record<ResolvedDataTier, number> = {
  'free-tier': 20,
  'starter-tier': 100
}

const FREE_TIER_MIN_SCORE = 70

function applyProspectTierConstraints(
  query: ProspectsQuery,
  dataTier: ResolvedDataTier
): ProspectsQuery {
  const maxLimit = PROSPECT_TIER_LIMITS[dataTier]
  const limit = Math.min(query.limit, maxLimit)

  if (dataTier !== 'free-tier') {
    return { ...query, limit }
  }

  const minScore =
    query.min_score === undefined
      ? FREE_TIER_MIN_SCORE
      : Math.max(query.min_score, FREE_TIER_MIN_SCORE)

  return {
    ...query,
    limit,
    min_score: minScore
  }
}

// GET /api/prospects - List prospects (paginated, filtered, sorted)
router.get(
  '/',
  validateRequest({ query: querySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const dataTier = getResolvedDataTier(req)
    const tieredQuery = applyProspectTierConstraints(req.query as ProspectsQuery, dataTier)
    const result = await prospectsService.list(tieredQuery)

    res.json({
      prospects: result.prospects,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      }
    })
  })
)

// POST /api/prospects/batch/claim - Claim multiple prospects
//
// Registered before the parametrized `/:id` routes so the literal `batch`
// segment is matched here rather than being captured as an `:id` (which would
// fail UUID validation with a 400). Returns the claimed prospect rows so the
// client can patch its in-memory list.
router.post(
  '/batch/claim',
  validateRequest({ body: batchClaimBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { ids, user } = req.body as { ids: string[]; user: string }
    const claimed = await prospectsService.batchClaimReturning(ids, user)

    res.json(claimed)
  })
)

// DELETE /api/prospects/batch - Delete multiple prospects
//
// Registered before `/:id` for the same routing-precedence reason as the batch
// claim route above.
router.delete(
  '/batch',
  validateRequest({ body: batchDeleteBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { ids } = req.body as { ids: string[] }
    await prospectsService.batchDelete(ids)

    res.status(204).send()
  })
)

// GET /api/prospects/export/leads - Export scored MCA leads as a JSON batch or
// CSV file. Registered before `/:id` so `export` is not treated as a prospect id.
router.get(
  '/export/leads',
  validateRequest({ query: exportQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as LeadExportQuery
    const exportService = new LeadExportService()
    const batch = await exportService.exportLeads({
      state: query.state,
      industry: query.industry,
      status: query.status,
      minScore: query.min_score,
      maxScore: query.max_score,
      limit: query.limit,
      offset: query.offset
    })

    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${batch.batch.id}.csv"`)
      return res.send(serializeLeadExportCsv(batch))
    }

    res.json(batch)
  })
)

// GET /api/prospects/:id - Get prospect details
router.get(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.getById(req.params.id)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(prospect)
  })
)

// POST /api/prospects - Create prospect
router.post(
  '/',
  tierGate,
  validateRequest({ body: createProspectSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.create(req.body)

    res.status(201).json(prospect)
  })
)

// POST /api/prospects/:id/claim - Claim a prospect for a user
//
// Sets status='claimed', claimed_by, claimed_date. The service performs an
// atomic conditional update; a NotFoundError (404) or ConflictError (409,
// already claimed) propagates to the error handler. Returns the claimed
// prospect row (the shape the dashboard expects).
router.post(
  '/:id/claim',
  validateRequest({ params: idParamSchema, body: claimBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const { user } = req.body as { user: string }
    const prospect = await prospectsService.claim(req.params.id, user)

    res.json(prospect)
  })
)

// POST /api/prospects/:id/unclaim - Release a claimed prospect
//
// Reverses claim: status='new', clears claimed_by/claimed_date. Returns the
// updated prospect row.
router.post(
  '/:id/unclaim',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.unclaim(req.params.id)

    res.json(prospect)
  })
)

// Validate that a supplied bank-features object carries every input the
// QualificationService genuinely needs. Returns the list of missing field
// names (empty when complete). A field counts as missing if it is absent, null,
// or — for numeric inputs — not a finite number; we never coerce or default
// underwriting inputs.
function findMissingBankFeatureFields(bankFeatures: Record<string, unknown> | undefined): string[] {
  if (!bankFeatures) {
    return [...REQUIRED_BANK_FEATURE_FIELDS]
  }

  const missing: string[] = []
  for (const field of REQUIRED_BANK_FEATURE_FIELDS) {
    const value = bankFeatures[field]
    if (value === undefined || value === null) {
      missing.push(field)
      continue
    }
    if (field === 'revenueTrend') {
      const parsed = revenueTrendSchema.safeParse(value)
      if (!parsed.success) {
        missing.push(field)
      }
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      missing.push(field)
    }
  }
  return missing
}

// POST /api/prospects/:id/score - Compute the prospect's MCA score from live
// UCC-filing and health data and persist it.
//
// ScoringService.scoreProspect reads the prospect row plus its linked
// ucc_filings (status/recency/volume) and latest health_scores row, derives
// intent/health/position sub-scores, applies industry + state modifiers, and
// returns a composite 0-100 score with grade, confidence, factors, narrative,
// and recommendation. We persist the composite as priority_score (the column
// the dashboard reads) and the generated narrative, then return the full result.
router.post(
  '/:id/score',
  validateRequest({ params: idParamSchema, body: scoreBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.getById(req.params.id)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const body = (req.body ?? {}) as { industry?: string; state?: string }
    const scoringService = new ScoringService()
    const result = await scoringService.scoreProspect(req.params.id, {
      industry: body.industry,
      state: body.state
    })

    // Persist the live-computed composite as the canonical priority_score plus
    // the narrative so the dashboard and list/sort reflect real filing data.
    const updated = await prospectsService.update(req.params.id, {
      priorityScore: result.compositeScore,
      narrative: result.narrative
    })

    res.json({ prospect: updated, scoring: result })
  })
)

// POST /api/prospects/:id/qualify - Run the pre-qualification rules engine.
//
// QualificationService.qualify needs extracted bank-data features
// (UnderwritingFeatures): average daily balance, NSF count, negative-days %,
// estimated existing positions, average monthly deposits, deposit-consistency
// score, days-since-last-deposit, payment obligations, transaction/day counts,
// and a revenue-trend object. These do not exist on the prospect record, so the
// caller must supply `bankFeatures` (typically produced by the underwrite
// endpoint). If any required input is missing we fail closed with a 422 naming
// exactly which inputs are absent rather than fabricating them.
router.post(
  '/:id/qualify',
  validateRequest({ params: idParamSchema, body: qualifyBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.getById(req.params.id)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const body = req.body as {
      bankFeatures?: Record<string, unknown>
      timeInBusinessMonths?: number
      industry?: string
      state?: string
    }

    const missing = findMissingBankFeatureFields(body.bankFeatures)
    if (missing.length > 0) {
      return res.status(422).json({
        error: {
          message:
            'Qualification requires complete bank-data features; the following inputs are missing or invalid',
          code: 'MISSING_QUALIFICATION_INPUTS',
          statusCode: 422,
          details: { missing }
        }
      })
    }

    const qualificationService = new QualificationService()
    const result = await qualificationService.qualify(
      req.params.id,
      body.bankFeatures as unknown as UnderwritingFeatures,
      {
        timeInBusinessMonths: body.timeInBusinessMonths,
        industry: body.industry,
        state: body.state
      }
    )

    res.json({ qualification: result })
  })
)

// POST /api/prospects/:id/underwrite - Extract underwriting features from the
// prospect's linked bank account.
//
// UnderwritingService.extractFeatures needs a Plaid `accessToken` for the
// prospect's connected bank — it fetches transactions and derives the full
// UnderwritingFeatures set (ADB, NSF, negative days, lender-payment/stack
// detection, revenue trend, deposit consistency). Without a token there is no
// bank data, so we fail closed with a 422 naming the missing input rather than
// inventing financials. Pass `qualify: true` to chain straight into the rules
// engine using the freshly extracted features.
router.post(
  '/:id/underwrite',
  validateRequest({ params: idParamSchema, body: underwriteBodySchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.getById(req.params.id)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    const body = req.body as {
      accessToken?: string
      monthsToAnalyze?: number
      timeInBusinessMonths?: number
      qualify?: boolean
    }

    if (!body.accessToken) {
      return res.status(422).json({
        error: {
          message: 'Underwriting requires a Plaid access token for the prospect bank connection',
          code: 'MISSING_UNDERWRITING_INPUTS',
          statusCode: 422,
          details: { missing: ['accessToken'] }
        }
      })
    }

    const underwritingService = new UnderwritingService()
    const features = await underwritingService.extractFeatures(body.accessToken, {
      monthsToAnalyze: body.monthsToAnalyze
    })

    if (!body.qualify) {
      return res.json({ features })
    }

    // Convenience chaining: qualify with the just-extracted features.
    const qualificationService = new QualificationService()
    const qualification = await qualificationService.qualify(req.params.id, features, {
      timeInBusinessMonths: body.timeInBusinessMonths
    })

    res.json({ features, qualification })
  })
)

// PATCH /api/prospects/:id - Update prospect
router.patch(
  '/:id',
  validateRequest({ params: idParamSchema, body: updateProspectSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const prospect = await prospectsService.update(req.params.id, req.body)

    if (!prospect) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.json(prospect)
  })
)

// DELETE /api/prospects/:id - Delete prospect
router.delete(
  '/:id',
  validateRequest({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const prospectsService = new ProspectsService()
    const deleted = await prospectsService.delete(req.params.id)

    if (!deleted) {
      return res.status(404).json({
        error: {
          message: `Prospect ${req.params.id} not found`,
          code: 'NOT_FOUND',
          statusCode: 404
        }
      })
    }

    res.status(204).send()
  })
)

export default router
