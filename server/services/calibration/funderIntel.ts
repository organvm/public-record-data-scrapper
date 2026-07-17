/**
 * Funder-intelligence calibration — the public SHELL of a private dictionary.
 *
 * Knowing WHICH merchant-cash-advance funders operate and how to recognize
 * them on a bank statement is hard-won market intelligence, not commodity
 * code. This module exposes the shape and a small ILLUSTRATIVE default so the
 * public repository compiles, tests, and demos; the production funder
 * dictionary is INJECTED from a private calibration file that is never
 * committed to this public repo.
 *
 * This is the reusable calibration seam. The discovery source-map and the
 * scoring/credit-box tables follow the same pattern: public interface +
 * illustrative default here, real values injected privately.
 *
 * Resolution order (first hit wins):
 *   1. process.env.SCORING_CALIBRATION_PATH — an explicit JSON path (tests/ops)
 *   2. <this dir>/funderIntel.private.json    — the operator's private file (gitignored)
 *   3. the illustrative public default (below)
 *
 * Private/injected JSON shape: { "mcaLenderNames": ["...", ...] }
 *
 * @module server/services/calibration/funderIntel
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Illustrative ONLY — NOT the production funder dictionary. Deliberately
// generic so a bare public clone has no curated market intelligence to lift.
const ILLUSTRATIVE_MCA_LENDERS: readonly string[] = ['SAMPLE CAPITAL', 'EXAMPLE FUNDING']

interface FunderCalibration {
  mcaLenderNames: string[]
}

let cache: FunderCalibration | null = null

function loadCalibration(): FunderCalibration {
  if (cache) return cache
  const candidates = [
    process.env.SCORING_CALIBRATION_PATH,
    join(__dirname, 'funderIntel.private.json')
  ].filter((p): p is string => Boolean(p))

  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const data = JSON.parse(readFileSync(path, 'utf8')) as { mcaLenderNames?: unknown }
      if (Array.isArray(data.mcaLenderNames) && data.mcaLenderNames.length > 0) {
        cache = { mcaLenderNames: data.mcaLenderNames.map(String) }
        return cache
      }
    } catch {
      // Malformed/unreadable candidate — fall through to the next / illustrative.
    }
  }
  cache = { mcaLenderNames: [...ILLUSTRATIVE_MCA_LENDERS] }
  return cache
}

/**
 * The recognized MCA/funder name list. Production values are injected from a
 * private calibration file; a bare public clone gets only the illustrative set.
 */
export function mcaLenderNames(): string[] {
  return loadCalibration().mcaLenderNames
}

/** Test/ops seam: drop the cache so a new SCORING_CALIBRATION_PATH takes effect. */
export function __resetFunderIntelCache(): void {
  cache = null
}
