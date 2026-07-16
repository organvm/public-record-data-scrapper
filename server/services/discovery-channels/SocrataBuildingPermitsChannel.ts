/**
 * Socrata Open-Data building-permits discovery channel.
 *
 * Surfaces businesses (permittees / contractors) actively pulling building
 * permits — a top-of-funnel 'permit' growth signal indicating construction /
 * expansion activity and near-term capital needs.
 *
 * ── Endpoints (public Socrata SODA, NO API KEY) ─────────────────────────────
 *  NY → NYC DOB Permit Issuance
 *       https://data.cityofnewyork.us/resource/ipu4-2q9a.json
 *       Business field:  permittee_s_business_name
 *       State:           implicit NY (NYC dataset)
 *       Date field:      issuance_date  (MM/DD/YYYY string)
 *  CA → City of Los Angeles "LA BUILD PERMITS"
 *       https://data.lacity.org/resource/xnhu-aczu.json
 *       Business field:  contractors_business_name
 *       State:           implicit CA (LA dataset)
 *       Date field:      issue_date  (ISO 8601)
 *  FL → City of Orlando "Permit Applications" (updated daily; verified live
 *       2026-07-16 — Miami-Dade's Socrata is gone, 302 → ArcGIS legacy)
 *       https://data.cityoforlando.net/resource/ryhf-m453.json
 *       Business field:  contractor_name
 *       State:           implicit FL (Orlando dataset)
 *       Date field:      issue_permit_date  (ISO 8601; null until issuance —
 *                        see the $where null-guard below)
 *  TX → City of Austin "Issued Construction Permits"
 *       https://data.austintexas.gov/resource/3syk-w9eu.json
 *       Business field:  contractor_company_name
 *       State:           implicit TX (Austin dataset)
 *       Date field:      issue_date  (ISO 8601)
 *
 *  All accept SODA query params ($limit, $order, $where). We request newest
 *  first and cap rows; SODA sorts DESC with NULL FIRST, so the $where also
 *  requires the order field non-null (else never-issued applications lead
 *  the page). Each row maps to one candidate (deduped per-business within
 *  the page). Courtesy rate-limit via the shared 'socrata' bucket.
 *
 * Fail-closed: a non-2xx response, non-array body, or a payload missing the
 * documented business-name field for EVERY row throws a named error rather
 * than inventing leads.
 *
 * @module server/services/discovery-channels/SocrataBuildingPermitsChannel
 */

import { rateLimiterManager } from '@public-records/core/enrichment'
import {
  DiscoveryChannel,
  DiscoveryCandidate,
  DiscoveryParams,
  DiscoveryChannelError
} from './types'
import { clampLimit, fetchJson } from './utils'

const CHANNEL = 'socrata-building-permits'
const REQUEST_TIMEOUT_MS = 12000
const RATE_BUCKET = 'socrata'

interface SocrataSource {
  /** State this dataset implicitly covers (datasets are city-scoped). */
  state: string
  /** Base resource URL (.json). */
  url: string
  /** Field holding the business name in each row. */
  businessField: string
  /** Field used for newest-first ordering. */
  orderField: string
}

// Per-state dataset registry. Adding a state = adding a documented entry here.
const SOURCES: Record<string, SocrataSource> = {
  NY: {
    state: 'NY',
    url: 'https://data.cityofnewyork.us/resource/ipu4-2q9a.json',
    businessField: 'permittee_s_business_name',
    orderField: 'issuance_date'
  },
  CA: {
    state: 'CA',
    url: 'https://data.lacity.org/resource/xnhu-aczu.json',
    businessField: 'contractors_business_name',
    orderField: 'issue_date'
  },
  FL: {
    state: 'FL',
    url: 'https://data.cityoforlando.net/resource/ryhf-m453.json',
    businessField: 'contractor_name',
    orderField: 'issue_permit_date'
  },
  TX: {
    state: 'TX',
    url: 'https://data.austintexas.gov/resource/3syk-w9eu.json',
    businessField: 'contractor_company_name',
    orderField: 'issue_date'
  }
}

export class SocrataBuildingPermitsChannel implements DiscoveryChannel {
  readonly name = CHANNEL

  /** Key-less public source — always configured. */
  isConfigured(): boolean {
    return true
  }

  async discover(params: DiscoveryParams): Promise<DiscoveryCandidate[]> {
    const limit = clampLimit(params.limit)
    const sources = this.resolveSources(params.state)

    const candidates: DiscoveryCandidate[] = []
    for (const source of sources) {
      // Spread the limit across the targeted datasets.
      const perSource = Math.max(1, Math.ceil(limit / sources.length))
      const rows = await this.fetchSource(source, perSource)
      candidates.push(...this.mapRows(source, rows))
      if (candidates.length >= limit) break
    }

    return candidates.slice(0, limit)
  }

  /**
   * Pick the dataset(s) to query. A requested state with no registered dataset
   * is a fail-closed condition (we will not silently return data for the wrong
   * geography).
   */
  private resolveSources(state?: string): SocrataSource[] {
    if (state) {
      const code = state.trim().toUpperCase()
      const source = SOURCES[code]
      if (!source) {
        throw new DiscoveryChannelError(
          CHANNEL,
          `no building-permit dataset registered for state '${code}' (have: ${Object.keys(SOURCES).join(', ')})`
        )
      }
      return [source]
    }
    return Object.values(SOURCES)
  }

  private async fetchSource(
    source: SocrataSource,
    rowLimit: number
  ): Promise<Record<string, unknown>[]> {
    await rateLimiterManager.waitForTokens(RATE_BUCKET)

    const qs = new URLSearchParams({
      $limit: String(rowLimit),
      $order: `${source.orderField} DESC`,
      // SODA orders DESC with NULL FIRST — without the order-field guard,
      // rows that never reached issuance (null date) lead every page.
      $where: `${source.businessField} IS NOT NULL AND ${source.orderField} IS NOT NULL`
    })
    const url = `${source.url}?${qs.toString()}`

    const body = await fetchJson(
      CHANNEL,
      url,
      { headers: { Accept: 'application/json' } },
      `Socrata (${source.state})`,
      REQUEST_TIMEOUT_MS
    )

    if (!Array.isArray(body)) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `Socrata (${source.state}) response shape changed: expected a JSON array of rows`
      )
    }

    const rows = body as Record<string, unknown>[]

    // Fail closed: if NOT A SINGLE row carries the documented business field,
    // the dataset schema changed — do not invent leads.
    if (rows.length > 0 && !rows.some((r) => typeof r[source.businessField] === 'string')) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `Socrata (${source.state}) schema changed: field '${source.businessField}' absent from all rows`
      )
    }

    return rows
  }

  private mapRows(source: SocrataSource, rows: Record<string, unknown>[]): DiscoveryCandidate[] {
    const out: DiscoveryCandidate[] = []
    const seen = new Set<string>()

    for (const row of rows) {
      const name = row[source.businessField]
      if (typeof name !== 'string' || name.trim().length === 0) continue

      const company = name.trim()
      const key = company.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      out.push({
        company_name: company,
        state: source.state,
        signal_type: 'permit',
        signal_strength: 60,
        source: CHANNEL,
        raw: {
          dataset_state: source.state,
          business_field: source.businessField,
          row
        }
      })
    }

    return out
  }
}
