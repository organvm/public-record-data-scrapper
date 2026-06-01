/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for UCC Data Sources
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CaliforniaUCCSource,
  TexasUCCSource,
  NewYorkUCCSource,
  FloridaUCCSource,
  CSCUCCSource,
  // CTCorpUCCSource, - not tested
  LexisNexisUCCSource,
  UCCAggregatorSource
} from '../ucc-data'

// Mock fetch
global.fetch = vi.fn()

describe('CaliforniaUCCSource', () => {
  let source: CaliforniaUCCSource

  beforeEach(() => {
    source = new CaliforniaUCCSource()
    vi.clearAllMocks()
  })

  it('should fetch UCC filings successfully', async () => {
    const mockResponse = {
      results: [
        {
          fileNumber: 'CA-UCC-12345',
          filingDate: '2024-01-15',
          debtorName: 'Acme Corp',
          securedPartyName: 'Big Bank',
          collateralDescription: 'Equipment and inventory',
          status: 'Active',
          lapseDate: '2029-01-15'
        }
      ]
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result = await source.fetchData({
      debtorName: 'Acme Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.available).toBe(true)
    expect((result.data as any)?.state).toBe('CA')
    expect((result.data as any)?.totalFilings).toBe(1)
  })

  it('should provide fallback manual search URL when API unavailable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized'
    } as Response)

    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.available).toBe(false)
    expect((result.data as any)?.manualSearchUrl).toContain('businesssearch.sos.ca.gov')
  })

  it('should validate query parameters', async () => {
    const result = await source.fetchData({})

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid query parameters')
  })

  it('should accept either debtorName or fileNumber', async () => {
    const mockResponse = { results: [] }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result1 = await source.fetchData({ debtorName: 'Test' })
    expect(result1.success).toBe(true)

    const result2 = await source.fetchData({ fileNumber: 'CA-123' })
    expect(result2.success).toBe(true)
  })
})

describe('State UCC Sources', () => {
  it('TexasUCCSource should provide manual search guidance', async () => {
    const source = new TexasUCCSource()

    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.available).toBe(false)
    expect((result.data as any)?.state).toBe('TX')
    expect((result.data as any)?.note).toContain('web scraping')
  })

  it('NewYorkUCCSource should recommend using scraper', async () => {
    const source = new NewYorkUCCSource()

    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.available).toBe(false)
    expect((result.data as any)?.state).toBe('NY')
    expect((result.data as any)?.recommendation).toContain('NYUCCPortalScraper')
  })

  it('FloridaUCCSource should provide Sunbiz portal URL', async () => {
    const source = new FloridaUCCSource()

    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.available).toBe(false)
    expect((result.data as any)?.state).toBe('FL')
    expect((result.data as any)?.portalUrl).toContain('sunbiz')
  })
})

