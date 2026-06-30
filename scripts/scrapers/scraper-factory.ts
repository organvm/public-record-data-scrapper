/**
 * Scraper Factory
 *
 * Centralized factory for creating UCC scrapers with different implementations
 *
 * Three implementation options:
 * 1. MOCK: Canned filings — TESTS ONLY. Never the default outside NODE_ENV=test.
 * 2. PUPPETEER: Real web scraping, free but complex
 * 3. API: Commercial service, reliable and legal (recommended for production)
 *
 * Fail-closed default: the factory defaults to a REAL implementation ('api')
 * so the product never silently serves fabricated filings. Mock scrapers are
 * still available for tests and for an explicit `SCRAPER_IMPLEMENTATION=mock`
 * opt-in, and instantiating one outside a test environment logs a loud warning.
 */

import { BaseScraper } from './base-scraper'
import { CaliforniaUCCScraper } from './ca-ucc-scraper'
import { CaliforniaUCCScraperPuppeteer } from './ca-ucc-scraper-puppeteer'
import { CaliforniaUCCScraperAPI } from './ca-ucc-scraper-api'
import { TexasUCCScraper } from './tx-ucc-scraper'
import { FloridaUCCScraper } from './fl-ucc-scraper'
import { NewYorkUCCScraper } from './ny-ucc-scraper'
import { IllinoisUCCScraper } from './il-ucc-scraper'
import { existsSync } from 'fs'
import { join } from 'path'

export type ScraperImplementation = 'mock' | 'puppeteer' | 'api'
export type SupportedState = 'CA' | 'TX' | 'FL' | 'NY' | 'IL'

export interface ScraperFactoryConfig {
  implementation?: ScraperImplementation
  apiKey?: string
  apiEndpoint?: string
}

/**
 * Scraper Factory
 */
export class ScraperFactory {
  /**
   * Resolve the default implementation, failing closed to a REAL implementation.
   *
   * Priority:
   * 1. Explicit `SCRAPER_IMPLEMENTATION` env (respects an intentional `mock`).
   * 2. `mock` ONLY when running under tests (`NODE_ENV=test`).
   * 3. Otherwise `api` (real). We never silently default to `mock` in dev/prod —
   *    that would serve fabricated filings.
   */
  private static resolveDefaultImplementation(): ScraperImplementation {
    const explicit = process.env.SCRAPER_IMPLEMENTATION as ScraperImplementation | undefined
    if (explicit) {
      return explicit
    }
    if (process.env.NODE_ENV === 'test') {
      return 'mock'
    }
    return 'api'
  }

  private static get defaultImplementation(): ScraperImplementation {
    return this.resolveDefaultImplementation()
  }

  /**
   * Whether mock scrapers are sanctioned in the current environment (tests, or
   * an explicit opt-in). Used to gate the loud out-of-test warning.
   */
  private static isMockSanctioned(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      (process.env.SCRAPER_IMPLEMENTATION as ScraperImplementation | undefined) === 'mock'
    )
  }

  /**
   * Loudly warn when a mock scraper is created outside a test environment.
   * Mock scrapers return canned filings; using them in dev/prod fabricates data.
   */
  private static warnIfMockOutsideTest(state: SupportedState): void {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    console.warn(
      `[ScraperFactory] ⚠️  Instantiating MOCK ${state} scraper outside a test environment. ` +
        `Mock scrapers return CANNED filings and MUST NOT be treated as real ingestion. ` +
        `Set SCRAPER_IMPLEMENTATION=api (or puppeteer) for real data.`
    )
  }

  /**
   * Create a scraper for a specific state
   */
  static create(state: SupportedState, config?: ScraperFactoryConfig): BaseScraper {
    const implementation = config?.implementation || this.defaultImplementation

    console.log(`[ScraperFactory] Creating ${state} scraper with ${implementation} implementation`)

    switch (implementation) {
      case 'mock':
        this.warnIfMockOutsideTest(state)
        return this.createMockScraper(state)

      case 'puppeteer':
        return this.createPuppeteerScraper(state)

      case 'api':
        return new CaliforniaUCCScraperAPI({
          apiKey: config?.apiKey || process.env.UCC_API_KEY,
          endpoint: config?.apiEndpoint || process.env.UCC_API_ENDPOINT
        })

      default:
        throw new Error(`Unknown implementation: ${implementation}`)
    }
  }

  private static createMockScraper(state: SupportedState): BaseScraper {
    switch (state) {
      case 'CA':
        return new CaliforniaUCCScraper()
      case 'TX':
        return new TexasUCCScraper()
      case 'FL':
        return new FloridaUCCScraper()
      case 'NY':
        return new NewYorkUCCScraper()
      case 'IL':
        return new IllinoisUCCScraper()
      default:
        throw new Error(`Scraper not implemented for state: ${state}`)
    }
  }

  private static createPuppeteerScraper(state: SupportedState): BaseScraper {
    switch (state) {
      case 'CA':
        return new CaliforniaUCCScraperPuppeteer()
      default:
        throw new Error(`Puppeteer implementation not yet available for ${state}`)
    }
  }

  /**
   * Get recommended implementation based on environment
   */
  static getRecommendedImplementation(): ScraperImplementation {
    // Tests are the only context that may default to mock.
    if (process.env.NODE_ENV === 'test') {
      return 'mock'
    }

    // If API key is configured, recommend API (real + reliable).
    if (process.env.UCC_API_KEY) {
      return 'api'
    }

    // No API key: recommend Puppeteer if it is installed (real, free).
    if (this.isImplementationAvailable('puppeteer').available) {
      return 'puppeteer'
    }

    // Otherwise recommend API even if not configured yet — surfacing a real
    // (configurable) path rather than silently recommending fabricated mock data.
    return 'api'
  }

  /**
   * Check if implementation is available
   */
  static isImplementationAvailable(implementation: ScraperImplementation): {
    available: boolean
    reason?: string
  } {
    switch (implementation) {
      case 'mock':
        return { available: true }

      case 'puppeteer':
        // Check if Puppeteer is installed
        if (existsSync(join(process.cwd(), 'node_modules', 'puppeteer', 'package.json'))) {
          return { available: true }
        }
        return {
          available: false,
          reason:
            'Puppeteer not installed. Run: npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth'
        }

      case 'api':
        if (!process.env.UCC_API_KEY) {
          return {
            available: false,
            reason: 'API key not configured. Set UCC_API_KEY environment variable.'
          }
        }
        return { available: true }

      default:
        return {
          available: false,
          reason: `Unknown implementation: ${implementation}`
        }
    }
  }
}

/**
 * Helper functions for common use cases
 */

export function createScraper(state: SupportedState, config?: ScraperFactoryConfig): BaseScraper {
  return ScraperFactory.create(state, config)
}

export function createMockScraper(state: SupportedState): BaseScraper {
  return ScraperFactory.create(state, { implementation: 'mock' })
}

export function createPuppeteerScraper(state: SupportedState): BaseScraper {
  return ScraperFactory.create(state, { implementation: 'puppeteer' })
}

export function createAPIScraper(state: SupportedState, apiKey?: string): BaseScraper {
  return ScraperFactory.create(state, {
    implementation: 'api',
    apiKey: apiKey || process.env.UCC_API_KEY
  })
}
