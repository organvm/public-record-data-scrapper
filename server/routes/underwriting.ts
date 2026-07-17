/**
 * Underwriting routes.
 *
 *   POST /api/underwriting/analyze-statement
 *     Analyze a normalized bank-statement transaction list into the full
 *     underwriting feature set (BankStatementAnalyzer) and run the existing
 *     QualificationService over it. Paid-tier surface: free-tier callers get
 *     a 402 upsell, same contract as the prospect-cap gate.
 *
 * Mounted behind authMiddleware + orgContextMiddleware + dataTierRouter
 * (server/index.ts), so `getResolvedDataTier` reads the server-side resolved
 * entitlement — never a client-supplied header.
 *
 * @module server/routes/underwriting
 */

import { Router } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { getResolvedDataTier } from '../middleware/dataTier'
import { BankStatementAnalyzer } from '../services/BankStatementAnalyzer'
import { QualificationService } from '../services/QualificationService'

const router = Router()

const transactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  description: z.string().min(1).max(200),
  // Plaid sign convention: positive = debit/withdrawal, negative = deposit.
  amount: z.number().finite(),
  running_balance: z.number().finite().optional()
})

const analyzeStatementSchema = z.object({
  transactions: z.array(transactionSchema).min(1).max(10000),
  time_in_business_months: z.number().int().positive().max(600).optional(),
  industry: z.string().max(100).optional(),
  state: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .optional()
})

type AnalyzeStatementBody = z.infer<typeof analyzeStatementSchema>

// POST /api/underwriting/analyze-statement - statement rows in, features +
// qualification verdict out. Nothing is persisted.
router.post(
  '/analyze-statement',
  validateRequest({ body: analyzeStatementSchema }),
  asyncHandler(async (req, res) => {
    if (getResolvedDataTier(req) === 'free-tier') {
      return res.status(402).json({
        success: false,
        error: {
          message:
            'Bank-statement analysis is a paid feature. Upgrade to Starter or Pro to run underwriting on statement data.',
          code: 'TIER_UPGRADE_REQUIRED',
          statusCode: 402,
          details: {
            currentTier: 'free',
            requiredTier: 'starter',
            cta: { action: 'upgrade_plan', label: 'Upgrade to Starter', href: '/pricing' }
          }
        }
      })
    }

    const body = req.body as AnalyzeStatementBody

    const analyzer = new BankStatementAnalyzer()
    const analysis = analyzer.analyze(body.transactions)

    // Standalone analysis: the synthetic id never matches a prospect row, so
    // QualificationService falls back to the options provided here.
    const qualificationService = new QualificationService()
    const qualification = await qualificationService.qualify('statement-analysis', analysis, {
      timeInBusinessMonths: body.time_in_business_months,
      industry: body.industry,
      state: body.state
    })

    res.json({
      success: true,
      data: {
        features: analysis,
        qualification,
        capacityEstimate: analysis.capacityEstimate,
        stackingDetected: analysis.stackingDetected
      }
    })
  })
)

export default router
