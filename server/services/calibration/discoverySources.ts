/**
 * Discovery source-map calibration — the public SHELL of a private dictionary.
 *
 * Knowing WHICH curated open-data endpoints (and their per-city field mappings)
 * yield high-signal financing leads — and which specific FOIA package holds the
 * recent SBA 7(a) loan-level records — is hard-won market intelligence, not
 * commodity code. This module exposes the shape and a small ILLUSTRATIVE default
 * so the public repository compiles, tests, and demos; the production source-map
 * is INJECTED from a private calibration file that is never committed to this
 * public repo.
 *
 * This is the discovery source-map half of the reusable calibration seam
 * introduced in ./funderIntel.ts (the scoring/credit-box tables reuse it too).
 *
 * Resolution order (first hit wins):
 *   1. process.env.SCORING_CALIBRATION_PATH — an explicit JSON path (tests/ops)
 *   2. <this dir>/discoverySources.private.json — the operator's private file (gitignored)
 *   3. the illustrative public default (below)
 *
 * A single private JSON may carry every calibration key; this module reads the
 * `socrataBuildingPermitSources` and `sbaCkanPackageId` top-level keys.
 *
 * Private/injected JSON shape:
 *   {
 *     "socrataBuildingPermitSources": {
 *       "NY": { "state": "NY", "url": "https://.../resource/xxxx-xxxx.json",
 *               "businessField": "...", "orderField": "..." }, ...
 *     },
 *     "sbaCkanPackageId": "<curated FOIA package uuid>"
 *   }
 *
 * @module server/services/calibration/discoverySources
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

/** One Socrata city dataset: geography, resource URL, and row field mapping. */
export interface SocrataSource {
  /** State this dataset implicitly covers (datasets are city-scoped). */
  state: string
  /** Base resource URL (.json). */
  url: string
  /** Field holding the business name in each row. */
  businessField: string
  /** Field used for newest-first ordering. */
  orderField: string
}

interface DiscoverySourceCalibration {
  socrataBuildingPermitSources: Record<string, SocrataSource>
  sbaCkanPackageId: string
}

// Illustrative ONLY — NOT the production source-map. Deliberately generic
// sample entries so a bare public clone has no curated market intelligence to
// lift. The shape works; the real endpoints do not ship in this public repo.
const ILLUSTRATIVE_SOCRATA_SOURCES: Record<string, SocrataSource> = {
  XX: {
    state: 'XX',
    url: 'https://example.data.gov/resource/xxxx-xxxx.json',
    businessField: 'business_name',
    orderField: 'issued_date'
  },
  YY: {
    state: 'YY',
    url: 'https://sample.data.gov/resource/yyyy-yyyy.json',
    businessField: 'contractor_name',
    orderField: 'issue_date'
  }
}

// Illustrative ONLY — a clearly-fake placeholder id, NOT the real curated FOIA
// package. The self-healing resolver in SBALoansChannel tolerates a package id
// that resolves to nothing (it falls through to the DCAT catalog).
const ILLUSTRATIVE_SBA_CKAN_PACKAGE_ID = '00000000-0000-0000-0000-000000000000'

let cache: DiscoverySourceCalibration | null = null

function isSocrataSource(v: unknown): v is SocrataSource {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.state === 'string' &&
    typeof o.url === 'string' &&
    typeof o.businessField === 'string' &&
    typeof o.orderField === 'string'
  )
}

function coerceSocrataSources(raw: unknown): Record<string, SocrataSource> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const out: Record<string, SocrataSource> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSocrataSource(value)) return null
    out[key] = {
      state: value.state,
      url: value.url,
      businessField: value.businessField,
      orderField: value.orderField
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function loadCalibration(): DiscoverySourceCalibration {
  if (cache) return cache
  const candidates = [
    process.env.SCORING_CALIBRATION_PATH,
    join(__dirname, 'discoverySources.private.json')
  ].filter((p): p is string => Boolean(p))

  let socrataBuildingPermitSources: Record<string, SocrataSource> | null = null
  let sbaCkanPackageId: string | null = null

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const data = JSON.parse(readFileSync(path, 'utf8')) as {
        socrataBuildingPermitSources?: unknown
        sbaCkanPackageId?: unknown
      }
      if (socrataBuildingPermitSources === null) {
        socrataBuildingPermitSources = coerceSocrataSources(data.socrataBuildingPermitSources)
      }
      if (sbaCkanPackageId === null) {
        sbaCkanPackageId =
          typeof data.sbaCkanPackageId === 'string' && data.sbaCkanPackageId.length > 0
            ? data.sbaCkanPackageId
            : null
      }
      if (socrataBuildingPermitSources !== null && sbaCkanPackageId !== null) break
    } catch {
      // Malformed/unreadable candidate — fall through to the next / illustrative.
    }
  }

  cache = {
    socrataBuildingPermitSources: socrataBuildingPermitSources ?? {
      ...ILLUSTRATIVE_SOCRATA_SOURCES
    },
    sbaCkanPackageId: sbaCkanPackageId ?? ILLUSTRATIVE_SBA_CKAN_PACKAGE_ID
  }
  return cache
}

/**
 * The curated per-state Socrata building-permit source-map. Production values
 * are injected from a private calibration file; a bare public clone gets only
 * the illustrative sample entries.
 */
export function socrataBuildingPermitSources(): Record<string, SocrataSource> {
  return loadCalibration().socrataBuildingPermitSources
}

/**
 * The curated SBA 7(a)/504 FOIA CKAN package id. Production value is injected
 * from a private calibration file; a bare public clone gets only a fake
 * placeholder id (the resolver heals past it via the DCAT catalog).
 */
export function sbaCkanPackageId(): string {
  return loadCalibration().sbaCkanPackageId
}

/** Test/ops seam: drop the cache so a new SCORING_CALIBRATION_PATH takes effect. */
export function __resetDiscoverySourcesCache(): void {
  cache = null
}
