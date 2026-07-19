import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Rate limiter is a no-op in tests — never block / hit a real bucket.
vi.mock('@public-records/core/enrichment', () => ({
  rateLimiterManager: {
    waitForTokens: vi.fn().mockResolvedValue(undefined)
  }
}))

import { SocrataBuildingPermitsChannel } from '../../services/discovery-channels/SocrataBuildingPermitsChannel'
import { DiscoveryChannelError } from '../../services/discovery-channels/types'

/** A successful JSON Response wrapping a Socrata row array. */
function rowsResponse(rows: Record<string, unknown>[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => rows
  } as unknown as Response
}

const NY_FIELD = 'permittee_s_business_name'
const CA_FIELD = 'contractors_business_name'
const FL_FIELD = 'contractor_name'
const TX_FIELD = 'contractor_company_name'

describe('SocrataBuildingPermitsChannel', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(url).toContain('data.cityoforlando.net/resource/ryhf-m453.json')
    // SODA sorts DESC NULL FIRST — the null-guard keeps unissued applications out.
    expect(url).toContain('issue_permit_date IS NOT NULL')
  })

  it('uses Austin issue_date and never the obsolete issued_date alias', async () => {
    fetchSpy.mockResolvedValueOnce(
      rowsResponse([
        {
          [TX_FIELD]: 'Lone Star Builders LLC',
          issue_date: '2026-07-16T00:00:00.000'
        }
      ])
    )

    await new SocrataBuildingPermitsChannel().discover({ state: 'TX', limit: 5 })

    // Austin dataset 3syk-w9eu exposes `issue_date`. Its live metadata does
    // not contain `issued_date`; using that review-suggested alias yields a
    // SODA no-such-column response.
    const url = decodeURIComponent(String(fetchSpy.mock.calls[0][0]).replace(/\+/g, ' '))
    expect(url).toContain('data.austintexas.gov/resource/3syk-w9eu.json')
    expect(url).toContain('issue_date DESC')
    expect(url).toContain('issue_date IS NOT NULL')
    expect(url).not.toContain('issued_date')
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
    ).rejects.toThrow(/Socrata \(NY\) schema changed: field 'permittee_s_business_name' absent/)
  })
})
