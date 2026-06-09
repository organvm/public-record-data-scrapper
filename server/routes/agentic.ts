import { Router, Response } from 'express'
import { z } from 'zod'
import { validateRequest } from '../middleware/validateRequest'
import { asyncHandler } from '../middleware/errorHandler'
import { requireRole, AuthenticatedRequest } from '../middleware/authMiddleware'
import { ImprovementExecutor, type ExecutableImprovement } from '../services/ImprovementExecutor'
import { database } from '../database/connection'

const router = Router()

/**
 * Hard ceiling on the serialized callback payload persisted to audit_logs.
 * The cycle review + improvement arrays are stored verbatim as the durable
 * audit record, so without a cap a client could push an unbounded blob into
 * the compliance sink. 128KB comfortably fits a real council cycle while
 * rejecting abuse.
 */
const MAX_CALLBACK_PAYLOAD_BYTES = 128 * 1024

/**
 * Resolves the caller's tenant (org) from the authenticated JWT and enforces
 * multi-tenant isolation. Mirrors the contract used by deals.ts: the org is
 * ALWAYS derived from `req.user.orgId` and never trusted from the client. A
 * client-supplied `org_id` must match the token's org or the request is
 * rejected (403).
 *
 * Returns the resolved orgId on success, or null after writing an error
 * response (the caller must return immediately when null is returned).
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

// Body schema for POST /execute: the approved improvement. Kept permissive on
// the suggestion internals (the executor only routes on `category`), but strict
// at the top level so unexpected fields are rejected. `org_id` is optional and
// only cross-checked against the token (see resolveOrgId).
const executeImprovementSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    id: z.string().min(1),
    category: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    prospectIds: z.array(z.string().min(1)).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional()
  })
  .strict()

// Body schema for POST /callbacks: the AgentCallbackClient cycle payload
// (apps/web/src/lib/agentic/types.ts → AgentCallbackPayload). Validated only at
// the envelope level — the council review and improvement arrays are stored
// verbatim as the durable audit record, so their internals are passed through.
const callbackPayloadSchema = z
  .object({
    org_id: z.string().uuid().optional(),
    // entity_id in audit_logs is a UUID column; the web AgenticCouncil mints
    // the cycle id via uuidv4(), so we validate it here to fail closed at 400
    // rather than surfacing a DB type error as a 500.
    review: z.object({ id: z.string().uuid() }).passthrough(),
    executedImprovements: z.array(z.unknown()),
    pendingImprovements: z.array(z.unknown())
  })
  .strict()

/**
 * POST /api/agentic/execute
 *
 * Runs the ImprovementExecutor against an approved improvement and returns its
 * ExecutionResult verbatim. Always 200: the executor itself reports
 * success/failure via `executed` (fail-closed), so a non-executing improvement
 * is a valid result, not an HTTP error.
 */
router.post(
  '/execute',
  requireRole('user', 'admin'),
  validateRequest({ body: executeImprovementSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const body = req.body as z.infer<typeof executeImprovementSchema>
    const improvement: ExecutableImprovement = {
      id: body.id,
      category: body.category,
      title: body.title,
      description: body.description,
      prospectIds: body.prospectIds,
      severity: body.severity
    }

    const executor = new ImprovementExecutor()
    const result = await executor.execute(improvement, orgId)

    res.status(200).json(result)
  })
)

/**
 * POST /api/agentic/callbacks
 *
 * Accepts the AgentCallbackClient cycle payload and persists it to the durable
 * audit log (`audit_logs`, the immutable compliance sink). Returns 202: the
 * payload is recorded for later review, not acted on synchronously.
 */
router.post(
  '/callbacks',
  requireRole('user', 'admin'),
  validateRequest({ body: callbackPayloadSchema }),
  asyncHandler(async (req, res) => {
    const orgId = resolveOrgId(req as AuthenticatedRequest, res)
    if (!orgId) return

    const authReq = req as AuthenticatedRequest
    const body = req.body as z.infer<typeof callbackPayloadSchema>

    // Serialize once: this exact string is both size-checked and persisted.
    const serializedState = JSON.stringify({
      review: body.review,
      executedImprovements: body.executedImprovements,
      pendingImprovements: body.pendingImprovements
    })

    // Cap the payload before it reaches the durable audit sink. Reject
    // oversized blobs (413) with a named reason rather than persisting them.
    const payloadBytes = Buffer.byteLength(serializedState, 'utf8')
    if (payloadBytes > MAX_CALLBACK_PAYLOAD_BYTES) {
      res.status(413).json({
        error: {
          message: `Callback payload too large: ${payloadBytes} bytes exceeds the ${MAX_CALLBACK_PAYLOAD_BYTES}-byte limit`,
          code: 'PAYLOAD_TOO_LARGE',
          statusCode: 413
        }
      })
      return
    }

    // Persist verbatim to audit_logs. The cycle review id is the entity id so
    // the record is retrievable by AuditService.getEntityHistory.
    await database.query(
      `INSERT INTO audit_logs (
        org_id, user_id, action, entity_type, entity_id, after_state
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orgId,
        authReq.user?.id ?? null,
        'agentic_cycle_callback',
        'agentic_cycle',
        body.review.id,
        serializedState
      ]
    )

    res.status(202).json({
      status: 'accepted',
      cycleId: body.review.id,
      executed: body.executedImprovements.length,
      pending: body.pendingImprovements.length
    })
  })
)

export default router
