/**
 * Lead-discovery routes (top-of-funnel, beyond UCC — campaign Phase 3 / #60).
 *
 *   POST /api/discovery/run       run discovery across configured channels,
 *                                 dedupe, persist new prospects + signals.
 *   GET  /api/discovery/channels  list channels + their configured state.
 *
 * Org is ALWAYS derived from the authenticated JWT (never trusted from the
 * client) — same multi-tenant discipline as routes/deals.ts.
 *
 * @module server/routes/discovery
 */

import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { LeadDiscoveryService } from '../services/LeadDiscoveryService'

const router = Router()

/**
 * Resolve the caller's tenant (org) from the verified JWT. The org is ALWAYS
 * derived from `req.user.orgId`; a client-supplied `org_id` must match the
 * token's org or the request is rejected (403). Returns the orgId on success,
 * or null after writing an error response (caller must return immediately).
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

const runDiscoverySchema = z
  .object({
    org_id: z.string().uuid().optional(),
    // Channel names to restrict the run to; omit to run all.
    channels: z.array(z.string().min(1)).optional(),
    // Two-letter USPS state code (case-insensitive on the wire).
    state: z
      .string()
      .length(2)
      .transform((s) => s.toUpperCase())
      .optional(),
    limit: z.coerce.number().int().positive().max(200).optional()
  })
  .strict()

// POST /api/discovery/run - run discovery and persist new candidate prospects.
router.post(
  '/run',
  requireRole('user', 'admin'),
  validateRequest({ body: runDiscoverySchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const body = req.body as z.infer<typeof runDiscoverySchema>
    const service = new LeadDiscoveryService()

    const result = await service.run({
      orgId,
      channels: body.channels,
      state: body.state,
      limit: body.limit
    })

    res.json({
      candidates_found: result.candidates_found,
      inserted: result.inserted,
      duplicates: result.duplicates,
      per_channel: result.per_channel
    })
  })
)

// GET /api/discovery/channels - list channels and their configured state.
router.get(
  '/channels',
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const service = new LeadDiscoveryService()
    res.json({ channels: service.listChannels() })
  })
)

export default router
