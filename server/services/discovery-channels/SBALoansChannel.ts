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
    return this.streamCsvCandidates(csvUrl, wantState, limit)
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

  /**
   * Stream the SBA CSV line-by-line and map matching rows to candidates,
   * filtered to the requested state. The FOIA CSV is multi-hundred-MB, so the
   * body is consumed INCREMENTALLY via its reader — never buffered whole into a
   * string. Once `limit` candidates are collected the fetch is ABORTED (the
   * remaining bytes are never downloaded). Fails closed if the header lost a
   * required column (the schema check runs on the first non-empty line before
   * any data row is processed).
   */
  private async streamCsvCandidates(
    url: string,
    wantState: string | null,
    limit: number
  ): Promise<DiscoveryCandidate[]> {
    // Dedicated controller so we can abort the in-flight stream the moment we
    // have enough rows (distinct from the per-request timeout controller).
    const abort = new AbortController()
    let response: Response
    try {
      response = await fetchWithTimeout(url, { headers: { Accept: 'text/csv' } }, abort.signal)
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
    if (!response.body) {
      throw new DiscoveryChannelError(CHANNEL, 'SBA CSV response had no body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')

    const out: DiscoveryCandidate[] = []
    const seen = new Set<string>()
    let buffer = ''
    let header: Header | null = null
    let done = false

    const handleLine = (rawLine: string): boolean => {
      const line = rawLine.replace(/\r$/, '')
      if (line.trim().length === 0) return false // skip blank lines

      if (!header) {
        // First non-empty line is the header — validate schema, fail closed.
        header = parseHeader(line)
        return false
      }

      const candidate = rowToCandidate(line, header, wantState, seen)
      if (candidate) {
        out.push(candidate)
        return out.length >= limit
      }
      return false
    }

    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })

        let newlineAt: number
        while ((newlineAt = buffer.indexOf('\n')) !== -1) {
          const rawLine = buffer.slice(0, newlineAt)
          buffer = buffer.slice(newlineAt + 1)
          if (handleLine(rawLine)) {
            done = true
            break
          }
        }
      }

      // Flush any trailing line (no terminating newline) if we still need rows.
      if (!done) {
        const tail = buffer + decoder.decode()
        if (tail.length > 0) handleLine(tail)
      }
    } catch (err) {
      // A fail-closed schema/empty error from the parser is already a precise
      // DiscoveryChannelError — propagate it unchanged. Only genuine stream/IO
      // faults get the generic wrapper.
      if (err instanceof DiscoveryChannelError) throw err
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CSV stream failed: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      // Stop the download and free the reader. cancel() rejects the underlying
      // stream so the remaining (potentially hundreds of MB) bytes are never
      // pulled; abort() tears down the connection for good measure.
      try {
        await reader.cancel()
      } catch {
        // Reader may already be closed/errored — nothing to release.
      }
      abort.abort()
    }

    if (!header) {
      throw new DiscoveryChannelError(CHANNEL, 'SBA CSV was empty')
    }

    return out
  }
}

/** Resolved header: required column positions + optional enrichment positions. */
interface Header {
  borrname: number
  borrstate: number
  approvaldate: number
  naicsDescIdx: number
  cityIdx: number
  grossIdx: number
}

/** Parse + validate the CSV header, failing closed on a missing required column. */
function parseHeader(headerLine: string): Header {
  const cols = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase())
  const idx: Record<string, number> = {}
  for (const col of REQUIRED_COLUMNS) {
    const at = cols.indexOf(col)
    if (at === -1) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SBA CSV schema changed: required column '${col}' missing from header`
      )
    }
    idx[col] = at
  }
  return {
    borrname: idx.borrname,
    borrstate: idx.borrstate,
    approvaldate: idx.approvaldate,
    // Optional enrichment columns (absence is tolerated, not fatal).
    naicsDescIdx: cols.indexOf('naicsdescription'),
    cityIdx: cols.indexOf('borrcity'),
    grossIdx: cols.indexOf('grossapproval')
  }
}

/**
 * Map one data row to a candidate, applying the state filter and per-stream
 * dedupe. Returns null when the row is unusable, filtered out, or a duplicate.
 */
function rowToCandidate(
  line: string,
  header: Header,
  wantState: string | null,
  seen: Set<string>
): DiscoveryCandidate | null {
  const cells = parseCsvLine(line)
  const company = (cells[header.borrname] ?? '').trim()
  const state = (cells[header.borrstate] ?? '').trim().toUpperCase()
  if (!company || state.length !== 2) return null
  if (wantState && state !== wantState) return null

  const key = `${company.toLowerCase()}|${state}`
  if (seen.has(key)) return null
  seen.add(key)

  return {
    company_name: company,
    state,
    signal_type: 'contract',
    signal_strength: 75,
    source: CHANNEL,
    raw: {
      approval_date: cells[header.approvaldate] ?? null,
      borr_city: header.cityIdx >= 0 ? (cells[header.cityIdx] ?? null) : null,
      naics_description: header.naicsDescIdx >= 0 ? (cells[header.naicsDescIdx] ?? null) : null,
      gross_approval: header.grossIdx >= 0 ? (cells[header.grossIdx] ?? null) : null
    }
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  // Forward an external abort (e.g. "limit reached" on a stream) into the
  // timeout controller so a single signal tears the fetch down either way.
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }
}
