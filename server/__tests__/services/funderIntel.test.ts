import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mcaLenderNames, __resetFunderIntelCache } from '../../services/calibration/funderIntel'

// Proves the calibration SEAM: production funder intelligence is injected from a
// private file (SCORING_CALIBRATION_PATH), while a bare public clone falls back
// to a small illustrative default — the public repo never carries the curated
// dictionary. Same pattern the source-map and scoring tables will reuse.
describe('funderIntel calibration seam', () => {
  const originalEnv = process.env.SCORING_CALIBRATION_PATH
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'funder-cal-'))
    __resetFunderIntelCache()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SCORING_CALIBRATION_PATH
    else process.env.SCORING_CALIBRATION_PATH = originalEnv
    __resetFunderIntelCache()
    rmSync(workDir, { recursive: true, force: true })
  })

  it('injects the production dictionary from SCORING_CALIBRATION_PATH', () => {
    const path = join(workDir, 'funders.json')
    writeFileSync(path, JSON.stringify({ mcaLenderNames: ['ACME ADVANCE', 'BETA CAPITAL'] }))
    process.env.SCORING_CALIBRATION_PATH = path
    __resetFunderIntelCache()

    expect(mcaLenderNames()).toEqual(['ACME ADVANCE', 'BETA CAPITAL'])
  })

  it('always returns a non-empty list (falls back to the illustrative default)', () => {
    // Point at a path that does not exist: no injection, no crash — the shell
    // still works so the public repo compiles/demos.
    process.env.SCORING_CALIBRATION_PATH = join(workDir, 'does-not-exist.json')
    __resetFunderIntelCache()

    const names = mcaLenderNames()
    expect(Array.isArray(names)).toBe(true)
    expect(names.length).toBeGreaterThan(0)
  })

  it('honors the cache reset when the injected calibration changes', () => {
    const path = join(workDir, 'funders.json')
    writeFileSync(path, JSON.stringify({ mcaLenderNames: ['FIRST FUND'] }))
    process.env.SCORING_CALIBRATION_PATH = path
    __resetFunderIntelCache()
    expect(mcaLenderNames()).toEqual(['FIRST FUND'])

    writeFileSync(path, JSON.stringify({ mcaLenderNames: ['SECOND FUND'] }))
    __resetFunderIntelCache()
    expect(mcaLenderNames()).toEqual(['SECOND FUND'])
  })

  it('ignores a malformed calibration file and stays usable', () => {
    const path = join(workDir, 'bad.json')
    writeFileSync(path, '{ not valid json')
    process.env.SCORING_CALIBRATION_PATH = path
    __resetFunderIntelCache()

    expect(mcaLenderNames().length).toBeGreaterThan(0)
  })
})
