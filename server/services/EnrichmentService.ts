/**
 * EnrichmentService
 *
 * Service layer for data enrichment in the UCC-MCA Intelligence Platform.
 * Enriches prospect data with real signals gathered from free, key-less public
 * data sources (SEC EDGAR, OSHA enforcement, USPTO, Census Business Patterns)
 * via the shared `@public-records/core/enrichment` data-source layer.
 *
 * Fail-closed discipline: a source that errors contributes a *named* error, not
 * invented data. If ALL queried sources fail, enrichment fails with the
 * aggregated reasons rather than persisting fabricated values.
 *
 * @module server/services/EnrichmentService
 */

import {
  SECEdgarSource,
  OSHASource,
  USPTOSource,
  CensusSource,
  type DataSourceResponse
} from '@public-records/core/enrichment'
import { database } from '../database/connection'
import type { ResolvedDataTier } from '../middleware/dataTier'
import { getEnrichmentQueue } from '../queue/queues'

/**
 * A prospect row as needed for enrichment (subset of the prospects table).
 */
interface ProspectRow {
  id: string
  company_name?: string | null
  industry?: string | null
  state?: string | null
}

/**
 * Per-source outcome captured during enrichment.
 */
interface SourceOutcome {
  source: string
  success: boolean
  error?: string
}

/**
 * Result of enriching a prospect with additional data.
 */
interface EnrichmentResult {
  /** Detected growth signals by type */
  growth_signals: {
    /** Number of hiring signals detected */
    hiring: number
    /** Number of permit applications detected */
    permits: number
    /** Number of new contracts detected */
    contracts: number
    /** Number of expansion signals detected */
    expansion: number
    /** Number of equipment purchase signals detected */
    equipment: number
  }
  /** Calculated health score */
  health_score: {
    /** Numeric score (0-100) */
    score: number
    /** Letter grade (A-F) */
    grade: string
    /** Trend direction (improving, stable, declining) */
    trend: string
    /** Number of violations found */
    violations: number
  }
  /** Estimated annual revenue */
  estimated_revenue: number
  /** Industry classification */
  industry_classification: string
  /** Data sources that successfully contributed */
  data_sources_used: string[]
  /** Confidence in the enrichment (0-1), proportional to source coverage */
  confidence: number
  /** Named errors from sources that failed (fail-closed: no fabricated data) */
  source_errors: string[]
}

/**
 * Map the prospect industry enum onto a 2-digit NAICS sector code so the Census
 * Business Patterns source can return real industry statistics. Industries that
 * span multiple NAICS sectors use the dominant sector.
 */
const INDUSTRY_TO_NAICS: Record<string, string> = {
  restaurant: '72', // Accommodation & Food Services
  retail: '44', // Retail Trade
  construction: '23', // Construction
  healthcare: '62', // Health Care & Social Assistance
  manufacturing: '31', // Manufacturing
  services: '54', // Professional, Scientific & Technical Services
  technology: '51' // Information
}

/**
 * Map a state abbreviation onto the FIPS state code the Census API expects.
 */
const STATE_TO_FIPS: Record<string, string> = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  DC: '11',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * Service for enriching prospect data with external signals.
 *
 * Provides methods for:
 * - Single prospect enrichment (against live free public data sources)
 * - Batch enrichment
 * - Triggering refresh of stale data
 * - Enrichment status monitoring
 *
 * @example
 * ```typescript
 * const service = new EnrichmentService()
 * const result = await service.enrichProspect('prospect-id')
 * ```
 */
export class EnrichmentService {
  private readonly secSource: SECEdgarSource
  private readonly oshaSource: OSHASource
  private readonly usptoSource: USPTOSource
  private readonly censusSource: CensusSource

  constructor() {
    this.secSource = new SECEdgarSource()
    this.oshaSource = new OSHASource()
    this.usptoSource = new USPTOSource()
    this.censusSource = new CensusSource()
  }

