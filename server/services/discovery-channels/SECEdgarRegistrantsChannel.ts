/**
 * SEC EDGAR Full-Text Search discovery channel.
 *
 * Surfaces businesses that have RECENTLY filed registration / material-event
 * forms (S-1 IPO registrations, 8-K material events) — a strong top-of-funnel
 * signal that a company is raising capital or undergoing a financing event.
 *
 * ── Endpoint (public, NO API KEY) ──────────────────────────────────────────
 *   GET https://efts.sec.gov/LATEST/search-index?q=<term>&forms=<forms>
 *       &dateRange=custom&startdt=<YYYY-MM-DD>&enddt=<YYYY-MM-DD>
 *   SEC requires a descriptive User-Agent header (no key). 10 req/sec courtesy
 *   limit — we reuse the shared 'sec-edgar' token bucket.
 *
 * ── Response shape (documented; parser fails closed if it changes) ──────────
 *   {
 *     hits: {
 *       hits: [
 *         { _source: {
 *             display_names: ["ACME, Inc.  (CIK 0001234567)"],
 *             biz_states:    ["CA"],          // business address state(s)
 *             form:          "S-1",
 *             root_forms:    ["S-1"],
 *             file_date:     "2025-01-14",
 *             sics:          ["7372"],        // Standard Industrial Classification
 *             ciks:          ["0001234567"]
 *         } }, ...
 *       ]
 *     }
 *   }
 *
 * Signal mapping: a new registration/material-event filing → 'expansion'
 * (capital-raising / corporate event), strength scaled by recency-weighted
 * form weight.
 *
 * @module server/services/discovery-channels/SECEdgarRegistrantsChannel
 */

import { rateLimiterManager } from '@public-records/core/enrichment'
import {
  DiscoveryChannel,
  DiscoveryCandidate,
  DiscoveryParams,
  DiscoveryChannelError
} from './types'

const CHANNEL = 'sec-edgar-registrants'
const ENDPOINT = 'https://efts.sec.gov/LATEST/search-index'
// Material-event + registration forms that indicate financing activity.
const FORMS = ['S-1', '8-K']
const USER_AGENT = 'UCC-MCA-Intelligence lead-discovery contact@example.com'
const REQUEST_TIMEOUT_MS = 12000
const DEFAULT_LIMIT = 25

interface EdgarHitSource {
  display_names?: unknown
  biz_states?: unknown
  form?: unknown
  root_forms?: unknown
  file_date?: unknown
  sics?: unknown
  ciks?: unknown
}

export class SECEdgarRegistrantsChannel implements DiscoveryChannel {
  readonly name = CHANNEL

  /** Key-less public source — always configured. */
  isConfigured(): boolean {
    return true
  }

  async discover(params: DiscoveryParams): Promise<DiscoveryCandidate[]> {
    const limit = clampLimit(params.limit)
    await rateLimiterManager.waitForTokens('sec-edgar')

    // Look back 30 days for "recent" registrants.
    const enddt = new Date()
    const startdt = new Date(enddt.getTime() - 30 * 24 * 60 * 60 * 1000)
    const qs = new URLSearchParams({
      q: '*',
      forms: FORMS.join(','),
      dateRange: 'custom',
      startdt: isoDate(startdt),
      enddt: isoDate(enddt)
    })
    const url = `${ENDPOINT}?${qs.toString()}`

    let response: Response
    try {
      response = await fetchWithTimeout(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
      })
    } catch (err) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SEC EDGAR unreachable: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    if (!response.ok) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SEC EDGAR returned HTTP ${response.status} ${response.statusText}`
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch (err) {
      throw new DiscoveryChannelError(
        CHANNEL,
        `SEC EDGAR response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    // Fail closed: the documented envelope is { hits: { hits: [...] } }.
    const hits = (body as { hits?: { hits?: unknown } })?.hits?.hits
    if (!Array.isArray(hits)) {
      throw new DiscoveryChannelError(
        CHANNEL,
        'SEC EDGAR response shape changed: expected hits.hits[] array'
      )
    }

    const wantState = normalizeState(params.state)
    const out: DiscoveryCandidate[] = []
    const seen = new Set<string>()

    for (const hit of hits) {
      const src = (hit as { _source?: EdgarHitSource })?._source
      if (!src) continue

      const company = parseDisplayName(src.display_names)
      if (!company) continue

      const state = firstString(src.biz_states)
      if (!state) continue
      if (wantState && state.toUpperCase() !== wantState) continue

      // Dedupe within the channel's own result page (same filer, many docs).
      const key = `${company.toLowerCase()}|${state.toUpperCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      const form = stringOr(src.form, firstString(src.root_forms) ?? 'filing')
      out.push({
        company_name: company,
        state: state.toUpperCase(),
        signal_type: 'expansion',
        signal_strength: scoreForm(form),
        source: CHANNEL,
        raw: {
          form,
          file_date: src.file_date ?? null,
          cik: firstString(src.ciks) ?? null,
          sic: firstString(src.sics) ?? null,
          display_name: company
        }
      })

      if (out.length >= limit) break
    }

    return out
  }
}

function scoreForm(form: string): number {
  // S-1 (registration / capital raise) is the stronger signal than 8-K.
  return form.toUpperCase().startsWith('S-1') ? 70 : 55
}

function parseDisplayName(value: unknown): string | null {
  const raw = firstString(value)
  if (!raw) return null
  // "ACME, Inc.  (CIK 0001234567)" → strip the trailing CIK annotation.
  const cleaned = raw.replace(/\s*\(CIK\s*\d+\)\s*$/i, '').trim()
  return cleaned.length > 0 ? cleaned : null
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string' && v.trim().length > 0)
    return typeof first === 'string' ? first.trim() : null
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  return null
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeState(state?: string): string | null {
  if (!state) return null
  const trimmed = state.trim().toUpperCase()
  return trimmed.length === 2 ? trimmed : null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
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
