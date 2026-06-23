/**
 * On-Demand UCC Filing Search Routes
 *
 * Provides public API for searching UCC filings by company name and state.
 * First-paying-customer revenue endpoint: data-as-a-service / one-off scrape gigs.
 *
 *   POST /api/scrape/ucc  search for UCC filings by company name + state
 *
 * @module server/routes/scrape
 */

import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole } from '../middleware/authMiddleware'
import { UCCSearchService } from '../services/UCCSearchService'

const router = Router()

// Validation schemas
const searchUCCSchema = z.object({
  company_name: z.string().min(2).max(200),
  state: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase()),
  limit: z.coerce.number().int().positive().max(1000).default(100)
})

// POST /api/scrape/ucc - Search for UCC filings by company name
router.post(
  '/ucc',
  requireRole('user', 'admin'),
  validateRequest({ body: searchUCCSchema }),
  asyncHandler(async (req, res) => {
    const searchService = new UCCSearchService()
    const body = req.body as z.infer<typeof searchUCCSchema>

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

export default router