  /**
   * Enrich a single prospect with real growth signals and health data drawn
   * from free public data sources.
   *
   * This method:
   * 1. Fetches the prospect from the database
   * 2. Queries SEC EDGAR, OSHA, USPTO and Census for real signals
   * 3. Persists growth_signals, a health_scores row, an enrichment_logs row and
   *    updates the prospect's enrichment metadata
   * 4. Returns the aggregated enrichment result
   *
   * Fail-closed: each source that errors contributes a named error rather than
   * fabricated data; if every queried source fails the method throws with the
   * aggregated reasons (and records a `failed` enrichment_logs row).
   *
   * @param prospectId - The prospect's unique identifier
   * @returns Enrichment result with all gathered data
   * @throws {Error} If the prospect is not found, or if all sources fail
   */
  async enrichProspect(
    prospectId: string,
    _dataTier: ResolvedDataTier = 'free-tier'
  ): Promise<EnrichmentResult> {
    // Reserved for tier-based source routing once paid tiers (Phase 2
    // credentials) are wired; the free tier is the only live tier today.
    void _dataTier
    const startedAt = new Date()

    const prospect = await database.query<ProspectRow>('SELECT * FROM prospects WHERE id = $1', [
      prospectId
    ])

    if (prospect.length === 0) {
      throw new Error(`Prospect ${prospectId} not found`)
    }

    const row = prospect[0]
    const companyName = (row.company_name ?? '').trim()
    const industry = (row.industry ?? '').trim().toLowerCase()
    const state = (row.state ?? '').trim().toUpperCase()

    const outcomes: SourceOutcome[] = []

    // --- SEC EDGAR: presence of public filings (contract/expansion signal) ---
    let secFilings = 0
    if (companyName) {
      const sec = await this.secSource.fetchData({ companyName })
      this.recordOutcome(outcomes, sec)
      if (sec.success) {
        const data = asRecord(sec.data)
        const filings = data.filings
        secFilings = Array.isArray(filings) ? filings.length : data.cik ? 1 : 0
      }
    } else {
      outcomes.push({ source: 'sec-edgar', success: false, error: 'missing company name' })
    }

    // --- OSHA: workplace-safety violations (health-score input) ---
    let oshaViolations = 0
    let oshaPenalties = 0
    let oshaRecent: unknown[] = []
    if (companyName) {
      const osha = await this.oshaSource.fetchData({ companyName })
      this.recordOutcome(outcomes, osha)
      if (osha.success) {
        const data = asRecord(osha.data)
        oshaViolations = asNumber(data.violations)
        oshaPenalties = asNumber(data.totalPenalties)
        oshaRecent = Array.isArray(data.recentViolations) ? data.recentViolations : []
      }
    } else {
      outcomes.push({ source: 'osha', success: false, error: 'missing company name' })
    }

    // --- USPTO: trademark assignments/applications (expansion signal) ---
    let trademarkCount = 0
    if (companyName) {
      const uspto = await this.usptoSource.fetchData({ companyName })
      this.recordOutcome(outcomes, uspto)
      if (uspto.success) {
        const data = asRecord(uspto.data)
        trademarkCount = asNumber(data.trademarkCount)
      }
    } else {
      outcomes.push({ source: 'uspto', success: false, error: 'missing company name' })
    }

    // --- Census: industry statistics for the prospect's state/sector ---
    let censusBusinessCount = 0
    let censusEmployees = 0
    let censusPayroll = 0
    const fips = STATE_TO_FIPS[state]
    const naicsCode = INDUSTRY_TO_NAICS[industry]
    if (fips) {
      const census = await this.censusSource.fetchData({ state: fips, naicsCode: naicsCode ?? '' })
      this.recordOutcome(outcomes, census)
      if (census.success) {
        const data = asRecord(census.data)
        censusBusinessCount = asNumber(data.businessCount)
        censusEmployees = asNumber(data.totalEmployees)
        censusPayroll = asNumber(data.totalPayroll)
      }
    } else {
      outcomes.push({ source: 'census', success: false, error: `unknown state '${state}'` })
    }

    const successfulSources = outcomes.filter((o) => o.success)
    const failedSources = outcomes.filter((o) => !o.success)
    const sourceErrors = failedSources.map((o) => `${o.source}: ${o.error ?? 'unknown error'}`)

    // Fail-closed: if no source produced data, do not persist anything; fail the
    // job with the aggregated reasons.
    if (successfulSources.length === 0) {
      const reasons = sourceErrors.join('; ') || 'no sources returned data'
      await this.recordEnrichmentLog({
        prospectId,
        status: 'failed',
        enrichedFields: [],
        errors: sourceErrors,
        confidence: 0,
        startedAt,
        metadata: { company_name: companyName, industry, state }
      })
      throw new Error(`Enrichment failed for prospect ${prospectId}: ${reasons}`)
    }

    // Derive growth signals from the real source data.
    const growthSignals = {
      hiring: 0,
      permits: 0,
      contracts: secFilings > 0 ? secFilings : 0,
      expansion: trademarkCount > 0 ? trademarkCount : 0,
      equipment: 0
    }

    // Derive a health score from OSHA violations (fewer violations → higher).
    const violationPenalty = Math.min(oshaViolations * 10, 60)
    const healthScoreValue = Math.max(0, 100 - violationPenalty)
    const grade = this.scoreToGrade(healthScoreValue)
    const trend = oshaViolations === 0 ? 'stable' : 'declining'

    // Confidence is proportional to how many of the queried sources succeeded.
    const confidence = Number((successfulSources.length / Math.max(outcomes.length, 1)).toFixed(2))

    const dataSourcesUsed = successfulSources.map((o) => o.source)

    const result: EnrichmentResult = {
      growth_signals: growthSignals,
      health_score: {
        score: healthScoreValue,
        grade,
        trend,
        violations: oshaViolations
      },
      estimated_revenue: censusPayroll,
      industry_classification: industry || 'unknown',
      data_sources_used: dataSourcesUsed,
      confidence,
      source_errors: sourceErrors
    }

    // --- Persist what succeeded ---------------------------------------------
    const enrichedFields: string[] = []

    // Growth signals (one row per detected, non-empty signal type).
    const detectedSignals: Array<{ type: string; count: number; description: string }> = []
    if (growthSignals.contracts > 0) {
      detectedSignals.push({
        type: 'contract',
        count: growthSignals.contracts,
        description: `${growthSignals.contracts} SEC EDGAR filing(s) on record`
      })
    }
    if (growthSignals.expansion > 0) {
      detectedSignals.push({
        type: 'expansion',
        count: growthSignals.expansion,
        description: `${growthSignals.expansion} USPTO trademark application(s)`
      })
    }

    for (const signal of detectedSignals) {
      const score = Math.min(100, signal.count * 20)
      await database.query(
        `INSERT INTO growth_signals
           (prospect_id, type, description, detected_date, source_url, score, confidence, raw_data)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7)`,
        [
          prospectId,
          signal.type,
          signal.description,
          null,
          score,
          confidence,
          JSON.stringify({
            sec_filings: secFilings,
            trademark_count: trademarkCount,
            census_business_count: censusBusinessCount,
            census_employees: censusEmployees
          })
        ]
      )
      enrichedFields.push(`growth_signal:${signal.type}`)
    }

    // Health score (only when OSHA actually answered).
    const oshaSucceeded = successfulSources.some((o) => o.source === 'osha')
    if (oshaSucceeded) {
      await database.query(
        `INSERT INTO health_scores
           (prospect_id, grade, score, sentiment_trend, review_count, avg_sentiment,
            violation_count, recorded_date, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8)
         ON CONFLICT (prospect_id, recorded_date) DO UPDATE SET
           grade = EXCLUDED.grade,
           score = EXCLUDED.score,
           sentiment_trend = EXCLUDED.sentiment_trend,
           violation_count = EXCLUDED.violation_count,
           raw_data = EXCLUDED.raw_data`,
        [
          prospectId,
          grade,
          healthScoreValue,
          trend,
          0,
          0,
          oshaViolations,
          JSON.stringify({
            osha_violations: oshaViolations,
            osha_total_penalties: oshaPenalties,
            osha_recent: oshaRecent
          })
        ]
      )
      enrichedFields.push('health_score')
    }

    // Update prospect enrichment metadata (and estimated revenue when Census
    // produced a payroll figure we can use as a proxy).
    const censusSucceeded = successfulSources.some((o) => o.source === 'census')
    if (censusSucceeded && censusPayroll > 0) {
      await database.query(
        `UPDATE prospects
            SET last_enriched_at = NOW(),
                enrichment_confidence = $2,
                estimated_revenue = $3,
                updated_at = NOW()
          WHERE id = $1`,
        [prospectId, confidence, censusPayroll]
      )
      enrichedFields.push('estimated_revenue')
    } else {
      await database.query(
        `UPDATE prospects
            SET last_enriched_at = NOW(),
                enrichment_confidence = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [prospectId, confidence]
      )
    }
    enrichedFields.push('enrichment_confidence')

    await this.recordEnrichmentLog({
      prospectId,
      status: failedSources.length > 0 ? 'partial' : 'success',
      enrichedFields,
      errors: sourceErrors,
      confidence,
      startedAt,
      metadata: {
        company_name: companyName,
        industry,
        state,
        data_sources_used: dataSourcesUsed
      }
    })

    return result
  }

  /**
   * Enrich multiple prospects in a batch operation.
   *
   * Processes each prospect individually, collecting successes and failures.
   * Errors for individual prospects don't stop the batch.
   *
   * @param prospectIds - Array of prospect IDs to enrich
   * @returns Array of results indicating success/failure for each prospect
   */
  async enrichBatch(
    prospectIds: string[],
    dataTier: ResolvedDataTier = 'free-tier'
  ): Promise<Array<{ prospect_id: string; success: boolean; error?: string }>> {
    const results = []

    for (const prospectId of prospectIds) {
      try {
        await this.enrichProspect(prospectId, dataTier)
        results.push({ prospect_id: prospectId, success: true })
      } catch (error) {
        results.push({
          prospect_id: prospectId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  /**
   * Trigger a refresh of stale or unenriched prospect data.
   *
   * By default, refreshes prospects that:
   * - Have never been enriched
   * - Were last enriched more than 7 days ago
   *
   * Limited to 100 prospects per call for performance.
   *
   * @param force - If true, refresh all prospects regardless of staleness
   * @returns Summary of refresh operation results
   */
  async triggerRefresh(force: boolean = false, dataTier: ResolvedDataTier = 'free-tier') {
    // Get prospects that need refreshing
    const query = force
      ? 'SELECT id FROM prospects'
      : `SELECT id FROM prospects
         WHERE last_enriched_at IS NULL
            OR last_enriched_at < NOW() - INTERVAL '7 days'
         LIMIT 100`

    const prospects = await database.query<{ id: string }>(query)

    const prospectIds = prospects.map((p) => p.id)
    const results = await this.enrichBatch(prospectIds, dataTier)

    return {
      queued: prospectIds.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length
    }
  }

  /**
   * Get the current status of enrichment across all prospects.
   *
   * @returns Statistics about enrichment coverage and quality
   */
  async getStatus() {
    const stats = await database.query(`
      SELECT
        COUNT(*) as total_prospects,
        COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL) as enriched_count,
        COUNT(*) FILTER (WHERE last_enriched_at IS NULL) as unenriched_count,
        COUNT(*) FILTER (WHERE last_enriched_at < NOW() - INTERVAL '7 days') as stale_count,
        COALESCE(AVG(enrichment_confidence), 0) as avg_confidence
      FROM prospects
    `)

    return (
      stats[0] || {
        total_prospects: 0,
        enriched_count: 0,
        unenriched_count: 0,
        stale_count: 0,
        avg_confidence: 0
      }
    )
  }

  /**
   * Get the current status of the enrichment job queue.
   *
   * When the BullMQ `data-enrichment` queue has been initialized (the worker /
   * server boot calls `initializeQueues()`), this returns real job counts.
   * Outside of that context (e.g. a bare request before queue boot) it reports
   * an honest `supported: false` rather than fabricating counts.
   *
   * @returns Queue telemetry status
   */
  async getQueueStatus() {
    try {
      const queue = getEnrichmentQueue()
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed')
      return {
        supported: true,
        reason: null,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0
      }
    } catch (error) {
      // Queue not initialized (no worker/queue boot) — report honest unsupported.
      return {
        supported: false,
        reason: error instanceof Error ? error.message : 'Enrichment queue is not initialized.',
        waiting: null,
        active: null,
        completed: null,
        failed: null,
        delayed: null
      }
    }
  }

  private recordOutcome(outcomes: SourceOutcome[], response: DataSourceResponse): void {
    outcomes.push({
      source: response.source,
      success: response.success,
      error: response.success ? undefined : response.error
    })
  }

  private scoreToGrade(score: number): string {
    if (score >= 90) return 'A'
    if (score >= 80) return 'B'
    if (score >= 70) return 'C'
    if (score >= 60) return 'D'
    return 'F'
  }

  private async recordEnrichmentLog(params: {
    prospectId: string
    status: 'success' | 'partial' | 'failed'
    enrichedFields: string[]
    errors: string[]
    confidence: number
    startedAt: Date
    metadata: Record<string, unknown>
  }): Promise<void> {
    try {
      const processingTimeMs = Date.now() - params.startedAt.getTime()
      await database.query(
        `INSERT INTO enrichment_logs
           (prospect_id, status, enriched_fields, errors, confidence,
            processing_time_ms, started_at, completed_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)`,
        [
          params.prospectId,
          params.status,
          params.enrichedFields,
          JSON.stringify(params.errors),
          params.confidence,
          processingTimeMs,
          params.startedAt.toISOString(),
          JSON.stringify(params.metadata)
        ]
      )
    } catch (error) {
      // Logging is best-effort; never let a telemetry write break enrichment.
      console.error('[EnrichmentService] failed to write enrichment_logs row:', error)
    }
  }
}
