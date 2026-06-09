/**
 * New York UCC Scraper Collector
 *
 * Production collector that wraps the real Playwright-backed NY portal scraper
 * (`scripts/scrapers/states/newyork.ts` → `NYUCCPortalScraper`) to satisfy the
 * worker's `StateCollector` contract (`collectNewFilings`, etc.).
 *
 * Why this collector is different from CA/TX:
 * - The NY Department of State public UCC portal only supports an interactive
 *   per-debtor-name search. There is NO bulk export and NO date-windowed query
 *   endpoint, so a true date-incremental collector (`options.since`) is not
 *   possible against this source. We therefore implement the non-incremental
 *   strategy the worker already supports: iterate a configured list of debtor
 *   "seed" names, collect every filing the portal returns, and rely on the
 *   worker's `ON CONFLICT (external_id)` upsert dedupe (`persistCollectedFilings`)
 *   to fold repeat runs into stable rows. `options.since` is honored only as a
 *   best-effort post-filter on `filingDate` when the portal happens to return a
 *   parseable date — it can never make the portal itself return "new" filings.
 *
 * Fail-closed discipline (never invented data, never empty-success on failure):
 * - No debtor seeds configured  → collector is NOT ready; `createNYScraperCollector`
 *   returns it but `isReady()` is false so the worker's `resolveCollectorForJob`
 *   throws a NonRetryableIngestionError (mirroring the FL `isReady()` gate)
 *   instead of running an empty collection.
 * - Playwright unavailable / portal offline / portal anti-bot block / unexpected
 *   page structure → the underlying scraper reports `success: false`; this
 *   collector throws `NYCollectionError` with the named reason. It NEVER returns
 *   `[]` to mask a failure (an empty array is reserved for a genuine "portal
 *   answered, no records" result). At runtime this surfaces through the worker's
 *   self-heal path exactly like the CA/TX collectors' plain `Error` throws.
 *
 * NY requires no credentials per the scraper; the only configuration is the
 * debtor seed list (`NY_UCC_DEBTOR_SEEDS`), because the portal has no other way
 * to enumerate filings.
 *
 * Note: `NYCollectionError` is thrown (rather than importing the worker's
 * `NonRetryableIngestionError`) so this apps/web collector stays free of any
 * server/bullmq/pg import. The non-retryable wiring failure is signalled the
 * same way FL signals it — via `isReady()` checked inside `resolveCollectorForJob`.
 */

import { NewYorkScraper } from '../../../../../../scripts/scrapers/states/newyork'
import type {
  UCCFiling as ScraperUCCFiling,
  ScraperResult
} from '../../../../../../scripts/scrapers/base-scraper'
import { RateLimiter } from '../RateLimiter'
import type {
  CollectionOptions,
  CollectorStatus,
  Party,
  SearchResult,
  StateCollector,
  UCCFiling,
  ValidationResult
} from '../types'

/**
 * Error thrown when the NY portal cannot be collected from (offline, blocked,
 * Playwright missing, unsupported operation). Named so logs/telemetry can tell
 * a portal failure apart from a generic error; never used to mask empty results.
 */
export class NYCollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NYCollectionError'
  }
}

export interface NYScraperConfig {
  /**
   * Debtor names to drive the per-name portal search. The NY portal cannot
   * enumerate filings any other way, so without at least one seed the collector
   * is not ready and refuses to run (fail-closed).
   */
  debtorSeeds?: string[]
  /** Run the headless browser (default true). */
  headless?: boolean
  /** Cap on filings returned across all seeds (worker passes `batchSize`). */
  maxFilings?: number
}

/**
 * Minimal contract the collector needs from the underlying scraper. Declared as
 * an interface so tests can inject a mock without spinning up Playwright.
 */
export interface NYScraperLike {
  search(companyName: string): Promise<ScraperResult>
  closeBrowser(): Promise<void>
}

export class NYScraperCollector implements StateCollector {
  private readonly debtorSeeds: string[]
  private readonly headless: boolean
  private readonly maxFilings: number
  private readonly scraper: NYScraperLike
  private readonly rateLimiter: RateLimiter
  private readonly stats: {
    totalCollected: number
    totalErrors: number
    totalRequests: number
    lastCollectionTime?: string
    latencies: number[]
  }

