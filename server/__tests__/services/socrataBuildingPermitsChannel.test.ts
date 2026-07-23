import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Rate limiter is a no-op in tests — never block / hit a real bucket.
vi.mock('@public-records/core/enrichment', () => ({
  rateLimiterManager: {
    waitForTokens: vi.fn().mockResolvedValue(undefined)
  }
}))

import { SocrataBuildingPermitsChannel } from '../../services/discovery-channels/SocrataBuildingPermitsChannel'
import { DiscoveryChannelError } from '../../services/discovery-channels/types'
import { __resetDiscoverySourcesCache } from '../../services/calibration/discoverySources'

// The curated per-state source-map is now injected through the calibration seam
// (see server/services/calibration/discoverySources.ts). The real production
// endpoints/fields are the MOAT and never live in tracked source — including
// this test. So the suite injects a SAMPLE source-map via SCORING_CALIBRATION_PATH
// (exactly how an operator supplies their private map) and asserts the channel
// faithfully uses whatever it was given. Behavior is what's under test; the real
// values are proven by the same code path with the operator's own private file.
const SAMPLE_SOURCES = {
  NY: {
    state: 'NY',
    url: 'https://example.data.gov/resource/nyxx-xxxx.json',
    businessField: 'sample_ny_business',
    orderField: 'sample_ny_date'
  },
  CA: {
    state: 'CA',
    url: 'https://example.data.gov/resource/caxx-xxxx.json',
    businessField: 'sample_ca_business',
    orderField: 'sample_ca_date'
  },
  FL: {
    state: 'FL',
    url: 'https://example.data.gov/resource/flxx-xxxx.json',
    businessField: 'sample_fl_business',
    orderField: 'sample_fl_date'
  },
  TX: {
    state: 'TX',
    url: 'https://example.data.gov/resource/txxx-xxxx.json',
    businessField: 'sample_tx_business',
    orderField: 'sample_tx_date'
  }
}

/** A successful JSON Response wrapping a Socrata row array. */
function rowsResponse(rows: Record<string, unknown>[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => rows
  } as unknown as Response
}

const NY_FIELD = SAMPLE_SOURCES.NY.businessField
const CA_FIELD = SAMPLE_SOURCES.CA.businessField
const FL_FIELD = SAMPLE_SOURCES.FL.businessField
const TX_FIELD = SAMPLE_SOURCES.TX.businessField

