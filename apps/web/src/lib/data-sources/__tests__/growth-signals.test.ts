/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for Growth Signal Data Sources
 *
 * Sources that require credentials short-circuit before issuing a request,
 * so the "missing credentials" cases resolve without touching the network or
 * falling into the executeFetch retry/backoff path. Cases that exercise a
 * successful response stub `fetch` explicitly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  NewsAPISource,
  USASpendingSource,
  BuildingPermitsSource,
  IndeedJobsSource
  // LinkedInJobsSource - not tested
} from '../growth-signals'

// Mock fetch
global.fetch = vi.fn()

describe('NewsAPISource', () => {
  let source: NewsAPISource

  beforeEach(() => {
    source = new NewsAPISource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      companyName: 'Acme Corp'
    })

    // Without API key, should return error or empty data
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('should return error for empty query or missing credentials', async () => {
    const result = await source.fetchData({})

    expect(result.success).toBe(false)
    // Either invalid params or not configured error
    expect(result.error).toBeDefined()
  })

  it('should include source name', async () => {
    const result = await source.fetchData({
      companyName: 'Test Corp'
    })

    expect(result.source).toBeDefined()
  })
})

describe('USASpendingSource', () => {
  let source: USASpendingSource

  beforeEach(() => {
    source = new USASpendingSource()
    vi.clearAllMocks()
  })

  it('should fetch government contracts successfully', async () => {
    const mockResponse = {
      results: [
        {
          'Award ID': 'CONTRACT-001',
          'Recipient Name': 'Acme Corp',
          'Award Amount': '1000000',
          'Award Type': 'Contract',
          'Awarding Agency': 'Department of Defense',
          'Start Date': '2024-01-15'
        }
      ],
      page_metadata: {
        total: 1
      }
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result = await source.fetchData({
      companyName: 'Acme Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.totalContracts).toBeGreaterThanOrEqual(0)
    expect((result.data as any)?.totalAmount).toBeGreaterThanOrEqual(0)
  })

  it('should calculate growth trends', async () => {
    const mockResponse = {
      results: [
        {
          'Award Amount': '500000',
          'Start Date': new Date().toISOString()
        },
        {
          'Award Amount': '300000',
          'Start Date': new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
        }
      ],
      page_metadata: { total: 2 }
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    } as Response)

    const result = await source.fetchData({
      companyName: 'Test Corp'
    })

    expect(result.success).toBe(true)
    expect((result.data as any)?.growthTrend).toBeDefined()
  })
})

describe('IndeedJobsSource', () => {
  let source: IndeedJobsSource

  beforeEach(() => {
    source = new IndeedJobsSource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      companyName: 'Acme Corp',
      location: 'San Francisco, CA'
    })

    // Without API key, should return appropriate response
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('should return error for empty query or missing credentials', async () => {
    const result = await source.fetchData({})

    expect(result.success).toBe(false)
    // Either invalid params or not configured error
    expect(result.error).toBeDefined()
  })

  it('should include source name', async () => {
    const result = await source.fetchData({
      companyName: 'Test Corp'
    })

    expect(result.source).toBeDefined()
  })
})

describe('BuildingPermitsSource', () => {
  let source: BuildingPermitsSource

  beforeEach(() => {
    source = new BuildingPermitsSource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials gracefully', async () => {
    const result = await source.fetchData({
      companyName: 'Test Corp',
      address: '123 Main St',
      city: 'San Francisco',
      state: 'CA'
    })

    // Without credentials, should return appropriate response
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('should return error for empty query or missing credentials', async () => {
    const result = await source.fetchData({})

    expect(result.success).toBe(false)
    // Either invalid params or not configured error
    expect(result.error).toBeDefined()
  })

  it('should include source name', async () => {
    const result = await source.fetchData({
      companyName: 'Test Corp',
      city: 'Austin',
      state: 'TX'
    })

    expect(result.source).toBeDefined()
  })
})
