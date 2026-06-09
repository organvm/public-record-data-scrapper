/**
 * ImprovementExecutor
 *
 * Maps an approved agentic Improvement to a concrete, real server-side action.
 *
 * The web-side AgenticEngine previously "executed" improvements via a closed
 * simulation (setTimeout + fabricated before/after metrics). This service is
 * the real execution path: it translates an improvement's category into an
 * actual side effect that the platform already supports, and returns ONLY
 * observed effects (a real BullMQ jobId, a persisted alertId, a scored
 * prospect id, etc.).
 *
 * Fail-closed discipline: any category without a concrete server-side action,
 * or any improvement missing the inputs a real action requires (e.g. no
 * prospect ids to re-enrich, no org/prospect to attach an alert to), returns
 * `{ executed: false, reason }`. It NEVER claims success for an action that
 * did not happen, and it NEVER fabricates metrics.
 *
 * @module server/services/ImprovementExecutor
 */

import { getEnrichmentQueue } from '../queue/queues'
import { AlertService, type AlertType, type AlertSeverity } from './AlertService'
import { ScoringService } from './ScoringService'
import { database } from '../database/connection'

/**
 * Verifies which of the supplied prospect ids actually belong to `orgId` and
 * returns ONLY the verified subset. The `prospectIds` arriving from the web
 * layer are attacker-influenceable (a client could forge ids belonging to
 * another tenant), so every id an action would touch MUST be filtered through
 * this org-ownership gate before any side effect.
 *
 * Injectable for testing; the production default queries the `prospects` table
 * (org_id is NOT NULL with an FK — migration 014).
 */
export type ProspectOwnershipFilter = (prospectIds: string[], orgId: string) => Promise<string[]>

const defaultProspectOwnershipFilter: ProspectOwnershipFilter = async (prospectIds, orgId) => {
  if (prospectIds.length === 0) return []
  const rows = await database.query<{ id: string }>(
    'SELECT id FROM prospects WHERE id = ANY($1) AND org_id = $2',
    [prospectIds, orgId]
  )
  return rows.map((row) => row.id)
}

/**
 * Minimal server-side mirror of the web `Improvement` contract
 * (apps/web/src/lib/agentic/types.ts). Only the fields the executor actually
 * needs to route and act are required; everything else is accepted loosely so
 * the engine can forward its improvement without a lossy re-shape.
 *
 * `prospectIds` is the executor-specific extension: the web layer must supply
 * the flagged prospect ids for data-quality / performance / alert actions,
 * since the improvement suggestion itself does not carry them.
 */
export interface ExecutableImprovement {
  id: string
  category: string
  title: string
  description?: string
  /** Prospect ids the improvement applies to (re-enrichment / re-score / alert target). */
  prospectIds?: string[]
  /** Optional per-improvement severity hint for alert-producing categories. */
  severity?: AlertSeverity
}

/**
 * The structured outcome of attempting to execute an improvement. Returned
 * verbatim to the caller (and forwarded to the web engine). `executed` is the
 * single source of truth: when false, `reason` names exactly why nothing
 * happened. `details` carries ONLY real observed effects (jobId, alertId,
 * scored prospect ids).
 */
export interface ExecutionResult {
  executed: boolean
  /** Stable action discriminator (e.g. 're-enrichment', 'alert', 're-score', 'none'). */
  action: string
  /** Real observed effects only — never fabricated metrics. */
  details: Record<string, unknown>
  /** Present (and human-readable) whenever `executed` is false. */
  reason?: string
}

/**
 * Maps an improvement category to the alert type used when persisting a
 * security/compliance alert. Unknown-but-routable categories fall back to a
 * generic critical-score signal so the persisted alert still type-checks
 * against the `alerts` table CHECK constraint (migration 020).
 */
function alertTypeForCategory(category: string): AlertType {
  switch (category) {
    case 'security':
    case 'threat-analysis':
      return 'score_critical'
    case 'compliance':
      return 'trend_declining'
    default:
      return 'score_critical'
  }
}

/**
 * Executes approved agentic improvements as real platform side effects.
 *
 * Dependencies are injectable for testing; production callers construct it
 * with no arguments and get the live AlertService / ScoringService and the
 * shared enrichment queue.
 */
export class ImprovementExecutor {
  private readonly alertService: AlertService
  private readonly scoringService: ScoringService
  private readonly verifyProspectOwnership: ProspectOwnershipFilter

  constructor(
    deps: {
      alertService?: AlertService
      scoringService?: ScoringService
      verifyProspectOwnership?: ProspectOwnershipFilter
    } = {}
  ) {
    this.alertService = deps.alertService ?? new AlertService()
    this.scoringService = deps.scoringService ?? new ScoringService()
    this.verifyProspectOwnership = deps.verifyProspectOwnership ?? defaultProspectOwnershipFilter
  }

