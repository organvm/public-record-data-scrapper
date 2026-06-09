import { apiRequest } from './client'
import type { AgentCallbackPayload, Improvement } from '../agentic/types'

/**
 * Server-side execution outcome for an approved improvement. Mirrors
 * `ExecutionResult` in server/services/ImprovementExecutor.ts. `executed` is
 * the single source of truth: when false, `reason` names exactly why nothing
 * happened, and `details` carries ONLY real observed effects (jobId, alertId,
 * scored prospect ids) — never fabricated metrics.
 */
export interface ExecutionResult {
  executed: boolean
  action: string
  details: Record<string, unknown>
  reason?: string
}

/**
 * The request body POST /api/agentic/execute expects: the approved improvement
 * flattened to the fields the server-side executor routes on, plus the
 * executor-specific `prospectIds` extension.
 */
export interface ExecuteImprovementRequest {
  id: string
  category: string
  title: string
  description?: string
  prospectIds?: string[]
  severity?: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Client seam used by AgenticEngine to reach the real execution path. Both
 * methods talk to the server; the engine depends on this interface (not the
 * concrete functions) so it can be unit-tested without a live API.
 */
export interface AgenticApiClient {
  executeImprovement(
    request: ExecuteImprovementRequest,
    signal?: AbortSignal
  ): Promise<ExecutionResult>
  sendCallback(payload: AgentCallbackPayload, signal?: AbortSignal): Promise<void>
}

/**
 * Flattens a full `Improvement` into the execute request shape.
 *
 * `prospectIds` resolution order:
 *   1. an explicit `prospectIds` argument (a caller narrowing the target set),
 *   2. the improvement's own `prospectIds`,
 *   3. the originating suggestion's `prospectIds` (where an agent attached the
 *      flagged prospect ids when the finding referenced specific prospects).
 *
 * When none of those carry ids the field is omitted, and the server-side
 * executor fails closed for actionable categories — the correct honest outcome
 * for a genuinely system-level suggestion.
 */
export function toExecuteRequest(
  improvement: Improvement,
  prospectIds?: string[]
): ExecuteImprovementRequest {
  const resolvedProspectIds =
    prospectIds ?? improvement.prospectIds ?? improvement.suggestion.prospectIds

  return {
    id: improvement.id,
    category: improvement.suggestion.category,
    title: improvement.suggestion.title,
    description: improvement.suggestion.description,
    prospectIds: resolvedProspectIds
  }
}

/**
 * POST /api/agentic/execute — run an approved improvement server-side and
 * return its real ExecutionResult.
 */
export async function executeImprovement(
  request: ExecuteImprovementRequest,
  signal?: AbortSignal
): Promise<ExecutionResult> {
  return apiRequest<ExecutionResult>('/agentic/execute', {
    method: 'POST',
    body: request,
    signal
  })
}

/**
 * POST /api/agentic/callbacks — persist a completed autonomous cycle payload.
 */
export async function sendCallback(
  payload: AgentCallbackPayload,
  signal?: AbortSignal
): Promise<void> {
  await apiRequest('/agentic/callbacks', {
    method: 'POST',
    body: payload,
    signal
  })
}

/**
 * Default API client wired to the real HTTP functions above.
 */
export const agenticApiClient: AgenticApiClient = {
  executeImprovement,
  sendCallback
}
