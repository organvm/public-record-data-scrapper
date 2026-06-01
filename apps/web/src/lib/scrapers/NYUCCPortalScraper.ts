/* eslint-disable @typescript-eslint/no-explicit-any */
// Scraper with dynamic data handling

/**
 * New York UCC Portal Scraper
 *
 * Example scraper for New York State UCC filing portal using Playwright
 * Portal: https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame
 *
 * NOTE: This is a reference implementation. You'll need to:
 * 1. Install Playwright: npm install -D playwright
 * 2. Respect the portal's robots.txt and terms of service
 * 3. Implement appropriate rate limiting
 * 4. Handle CAPTCHAs if present
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { UCCFiling } from '@public-records/core'

export interface ScraperConfig {
  headless: boolean
  timeout: number // milliseconds
  userAgent?: string
  proxyUrl?: string
  keepPageOpenOnFailure?: boolean
}

export interface ScraperResult {
  success: boolean
  filings: UCCFiling[]
  errors: string[]
  metadata: {
    searchCriteria: Record<string, any>
    resultsCount: number
    scrapedCount: number
    timestamp: string
    processingTime: number
  }
}

/**
 * New York UCC Portal Scraper
 *
 * @example
 * ```typescript
 * const scraper = new NYUCCPortalScraper({
 *   headless: true,
 *   timeout: 30000
 * })
 *
 * const result = await scraper.searchByDebtorName('ACME Corporation')
 * console.log(`Found ${result.filings.length} filings`)
 * ```
 */