describe('SocrataBuildingPermitsChannel', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let calibrationDir: string
  const originalCalibrationPath = process.env.SCORING_CALIBRATION_PATH

  beforeEach(() => {
    // Inject the sample source-map through the calibration seam.
    calibrationDir = mkdtempSync(join(tmpdir(), 'socrata-cal-'))
    const calibrationPath = join(calibrationDir, 'calibration.json')
    writeFileSync(calibrationPath, JSON.stringify({ socrataBuildingPermitSources: SAMPLE_SOURCES }))
    process.env.SCORING_CALIBRATION_PATH = calibrationPath
    __resetDiscoverySourcesCache()

    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalCalibrationPath === undefined) delete process.env.SCORING_CALIBRATION_PATH
    else process.env.SCORING_CALIBRATION_PATH = originalCalibrationPath
    __resetDiscoverySourcesCache()
    rmSync(calibrationDir, { recursive: true, force: true })
  })

  it('always reports as configured (key-less public source)', () => {
    expect(new SocrataBuildingPermitsChannel().isConfigured()).toBe(true)
  })

  it('maps NY rows to permit candidates and dedupes by business name', async () => {
    fetchSpy.mockResolvedValueOnce(
      rowsResponse([
        { [NY_FIELD]: 'Acme Builders' },
        { [NY_FIELD]: 'Acme Builders' }, // duplicate within the page
        { [NY_FIELD]: 'Beta Contractors' }
      ])
    )

    const candidates = await new SocrataBuildingPermitsChannel().discover({
      state: 'NY',
      limit: 10
    })

    expect(candidates.map((c) => c.company_name)).toEqual(['Acme Builders', 'Beta Contractors'])
    expect(candidates[0]).toMatchObject({
      state: 'NY',
      signal_type: 'permit',
      signal_strength: 60,
      source: 'socrata-building-permits'
    })
    expect(candidates[0].raw).toMatchObject({ dataset_state: 'NY', business_field: NY_FIELD })
  })

  it('queries every registered dataset when no state is given', async () => {
    fetchSpy
      .mockResolvedValueOnce(rowsResponse([{ [NY_FIELD]: 'NY Co' }]))
      .mockResolvedValueOnce(rowsResponse([{ [CA_FIELD]: 'CA Co' }]))
      .mockResolvedValueOnce(rowsResponse([{ [FL_FIELD]: 'FL Co' }]))
      .mockResolvedValueOnce(rowsResponse([{ [TX_FIELD]: 'TX Co' }]))

    const candidates = await new SocrataBuildingPermitsChannel().discover({ limit: 10 })

    expect(fetchSpy).toHaveBeenCalledTimes(4)
    expect(candidates.map((c) => `${c.state}:${c.company_name}`)).toEqual([
      'NY:NY Co',
      'CA:CA Co',
      'FL:FL Co',
      'TX:TX Co'
    ])
  })

  it('serves FL from the Orlando dataset and requires a non-null order field', async () => {
    fetchSpy.mockResolvedValueOnce(rowsResponse([{ [FL_FIELD]: 'Sunshine Builders LLC' }]))

    const candidates = await new SocrataBuildingPermitsChannel().discover({
      state: 'FL',
      limit: 5
    })

    expect(candidates.map((c) => `${c.state}:${c.company_name}`)).toEqual([
      'FL:Sunshine Builders LLC'
    ])
    // URLSearchParams encodes spaces as '+' — normalize before asserting.
    const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]).replace(/\+/g, ' '))
    // The channel queries whatever resource the injected source-map names for FL.
    expect(url).toContain(SAMPLE_SOURCES.FL.url)
    // SODA sorts DESC NULL FIRST — the null-guard keeps unissued applications out.
    expect(url).toContain(`${SAMPLE_SOURCES.FL.orderField} IS NOT NULL`)
  })

  it('caps the total candidates at the requested limit', async () => {
    fetchSpy.mockResolvedValueOnce(
      rowsResponse(Array.from({ length: 10 }, (_, n) => ({ [NY_FIELD]: `Co ${n}` })))
    )

    const candidates = await new SocrataBuildingPermitsChannel().discover({ state: 'NY', limit: 3 })
    expect(candidates).toHaveLength(3)
  })

  it('fails closed for a state with no registered dataset', async () => {
    const err = await new SocrataBuildingPermitsChannel()
      .discover({ state: 'WA', limit: 10 })
      .catch((e) => e)
    expect(err).toBeInstanceOf(DiscoveryChannelError)
    expect((err as Error).message).toMatch(/no building-permit dataset registered for state 'WA'/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed when the upstream is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('connection reset'))
    await expect(
      new SocrataBuildingPermitsChannel().discover({ state: 'NY', limit: 10 })
    ).rejects.toThrow('Socrata (NY) unreachable: connection reset')
  })

  it('fails closed on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    } as unknown as Response)

    await expect(
      new SocrataBuildingPermitsChannel().discover({ state: 'NY', limit: 10 })
    ).rejects.toThrow(/Socrata \(NY\) returned HTTP 500 Internal Server Error/)
  })

  it('fails closed when the body is not a JSON array', async () => {
    fetchSpy.mockResolvedValueOnce(rowsResponse({} as unknown as Record<string, unknown>[]))
    await expect(
      new SocrataBuildingPermitsChannel().discover({ state: 'NY', limit: 10 })
    ).rejects.toThrow(/Socrata \(NY\) response shape changed: expected a JSON array of rows/)
  })

  it('fails closed when the documented business field is absent from every row', async () => {
    fetchSpy.mockResolvedValueOnce(rowsResponse([{ some_other_field: 'x' }, { another: 'y' }]))
    await expect(
      new SocrataBuildingPermitsChannel().discover({ state: 'NY', limit: 10 })
    ).rejects.toThrow(new RegExp(`Socrata \\(NY\\) schema changed: field '${NY_FIELD}' absent`))
  })
})