  constructor(config: NYScraperConfig = {}, scraper?: NYScraperLike) {
    this.debtorSeeds = (config.debtorSeeds ?? [])
      .map((seed) => seed.trim())
      .filter((seed) => seed.length > 0)
    this.headless = config.headless ?? true
    this.maxFilings = config.maxFilings ?? 1000

    // Inject a scraper for testing; otherwise wrap the real Playwright scraper.
    this.scraper = scraper ?? new NewYorkScraper({ headless: this.headless })

    // Conservative limits matching the NY portal's documented 5 req/min budget.
    this.rateLimiter = new RateLimiter({
      requestsPerMinute: 5,
      requestsPerHour: 120,
      requestsPerDay: 1000
    })

    this.stats = {
      totalCollected: 0,
      totalErrors: 0,
      totalRequests: 0,
      latencies: []
    }
  }

  /**
   * Ready only when at least one debtor seed is configured. The portal has no
   * way to enumerate filings without a name to search, so an empty seed list
   * means "cannot collect" — surfaced as not-ready so the worker fails closed.
   */
  isReady(): boolean {
    return this.debtorSeeds.length > 0
  }

  async searchByBusinessName(name: string): Promise<SearchResult> {
    const result = await this.runSearch(name)
    const filings = this.mapScraperFilings(result.filings ?? [])
    return {
      filings,
      total: filings.length,
      hasMore: false
    }
  }

  async searchByFilingNumber(filingNumber: string): Promise<UCCFiling | null> {
    void filingNumber
    // The NY portal scraper exposes only per-debtor-name search; filing-number
    // lookup is not implemented upstream, so we fail closed rather than guess.
    throw new NYCollectionError(
      'NY portal scraper does not support filing-number lookup; only debtor-name search is available.'
    )
  }

  async getFilingDetails(filingNumber: string): Promise<UCCFiling> {
    void filingNumber
    throw new NYCollectionError(
      'NY portal scraper does not expose per-filing detail pages; details come from the debtor-name search rows.'
    )
  }

  /**
   * Collect filings by driving the per-debtor-name portal search across the
   * configured seed list. `options.since`/`includeInactive`/`limit` are applied
   * as best-effort post-filters; the portal itself cannot date-window.
   */
  async collectNewFilings(options: CollectionOptions): Promise<UCCFiling[]> {
    if (!this.isReady()) {
      // Defensive: resolveCollectorForJob gates on isReady(), but never run an
      // empty collection that would look like a "no new filings" success.
      throw new NYCollectionError(
        'NY collector has no debtor seeds configured (set NY_UCC_DEBTOR_SEEDS); refusing to report empty success.'
      )
    }

    const limit = options.limit ?? this.maxFilings
    const collected: UCCFiling[] = []
    const seenFilingNumbers = new Set<string>()

    for (const seed of this.debtorSeeds) {
      if (collected.length >= limit) {
        break
      }

      const result = await this.runSearch(seed)

      let mapped = this.mapScraperFilings(result.filings ?? [])

      // Best-effort incremental post-filter: drop filings older than `since`
      // when a parseable filing date is present. Unparseable dates are kept so
      // we never silently discard real records.
      if (options.since) {
        const sinceMs = options.since.getTime()
        mapped = mapped.filter((filing) => {
          const filingMs = new Date(filing.filingDate).getTime()
          return Number.isNaN(filingMs) ? true : filingMs >= sinceMs
        })
      }

      // includeInactive defaults to true from the worker; when explicitly false,
      // keep only active filings.
      if (options.includeInactive === false) {
        mapped = mapped.filter((filing) => filing.status === 'active')
      }

      for (const filing of mapped) {
        if (seenFilingNumbers.has(filing.filingNumber)) {
          continue
        }
        seenFilingNumbers.add(filing.filingNumber)
        collected.push(filing)
        if (collected.length >= limit) {
          break
        }
      }
    }

    this.stats.totalCollected += collected.length
    this.stats.lastCollectionTime = new Date().toISOString()

    return collected.slice(0, limit)
  }

