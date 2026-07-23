/**
 * Scoring-modifier calibration — the public SHELL of a private dictionary.
 *
 * The populated industry-risk and state modifier tables (how much each industry
 * or state scales a composite prospect score) are hard-won market intelligence,
 * not commodity code. This module exposes the SHAPE (Record<string, number>) and
 * a small ILLUSTRATIVE default so the public repository compiles, tests, and
 * demos; the production modifier tables are INJECTED from a private calibration
 * file that is never committed to this public repo.
 *
 * This is the scoring-table half of the reusable calibration seam introduced in
 * ./funderIntel.ts. NOTE: the composite formula weights (DEFAULT_CONFIG in
 * ../ScoringService — intentRecencyWeight etc.) are documented public research
 * and stay in the source; only these populated modifier tables are private.
 *
 * Resolution order (first hit wins):
 *   1. process.env.SCORING_CALIBRATION_PATH — an explicit JSON path (tests/ops)
 *   2. <this dir>/scoringModifiers.private.json — the operator's private file (gitignored)
 *   3. the illustrative public default (below)
 *
 * A single private JSON may carry every calibration key; this module reads the
 * `industryRiskModifiers` and `stateModifiers` top-level keys.
 *
 * Private/injected JSON shape:
 *   {
 *     "industryRiskModifiers": { "<industry>": <multiplier>, ... },
 *     "stateModifiers": { "<state>": <multiplier>, ... }
 *   }
 *
 * @module server/services/calibration/scoringModifiers
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Illustrative ONLY — NOT the production modifier tables. Obviously-sample
// entries (not real industry/state keys, and no real multiplier) so a bare
// public clone still scores prospects — every real industry/state falls back to
// a neutral 1.0 in the caller — while carrying none of the real calibration.
const ILLUSTRATIVE_INDUSTRY_MODIFIERS: Record<string, number> = {
  'sample-industry-a': 0.9,
  'sample-industry-b': 1.0
}

const ILLUSTRATIVE_STATE_MODIFIERS: Record<string, number> = {
  XX: 1.0,
  YY: 0.9
}

interface ScoringModifierCalibration {
  industryRiskModifiers: Record<string, number>
  stateModifiers: Record<string, number>
}

let cache: ScoringModifierCalibration | null = null

/**
 * Accept a plain object whose every value is a finite number; reject anything
 * else so the caller falls back to the illustrative default for that table.
 */
function coerceNumberMap(raw: unknown): Record<string, number> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

function loadCalibration(): ScoringModifierCalibration {
  if (cache) return cache
  const candidates = [
    process.env.SCORING_CALIBRATION_PATH,
    join(__dirname, 'scoringModifiers.private.json')
  ].filter((p): p is string => Boolean(p))

  let industryRiskModifiers: Record<string, number> | null = null
  let stateModifiers: Record<string, number> | null = null

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const data = JSON.parse(readFileSync(path, 'utf8')) as {
        industryRiskModifiers?: unknown
        stateModifiers?: unknown
      }
      if (industryRiskModifiers === null) {
        industryRiskModifiers = coerceNumberMap(data.industryRiskModifiers)
      }
      if (stateModifiers === null) {
        stateModifiers = coerceNumberMap(data.stateModifiers)
      }
      if (industryRiskModifiers !== null && stateModifiers !== null) break
    } catch {
      // Malformed/unreadable candidate — fall through to the next / illustrative.
    }
  }

  cache = {
    industryRiskModifiers: industryRiskModifiers ?? { ...ILLUSTRATIVE_INDUSTRY_MODIFIERS },
    stateModifiers: stateModifiers ?? { ...ILLUSTRATIVE_STATE_MODIFIERS }
  }
  return cache
}

/**
 * The industry-risk modifier table (lower = higher risk). Production values are
 * injected from a private calibration file; a bare public clone gets only the
 * illustrative set.
 */
export function industryRiskModifiers(): Record<string, number> {
  return loadCalibration().industryRiskModifiers
}

/**
 * The state modifier table (regulatory environment, market size). Production
 * values are injected from a private calibration file; a bare public clone gets
 * only the illustrative set.
 */
export function stateModifiers(): Record<string, number> {
  return loadCalibration().stateModifiers
}

/** Test/ops seam: drop the cache so a new SCORING_CALIBRATION_PATH takes effect. */
export function __resetScoringModifiersCache(): void {
  cache = null
}
