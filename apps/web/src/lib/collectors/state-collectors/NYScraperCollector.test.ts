/**
 * Tests for NYScraperCollector
 *
 * Verifies the collector that wraps the real NY portal scraper:
 * - maps the flat scripts-side scraper UCCFiling onto the collector UCCFiling
 *   shape persistCollectedFilings expects (nested debtor/securedParty parties),
 * - fails closed (throws, never empty-success) when the scraper reports failure
 *   or throws (portal offline / blocked / Playwright missing),
 * - isReady()/configuration semantics gate on the debtor-seed list,
 * - the env factory parses NY_UCC_DEBTOR_SEEDS.
 *
 * The underlying NewYorkScraper is mocked so Playwright is never launched; the
 * collector also accepts an injected scraper, which most tests use directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  NYScraperCollector,
  NYCollectionError,
  createNYScraperCollector,
  type NYScraperLike
} from './NYScraperCollector'
import type {
  ScraperResult,
  UCCFiling as ScraperUCCFiling
} from '../../../../../../scripts/scrapers/base-scraper'

function scraperFiling(overrides: Partial<ScraperUCCFiling> = {}): ScraperUCCFiling {
  return {
    filingNumber: '202400123456',
    debtorName: 'Atlas Supply LLC',
    securedParty: 'Forward Funding LLC',
    filingDate: '2026-03-20',
    collateral: '',
    status: 'active',
    filingType: 'UCC-1',
    ...overrides
  }
}

function successResult(filings: ScraperUCCFiling[]): ScraperResult {
  return {
    success: true,
    filings,
    timestamp: new Date().toISOString()
  }
}

interface MockScraper extends NYScraperLike {
  search: ReturnType<typeof vi.fn<(companyName: string) => Promise<ScraperResult>>>
  closeBrowser: ReturnType<typeof vi.fn<() => Promise<void>>>
}

function createMockScraper(): MockScraper {
  return {
    search: vi.fn<(companyName: string) => Promise<ScraperResult>>(),
    closeBrowser: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  }
}

describe('NYScraperCollector', () => {
  let scraper: MockScraper

  beforeEach(() => {
    scraper = createMockScraper()
  })

  describe('isReady() / configuration', () => {
    it('is not ready without debtor seeds', () => {
      const collector = new NYScraperCollector({}, scraper)
      expect(collector.isReady()).toBe(false)
    })

    it('is ready when at least one debtor seed is configured', () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['Atlas Supply LLC'] }, scraper)
      expect(collector.isReady()).toBe(true)
    })

    it('trims and drops blank seeds', () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['  ', '', '  Atlas  '] }, scraper)
      expect(collector.isReady()).toBe(true)
    })

    it('reports unhealthy status when not ready', () => {
      const collector = new NYScraperCollector({}, scraper)
      expect(collector.getStatus().isHealthy).toBe(false)
    })
  })

  describe('collectNewFilings() — mapping', () => {
    it('maps flat scraper filings onto the collector UCCFiling shape', async () => {
      scraper.search.mockResolvedValue(successResult([scraperFiling()]))
      const collector = new NYScraperCollector({ debtorSeeds: ['Atlas Supply LLC'] }, scraper)

      const filings = await collector.collectNewFilings({ includeInactive: true })

      expect(filings).toHaveLength(1)
      expect(filings[0]).toMatchObject({
        filingNumber: '202400123456',
        filingType: 'UCC-1',
        filingDate: '2026-03-20',
        status: 'active',
        state: 'NY',
        debtor: { name: 'Atlas Supply LLC', organizationType: 'organization' },
        securedParty: { name: 'Forward Funding LLC', organizationType: 'organization' },
        collateral: ''
      })
      // rawData preserves the original scraper record for the worker's raw_data column.
      expect(filings[0].rawData).toMatchObject({ debtorName: 'Atlas Supply LLC' })
    })

    it('drops scraper rows missing a filing number (cannot build a stable external_id)', async () => {
      scraper.search.mockResolvedValue(
        successResult([scraperFiling(), scraperFiling({ filingNumber: '   ' })])
      )
      const collector = new NYScraperCollector({ debtorSeeds: ['Atlas Supply LLC'] }, scraper)

      const filings = await collector.collectNewFilings({})
      expect(filings).toHaveLength(1)
      expect(filings[0].filingNumber).toBe('202400123456')
    })

    it('drives a search per configured debtor seed and dedupes by filing number', async () => {
      scraper.search
        .mockResolvedValueOnce(successResult([scraperFiling({ filingNumber: 'A1' })]))
        .mockResolvedValueOnce(
          successResult([
            scraperFiling({ filingNumber: 'A1' }), // duplicate across seeds
            scraperFiling({ filingNumber: 'B2' })
          ])
        )
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One', 'Seed Two'] }, scraper)

      const filings = await collector.collectNewFilings({})

      expect(scraper.search).toHaveBeenCalledTimes(2)
      expect(scraper.search).toHaveBeenNthCalledWith(1, 'Seed One')
      expect(scraper.search).toHaveBeenNthCalledWith(2, 'Seed Two')
      expect(filings.map((f) => f.filingNumber)).toEqual(['A1', 'B2'])
    })

    it('respects the limit across seeds', async () => {
      scraper.search.mockResolvedValue(
        successResult([
          scraperFiling({ filingNumber: 'A1' }),
          scraperFiling({ filingNumber: 'A2' }),
          scraperFiling({ filingNumber: 'A3' })
        ])
      )
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      const filings = await collector.collectNewFilings({ limit: 2 })
      expect(filings).toHaveLength(2)
    })

    it('best-effort filters by since on parseable filing dates', async () => {
      scraper.search.mockResolvedValue(
        successResult([
          scraperFiling({ filingNumber: 'OLD', filingDate: '2020-01-01' }),
          scraperFiling({ filingNumber: 'NEW', filingDate: '2026-05-01' })
        ])
      )
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      const filings = await collector.collectNewFilings({ since: new Date('2026-01-01') })
      expect(filings.map((f) => f.filingNumber)).toEqual(['NEW'])
    })

    it('filters out inactive filings when includeInactive is false', async () => {
      scraper.search.mockResolvedValue(
        successResult([
          scraperFiling({ filingNumber: 'ACTIVE', status: 'active' }),
          scraperFiling({ filingNumber: 'LAPSED', status: 'lapsed' })
        ])
      )
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      const filings = await collector.collectNewFilings({ includeInactive: false })
      expect(filings.map((f) => f.filingNumber)).toEqual(['ACTIVE'])
    })

    it('returns an empty array on a genuine no-records success (portal answered, nothing found)', async () => {
      scraper.search.mockResolvedValue(successResult([]))
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      const filings = await collector.collectNewFilings({})
      expect(filings).toEqual([])
    })
  })

  describe('fail-closed behavior', () => {
    it('throws (never empty-success) when the scraper reports failure', async () => {
      scraper.search.mockResolvedValue({
        success: false,
        error: 'NY UCC portal appears to be offline or unavailable.',
        timestamp: new Date().toISOString()
      } satisfies ScraperResult)
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      await expect(collector.collectNewFilings({})).rejects.toThrow(NYCollectionError)
      await expect(collector.collectNewFilings({})).rejects.toThrow(/offline or unavailable/)
    })

    it('throws when the scraper itself throws (e.g. Playwright missing)', async () => {
      scraper.search.mockRejectedValue(
        new Error('Playwright not installed. Run: npm install -D playwright')
      )
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      await expect(collector.collectNewFilings({})).rejects.toThrow(NYCollectionError)
      await expect(collector.collectNewFilings({})).rejects.toThrow(/Playwright not installed/)
    })

    it('throws when run with no debtor seeds rather than reporting empty success', async () => {
      const collector = new NYScraperCollector({}, scraper)
      await expect(collector.collectNewFilings({})).rejects.toThrow(NYCollectionError)
      expect(scraper.search).not.toHaveBeenCalled()
    })

    it('does not support filing-number lookup (fails closed)', async () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)
      await expect(collector.searchByFilingNumber('A1')).rejects.toThrow(NYCollectionError)
    })

    it('does not support per-filing detail pages (fails closed)', async () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)
      await expect(collector.getFilingDetails('A1')).rejects.toThrow(NYCollectionError)
    })

    it('tracks error statistics on failed collection', async () => {
      scraper.search.mockResolvedValue({
        success: false,
        error: 'blocked',
        timestamp: new Date().toISOString()
      } satisfies ScraperResult)
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      await collector.collectNewFilings({}).catch(() => undefined)
      expect(collector.getStatus().errorRate).toBeGreaterThan(0)
    })
  })

  describe('searchByBusinessName()', () => {
    it('returns mapped filings in a SearchResult', async () => {
      scraper.search.mockResolvedValue(successResult([scraperFiling()]))
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)

      const result = await collector.searchByBusinessName('Atlas Supply LLC')
      expect(result.total).toBe(1)
      expect(result.hasMore).toBe(false)
      expect(result.filings[0].state).toBe('NY')
    })
  })

  describe('validateFiling()', () => {
    it('validates a well-formed NY filing', () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)
      const result = collector.validateFiling({
        filingNumber: 'A1',
        filingType: 'UCC-1',
        filingDate: '2026-03-20',
        status: 'active',
        state: 'NY',
        securedParty: { name: 'Forward Funding LLC' },
        debtor: { name: 'Atlas Supply LLC' },
        collateral: 'All assets'
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects a filing for the wrong state', () => {
      const collector = new NYScraperCollector({ debtorSeeds: ['Seed One'] }, scraper)
      const result = collector.validateFiling({
        filingNumber: 'A1',
        filingType: 'UCC-1',
        filingDate: '2026-03-20',
        status: 'active',
        state: 'CA',
        securedParty: { name: 'Forward Funding LLC' },
        debtor: { name: 'Atlas Supply LLC' },
        collateral: 'All assets'
      })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Invalid state: CA, expected NY')
    })
  })

  describe('createNYScraperCollector() factory', () => {
    const originalSeeds = process.env.NY_UCC_DEBTOR_SEEDS

    afterEach(() => {
      if (originalSeeds === undefined) {
        delete process.env.NY_UCC_DEBTOR_SEEDS
      } else {
        process.env.NY_UCC_DEBTOR_SEEDS = originalSeeds
      }
      vi.restoreAllMocks()
    })

    it('returns a not-ready collector when NY_UCC_DEBTOR_SEEDS is unset', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      delete process.env.NY_UCC_DEBTOR_SEEDS
      const collector = createNYScraperCollector()
      expect(collector).not.toBeNull()
      expect(collector?.isReady()).toBe(false)
    })

    it('parses comma-separated seeds and returns a ready collector', () => {
      process.env.NY_UCC_DEBTOR_SEEDS = 'Atlas Supply LLC, Forward Funding LLC ,  '
      const collector = createNYScraperCollector()
      expect(collector?.isReady()).toBe(true)
    })
  })
})
