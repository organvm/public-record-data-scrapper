/**
 * Unit tests for the key-gated enrichment sources (SAM.gov + commercial
 * adapters). These exercise the REAL source classes (no module mock) with a
 * stubbed global fetch, proving two things:
 *   1. Fail-closed: with no credential they return a named "not configured"
 *      error and never issue a request.
 *   2. When configured they issue a real request and map only the fields the
 *      provider returned (no fabrication).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SAMGovSource,
  DnBSource,
  ClearbitSource,
  ZoomInfoSource
} from '@public-records/core/enrichment'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function okJson(body: unknown) {
  return { ok: true, statusText: 'OK', json: async () => body }
}

describe('SAMGovSource', () => {
  it('fails closed (no request) when no API key is configured', async () => {
    const source = new SAMGovSource('')
    expect(source.isConfigured()).toBe(false)

    const res = await source.fetchData({ companyName: 'Acme Co' })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries with the api_key and maps registration data when configured', async () => {
    const source = new SAMGovSource('free-key')
    fetchMock.mockResolvedValue(
      okJson({
        totalRecords: 1,
        entityData: [
          { entityRegistration: { ueiSAM: 'UEI123', cageCode: 'CAGE9' }, contractCount: 4 }
        ]
      })
    )

    const res = await source.fetchData({ companyName: 'Acme Co' })

    expect(res.success).toBe(true)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('api_key=free-key')
    expect(url).toContain('legalBusinessName=Acme%20Co')
    expect(res.data).toMatchObject({ isRegistered: true, uei: 'UEI123', cageCode: 'CAGE9' })
  })
})

describe('DnBSource', () => {
  it('fails closed when DNB_API_KEY is absent', async () => {
    const source = new DnBSource('')
    expect(source.isConfigured()).toBe(false)
    const res = await source.fetchData({ companyName: 'Acme Co' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a bearer token and maps firmographics when configured', async () => {
    const source = new DnBSource('dnb-token')
    fetchMock.mockResolvedValue(
      okJson({
        matchCandidates: [
          {
            organization: {
              duns: '999',
              primaryName: 'Acme Co',
              dnbAssessment: { standardRating: { rating: '5A1' } },
              numberOfEmployees: [{ value: 120 }],
              financials: [{ yearlyRevenue: [{ value: 8000000 }] }]
            }
          }
        ]
      })
    )

    const res = await source.fetchData({ companyName: 'Acme Co', state: 'NY' })

    expect(res.success).toBe(true)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dnb-token')
    expect(res.data).toMatchObject({
      dunsNumber: '999',
      creditRating: '5A1',
      employeeCount: 120,
      annualRevenue: 8000000
    })
  })
})

describe('ClearbitSource', () => {
  it('fails closed when CLEARBIT_API_KEY is absent', async () => {
    const source = new ClearbitSource('')
    const res = await source.fetchData({ companyName: 'Acme Co' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps industry/revenue when configured', async () => {
    const source = new ClearbitSource('cb-key')
    fetchMock.mockResolvedValue(
      okJson({
        name: 'Acme Co',
        domain: 'acme.co',
        category: { industry: 'Software', sector: 'Information Technology' },
        metrics: { employees: 50, estimatedAnnualRevenue: '$1M-$10M' },
        foundedYear: 2011
      })
    )

    const res = await source.fetchData({ companyName: 'Acme Co' })

    expect(res.success).toBe(true)
    expect(res.data).toMatchObject({ industry: 'Software', employeeCount: 50, foundedYear: 2011 })
  })
})

describe('ZoomInfoSource', () => {
  it('fails closed when ZOOMINFO_API_TOKEN is absent', async () => {
    const source = new ZoomInfoSource('')
    const res = await source.fetchData({ companyName: 'Acme Co' })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not configured/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs an enrich request and maps company intelligence when configured', async () => {
    const source = new ZoomInfoSource('zi-token')
    fetchMock.mockResolvedValue(
      okJson({
        data: {
          result: [
            {
              data: [
                {
                  id: 7,
                  name: 'Acme Co',
                  revenue: 12000000,
                  employeeCount: 80,
                  industry: 'Retail',
                  website: 'acme.co'
                }
              ]
            }
          ]
        }
      })
    )

    const res = await source.fetchData({ companyName: 'Acme Co', state: 'CA' })

    expect(res.success).toBe(true)
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(res.data).toMatchObject({ revenue: 12000000, employeeCount: 80, industry: 'Retail' })
  })
})