export class NYUCCPortalScraper {
  private config: ScraperConfig
  private lastBrowser: import('playwright').Browser | null = null
  private lastPage: import('playwright').Page | null = null

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = {
      headless: config.headless ?? true,
      timeout: config.timeout ?? 30000,
      userAgent: config.userAgent,
      proxyUrl: config.proxyUrl,
      keepPageOpenOnFailure: config.keepPageOpenOnFailure ?? false
    }
  }

  /**
   * Search by debtor name
   */
  async searchByDebtorName(debtorName: string): Promise<ScraperResult> {
    const startTime = Date.now()
    const filings: UCCFiling[] = []
    const errors: string[] = []
    let success = false
    let browser: import('playwright').Browser | null = null

    try {
      // Lazy load playwright only when needed
      const playwright = await this.loadPlaywright()
      if (!playwright) {
        throw new Error('Playwright not installed. Run: npm install -D playwright')
      }

      const { chromium } = playwright
      browser = await chromium.launch({
        headless: this.config.headless,
        proxy: this.config.proxyUrl ? { server: this.config.proxyUrl } : undefined
      })

      this.lastBrowser = browser

      const context = await browser.newContext({
        userAgent:
          this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      })

      const page = await context.newPage()
      this.lastPage = page
      page.setDefaultTimeout(this.config.timeout)

      // Navigate to the NYS Standard Debtor Search form
      await page.goto('https://appext20.dos.ny.gov/pls/ucc_public/web_search.inhouse_search')

      const pageSnapshot = await page.evaluate(() => ({
        title: document.title || '',
        bodyText: document.body?.innerText || ''
      }))

      const snapshotText = pageSnapshot.bodyText.toLowerCase()
      const portalUnavailable =
        pageSnapshot.title.toLowerCase().includes('page unavailable') ||
        snapshotText.includes('application is currently offline') ||
        snapshotText.includes('operation has timed out')

      if (portalUnavailable) {
        errors.push('NY UCC portal appears to be offline or unavailable.')
      } else {
        // Wait for search form
        await page.waitForSelector('input[name="p_name"]', { timeout: this.config.timeout })

        // Fill in debtor name
        await page.fill('input[name="p_name"]', debtorName)

        // Submit search
        await page.click('input[type="submit"]')

        // Wait for results
        await page.waitForLoadState('networkidle')

        const parsedFilings = await page.evaluate(() => {
          const results: Array<{
            filingNumber: string
            filingDate: string
            lapseDate: string
            filingType: string
            debtorName: string
            securedParty: string
          }> = []

          const groupTables = Array.from(
            document.querySelectorAll('table[border="1"][width="98%"]')
          )

          for (const group of groupTables) {
            const innerTables = Array.from(group.querySelectorAll('table'))
            if (innerTables.length < 2) {
              continue
            }

            const infoTable = innerTables[0]
            const filingTable = innerTables[1]

            let debtorName = ''
            let securedParty = ''

            for (const row of Array.from(infoTable.querySelectorAll('tr'))) {
              const cells = Array.from(row.querySelectorAll('td'))
              if (cells.length < 3) {
                continue
              }
              const label = (cells[1]?.textContent || '').replace(/\s+/g, ' ').trim()
              const value = (cells[2]?.textContent || '').replace(/\s+/g, ' ').trim()
              if (!value) {
                continue
              }
              if (label.toLowerCase().includes('debtor names') && !debtorName) {
                debtorName = value
              }
              if (label.toLowerCase().includes('secured party names') && !securedParty) {
                securedParty = value
              }
            }

            const rows = Array.from(filingTable.querySelectorAll('tr'))
            for (const row of rows.slice(1)) {
              const cells = Array.from(row.querySelectorAll('td'))
              if (cells.length < 4) {
                continue
              }
              const filingNumber = (cells[0]?.textContent || '').replace(/\s+/g, ' ').trim()
              const filingDate = (cells[1]?.textContent || '').replace(/\s+/g, ' ').trim()
              const lapseDate = (cells[2]?.textContent || '').replace(/\s+/g, ' ').trim()
              const filingType = (cells[3]?.textContent || '').replace(/\s+/g, ' ').trim()

              if (!filingNumber || !filingDate) {
                continue
              }

              results.push({
                filingNumber,
                filingDate,
                lapseDate,
                filingType,
                debtorName,
                securedParty
              })
            }
          }

          return results
        })

        if (parsedFilings.length === 0) {
          const noResults = await (
            page.locator('text=/No records found/i') as { count(): Promise<number> }
          ).count()
          if (noResults === 0) {
            errors.push('NY results page did not contain expected filing tables.')
          }
        } else {
          const today = new Date()
          for (const filing of parsedFilings) {
            const normalizedType = filing.filingType.toLowerCase()
            const isUcc3 =
              normalizedType.includes('amendment') ||
              normalizedType.includes('continuation') ||
              normalizedType.includes('assignment') ||
              normalizedType.includes('termination') ||
              normalizedType.includes('release') ||
              normalizedType.includes('correction')
            const filingType =
              normalizedType.includes('financing statement') && !isUcc3 ? 'UCC-1' : 'UCC-3'
            const lapse = this.parseDate(filing.lapseDate)
            const lapseDate = new Date(lapse)
            const status = Number.isNaN(lapseDate.getTime())
              ? 'active'
              : lapseDate < today
                ? 'lapsed'
                : 'active'

            filings.push({
              id: `ny-${filing.filingNumber}`,
              filingDate: this.parseDate(filing.filingDate),
              debtorName: filing.debtorName || debtorName,
              securedParty: filing.securedParty,
              state: 'NY',
              status,
              filingType
            })
          }
        }
      }

      success = errors.length === 0
    } catch (error) {
      errors.push(`Scraper error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      success = false
    } finally {
      if (browser && (!this.config.keepPageOpenOnFailure || success)) {
        await browser.close()
        this.lastBrowser = null
        this.lastPage = null
      }
    }

    return {
      success,
      filings,
      errors,
      metadata: {
        searchCriteria: { debtorName },
        resultsCount: filings.length,
        scrapedCount: filings.length,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      }
    }
  }

  /**
   * Search by filing number
   */
  async searchByFilingNumber(filingNumber: string): Promise<ScraperResult> {
    const startTime = Date.now()
    const filings: UCCFiling[] = []
    const errors: string[] = []
    let success = false
    let browser: import('playwright').Browser | null = null

    try {
      const playwright = await this.loadPlaywright()
      if (!playwright) {
        throw new Error('Playwright not installed. Run: npm install -D playwright')
      }

      const { chromium } = playwright
      browser = await chromium.launch({ headless: this.config.headless })
      this.lastBrowser = browser
      const page = await browser.newPage()
      this.lastPage = page

      await page.goto('https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame')
      await page.fill('input[name="p_filing_number"]', filingNumber)
      await page.click('input[type="submit"]')
      await page.waitForLoadState('networkidle')

      // Extract filing details from detail page
      // Implementation similar to searchByDebtorName
      // ...

      success = errors.length === 0
    } catch (error) {
      errors.push(`Scraper error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      success = false
    } finally {
      if (browser && (!this.config.keepPageOpenOnFailure || success)) {
        await browser.close()
        this.lastBrowser = null
        this.lastPage = null
      }
    }

    return {
      success,
      filings,
      errors,
      metadata: {
        searchCriteria: { filingNumber },
        resultsCount: filings.length,
        scrapedCount: filings.length,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      }
    }
  }

  /**
   * Search for lapsed filings within a date range
   */
  async searchLapsedFilings(startDate: Date, endDate: Date): Promise<ScraperResult> {
    const startTime = Date.now()
    const filings: UCCFiling[] = []
    const errors: string[] = []
    let success = false

    try {
      const playwright = await this.loadPlaywright()
      if (!playwright) {
        throw new Error('Playwright not installed. Run: npm install -D playwright')
      }

      // Implementation for date range search
      // This would navigate to the appropriate search form
      // and filter for lapsed filings

      success = errors.length === 0
    } catch (error) {
      errors.push(`Scraper error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      success = false
    }

    return {
      success,
      filings,
      errors,
      metadata: {
        searchCriteria: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
        resultsCount: filings.length,
        scrapedCount: filings.length,
        timestamp: new Date().toISOString(),
        processingTime: Date.now() - startTime
      }
    }
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateStr: string): string {
    // Common NY UCC portal date format: MM/DD/YYYY
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (match) {
      const [, month, day, year] = match
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    // Fallback to current date if parsing fails
    return new Date().toISOString().split('T')[0]
  }

  /**
   * Parse filing status
   */
  private parseStatus(statusStr: string): 'active' | 'terminated' | 'lapsed' {
    const lower = statusStr.toLowerCase()

    if (lower.includes('active') || lower.includes('filed')) {
      return 'active'
    } else if (lower.includes('terminated') || lower.includes('discharged')) {
      return 'terminated'
    } else if (lower.includes('lapsed') || lower.includes('expired')) {
      return 'lapsed'
    }

    // Default to active for unknown statuses
    return 'active'
  }

  /**
   * Lazy load playwright to avoid requiring it as a dependency
   */
  private async loadPlaywright(): Promise<typeof import('playwright') | null> {
    try {
      return await import('playwright')
    } catch {
      return null
    }
  }

  async captureDiagnostics(
    outputDir: string,
    baseName: string
  ): Promise<{ screenshotPath?: string; htmlPath?: string }> {
    if (!this.lastPage || this.lastPage.isClosed()) {
      return {}
    }

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const screenshotPath = join(outputDir, `${baseName}.png`)
    const htmlPath = join(outputDir, `${baseName}.html`)

    let savedScreenshot = false
    let savedHtml = false

    try {
      await this.lastPage.screenshot({ path: screenshotPath, fullPage: true })
      savedScreenshot = true
    } catch {
      // Ignore screenshot errors to avoid masking the primary failure
    }

    try {
      const html = await this.lastPage.content()
      writeFileSync(htmlPath, html)
      savedHtml = true
    } catch {
      // Ignore HTML capture errors to avoid masking the primary failure
    }

    return {
      screenshotPath: savedScreenshot ? screenshotPath : undefined,
      htmlPath: savedHtml ? htmlPath : undefined
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.lastBrowser) {
      await this.lastBrowser.close()
      this.lastBrowser = null
      this.lastPage = null
    }
  }
}

/**
 * Example usage
 */
export async function exampleUsage() {
  const scraper = new NYUCCPortalScraper({
    headless: true,
    timeout: 30000
  })

  // Search by debtor name
  const result = await scraper.searchByDebtorName('ACME Corporation LLC')

  if (result.success) {
    console.log(`Found ${result.filings.length} filings`)
    result.filings.forEach((filing) => {
      console.log(`- ${filing.id}: ${filing.debtorName} (${filing.filingDate})`)
    })
  } else {
    console.error('Scraping failed:', result.errors)
  }

  return result
}

/**
 * Rate-limited scraper wrapper
 */
export class RateLimitedNYUCCScraper {
  private scraper: NYUCCPortalScraper
  private requestQueue: Array<() => Promise<any>> = []
  private processing = false
  private requestsPerMinute: number
  private lastRequestTime = 0

  constructor(config: Partial<ScraperConfig> = {}, requestsPerMinute: number = 30) {
    this.scraper = new NYUCCPortalScraper(config)
    this.requestsPerMinute = requestsPerMinute
  }

  async searchByDebtorName(debtorName: string): Promise<ScraperResult> {
    return this.enqueue(() => this.scraper.searchByDebtorName(debtorName))
  }

  async searchByFilingNumber(filingNumber: string): Promise<ScraperResult> {
    return this.enqueue(() => this.scraper.searchByFilingNumber(filingNumber))
  }

  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await fn()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })

      if (!this.processing) {
        this.processQueue()
      }
    })
  }

  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0) {
      return
    }

    this.processing = true

    while (this.requestQueue.length > 0) {
      const now = Date.now()
      const timeSinceLastRequest = now - this.lastRequestTime
      const minDelay = (60 * 1000) / this.requestsPerMinute

      if (timeSinceLastRequest < minDelay) {
        await this.delay(minDelay - timeSinceLastRequest)
      }

      const request = this.requestQueue.shift()
      if (request) {
        this.lastRequestTime = Date.now()
        await request()
      }
    }

    this.processing = false
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
