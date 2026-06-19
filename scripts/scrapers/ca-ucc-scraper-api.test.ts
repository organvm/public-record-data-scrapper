import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaliforniaUCCScraperAPI } from './ca-ucc-scraper-api'

type Sleepable = {
  sleep(ms: number): Promise<void>
}

const originalEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

describe('CaliforniaUCCScraperAPI', () => {
  beforeEach(() => {
    delete process.env.UCC_API_KEY
    delete process.env.UCC_API_ENDPOINT
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(CaliforniaUCCScraperAPI.prototype as unknown as Sleepable, 'sleep').mockResolvedValue(
      undefined
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    restoreEnv()
  })

  it('fails closed before fetching when no API key is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const scraper = new CaliforniaUCCScraperAPI()

    await expect(scraper.search('Acme LLC')).resolves.toMatchObject({
      success: false,
      error: 'API key not configured. Set UCC_API_KEY environment variable.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts search requests and maps valid API filings into the scraper shape', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        results: [
          {
            filing_number: 12345,
            debtor_name: 'Acme LLC',
            secured_party: 'First Bank',
            filing_date: '2026-04-20T00:00:00.000Z',
            collateral_description: 'Equipment and inventory',
            status: 'Active',
            type: 'UCC3'
          },
          {
            filingNumber: 'B-2',
            debtorName: 'Beta Inc',
            creditor: 'Working Capital Co',
            filingDate: '2026-01-05T00:00:00.000Z',
            collateral: 'Accounts receivable',
            status: 'terminated',
            filing_type: 'UCC-1'
          },
          {
            filing_number: '',
            debtor_name: '',
            secured_party: 'Incomplete Record',
            filing_date: '2026-02-01T00:00:00.000Z'
          }
        ]
      })
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const scraper = new CaliforniaUCCScraperAPI({
      apiKey: 'test-api-key',
      endpoint: 'https://api.example.test'
    })
    const result = await scraper.search('Acme LLC')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.test/search')
    expect(request?.method).toBe('POST')
    expect(request?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
      'User-Agent': 'UCC-Intelligence-Platform/1.0'
    })
    expect(JSON.parse(String(request?.body))).toEqual({
      query: {
        debtor_name: 'Acme LLC',
        state: 'CA'
      },
      options: {
        include_terminated: true,
        include_lapsed: true,
        max_results: 100
      }
    })

    expect(result).toMatchObject({
      success: true,
      retryCount: 0,
      searchUrl: 'https://bizfileonline.sos.ca.gov/search/business?SearchText=Acme%20LLC'
    })
    expect(result.filings).toEqual([
      {
        filingNumber: '12345',
        debtorName: 'Acme LLC',
        securedParty: 'First Bank',
        filingDate: '2026-04-20',
        collateral: 'Equipment and inventory',
        status: 'active',
        filingType: 'UCC-3'
      },
      {
        filingNumber: 'B-2',
        debtorName: 'Beta Inc',
        securedParty: 'Working Capital Co',
        filingDate: '2026-01-05',
        collateral: 'Accounts receivable',
        status: 'terminated',
        filingType: 'UCC-1'
      }
    ])
  })

  it('maps unauthorized API responses to a non-retryable search failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({})
    } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const scraper = new CaliforniaUCCScraperAPI({
      apiKey: 'bad-key',
      endpoint: 'https://api.example.test'
    })

    await expect(scraper.search('Acme LLC')).resolves.toMatchObject({
      success: false,
      error: 'Invalid API key',
      searchUrl: 'https://bizfileonline.sos.ca.gov/search/business?SearchText=Acme%20LLC'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid search terms before API setup or fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const scraper = new CaliforniaUCCScraperAPI({ apiKey: 'test-api-key' })

    await expect(scraper.search('')).resolves.toMatchObject({
      success: false,
      error: 'Invalid company name'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