  /**
   * Execute a single approved improvement.
   *
   * @param improvement - the approved improvement to act on
   * @param orgId - the caller's tenant; required for alert persistence
   */
  async execute(improvement: ExecutableImprovement, orgId: string): Promise<ExecutionResult> {
    const category = improvement.category

    switch (category) {
      case 'data-quality':
      case 'performance':
        return this.executeDataAction(improvement, orgId)

      case 'security':
      case 'compliance':
      case 'threat-analysis':
        return this.executeAlertAction(improvement, orgId, category)

      default:
        // Fail closed: there is no concrete server-side action for this
        // category, so we never claim success.
        return {
          executed: false,
          action: 'none',
          details: {},
          reason: `no server-side action for category ${category}`
        }
    }
  }

  /**
   * data-quality / performance → enqueue real re-enrichment for the flagged
   * prospects, or (when enrichment is unavailable) re-score them via the real
   * ScoringService. Requires prospect ids: with none, there is nothing concrete
   * to act on, so we fail closed.
   */
  private async executeDataAction(
    improvement: ExecutableImprovement,
    orgId: string
  ): Promise<ExecutionResult> {
    const requestedIds = improvement.prospectIds ?? []

    if (requestedIds.length === 0) {
      return {
        executed: false,
        action: 're-enrichment',
        details: {},
        reason: `category ${improvement.category} requires prospectIds but none were provided`
      }
    }

    // Org-ownership gate: act ONLY on prospects that belong to the caller's
    // tenant. Forged / cross-tenant ids are dropped here before any side effect.
    const prospectIds = await this.verifyProspectOwnership(requestedIds, orgId)

    if (prospectIds.length === 0) {
      return {
        executed: false,
        action: 're-enrichment',
        details: {},
        reason: 'no prospects belong to this organization'
      }
    }

    // Preferred concrete action: enqueue a real re-enrichment job. The job id
    // is a genuine observed effect we can surface.
    try {
      const queue = getEnrichmentQueue()
      const job = await queue.add('enrich-batch', {
        prospectIds,
        force: true,
        orgId
      })

      return {
        executed: true,
        action: 're-enrichment',
        details: {
          jobId: job.id ?? null,
          queueName: 'data-enrichment',
          prospectIds
        }
      }
    } catch (enqueueError) {
      // Enrichment queue is not initialized / unreachable. Fall back to a real
      // re-score via ScoringService. We still only report what actually ran.
      const scored: string[] = []
      const failures: Array<{ prospectId: string; error: string }> = []

      for (const prospectId of prospectIds) {
        try {
          await this.scoringService.scoreProspect(prospectId)
          scored.push(prospectId)
        } catch (scoreError) {
          failures.push({
            prospectId,
            error: scoreError instanceof Error ? scoreError.message : String(scoreError)
          })
        }
      }

      if (scored.length === 0) {
        return {
          executed: false,
          action: 're-score',
          details: { failures },
          reason: `re-enrichment enqueue failed (${
            enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
          }) and no prospect could be re-scored`
        }
      }

      return {
        executed: true,
        action: 're-score',
        details: { scoredProspectIds: scored, failures }
      }
    }
  }

  /**
   * security / compliance / threat-analysis → persist a real alert via
   * AlertService (backed by the `alerts` table, migration 020). Requires an
   * org and a target prospect; without a prospect there is nothing to attach
   * the alert to, so we fail closed.
   */
  private async executeAlertAction(
    improvement: ExecutableImprovement,
    orgId: string,
    category: string
  ): Promise<ExecutionResult> {
    const requestedIds = improvement.prospectIds ?? []

    if (requestedIds.length === 0) {
      return {
        executed: false,
        action: 'alert',
        details: {},
        reason: `category ${category} requires a target prospectId but none was provided`
      }
    }

    // Org-ownership gate: only raise an alert against a prospect that belongs
    // to the caller's tenant. A forged cross-tenant id is dropped here.
    const ownedIds = await this.verifyProspectOwnership(requestedIds, orgId)
    const prospectId = ownedIds[0]

    if (!prospectId) {
      return {
        executed: false,
        action: 'alert',
        details: {},
        reason: 'no prospects belong to this organization'
      }
    }

    const alert = await this.alertService.createAlert({
      orgId,
      prospectId,
      type: alertTypeForCategory(category),
      severity: improvement.severity ?? 'high',
      title: improvement.title,
      message:
        improvement.description ??
        `Agentic ${category} improvement ${improvement.id} flagged this prospect for review.`,
      data: {
        source: 'agentic-improvement',
        improvementId: improvement.id,
        category
      }
    })

    return {
      executed: true,
      action: 'alert',
      details: {
        alertId: alert.id,
        prospectId: alert.prospectId,
        alertType: alert.type
      }
    }
  }
}
