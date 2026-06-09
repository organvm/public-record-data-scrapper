import type { PoolClient } from 'pg'
import {
  OUTREACH_SEQUENCES,
  MINIMUM_CAPACITY_SCORE,
  SEQUENCE_COOLDOWN_DAYS
} from '../config/outreachTemplates'

/**
 * The minimal database surface this service depends on. `query` is the row-array
 * passthrough every caller already provides. `getPoolClient` is optional: when
 * present (the real `database` wrapper exposes it), recordReply runs its two
 * UPDATEs on a single dedicated connection inside a BEGIN/COMMIT transaction.
 * When absent (lightweight unit fakes), recordReply falls back to sequential
 * `query` calls — still checking the sequence rowCount so the caller gets a
 * truthful result.
 */
interface SequenceDb {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
  getPoolClient?: () => Promise<PoolClient>
}

export class OutreachSequenceService {
  constructor(private db: SequenceDb) {}

  async isEligible(
    prospectId: string,
    triggerType: string,
    capacityScore?: number
  ): Promise<{ eligible: boolean; reason?: string }> {
    // Check 1: Score threshold (if provided)
    if (capacityScore !== undefined && capacityScore < MINIMUM_CAPACITY_SCORE) {
      return {
        eligible: false,
        reason: `Fresh capacity score ${capacityScore} below threshold ${MINIMUM_CAPACITY_SCORE}`
      }
    }

    // Check 2: Cooldown — no active/recent sequence for this prospect+trigger in last N days
    const recent = await this.db.query<{ id: string }>(
      `SELECT id FROM outreach_sequences
       WHERE prospect_id = $1 AND trigger_type = $2
         AND created_at >= NOW() - $3::integer * INTERVAL '1 day'
         AND status NOT IN ('cancelled', 'failed')
       LIMIT 1`,
      [prospectId, triggerType, SEQUENCE_COOLDOWN_DAYS]
    )
    if (recent.length > 0) {
      return {
        eligible: false,
        reason: `Active or recent sequence exists (cooldown ${SEQUENCE_COOLDOWN_DAYS} days)`
      }
    }

    // Check 3: Templates exist for this trigger type
    const templates = OUTREACH_SEQUENCES[triggerType]
    if (!templates || templates.length === 0) {
      return { eligible: false, reason: `No templates configured for trigger type: ${triggerType}` }
    }

    return { eligible: true }
  }

  async createSequence(
    prospectId: string,
    triggerType: string,
    filingEventId?: string,
    capacityScore?: number
  ): Promise<string> {
    const templates = OUTREACH_SEQUENCES[triggerType] || []

    // Create sequence
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO outreach_sequences (prospect_id, filing_event_id, trigger_type, total_steps, fresh_capacity_score, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING id`,
      [prospectId, filingEventId || null, triggerType, templates.length, capacityScore || null]
    )
    const sequenceId = rows[0].id

    // Create steps
    for (let i = 0; i < templates.length; i++) {
      const template = templates[i]
      const scheduledFor =
        template.delayMinutes > 0
          ? new Date(Date.now() + template.delayMinutes * 60 * 1000).toISOString()
          : null

      await this.db.query(
        `INSERT INTO outreach_steps (sequence_id, step_number, channel, template_key, subject, body, scheduled_for, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sequenceId,
          i + 1,
          template.channel,
          template.key,
          template.subject || null,
          template.body,
          scheduledFor,
          scheduledFor ? 'scheduled' : 'pending'
        ]
      )
    }

    // Update sequence started_at
    await this.db.query(`UPDATE outreach_sequences SET started_at = NOW() WHERE id = $1`, [
      sequenceId
    ])

