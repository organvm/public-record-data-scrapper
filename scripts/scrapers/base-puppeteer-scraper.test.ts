import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Browser, Page } from 'puppeteer'
import { BasePuppeteerScraper } from './base-puppeteer-scraper'
import type { ScraperResult } from './base-scraper'

const puppeteerMock = vi.hoisted(() => ({
  launch: vi.fn()
}))

vi.mock('puppeteer', () => ({
  default: {
    launch: puppeteerMock.launch
  }
}))

class TestScraper extends BasePuppeteerScraper {
  constructor(options?: { keepPageOpenOnFailure?: boolean; headless?: boolean }) {
    super(
      {
        state: 'CA',
        baseUrl: 'https://example.test',
        rateLimit: 1,
        timeout: 1000,
        retryAttempts: 0
      },
      options
    )
  }

  async runSearch(result: ScraperResult): Promise<ScraperResult> {
    return this.withSearchPage(async (page, finalize) => {
      await this.initializePage(page)
      return finalize(result)
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_companyName: string): Promise<ScraperResult> {
    return { success: true, timestamp: new Date().toISOString() }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getManualSearchUrl(_companyName: string): string {
    return 'https://example.test'
  }
}

type PageMock = Page & {
  url: ReturnType<typeof vi.fn>
  isClosed: ReturnType<typeof vi.fn>
  setUserAgent: ReturnType<typeof vi.fn>
  setViewport: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  screenshot: ReturnType<typeof vi.fn>
  content: ReturnType<typeof vi.fn>
}

function createMockPage(): PageMock {
  let closed = false

  const page = {
    setUserAgent: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      closed = true
    }),
    isClosed: vi.fn(() => closed),
    screenshot: vi.fn(async (options: { path?: string } = {}) => {
      if (options.path) {
        writeFileSync(options.path, 'screenshot-bytes')
      }
    }),
    content: vi.fn(async () => '<!doctype html><html><body>ok</body></html>'),
    url: vi.fn(() => 'https://example.test')
  } as unknown as PageMock

  return page
}

function createMockBrowser(page: Page): Browser {
  return {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  } as unknown as Browser
}

describe('BasePuppeteerScraper', () => {
  beforeEach(() => {
    puppeteerMock.launch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initializes page settings before running a page workflow', async () => {
    const page = createMockPage()
    puppeteerMock.launch.mockResolvedValue(createMockBrowser(page))
    const scraper = new TestScraper()

    await scraper.runSearch({
      success: true,
      timestamp: new Date().toISOString()
    })

    expect(page.setUserAgent).toHaveBeenCalledWith(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )
    expect(page.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 })
    expect(page.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed page open only when configured to do so', async () => {
    const keptOpenPage = createMockPage()
    const closedPage = createMockPage()
    puppeteerMock.launch.mockResolvedValueOnce(createMockBrowser(keptOpenPage))
    puppeteerMock.launch.mockResolvedValueOnce(createMockBrowser(closedPage))

    const keepOpen = new TestScraper({ keepPageOpenOnFailure: true })
    const closeNormally = new TestScraper()

    await keepOpen.runSearch({
      success: false,
      error: 'blocked',
      timestamp: new Date().toISOString()
    })
    expect(keptOpenPage.close).toHaveBeenCalledTimes(0)

    await closeNormally.runSearch({
      success: false,
      error: 'blocked',
      timestamp: new Date().toISOString()
    })
    expect(closedPage.close).toHaveBeenCalledTimes(1)
  })

  it('writes screenshot and html diagnostics for active pages', async () => {
    const page = createMockPage()
    const scraper = new TestScraper()
    const tempDir = mkdtempSync(join(tmpdir(), 'scraper-diagnostics-'))
    const resultPath = join(tempDir, 'ca-test')

    ;(scraper as unknown as { lastPage: PageMock }).lastPage = page

    const result = await scraper.captureDiagnostics(tempDir, 'ca-test')

    expect(result).toEqual({
      screenshotPath: `${resultPath}.png`,
      htmlPath: `${resultPath}.html`
    })
    expect(page.screenshot).toHaveBeenCalledWith({ path: `${resultPath}.png`, fullPage: true })
    expect(page.content).toHaveBeenCalledTimes(1)

    const html = readFileSync(`${resultPath}.html`, 'utf8')
    expect(html).toContain('ok')
    expect(existsSync(`${resultPath}.png`)).toBe(true)

    rmSync(tempDir, { recursive: true, force: true })
  })

  it('releases browser resources and clears tracked pages on close', async () => {
    const page = createMockPage()
    const browser = createMockBrowser(page)
    puppeteerMock.launch.mockResolvedValue(browser)
    const scraper = new TestScraper()

    await scraper.runSearch({
      success: true,
      timestamp: new Date().toISOString()
    })
    await scraper.closeBrowser()

    expect(browser.close).toHaveBeenCalledTimes(1)
    expect((scraper as unknown as { lastPage: Page | null }).lastPage).toBeNull()
  })
})
