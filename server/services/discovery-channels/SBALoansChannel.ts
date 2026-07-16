/**
 * SBA 7(a) recent-loan discovery channel.
 *
 * Surfaces businesses that RECENTLY received an SBA 7(a) loan — a confirmed
 * financing event and a strong 'contract' (capital-secured) growth signal.
 *
 * ── Dataset (public FOIA release, NO API KEY) ───────────────────────────────
 *   SBA "7(a) & 504 FOIA" — loan-level borrower records
 *     legacy CKAN id: 0ff8e8e9-b967-4f4e-987c-6ac78c575087  (data.sba.gov)
 *   We fetch the recent 7(a) CSV resource (FY2020-present). The "as-of" date
 *   is embedded in the filename, so the concrete file URL must be resolved at
 *   runtime. Resolution is a self-healing chain (#347):
 *
 *   1. Legacy CKAN package_show — the pre-2026 portal API. data.sba.gov's
 *      2026 Drupal 11 migration dropped every /api/3/action/* path (they now
 *      return the portal's HTML 404), but the rung is kept first so the
 *      channel heals itself if SBA restores CKAN.
 *      GET https://data.sba.gov/api/3/action/package_show?id=<pkgId>
 *        → result.resources[] : { format, url, name }
 *   2. DCAT catalog — the federal open-data surface the Drupal portal DOES
 *      serve. The 7(a)/504 FOIA dataset is absent from it as of 2026-07 but
 *      this is where it should reappear.
 *      GET https://data.sba.gov/data.json → dataset[].distribution[].downloadURL
 *   3. Fail closed with a named unavailability reason (never a raw HTTP code).
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
import { clampLimit, normalizeState, errorMessage, fetchWithTimeout, fetchJson } from './utils'

const CHANNEL = 'sba-7a-loans'
const CKAN_PACKAGE_ID = '0ff8e8e9-b967-4f4e-987c-6ac78c575087'
const CKAN_PACKAGE_SHOW = `https://data.sba.gov/api/3/action/package_show?id=${CKAN_PACKAGE_ID}`
// Project Open Data (DCAT) catalog the post-2026 Drupal portal serves.
const DCAT_CATALOG_URL = 'https://data.sba.gov/data.json'
// Filename stem of the recent 7(a) CSV resource (date suffix rotates).
const RECENT_7A_RESOURCE_STEM = 'foia-7a-fy2020-present'
const RATE_BUCKET = 'sba'
const REQUEST_TIMEOUT_MS = 20000
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

  /**
   * Resolve the rotating recent-7(a) CSV resource URL via the self-healing
   * chain documented in the module header: legacy CKAN → DCAT catalog →
   * named unavailability error. A CKAN answer that lacks the resource falls
   * through to DCAT the same as a dead CKAN — only the final rung throws.
   */
  private async resolveRecentCsvUrl(): Promise<string> {
    let ckanReason: string
    try {
      return await this.resolveViaCkan()
    } catch (err) {
      ckanReason = errorMessage(err)
    }
    try {
      // The fallback is a distinct external request and therefore consumes its
      // own token. One token for the resolution chain is not enough when CKAN
      // fails and DCAT is attempted in the same discovery run.
      await rateLimiterManager.waitForTokens(RATE_BUCKET)
      return await this.resolveViaDcat()
    } catch (dcatErr) {
      throw new DiscoveryChannelError(
        CHANNEL,
        'SBA 7(a) FOIA dataset unavailable: the 2026 data.sba.gov migration dropped the CKAN API ' +
          'and the loan-level dataset is absent from the DCAT catalog — no candidates until SBA ' +
          `republishes (CKAN: ${ckanReason}; DCAT: ${errorMessage(dcatErr)})`
      )
    }
  }

  /** Rung 1 — legacy CKAN package_show (pre-2026 portal). */
  private async resolveViaCkan(): Promise<string> {
    const body = await fetchJson(
      CHANNEL,
      CKAN_PACKAGE_SHOW,
      { headers: { Accept: 'application/json' } },
      'SBA CKAN',
      REQUEST_TIMEOUT_MS
    )

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

  /** Rung 2 — DCAT catalog (data.json) served by the post-2026 Drupal portal. */
  private async resolveViaDcat(): Promise<string> {
    const body = await fetchJson(
      CHANNEL,
      DCAT_CATALOG_URL,
      { headers: { Accept: 'application/json' } },
      'SBA DCAT',
      REQUEST_TIMEOUT_MS
    )

    const datasets = (body as { dataset?: unknown })?.dataset
    if (!Array.isArray(datasets)) {
      throw new DiscoveryChannelError(
        CHANNEL,
        'SBA DCAT response shape changed: expected dataset[] array'
      )
    }

    for (const ds of datasets as { distribution?: unknown }[]) {
      const dists = ds?.distribution
      if (!Array.isArray(dists)) continue
      for (const dist of dists as {
        downloadURL?: unknown
        format?: unknown
        mediaType?: unknown
      }[]) {
        const url = typeof dist.downloadURL === 'string' ? dist.downloadURL : ''
        if (url.toLowerCase().includes(RECENT_7A_RESOURCE_STEM) && isCsvDistribution(dist, url)) {
          return url
        }
      }
    }

    throw new DiscoveryChannelError(
      CHANNEL,
      `recent 7(a) CSV ('${RECENT_7A_RESOURCE_STEM}') absent from the DCAT catalog`
    )
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
      response = await fetchWithTimeout(
        url,
        { headers: { Accept: 'text/csv' } },
        { timeoutMs: REQUEST_TIMEOUT_MS, externalSignal: abort.signal }
      )
    } catch (err) {
      throw new DiscoveryChannelError(CHANNEL, `SBA CSV unreachable: ${errorMessage(err)}`)
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
      throw new DiscoveryChannelError(CHANNEL, `SBA CSV stream failed: ${errorMessage(err)}`)
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

/** Accept a DCAT distribution only when its metadata or URL identifies CSV. */
function isCsvDistribution(
  dist: { format?: unknown; mediaType?: unknown },
  downloadUrl: string
): boolean {
  const format = typeof dist.format === 'string' ? dist.format.trim().toLowerCase() : ''
  const mediaType =
    typeof dist.mediaType === 'string' ? dist.mediaType.split(';', 1)[0].trim().toLowerCase() : ''
  let pathname = ''
  try {
    pathname = new URL(downloadUrl).pathname.toLowerCase()
  } catch {
    return false
  }
  return (
    format === 'csv' ||
    format === 'text/csv' ||
    mediaType === 'text/csv' ||
    mediaType === 'application/csv' ||
    pathname.endsWith('.csv')
  )
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
