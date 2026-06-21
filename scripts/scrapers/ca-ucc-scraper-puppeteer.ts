/**
 * California UCC Filing Scraper - Puppeteer Implementation
 *
 * Real web scraping implementation using Puppeteer with stealth mode
 *
 * IMPORTANT: Web scraping government websites may have legal and ethical considerations.
 * - Check the website's robots.txt and Terms of Service
 * - Use respectful rate limiting
 * - Consider using official APIs when available
 * - This is for educational/research purposes
 */

import type { Browser, Page } from 'puppeteer'
import { BaseScraper, ScraperConfig, ScraperResult, UCCFiling } from './base-scraper'

// @ts-expect-error - puppeteer-extra types are not included
import puppeteerExtra from 'puppeteer-extra'
// @ts-expect-error - puppeteer-extra-plugin-stealth types are not included
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

// Enable stealth mode
puppeteerExtra.use(StealthPlugin())

export class CaliforniaUCCScraperPuppeteer extends BaseScraper {
  private browser: Browser | null = null

  constructor() {
    const config: ScraperConfig = {
      state: 'CA',
      baseUrl: 'https://bizfileonline.sos.ca.gov/search/business',
      rateLimit: 10, // Conservative: 10 requests per minute
      timeout: 60000, // 60 seconds for page loads
      retryAttempts: 3
    }
    super(config)
  }

  /**
   * Initialize browser with stealth settings
   */
  private async initBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser
    }

    this.log('info', 'Launching headless browser with stealth mode')

    // Assign through a local so the non-null type survives the await —
    // TS resets property narrowing across await boundaries.
    const browser = await puppeteerExtra.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    })
    this.browser = browser

    return browser
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
      this.log('info', 'Browser closed')
    }
  }

  /**
   * Search for UCC filings in California
   */
  async search(companyName: string): Promise<ScraperResult> {
    if (!this.validateSearch(companyName)) {
      return {
        success: false,
        error: 'Invalid company name',
        timestamp: new Date().toISOString()
      }
    }

    this.log('info', 'Starting CA UCC search (Puppeteer)', { companyName })

    try {
      const { result: filings, retryCount } = await this.retryWithBackoff(
        () => this.executeSearch(companyName),
        `CA UCC search for "${companyName}"`
      )

      return {
        success: true,
        filings,
        searchUrl: this.getManualSearchUrl(companyName),
        timestamp: new Date().toISOString(),
        retryCount
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      this.log('error', 'CA UCC search failed', { error: errorMessage, companyName })

      return {
        success: false,
        error: errorMessage,
        searchUrl: this.getManualSearchUrl(companyName),
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Execute the actual search using Puppeteer
   */
  private async executeSearch(companyName: string): Promise<UCCFiling[]> {
    const delayMs = (60 * 1000) / this.config.rateLimit
    await this.sleep(delayMs)

    let page: Page | null = null

    try {
      const browser = await this.initBrowser()
      page = await browser.newPage()

      // Set realistic viewport
      await page.setViewport({ width: 1920, height: 1080 })

      // Additional stealth measures
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
      })

      this.log('info', 'Navigating to CA SOS website', { url: this.config.baseUrl })

      // Navigate to search page
      await page.goto(this.config.baseUrl, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout
      })

      // Wait a bit to appear more human-like
      await this.sleep(1000 + Math.random() * 1000)

      // Try to find search input
      // NOTE: These selectors are PLACEHOLDERS - actual selectors need to be
      // determined by inspecting the live CA SOS website
      const searchInputSelector =
        'input[name="SearchText"], input[type="text"]#search, input.search-input'

      try {
        await page.waitForSelector(searchInputSelector, { timeout: 5000 })
      } catch {
        throw new Error('Could not find search input field - website structure may have changed')
      }

      // Type company name (with human-like delay)
      this.log('info', 'Entering search query', { companyName })
      await page.type(searchInputSelector, companyName, { delay: 100 })

      // Wait a bit
      await this.sleep(500 + Math.random() * 500)

      // Submit search
      const submitButtonSelector =
        'button[type="submit"], input[type="submit"], button.search-button'
      await page.click(submitButtonSelector)

      // Wait for results
      this.log('info', 'Waiting for search results')
      await page.waitForSelector('.results-table, table.results, #results', {
        timeout: this.config.timeout
      })

      // Parse results
      const filings = await page.evaluate(() => {
        const results: Partial<UCCFiling>[] = []

        // NOTE: These selectors are PLACEHOLDERS - need real inspection
        const rows = document.querySelectorAll('.result-row, tr.filing-row, .filing-result')

        rows.forEach((row) => {
          try {
            const filing: Partial<UCCFiling> = {
              filingNumber:
                row.querySelector('.filing-number, .filing-id')?.textContent?.trim() || '',
              debtorName: row.querySelector('.debtor-name, .debtor')?.textContent?.trim() || '',
              securedParty:
                row.querySelector('.secured-party, .creditor')?.textContent?.trim() || '',
              filingDate: row.querySelector('.filing-date, .date')?.textContent?.trim() || '',
              collateral:
                row.querySelector('.collateral, .description')?.textContent?.trim() ||
                'Not specified',
              status: 'lapsed' as const, // Need to parse actual status
              filingType: 'UCC-1' as const // Need to parse actual type
            }

            if (filing.filingNumber && filing.debtorName) {
              results.push(filing)
            }
          } catch (err) {
            console.error('Error parsing row:', err)
          }
        })

        return results
      })

      // Close page
      await page.close()

      // Validate and filter filings
      const { validatedFilings, validationErrors } = this.validateFilings(filings)

      if (validationErrors.length > 0) {
        this.log('warn', 'Some filings had validation errors', {
          errorCount: validationErrors.length,
          errors: validationErrors.slice(0, 5) // Log first 5 errors
        })
      }

      this.log('info', 'CA UCC search completed', {
        filingCount: validatedFilings.length,
        validationErrorCount: validationErrors.length
      })

      return validatedFilings
    } catch (error) {
      if (page) await page.close().catch(() => {})
      throw error
    }
  }

  /**
   * Get manual search URL for user verification
   */
  getManualSearchUrl(companyName: string): string {
    const encoded = encodeURIComponent(companyName)
    return `${this.config.baseUrl}?SearchText=${encoded}&SearchType=BUSINESS_NAME`
  }
}

/**
 * Helper to create California Puppeteer scraper instance
 */
export function createCAPuppeteerScraper(): CaliforniaUCCScraperPuppeteer {
  return new CaliforniaUCCScraperPuppeteer()
}