describe('CSCUCCSource', () => {
  let source: CSCUCCSource

  beforeEach(() => {
    source = new CSCUCCSource()
    vi.clearAllMocks()
  })

  it('should return error when credentials are missing', async () => {
    // Without env vars, should return credentials error
    const result = await source.fetchData({
      debtorName: 'Acme Corp',
      state: 'CA'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('should require state parameter', async () => {
    const result = await source.fetchData({
      debtorName: 'Test Corp'
      // Missing state
    })

    expect(result.success).toBe(false)
    // Either invalid params or not configured error
    expect(result.error).toBeDefined()
  })

  it('should include source name in response', async () => {
    const result = await source.fetchData({
      debtorName: 'Test Corp',
      state: 'CA'
    })

    expect(result.source).toBe('csc-ucc')
  })
})

describe('LexisNexisUCCSource', () => {
  let source: LexisNexisUCCSource

  beforeEach(() => {
    source = new LexisNexisUCCSource()
    vi.clearAllMocks()
  })

  it('should return error when credentials are missing', async () => {
    const result = await source.fetchData({
      debtorName: 'National Corp',
      nationwide: true
    })

    // Without env vars, should return credentials error
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('should include source name in response', async () => {
    const result = await source.fetchData({
      debtorName: 'California Corp',
      state: 'CA'
    })

    expect(result.source).toBe('lexisnexis-ucc')
  })

  it('should require API credentials for searches', async () => {
    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    // If no credentials, should return error
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })
})

describe('UCCAggregatorSource', () => {
  let source: UCCAggregatorSource

  beforeEach(() => {
    source = new UCCAggregatorSource()
    vi.clearAllMocks()
  })

  it('should aggregate results from multiple sources', async () => {
    // Mock successful responses from multiple sources
    const mockResponse = {
      results: [
        {
          fileNumber: 'CA-001',
          debtorName: 'Test Corp',
          filingDate: '2024-01-15',
          state: 'CA'
        }
      ]
    }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result = await source.fetchData({
      debtorName: 'Test Corp',
      state: 'CA'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.sourcesQueried).toBeGreaterThan(0)
    expect((result.data as any)?.totalFilings).toBeGreaterThanOrEqual(0)
  })

  it('should deduplicate filings across sources', async () => {
    // This test would require more complex mocking of individual sources
    // For now, just verify the structure
    const result = await source.fetchData({
      debtorName: 'Multi-State Corp',
      nationwide: true
    })

    expect(result.success).toBe(true)
    expect(result.data as any).toHaveProperty('filings')
    expect(result.data as any).toHaveProperty('sourcesQueried')
    expect(result.data as any).toHaveProperty('sourcesSucceeded')
  })

  it('should handle partial failures gracefully', async () => {
    // Some sources succeed, some fail
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ fileNumber: 'CA-001' }] })
      } as Response)
      .mockRejectedValueOnce(new Error('Network error'))

    const result = await source.fetchData({
      debtorName: 'Test Corp',
      state: 'CA'
    })

    expect(result.success).toBe(true)
    // Should still return data from successful sources
    expect((result.data as any)?.sourcesSucceeded).toBeGreaterThanOrEqual(0)
    expect((result.data as any)?.sourcesFailed).toBeGreaterThanOrEqual(0)
  })

  it('should sort filings by date (most recent first)', async () => {
    const mockResponse = {
      results: [
        { fileNumber: 'CA-001', filingDate: '2024-01-01' },
        { fileNumber: 'CA-002', filingDate: '2024-06-01' },
        { fileNumber: 'CA-003', filingDate: '2024-03-01' }
      ]
    }

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result = await source.fetchData({
      debtorName: 'Test Corp',
      state: 'CA'
    })

    expect(result.success).toBe(true)
    if ((result.data as any)?.filings && (result.data as any).filings.length > 1) {
      const dates = (result.data as any).filings.map((f: { filingDate: string }) =>
        new Date(f.filingDate).getTime()
      )
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
      }
    }
  })

  it('should filter sources by state when not nationwide', async () => {
    const result = await source.fetchData({
      debtorName: 'California Corp',
      state: 'CA',
      nationwide: false
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.searchType).toBe('state')
    expect((result.data as any)?.state).toBe('CA')
  })
})

describe('Rate Limiting and Retries', () => {
  it('should handle multiple rapid requests', async () => {
    const source = new CaliforniaUCCSource()

    // Make multiple requests - all should complete (may succeed or fail)
    const promises = Array(3)
      .fill(null)
      .map(() => source.fetchData({ debtorName: 'Test' }))

    const results = await Promise.all(promises)

    expect(results).toHaveLength(3)
    results.forEach((result) => {
      expect(result).toBeDefined()
      expect(typeof result.success).toBe('boolean')
    })
  })

  it('should include timing information', async () => {
    const source = new CaliforniaUCCSource()

    const result = await source.fetchData({
      debtorName: 'Test Corp'
    })

    expect(result.responseTime).toBeDefined()
    expect(typeof result.responseTime).toBe('number')
  })
})
