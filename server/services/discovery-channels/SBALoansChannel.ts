/**
 * SBA 7(a) recent-loan discovery channel.
 *
 * Surfaces businesses that RECENTLY received an SBA 7(a) loan — a confirmed
 * financing event and a strong 'contract' (capital-secured) growth signal.
 *
 * ── Dataset (public FOIA release, NO API KEY) ───────────────────────────────
 *   SBA "7(a) & 504 FOIA" — CKAN dataset
 *     id: 0ff8e8e9-b967-4f4e-987c-6ac78c575087  (data.sba.gov)
 *   We fetch the recent 7(a) CSV resource (FY2020-present). The "as-of" date
 *   is embedded in the filename, so the concrete file URL is resolved through
 *   the CKAN package_show API at runtime (the package id is stable; the
 *   resource filename rotates). If the recent 7(a) resource cannot be located,
 *   that is a fail-closed condition.
 *
 *   CKAN: GET https://data.sba.gov/api/3/action/package_show?id=<pkgId>
 *         → result.resources[] : { format, url, name }
 *
 * ── CSV shape (documented header; parser fails closed if columns change) ────
 *   asofdate,program,locationid,borrname,borrstreet,borrcity,borrstate,
 *   borrzip,bankname,...,grossapproval,...,approvaldate,approvalfy,...,
 *   naicscode,naicsdescription,...
 *   Required columns: borrname, borrstate, approvaldate. Missing any of these
 *   in the header => the dataset shape changed => named error (no fabrication).
 *
 * @module server/services/discovery-channels/SBALoansChannel
 */

import { rateLimiterManager } from '@public-records/core/enrichment'
import {
  DiscoveryChannel,
  DiscoveryCandidate,
  DiscoveryParams,
  DiscoveryChannelError
} from './types'

const CHANNEL = 'sba-7a-loans'
const CKAN_PACKAGE_ID = '0ff8e8e9-b967-4f4e-987c-6ac78c575087'
const CKAN_PACKAGE_SHOW = `https://data.sba.gov/api/3/action/package_show?id=${CKAN_PACKAGE_ID}`
// Filename stem of the recent 7(a) CSV resource (date suffix rotates).
const RECENT_7A_RESOURCE_STEM = 'foia-7a-fy2020-present'
const RATE_BUCKET = 'sba'
const REQUEST_TIMEOUT_MS = 20000
const DEFAULT_LIMIT = 25
const REQUIRED_COLUMNS = ['borrname', 'borrstate', 'approvaldate'] as const

interface CkanResource {
  format?: unknown
  url?: unknown
  name?: unknown
}

export class SBALoansChannel implements DiscoveryChannel {
  readonly name = CHANNEL

  /** Key-less public dataset — always configured. */
  isConfigured(): boolean {
    return true
  }

  async discover(params: DiscoveryParams): Promise<DiscoveryCandidate[]> {
    const limit = clampLimit(params.limit)
    const wantState = normalizeState(params.state)

    await rateLimiterManager.waitForTokens(RATE_BUCKET)
    const csvUrl = await this.resolveRecentCsvUrl()

    await rateLimiterManager.waitForTokens(RATE_BUCKET)
    const csvText = await this.fetchCsv(csvUrl)

    return this.parseCsv(csvText, wantState, limit)
  }

  /** Resolve the rotating recent-7(a) CSV resource URL via CKAN. */
  private async resolveRecentCsvUrl(): Promise<string> {
    let response: Response
    try {
      response = await fetchWithTimeout(CKAN_PACKAGE_SHOW, {
        headers: { Accept: 'application/json' }
      })
    } catch (err) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CKAN unreachable: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (!response.ok) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CKAN returned HTTP ${response.status} ${response.statusText}`
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (err) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CKAN response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const resources = (body as { result?: { resources?: unknown } })?.result?.resources
    if (!Array.isArray(resources)) {
      throw new DiscoveryChannelError(
        CHANNEL,
        'SBA CKAN response shape changed: expected result.resources[] array'
      )
    }

    const match = (resources as CkanResource[]).find((r) => {
      const url = typeof r.url === 'string' ? r.url.toLowerCase() : ''
      const fmt = typeof r.format === 'string' ? r.format.toUpperCase() : ''
      return fmt === 'CSV' && url.includes(RECENT_7A_RESOURCE_STEM)
    })

    if (!match || typeof match.url !== 'string') {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA dataset changed: recent 7(a) CSV resource ('${RECENT_7A_RESOURCE_STEM}') not found`
      )
    }
    return match.url
  }

  private async fetchCsv(url: string): Promise<string> {
    let response: Response
    try {
      response = await fetchWithTimeout(url, { headers: { Accept: 'text/csv' } })
    } catch (err) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CSV unreachable: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (!response.ok) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CSV returned HTTP ${response.status} ${response.statusText}`
      )
    }
    return response.text()
  }

  /**
   * Parse the SBA CSV, filter to the requested state and most-recent rows,
   * and map to candidates. Fails closed if the header lost a required column.
   */
  private parseCsv(csvText: string, wantState: string | null, limit: number): DiscoveryCandidate[] {
    const lines = csvText.split(/\r?\n/)
    const headerLine = lines.find((l) => l.trim().length > 0)
    if (!headerLine) {
      throw new DiscoveryChannelError(CHANNEL, 'SBA CSV was empty')
    }

    const header = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase())
    const idx: Record<string, number> = {}
    for (const col of REQUIRED_COLUMNS) {
      const at = header.indexOf(col)
      if (at === -1) {
        throw new DiscoveryChannelError(
          CHANNEL,
          `SBA CSV schema changed: required column '${col}' missing from header`
        )
      }
      idx[col] = at
    }
    // Optional enrichment columns (absence is tolerated, not fatal).
    const naicsDescIdx = header.indexOf('naicsdescription')
    const cityIdx = header.indexOf('borrcity')
    const grossIdx = header.indexOf('grossapproval')

    const headerPos = lines.indexOf(headerLine)
    const dataRows = lines.slice(headerPos + 1).filter((l) => l.trim().length > 0)

    const out: DiscoveryCandidate[] = []
    const seen = new Set<string>()

    for (const line of dataRows) {
      const cells = parseCsvLine(line)
      const company = (cells[idx.borrname] ?? '').trim()
      const state = (cells[idx.borrstate] ?? '').trim().toUpperCase()
      if (!company || state.length !== 2) continue
      if (wantState && state !== wantState) continue

      const key = `${company.toLowerCase()}|${state}`
      if (seen.has(key)) continue
      seen.add(key)

      out.push({
        company_name: company,
        state,
        signal_type: 'contract',
        signal_strength: 75,
        source: CHANNEL,
        raw: {
          approval_date: cells[idx.approvaldate] ?? null,
          borr_city: cityIdx >= 0 ? (cells[cityIdx] ?? null) : null,
          naics_description: naicsDescIdx >= 0 ? (cells[naicsDescIdx] ?? null) : null,
          gross_approval: grossIdx >= 0 ? (cells[grossIdx] ?? null) : null
        }
      })

      if (out.length >= limit) break
    }

    return out
  }
}

/**
 * Minimal RFC-4180-aware single-line CSV parser: handles quoted fields,
 * embedded commas, and escaped double-quotes ("").
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

function normalizeState(state?: string): string | null {
  if (!state) return null
  const trimmed = state.trim().toUpperCase()
  return trimmed.length === 2 ? trimmed : null
}

function clampLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), 200)
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
