/**
 * On-Demand UCC Filing Search Routes
 *
 * Provides public API for searching UCC filings by company name and state.
 * First-paying-customer revenue endpoint: data-as-a-service / one-off scrape gigs.
 *
 *   POST /api/scrape/ucc         synchronous search (small, fast queries)
 *   POST /api/scrape/jobs        enqueue async scrape (large queries, returns 202 + jobId)
 *   GET  /api/scrape/jobs/:jobId poll job status and retrieve results
 *   GET  /api/scrape/readiness/:stateCode  check if a state is searchable
 *
 * Auth: mounted behind apiKeyOrJwtAuth (server/index.ts), so a paying customer
 * can authenticate with an org-scoped API key (`X-API-Key: prk_…` or
 * `Authorization: Bearer prk_…`) or an internal JWT. requireRole gates on the
 * role carried by whichever credential authenticated the request.
 *
 * @module server/routes/scrape
 */

import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, type AuthenticatedRequest } from '../middleware/authMiddleware'
import { UCCSearchService } from '../services/UCCSearchService'
import { ScrapeJobService } from '../services/ScrapeJobService'
import { getResolvedDataTier } from '../middleware/dataTier'

const router = Router()

// Extract the UUID from "apikey:<uuid>" — returns null for JWT auth.
function extractApiKeyId(userId: string): string | null {
  if (userId.startsWith('apikey:')) return userId.slice('apikey:'.length)
  return null
}

// Validation schemas
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

const safeCompanyName = z
  .string()
  .trim()
  .min(2, 'company name is required')
  .max(200, 'company name must be 200 characters or less')
  .refine((value) => !hasControlCharacters(value), {
    message: 'company name cannot contain control characters'
  })
  .transform((value) => value.replace(/\s+/g, ' '))

const safeStateCode = z
  .string()
  .trim()
  .length(2)
  .transform((s) => s.toUpperCase())
  .refine((value) => /^[A-Z]{2}$/.test(value), {
    message: 'state must be a 2-letter code'
  })

const searchUCCSchema = z.object({
  company_name: safeCompanyName,
  state: safeStateCode,
  limit: z.coerce.number().int().positive().max(1000).default(100)
})

const readinessSchema = z.object({
  stateCode: safeStateCode
})

// GET /api/scrape/readiness/:stateCode - Check if a state can be searched right now
router.get(
  '/readiness/:stateCode',
  requireRole('user', 'admin'),
  validateRequest({ params: readinessSchema }),
  asyncHandler(async (req, res) => {
    const searchService = new UCCSearchService()
    const state = req.params.stateCode

    res.json({
      success: true,
      data: searchService.getStateReadiness(state),
      meta: {
        requestedAt: new Date().toISOString()
      }
    })
  })
)

// POST /api/scrape/ucc - Search for UCC filings by company name
router.post(
  '/ucc',
  requireRole('user', 'admin'),
  validateRequest({ body: searchUCCSchema }),
  asyncHandler(async (req, res) => {
    const dataTier = getResolvedDataTier(req)
    if (dataTier === 'free-tier') {
      res.status(402).json({
        success: false,
        error: {
          message: 'On-demand UCC scraping requires a paid subscription',
          code: 'TIER_UPGRADE_REQUIRED',
          statusCode: 402,
          details: { requiredTier: 'starter' }
        }
      })
      return
    }

    const searchService = new UCCSearchService()
    const body = req.body as z.infer<typeof searchUCCSchema>
    const readiness = searchService.getStateReadiness(body.state)

    if (!readiness.canSearch) {
      res.status(400).json({
        success: false,
        error: {
          message: readiness.reason,
          code: 'UCC_STATE_UNAVAILABLE',
          statusCode: 400,
          details: {
            state: readiness.state,
            readinessEndpoint: `/api/scrape/readiness/${readiness.state}`
          }
        }
      })
      return
    }

    try {
      const result = await searchService.search({
        companyName: body.company_name,
        state: body.state,
        limit: body.limit
      })

      res.json({
        success: true,
        data: result,
        meta: {
          requestedAt: new Date().toISOString()
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search UCC filings'
      res.status(400).json({
        success: false,
        error: {
          message,
          code: 'UCC_SEARCH_FAILED',
          statusCode: 400
        }
      })
    }
  })
)

const enqueueJobSchema = z.object({
  company_name: safeCompanyName,
  state: safeStateCode,
  limit: z.coerce.number().int().positive().max(1000).default(100)
})

const jobIdSchema = z.object({
  jobId: z.string().uuid()
})

// POST /api/scrape/jobs - Enqueue an async scrape, returns 202 + jobId immediately
router.post(
  '/jobs',
  requireRole('user', 'admin'),
  validateRequest({ body: enqueueJobSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const dataTier = getResolvedDataTier(req)
    if (dataTier === 'free-tier') {
      res.status(402).json({
        success: false,
        error: {
          message: 'On-demand UCC scraping requires a paid subscription',
          code: 'TIER_UPGRADE_REQUIRED',
          statusCode: 402,
          details: { requiredTier: 'starter' }
        }
      })
      return
    }

    const body = req.body as z.infer<typeof enqueueJobSchema>
    const orgId = req.user!.orgId!
    const apiKeyId = extractApiKeyId(req.user!.id)

    const searchService = new UCCSearchService()
    const readiness = searchService.getStateReadiness(body.state)

    if (!readiness.canSearch) {
      res.status(400).json({
        success: false,
        error: {
          message: readiness.reason,
          code: 'UCC_STATE_UNAVAILABLE',
          statusCode: 400,
          details: {
            state: readiness.state,
            readinessEndpoint: `/api/scrape/readiness/${readiness.state}`
          }
        }
      })
      return
    }

    const jobService = new ScrapeJobService()
    const job = await jobService.enqueue({
      orgId,
      apiKeyId,
      companyName: body.company_name,
      state: body.state,
      limit: body.limit
    })

    res.status(202).json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        pollUrl: `/api/scrape/jobs/${job.id}`
      },
      meta: { queuedAt: job.queuedAt }
    })

    // Process the job asynchronously after the response is sent.
    setImmediate(() => {
      void (async () => {
        try {
          await jobService.markProcessing(job.id)
          const result = await searchService.search({
            companyName: job.companyName,
            state: job.state,
            limit: job.limit
          })
          await jobService.markCompleted(job.id, result)
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Processing failed'
          await jobService.markFailed(job.id, message)
        }
      })()
    })
  })
)

// GET /api/scrape/jobs/:jobId - Poll job status and retrieve results
router.get(
  '/jobs/:jobId',
  requireRole('user', 'admin'),
  validateRequest({ params: jobIdSchema }),
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { jobId } = req.params
    const orgId = req.user!.orgId!

    const jobService = new ScrapeJobService()
    const job = await jobService.get(jobId, orgId)

    if (!job) {
      res.status(404).json({
        success: false,
        error: {
          message: 'Scrape job not found',
          code: 'JOB_NOT_FOUND',
          statusCode: 404
        }
      })
      return
    }

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        companyName: job.companyName,
        state: job.state,
        result: job.result,
        error: job.error,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt
      }
    })
  })
)

export default router
