/**
 * Qualification credit-box calibration — the public SHELL of a private dictionary.
 *
 * The calibrated credit-box bands (the ADB / NSF / negative-day / position /
 * time-in-business / revenue thresholds, factor rates, and funding multiples per
 * tier) are hard-won underwriting intelligence, not commodity code. This module
 * exposes the SHAPE (see QualificationRules in ../QualificationService) and a
 * small ILLUSTRATIVE default so the public repository compiles, tests, and demos;
 * the production credit box is INJECTED from a private calibration file that is
 * never committed to this public repo.
 *
 * This is the scoring/credit-box half of the reusable calibration seam
 * introduced in ./funderIntel.ts.
 *
 * Resolution order (first hit wins):
 *   1. process.env.SCORING_CALIBRATION_PATH — an explicit JSON path (tests/ops)
 *   2. <this dir>/qualificationRules.private.json — the operator's private file (gitignored)
 *   3. the illustrative public default (below)
 *
 * A single private JSON may carry every calibration key; this module reads the
 * `qualificationRules` top-level key. Any missing sub-table falls back to the
 * illustrative default for that table, so a partial override stays valid.
 *
 * Private/injected JSON shape:
 *   { "qualificationRules": { "minAdbByTier": { "A": ..., ... }, ... } }
 *
 * @module server/services/calibration/qualificationRules
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { QualificationRules, QualificationTier } from '../QualificationService'

// Illustrative ONLY — NOT the production credit box. Rounded, generic
// placeholder bands that keep the app functional (a bare public clone still
// qualifies/declines and computes terms) but are deliberately not the real
// calibration.
const ILLUSTRATIVE_RULES: QualificationRules = {
  minAdbByTier: { A: 20000, B: 10000, C: 5000, D: 2000, Decline: 0 },
  maxNsfByTier: { A: 0, B: 2, C: 5, D: 10, Decline: Infinity },
  maxNegativeDaysByTier: { A: 0, B: 5, C: 10, D: 20, Decline: Infinity },
  maxPositionsByTier: { A: 0, B: 1, C: 3, D: 5, Decline: Infinity },
  minTimeInBusinessByTier: { A: 24, B: 12, C: 6, D: 3, Decline: 0 },
  minMonthlyRevenueByTier: { A: 40000, B: 20000, C: 10000, D: 5000, Decline: 0 },
  factorRatesByTier: { A: 1.2, B: 1.3, C: 1.4, D: 1.5, Decline: 0 },
  maxFundingMultiple: { A: 1.4, B: 1.1, C: 0.8, D: 0.5, Decline: 0 }
}

let cache: QualificationRules | null = null

const TIERS: QualificationTier[] = ['A', 'B', 'C', 'D', 'Decline']

/**
 * Accept a per-tier numeric table only if it carries a finite (or ±Infinity)
 * number for EVERY tier. A partial/garbled table is rejected so the caller
 * falls back to the illustrative default for that sub-table.
 */
function coerceTierNumbers(raw: unknown): Record<QualificationTier, number> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const src = raw as Record<string, unknown>
  const out = {} as Record<QualificationTier, number>
  for (const tier of TIERS) {
    const v = src[tier]
    if (typeof v !== 'number' || Number.isNaN(v)) return null
    out[tier] = v
  }
  return out
}

function loadCalibration(): QualificationRules {
  if (cache) return cache
  const candidates = [
    process.env.SCORING_CALIBRATION_PATH,
    join(__dirname, 'qualificationRules.private.json')
  ].filter((p): p is string => Boolean(p))

  // Start from the illustrative default and overlay any well-formed sub-table
  // found in the first candidate that carries a `qualificationRules` object.
  const merged: QualificationRules = {
    minAdbByTier: { ...ILLUSTRATIVE_RULES.minAdbByTier },
    maxNsfByTier: { ...ILLUSTRATIVE_RULES.maxNsfByTier },
    maxNegativeDaysByTier: { ...ILLUSTRATIVE_RULES.maxNegativeDaysByTier },
    maxPositionsByTier: { ...ILLUSTRATIVE_RULES.maxPositionsByTier },
    minTimeInBusinessByTier: { ...ILLUSTRATIVE_RULES.minTimeInBusinessByTier },
    minMonthlyRevenueByTier: { ...ILLUSTRATIVE_RULES.minMonthlyRevenueByTier },
    factorRatesByTier: { ...ILLUSTRATIVE_RULES.factorRatesByTier },
    maxFundingMultiple: { ...ILLUSTRATIVE_RULES.maxFundingMultiple }
  }

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const data = JSON.parse(readFileSync(path, 'utf8')) as { qualificationRules?: unknown }
      const rules = data.qualificationRules
      if (typeof rules !== 'object' || rules === null) continue
      const r = rules as Record<string, unknown>
      const keys: (keyof QualificationRules)[] = [
        'minAdbByTier',
        'maxNsfByTier',
        'maxNegativeDaysByTier',
        'maxPositionsByTier',
        'minTimeInBusinessByTier',
        'minMonthlyRevenueByTier',
        'factorRatesByTier',
        'maxFundingMultiple'
      ]
      let applied = false
      for (const key of keys) {
        const table = coerceTierNumbers(r[key])
        if (table) {
          merged[key] = table
          applied = true
        }
      }
      // First candidate carrying a usable override wins; stop scanning.
      if (applied) break
    } catch {
      // Malformed/unreadable candidate — fall through to the next / illustrative.
    }
  }

  cache = merged
  return cache
}

/**
 * The calibrated qualification credit-box rules. Production values are injected
 * from a private calibration file; a bare public clone gets only the
 * illustrative bands.
 */
export function qualificationRules(): QualificationRules {
  return loadCalibration()
}

/** Test/ops seam: drop the cache so a new SCORING_CALIBRATION_PATH takes effect. */
export function __resetQualificationRulesCache(): void {
  cache = null
}
