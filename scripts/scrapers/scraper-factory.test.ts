import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAPIScraper,
  createMockScraper,
  createPuppeteerScraper,
  createScraper,
  ScraperFactory,
  type SupportedState
} from './scraper-factory'

const originalEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

describe('ScraperFactory', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    delete process.env.SCRAPER_IMPLEMENTATION
    delete process.env.UCC_API_KEY
    delete process.env.UCC_API_ENDPOINT
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv()
  })

  it('defaults to mock implementation under tests and creates supported state scrapers', () => {
    expect(ScraperFactory.getRecommendedImplementation()).toBe('mock')

    expect(createScraper('CA').getState()).toBe('CA')
    expect(createMockScraper('TX').getState()).toBe('TX')
    expect(createMockScraper('FL').getState()).toBe('FL')
    expect(createMockScraper('NY').getState()).toBe('NY')
    expect(createMockScraper('IL').getState()).toBe('IL')
  })

  it('fails closed to API outside tests when no implementation is explicitly configured', async () => {
    process.env.NODE_ENV = 'development'

    const scraper = createScraper('CA')
    const result = await scraper.search('Acme LLC')

    expect(result).toMatchObject({
      success: false,
      error: 'API key not configured. Set UCC_API_KEY environment variable.'
    })
  })

  it('warns loudly when a mock scraper is explicitly created outside tests', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.NODE_ENV = 'development'

    expect(createMockScraper('TX').getState()).toBe('TX')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Instantiating MOCK TX scraper'))
  })

  it('reports API implementation availability from environment configuration', () => {
    expect(ScraperFactory.isImplementationAvailable('api')).toEqual({
      available: false,
      reason: 'API key not configured. Set UCC_API_KEY environment variable.'
    })

    process.env.UCC_API_KEY = 'test-api-key'

    expect(ScraperFactory.isImplementationAvailable('api')).toEqual({ available: true })
    expect(createAPIScraper('CA').getState()).toBe('CA')
  })

  it('rejects unsupported implementation and state combinations', () => {
    expect(() => createPuppeteerScraper('TX')).toThrow(
      'Puppeteer implementation not yet available for TX'
    )

    expect(() => ScraperFactory.create('WA' as SupportedState)).toThrow(
      'Scraper not implemented for state: WA'
    )
  })
})
