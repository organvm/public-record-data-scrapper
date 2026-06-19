import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BaseScraper,
  type ScraperConfig,
  type ScraperResult,
  type UCCFiling
} from './base-scraper'

class HarnessScraper extends BaseScraper {
  sleeps: number[] = []

  constructor(config: Partial<ScraperConfig> = {}) {
    super({
      state: 'TS',
      baseUrl: 'https://example.test',
      rateLimit: 60,
      timeout: 1000,
      retryAttempts: 2,
      ...config
    })
  }

  async search(companyName: string): Promise<ScraperResult> {
    return {
      success: this.validateSearch(companyName),
      timestamp: new Date().toISOString()
    }
  }

  getManualSearchUrl(companyName: string): string {
    return `https://example.test/search?q=${encodeURIComponent(companyName)}`
  }

  validateCompanyName(companyName: string): boolean {
    return this.validateSearch(companyName)
  }

  retry<T>(
    fn: () => Promise<T>,
    context = 'harness operation'
  ): Promise<{ result: T; retryCount: number }> {
    return this.retryWithBackoff(fn, context)
  }

  retryable(error: Error): boolean {
    return this.isRetryableError(error)
  }

  validateRows(
    rows: Partial<UCCFiling>[],
    parseErrors: string[] = []
  ): { validatedFilings: UCCFiling[]; validationErrors: string[] } {
    return this.validateFilings(rows, parseErrors)
  }

  protected override sleep(ms: number): Promise<void> {
    this.sleeps.push(ms)
    return Promise.resolve()
  }

  protected override log(): void {
    // Keep unit test output focused on assertions.
  }
}

describe('BaseScraper', () => {
  let scraper: HarnessScraper

  beforeEach(() => {
    scraper = new HarnessScraper()
  })

  it('validates non-empty search terms only', () => {
    expect(scraper.validateCompanyName('Acme LLC')).toBe(true)
    expect(scraper.validateCompanyName('')).toBe(false)
  })

  it('validates and filters filing rows while preserving parse errors', () => {
    const validFiling: UCCFiling = {
      filingNumber: 'CA-2026-100',
      debtorName: 'Acme LLC',
      securedParty: 'First Bank',
      filingDate: '2026-01-15',
      collateral: 'Equipment',
      status: 'active',
      filingType: 'UCC-1'
    }

    const result = scraper.validateRows(
      [
        validFiling,
        {
          filingNumber: 'CA-2026-101',
          debtorName: 'Missing Secured Party',
          filingDate: '2026-01-16'
        },
        {
          securedParty: 'Missing Debtor',
          filingDate: '2026-01-17'
        }
      ],
      ['Row 4 could not be parsed']
    )

    expect(result.validatedFilings).toEqual([validFiling])
    expect(result.validationErrors).toEqual([
      'Row 4 could not be parsed',
      'Filing 2 validation errors: Missing secured party',
      'Filing 3 validation errors: Missing filing number, Missing debtor name'
    ])
  })

  it('returns retry count when a retryable operation eventually succeeds', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }))
      .mockResolvedValue('done')

    await expect(scraper.retry(operation)).resolves.toEqual({
      result: 'done',
      retryCount: 2
    })

    expect(operation).toHaveBeenCalledTimes(3)
    expect(scraper.sleeps).toEqual([1000, 2000])
  })

  it('does not retry non-retryable errors', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('bad input'))

    await expect(scraper.retry(operation)).rejects.toThrow('bad input')

    expect(operation).toHaveBeenCalledTimes(1)
    expect(scraper.sleeps).toEqual([])
  })

  it('throws the last retryable error after exhausting attempts', async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('fetch failed'))

    await expect(scraper.retry(operation)).rejects.toThrow('fetch failed')

    expect(operation).toHaveBeenCalledTimes(3)
    expect(scraper.sleeps).toEqual([1000, 2000])
  })

  it('classifies retryable errors by type, code, and message', () => {
    class TimeoutError extends Error {}

    expect(scraper.retryable(new TimeoutError('navigation stalled'))).toBe(true)
    expect(scraper.retryable(Object.assign(new Error('transient'), { code: 'ETIMEDOUT' }))).toBe(
      true
    )
    expect(scraper.retryable(new Error('socket hang up'))).toBe(true)
    expect(scraper.retryable(new Error('validation failed'))).toBe(false)
  })
})
