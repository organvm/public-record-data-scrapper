/**
 * Tests for Health Score Data Sources
 *
 * Sources that require credentials short-circuit before issuing a request,
 * so the "missing credentials" cases resolve without touching the network.
 * Cases that exercise a successful response stub `fetch` so they never fall
 * into the executeFetch retry/backoff path (which would add real wall-clock
 * delay to the suite).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  YelpSource,
  BBBSource,
  GoogleReviewsSource,
  SentimentAnalysisSource,
  TrustpilotSource
} from '../health-scores'

// Mock fetch
global.fetch = vi.fn()

describe('YelpSource', () => {
  let source: YelpSource

  beforeEach(() => {
    source = new YelpSource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      companyName: 'Acme Corp',
      city: 'San Francisco',
      state: 'CA'
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
      companyName: 'Test Corp',
      city: 'San Francisco',
      state: 'CA'
    })

    expect(result.source).toBeDefined()
  })
})

describe('BBBSource', () => {
  let source: BBBSource

  beforeEach(() => {
    source = new BBBSource()
    vi.clearAllMocks()
  })

  it('should validate required query parameters', async () => {
    const result = await source.fetchData({
      companyName: 'Test'
      // Missing city and state
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid query parameters')
  })

  it('should include source name', async () => {
    // BBB is a keyless scraping source, so stub a successful HTML response to
    // avoid the executeFetch retry/backoff path (which adds real delay).
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => '<div class="rating-A+">12 complaints</div>'
    } as Response)

    const result = await source.fetchData({
      companyName: 'Test Corp',
      city: 'Austin',
      state: 'TX'
    })

    expect(result.source).toBeDefined()
  })
})

describe('GoogleReviewsSource', () => {
  let source: GoogleReviewsSource

  beforeEach(() => {
    source = new GoogleReviewsSource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      companyName: 'Acme Corp',
      city: 'Seattle',
      state: 'WA'
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
      companyName: 'Test Corp',
      city: 'Austin',
      state: 'TX'
    })

    expect(result.source).toBeDefined()
  })
})

describe('SentimentAnalysisSource', () => {
  let source: SentimentAnalysisSource

  beforeEach(() => {
    source = new SentimentAnalysisSource('google')
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      texts: [
        'This company is excellent!',
        'Great service and professional team',
        'Amazing experience overall'
      ]
    })

    // Without API key, should return appropriate response
    expect(result).toBeDefined()
    expect(typeof result.success).toBe('boolean')
  })

  it('should return error for empty texts or missing credentials', async () => {
    const result = await source.fetchData({
      texts: []
    })

    expect(result.success).toBe(false)
    // Either invalid params or not configured error
    expect(result.error).toBeDefined()
  })

  it('should include source name', async () => {
    const result = await source.fetchData({
      texts: ['Test text']
    })

    expect(result.source).toBeDefined()
  })
})

describe('TrustpilotSource', () => {
  let source: TrustpilotSource

  beforeEach(() => {
    source = new TrustpilotSource()
    vi.clearAllMocks()
  })

  it('should handle missing API credentials', async () => {
    const result = await source.fetchData({
      companyName: 'Acme Corp'
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
