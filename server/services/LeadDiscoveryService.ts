/**
 * LeadDiscoveryService
 *
 * Top-of-funnel lead discovery BEYOND UCC filings (campaign Phase 3, issue
 * #60). Fans across configured {@link DiscoveryChannel}s — each wrapping a
 * public, key-less data source — dedupes the union against existing prospects,
 * and persists NEW candidates as `prospects` rows (status 'new') plus a
 * `growth_signals` row recording the discovery signal.
 *
 * ── Dedupe ──────────────────────────────────────────────────────────────────
 *   Candidates are keyed on normalized(company_name) + state. Normalization
 *   reuses `normalizeCompanyName` from @public-records/core/identity — the SAME
 *   logic the prospects table's `company_name_normalized` column is populated
 *   with (legal-suffix stripping, lowercasing, punctuation collapse), so the
 *   in-memory key matches the persisted normalized column. Dedupe runs in two
 *   passes: (1) collapse duplicates ACROSS channels, (2) drop any candidate
 *   whose normalized name+state already exists in `prospects` for the org.
 *
 * ── Fail-closed discipline (constitutional) ─────────────────────────────────
 *   A channel that is unconfigured or throws contributes a NAMED error to the
 *   per-channel result map; the service proceeds with the channels that
 *   answered. If EVERY requested channel fails (or none is configured), NOTHING
 *   is inserted — the run reports 0 inserted with the aggregated errors.
 *
 * ── Tenancy ─────────────────────────────────────────────────────────────────
 *   Inserts are scoped to the caller's `orgId` (required). `prospects.org_id`
 *   is NOT NULL with no DB default, so it is supplied explicitly here.
 *
 *   Schema reconciliation notes (the schema is the source of truth — see
 *   database/schema.sql; we do not invent columns):
 *     • `prospects.priority_score` is `NOT NULL CHECK (0-100)` with no nullable
 *       form. The Phase-3 brief calls for "priority_score null until scored";
 *       since the column cannot be NULL we persist the sentinel `0` (valid,
 *       lowest band) to mean "unscored".
 *     • `prospects` has NO `raw_data` column (only ucc_filings / growth_signals
 *       / health_scores do). The brief's "raw_data noting discovery source" is
 *       therefore split: a concise human-readable provenance note is written to
 *       `prospects.narrative` (TEXT), and the FULL structured discovery payload
 *       is stored on the companion `growth_signals.raw_data` (JSONB) row — which
 *       a later scoring pass reads to distinguish unscored discovery seeds.
 *     • `default_date` is NOT NULL with no UCC default at discovery time, so it
 *       is set to CURRENT_DATE.
 *     • `company_name_normalized` and `time_since_default` are trigger-populated.
 *
 * @module server/services/LeadDiscoveryService
 */

import { database } from '../database/connection'
import { normalizeCompanyName } from '@public-records/core/identity'
import {
  DiscoveryChannel,
  DiscoveryCandidate,
  DiscoveryParams,
  createDefaultChannels
} from './discovery-channels'

/** Sentinel priority_score for an unscored discovery seed (column is NOT NULL). */
const UNSCORED_PRIORITY = 0
/** Industry enum values accepted by the prospects.industry CHECK constraint. */
const VALID_INDUSTRIES = new Set([
  'restaurant',
  'retail',
  'construction',
  'healthcare',
  'manufacturing',
  'services',
  'technology'
])
/** Fallback industry for candidates we cannot classify (CHECK requires one). */
const DEFAULT_INDUSTRY = 'services'

/** Per-channel outcome for the run report. */
export interface ChannelResult {
  channel: string
  configured: boolean
  /** Candidates the channel returned (before cross-channel/db dedupe). */
  candidates_found: number
  /** Named error when the channel failed; null on success. */
  error: string | null
}

/** Result of a discovery run. */
export interface DiscoveryRunResult {
  candidates_found: number
  inserted: number
  duplicates: number
  per_channel: ChannelResult[]
}

interface RunOptions extends DiscoveryParams {
  /** Tenant the discovered prospects belong to (required for inserts). */
  orgId: string
  /** Restrict the run to these channel names; omit to run all. */
  channels?: string[]
}

export class LeadDiscoveryService {
  private readonly channels: DiscoveryChannel[]

  constructor(channels: DiscoveryChannel[] = createDefaultChannels()) {
    this.channels = channels
  }

  /** Names + configured state of every registered channel. */
  listChannels(): Array<{ name: string; configured: boolean }> {
    return this.channels.map((c) => ({ name: c.name, configured: c.isConfigured() }))
  }