  validateFiling(filing: UCCFiling): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!filing.filingNumber) errors.push('Missing filing number')
    if (!filing.filingDate) errors.push('Missing filing date')
    if (!filing.debtor?.name) errors.push('Missing debtor name')
    if (!filing.securedParty?.name) errors.push('Missing secured party name')
    if (filing.state !== 'NY') errors.push(`Invalid state: ${filing.state}, expected NY`)
    if (!filing.collateral) warnings.push('Missing collateral description')

    return { valid: errors.length === 0, errors, warnings }
  }

  getStatus(): CollectorStatus {
    const rateLimitStats = this.rateLimiter.getStats()

    return {
      isHealthy: this.isReady() && this.stats.totalErrors === 0,
      lastCollectionTime: this.stats.lastCollectionTime,
      totalCollected: this.stats.totalCollected,
      errorRate:
        this.stats.totalRequests > 0 ? this.stats.totalErrors / this.stats.totalRequests : 0,
      averageLatency:
        this.stats.latencies.length > 0
          ? this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length
          : 0,
      rateLimitStats: {
        perMinute: rateLimitStats.perMinute,
        perHour: rateLimitStats.perHour,
        perDay: rateLimitStats.perDay
      }
    }
  }

  /**
   * Run a single rate-limited portal search and fail closed on any scraper
   * failure (portal offline, anti-bot block, Playwright missing, unexpected
   * page structure). A failure throws a named NYCollectionError; it is never
   * converted into an empty-but-successful result.
   */
  private async runSearch(name: string): Promise<ScraperResult> {
    await this.rateLimiter.acquire()
    this.stats.totalRequests++

    const startTime = Date.now()
    let result: ScraperResult
    try {
      result = await this.scraper.search(name)
    } catch (error) {
      this.stats.totalErrors++
      throw new NYCollectionError(
        `NY portal search for "${name}" failed: ${
          error instanceof Error ? error.message : 'Unknown scraper error'
        }`
      )
    } finally {
      this.recordLatency(Date.now() - startTime)
    }

    if (!result.success) {
      this.stats.totalErrors++
      throw new NYCollectionError(
        `NY portal search for "${name}" did not succeed (portal blocked, offline, or unavailable): ${
          result.error ?? 'no error detail provided'
        }`
      )
    }

    return result
  }

  /**
   * Map the flat scripts-side scraper `UCCFiling` (debtorName/securedParty as
   * strings, narrow status/type enums) onto the collector `UCCFiling` shape
   * (`debtor`/`securedParty` as `Party`) that `persistCollectedFilings` reads.
   * Mirrors how TXBulkCollector.transformFiling builds nested parties.
   */
  private mapScraperFilings(filings: ScraperUCCFiling[]): UCCFiling[] {
    return filings
      .filter((filing) => Boolean(filing.filingNumber && filing.filingNumber.trim().length > 0))
      .map((filing) => this.mapScraperFiling(filing))
  }

  private mapScraperFiling(filing: ScraperUCCFiling): UCCFiling {
    const debtor: Party = {
      name: filing.debtorName,
      organizationType: 'organization'
    }
    const securedParty: Party = {
      name: filing.securedParty,
      organizationType: 'organization'
    }

    return {
      filingNumber: filing.filingNumber.trim(),
      filingType: filing.filingType,
      filingDate: filing.filingDate,
      status: filing.status,
      state: 'NY',
      securedParty,
      debtor,
      collateral: filing.collateral ?? '',
      rawData: filing as unknown as Record<string, unknown>
    }
  }

  private recordLatency(latency: number): void {
    this.stats.latencies.push(latency)
    if (this.stats.latencies.length > 100) {
      this.stats.latencies.shift()
    }
  }
}

/**
 * Parse the comma-separated NY debtor seed list from the environment.
 * Empty/whitespace entries are dropped.
 */
function parseDebtorSeeds(raw: string | undefined): string[] {
  if (!raw) {
    return []
  }
  return raw
    .split(',')
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0)
}

/**
 * Create the NY scraper collector from environment configuration.
 *
 * NY needs no credentials, but the portal can only be driven by debtor name, so
 * `NY_UCC_DEBTOR_SEEDS` (comma-separated) is required. When it is absent the
 * collector is returned but reports `isReady() === false`, so the worker's
 * `resolveCollectorForJob` fails closed with a NonRetryableIngestionError rather
 * than running an empty collection.
 */
export function createNYScraperCollector(): NYScraperCollector | null {
  const debtorSeeds = parseDebtorSeeds(process.env.NY_UCC_DEBTOR_SEEDS)

  if (debtorSeeds.length === 0) {
    console.warn(
      'NY_UCC_DEBTOR_SEEDS not set; NY scraper collector has no debtor names to search and will report not-ready.'
    )
    return new NYScraperCollector({ debtorSeeds })
  }

  return new NYScraperCollector({ debtorSeeds })
}