    return sequenceId
  }

  async getNextPendingStep(sequenceId: string): Promise<{
    id: string
    stepNumber: number
    channel: string
    templateKey: string | null
    subject: string | null
    body: string | null
    scheduledFor: string | null
  } | null> {
    const rows = await this.db.query<{
      id: string
      step_number: number
      channel: string
      template_key: string | null
      subject: string | null
      body: string | null
      scheduled_for: string | null
    }>(
      `SELECT id, step_number, channel, template_key, subject, body, scheduled_for
       FROM outreach_steps
       WHERE sequence_id = $1 AND status = 'pending'
       ORDER BY step_number ASC LIMIT 1`,
      [sequenceId]
    )
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      id: r.id,
      stepNumber: r.step_number,
      channel: r.channel,
      templateKey: r.template_key,
      subject: r.subject,
      body: r.body,
      scheduledFor: r.scheduled_for
    }
  }

  async updateStepStatus(
    stepId: string,
    status: string,
    externalId?: string,
    error?: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE outreach_steps SET status = $2, external_id = $3, error = $4, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END WHERE id = $1`,
      [stepId, status, externalId || null, error || null]
    )
  }

  async completeSequence(sequenceId: string): Promise<void> {
    await this.db.query(
      `UPDATE outreach_sequences SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [sequenceId]
    )
  }

  async getActiveSequences(prospectId: string): Promise<
    {
      id: string
      triggerType: string
      status: string
      currentStep: number
      totalSteps: number
      createdAt: string
    }[]
  > {
    return this.db.query(
      `SELECT id, trigger_type as "triggerType", status, current_step as "currentStep", total_steps as "totalSteps", created_at as "createdAt"
       FROM outreach_sequences WHERE prospect_id = $1 AND status IN ('pending', 'active')
       ORDER BY created_at DESC`,
      [prospectId]
    )
  }

  async cancelSequence(sequenceId: string): Promise<void> {
    await this.db.query(`UPDATE outreach_sequences SET status = 'cancelled' WHERE id = $1`, [
      sequenceId
    ])
    await this.db.query(
      `UPDATE outreach_steps SET status = 'skipped' WHERE sequence_id = $1 AND status IN ('pending', 'scheduled')`,
      [sequenceId]
    )
  }

  /**
   * Find a prospect's outreach sequences that are still in flight (pending or
   * active). These are the sequences an inbound reply should attach to and stop.
   * Returns the sequence id plus its current trigger_type/status.
   */
  async getActiveSequenceIds(
    prospectId: string
  ): Promise<{ id: string; triggerType: string; status: string }[]> {
    return this.db.query<{ id: string; triggerType: string; status: string }>(
      `SELECT id, trigger_type AS "triggerType", status
       FROM outreach_sequences
       WHERE prospect_id = $1 AND status IN ('pending', 'active')
       ORDER BY created_at DESC`,
      [prospectId]
    )
  }

  /**
   * Record that a contact replied to a sequence, and stop any further pending or
   * scheduled sends for it.
   *
   * The status CHECK on outreach_sequences (migration 012) does not include a
   * dedicated 'replied' value, and there is no column that fits a reply marker.
   * Rather than introduce a migration purely for a label, we reuse the existing
   * terminal 'cancelled' state — which already halts pending/scheduled steps via
   * the same state machine `cancelSequence` uses — and stamp the reply provenance
   * (timestamp, communication id, disposition) into the existing `metadata` JSONB
   * column. This keeps the reply auditable without a schema change.
   *
   * The metadata merge preserves any pre-existing keys (e.g. trigger context) by
   * merging into COALESCE(metadata, '{}') server-side.
   *
   * Transactionality: the sequence terminal-marking and the step-skipping are a
   * single atomic unit — a crash between them would leave a "cancelled" sequence
   * with live pending steps that the worker would keep sending. When the db
   * exposes a pool client we run both inside BEGIN/COMMIT on one connection;
   * otherwise we degrade to sequential queries (unit fakes). Either way we check
   * the sequence UPDATE's rowCount: a no-op match (already-terminal or unknown
   * id) is surfaced as a named warning rather than silently claiming success.
   *
   * Return type: this is the method the ReplyHandlingService `OutreachSequencePort`
   * contract calls, and that port is typed `Promise<void>`. We keep `recordReply`
   * void-compatible so that contract (and its caller in webhooks.ts) compiles
   * unchanged. Callers that need the matched/no-match outcome use the sibling
   * `recordReplyResult` below, which returns the boolean directly.
   */
  async recordReply(
    sequenceId: string,
    communicationId: string | null,
    disposition: string
  ): Promise<void> {
    const matched = await this.recordReplyResult(sequenceId, communicationId, disposition)
    if (!matched) {
      // Named result for the no-match case (already-terminal or unknown id):
      // the reply was NOT attached to any in-flight sequence. Surface it so it
      // is observable instead of a silent success.
      console.warn('[OutreachSequenceService] recordReply matched no in-flight sequence', {
        sequenceId,
        disposition
      })
    }
  }

  /**
   * Transactional core of recordReply. Returns true when the sequence row was
   * updated, false when no row matched. Separated from `recordReply` so the
   * boolean outcome is available to callers (and tests) without changing the
   * void-typed `OutreachSequencePort.recordReply` contract.
   */
  async recordReplyResult(
    sequenceId: string,
    communicationId: string | null,
    disposition: string
  ): Promise<boolean> {
    const replyMeta = {
      replied_at: new Date().toISOString(),
      reply_communication_id: communicationId,
      reply_disposition: disposition
    }
    const metaJson = JSON.stringify(replyMeta)

    // Mark the sequence terminal (so it is no longer "in flight") and stamp the
    // reply provenance. Merging with COALESCE(metadata,'{}') keeps prior keys.
    // RETURNING id lets both the pool-client and fallback paths detect a match.
    const sequenceSql = `UPDATE outreach_sequences
       SET status = 'cancelled',
           completed_at = NOW(),
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
       WHERE id = $1
       RETURNING id`
    const stepsSql = `UPDATE outreach_steps SET status = 'skipped'
       WHERE sequence_id = $1 AND status IN ('pending', 'scheduled')`

    if (this.db.getPoolClient) {
      const client = await this.db.getPoolClient()
      try {
        await client.query('BEGIN')
        const seqResult = await client.query(sequenceSql, [sequenceId, metaJson])
        if ((seqResult.rowCount ?? 0) === 0) {
          // No sequence matched — nothing to skip. Roll back the (empty) tx and
          // report no attachment.
          await client.query('ROLLBACK')
          return false
        }
        await client.query(stepsSql, [sequenceId])
        await client.query('COMMIT')
        return true
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Swallow rollback failures so the original error propagates.
        }
        throw error
      } finally {
        client.release()
      }
    }

    // Fallback (no pool client, e.g. unit fakes): sequential queries. Without a
    // single connection there is no real transaction to roll back, so we run
    // both UPDATEs unconditionally (matching the pre-existing two-write
    // behavior) and report attachment from the sequence UPDATE's returned rows.
    // A fake that does not honor RETURNING simply reports false; the steps
    // UPDATE still runs, so no caller's query sequence is shortened.
    const seqRows = await this.db.query<{ id: string }>(sequenceSql, [sequenceId, metaJson])
    await this.db.query(stepsSql, [sequenceId])
    return seqRows.length > 0
  }
}