  /**
   * Run discovery across the selected channels, dedupe, and persist new leads.
   */
  async run(options: RunOptions): Promise<DiscoveryRunResult> {
    const { orgId, channels: requested, state, limit } = options
    if (!orgId) {
      throw new Error('LeadDiscoveryService.run requires an orgId')
    }

    const selected = this.selectChannels(requested)
    const perChannel: ChannelResult[] = []
    const collected: DiscoveryCandidate[] = []

    for (const channel of selected) {
      if (!channel.isConfigured()) {
        perChannel.push({
          channel: channel.name,
          configured: false,
          candidates_found: 0,
          error: `${channel.name}: not configured`
        })
        continue
      }

      try {
        const candidates = await channel.discover({ state, limit })
        perChannel.push({
          channel: channel.name,
          configured: true,
          candidates_found: candidates.length,
          error: null
        })
        collected.push(...candidates)
      } catch (err) {
        // Fail closed: named error, channel contributes no data.
        const message = err instanceof Error ? err.message : String(err)
        perChannel.push({
          channel: channel.name,
          configured: true,
          candidates_found: 0,
          error: `${channel.name}: ${message}`
        })
      }
    }

    // Pass 1: collapse duplicates across channels (first occurrence wins).
    const unique = this.dedupeAcrossChannels(collected)

    // Pass 2: drop candidates that already exist as prospects for this org,
    // then insert the survivors.
    let inserted = 0
    let duplicates = collected.length - unique.length
    for (const candidate of unique) {
      const exists = await this.prospectExists(orgId, candidate)
      if (exists) {
        duplicates++
        continue
      }
      await this.insertCandidate(orgId, candidate)
      inserted++
    }

    return {
      candidates_found: collected.length,
      inserted,
      duplicates,
      per_channel: perChannel
    }
  }

  private selectChannels(requested?: string[]): DiscoveryChannel[] {
    if (!requested || requested.length === 0) return this.channels
    const wanted = new Set(requested)
    return this.channels.filter((c) => wanted.has(c.name))
  }

  /** Collapse cross-channel duplicates on normalized(name) + state. */
  private dedupeAcrossChannels(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
    const seen = new Set<string>()
    const out: DiscoveryCandidate[] = []
    for (const c of candidates) {
      const key = this.dedupeKey(c.company_name, c.state)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(c)
    }
    return out
  }

  private dedupeKey(companyName: string, state: string): string {
    return `${normalizeCompanyName(companyName)}|${state.trim().toUpperCase()}`
  }

  /**
   * Does a prospect with this normalized name + state already exist for the
   * org? Matches against the persisted `company_name_normalized` column using
   * the SAME normalization the trigger applies.
   */
  private async prospectExists(orgId: string, candidate: DiscoveryCandidate): Promise<boolean> {
    const normalized = normalizeCompanyName(candidate.company_name)
    const rows = await database.query<{ id: string }>(
      `SELECT id FROM prospects
        WHERE org_id = $1
          AND company_name_normalized = $2
          AND state = $3
        LIMIT 1`,
      [orgId, normalized, candidate.state.trim().toUpperCase()]
    )
    return rows.length > 0
  }

  /**
   * Insert a candidate as a prospect (status 'new') plus a growth_signals row
   * for the discovery signal, in a SINGLE transaction. `company_name_normalized`
   * and `time_since_default` are populated by DB triggers, so they are not
   * supplied here. Discovery provenance goes to `prospects.narrative` (prospects
   * has no raw_data column); the full structured payload rides on the companion
   * growth_signals row.
   *
   * The two inserts are wrapped in BEGIN/COMMIT (mirrors
   * AlertService.configureAlertRules): a failure on the signal insert ROLLBACKs
   * the prospect insert, so a prospect is never stranded without its provenance
   * signal.
   */
  private async insertCandidate(orgId: string, candidate: DiscoveryCandidate): Promise<void> {
    const industry = this.resolveIndustry(candidate.industry)
    const state = candidate.state.trim().toUpperCase()
    const narrative =
      `Discovered via ${candidate.source} ` +
      `(${candidate.signal_type}, strength ${candidate.signal_strength}). Unscored discovery seed.`

    const client = await database.getPoolClient()
    try {
      await client.query('BEGIN')

      const result = await client.query<{ id: string }>(
        `INSERT INTO prospects
           (org_id, company_name, industry, state, status, priority_score, default_date, narrative)
         VALUES ($1, $2, $3, $4, 'new', $5, CURRENT_DATE, $6)
         RETURNING id`,
        [orgId, candidate.company_name, industry, state, UNSCORED_PRIORITY, narrative]
      )

      const prospectId = result.rows[0]?.id
      if (!prospectId) {
        // Fail closed: without a returned id we cannot attach the signal.
        throw new Error(`Insert for '${candidate.company_name}' did not return a prospect id`)
      }

      await client.query(
        `INSERT INTO growth_signals
           (prospect_id, type, description, detected_date, source_url, score, confidence, raw_data)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7)`,
        [
          prospectId,
          candidate.signal_type,
          `Discovered via ${candidate.source} (${candidate.signal_type})`,
          null,
          clampScore(candidate.signal_strength),
          0.5,
          JSON.stringify({ source: candidate.source, raw: candidate.raw })
        ]
      )

      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Map a channel-provided industry hint onto the prospects.industry enum.
   * Unknown / absent hints fall back to 'services' (CHECK requires a value);
   * we never invent a more specific classification than the source supports.
   */
  private resolveIndustry(hint?: string): string {
    if (hint && VALID_INDUSTRIES.has(hint)) return hint
    return DEFAULT_INDUSTRY
  }
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(100, Math.round(score)))
}
