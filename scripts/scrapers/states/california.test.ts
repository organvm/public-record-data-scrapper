import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { JSDOM } from 'jsdom'
import type { Browser, Frame, Page } from 'puppeteer'
import { CaliforniaScraper } from './california'

const puppeteerMock = vi.hoisted(() => ({
  launch: vi.fn()
}))

vi.mock('puppeteer', () => ({
  default: {
    launch: puppeteerMock.launch
  }
}))

type Sleepable = {
  sleep(ms: number): Promise<void>
}

type EvaluateCallback = (...args: unknown[]) => unknown

type PageDouble = {
  dom: JSDOM
  frame: {
    evaluate: ReturnType<typeof vi.fn>
  }
  rawPage: {
    setUserAgent: ReturnType<typeof vi.fn>
    setViewport: ReturnType<typeof vi.fn>
    goto: ReturnType<typeof vi.fn>
    evaluate: ReturnType<typeof vi.fn>
    mainFrame: ReturnType<typeof vi.fn>
    frames: ReturnType<typeof vi.fn>
    waitForNavigation: ReturnType<typeof vi.fn>
    url: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    isClosed: ReturnType<typeof vi.fn>
    screenshot: ReturnType<typeof vi.fn>
    content: ReturnType<typeof vi.fn>
  }
  page: Page
}

type BrowserDouble = {
  newPage: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  browser: Browser
}

type GlobalKey =
  | 'window'
  | 'document'
  | 'HTMLElement'
  | 'HTMLButtonElement'
  | 'Event'
  | 'Node'
  | 'URL'

const globalKeys: GlobalKey[] = [
  'window',
  'document',
  'HTMLElement',
  'HTMLButtonElement',
  'Event',
  'Node',
  'URL'
]

const originalEnv = { ...process.env }

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
}

function runInDom<T>(dom: JSDOM, callback: () => T): T {
  const globalRecord = globalThis as Record<string, unknown>
  const previous = new Map<GlobalKey, unknown>()

  for (const key of globalKeys) {
    previous.set(key, globalRecord[key])
  }

  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: dom.window },
    document: { configurable: true, writable: true, value: dom.window.document },
    HTMLElement: { configurable: true, writable: true, value: dom.window.HTMLElement },
    HTMLButtonElement: {
      configurable: true,
      writable: true,
      value: dom.window.HTMLButtonElement
    },
    Event: { configurable: true, writable: true, value: dom.window.Event },
    Node: { configurable: true, writable: true, value: dom.window.Node },
    URL: { configurable: true, writable: true, value: dom.window.URL }
  })

  try {
    return callback()
  } finally {
    for (const key of globalKeys) {
      const value = previous.get(key)
      if (value === undefined) {
        delete globalRecord[key]
      } else {
        Object.defineProperty(globalThis, key, {
          configurable: true,
          writable: true,
          value
        })
      }
    }
  }
}

function createPage(html: string, url = 'https://bizfileonline.sos.ca.gov/search/ucc'): PageDouble {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true
  })
  let closed = false

  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get: function offsetParent(this: HTMLElement) {
      return this.hasAttribute('data-hidden') ? null : dom.window.document.body
    }
  })

  if (!('innerText' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get: function innerText(this: HTMLElement) {
        return this.textContent || ''
      },
      set: function innerText(this: HTMLElement, value: string) {
        this.textContent = value
      }
    })
  }

  const nativeClick = dom.window.HTMLElement.prototype.click
  dom.window.HTMLElement.prototype.click = function click(this: HTMLElement) {
    this.setAttribute('data-clicked', 'true')
    nativeClick.call(this)
  }

  const evaluateInDom = async (fn: EvaluateCallback, ...args: unknown[]) =>
    runInDom(dom, () => fn(...args))

  const frame = {
    evaluate: vi.fn(evaluateInDom)
  }

  const rawPage = {
    setUserAgent: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    goto: vi.fn(async (nextUrl: string) => {
      dom.reconfigure({ url: nextUrl })
    }),
    evaluate: vi.fn(evaluateInDom),
    mainFrame: vi.fn(() => frame as unknown as Frame),
    frames: vi.fn(() => [frame as unknown as Frame]),
    waitForNavigation: vi.fn(async () => undefined),
    url: vi.fn(() => dom.window.location.href),
    close: vi.fn(async () => {
      closed = true
    }),
    isClosed: vi.fn(() => closed),
    screenshot: vi.fn(async (options: { path?: string }) => {
      if (options.path) {
        writeFileSync(options.path, 'screenshot-bytes')
      }
    }),
    content: vi.fn(async () => (dom as unknown as { serialize: () => string }).serialize())
  }

  return {
    dom,
    frame,
    rawPage,
    page: rawPage as unknown as Page
  }
}

function mockBrowser(page: Page): BrowserDouble {
  const rawBrowser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined)
  }

  puppeteerMock.launch.mockResolvedValue(rawBrowser)

  return {
    ...rawBrowser,
    browser: rawBrowser as unknown as Browser
  }
}

describe('CaliforniaScraper', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    puppeteerMock.launch.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(CaliforniaScraper.prototype as unknown as Sleepable, 'sleep').mockResolvedValue(
      undefined
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv()
  })

  it('fills the debtor search form, parses result rows, and reports validation errors', async () => {
    const { dom, page, rawPage } = createPage(`
        <form>
          <label>Debtor <input name="debtorName" /></label>
          <button type="button">Search</button>
        </form>
        <table class="results">
          <thead>
            <tr>
              <th>Filing Number</th>
              <th>Filing Date</th>
              <th>Debtor</th>
              <th>Secured Party</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CA-UCC-100</td>
              <td>2026-06-01</td>
              <td>Acme Equipment LLC</td>
              <td>First Bank</td>
              <td>Filed</td>
            </tr>
            <tr>
              <td>CA-UCC3-101</td>
              <td>2026-06-08</td>
              <td>Acme Equipment LLC</td>
              <td>Term Lender</td>
              <td>Terminated</td>
            </tr>
            <tr>
              <td>CA-UCC-102</td>
              <td>2026-06-12</td>
              <td>Broken Row LLC</td>
              <td></td>
              <td>Active</td>
            </tr>
          </tbody>
        </table>
      `)
    const browser = mockBrowser(page)
    const scraper = new CaliforniaScraper()
    const expectedSearchUrl =
      'https://bizfileonline.sos.ca.gov/search/ucc?searchType=debtor&' +
      'searchCriteria=Acme%20Equipment%20LLC'

    const result = await scraper.search('Acme Equipment LLC')

    expect(puppeteerMock.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        headless: true,
        args: expect.arrayContaining(['--no-sandbox', '--window-size=1920x1080'])
      })
    )
    expect(browser.newPage).toHaveBeenCalledTimes(1)
    expect(rawPage.goto).toHaveBeenCalledWith(expectedSearchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    })
    const debtorInput = dom.window.document.querySelector<HTMLInputElement>(
      'input[name="debtorName"]'
    )
    expect(debtorInput?.value).toBe('Acme Equipment LLC')
    expect(dom.window.document.querySelector('[data-clicked="true"]')?.textContent).toBe('Search')
    expect(result).toMatchObject({
      success: true,
      retryCount: 0,
      searchUrl: expectedSearchUrl
    })
    expect(result.filings).toEqual([
      {
        filingNumber: 'CA-UCC-100',
        debtorName: 'Acme Equipment LLC',
        securedParty: 'First Bank',
        filingDate: '2026-06-01',
        collateral: '',
        status: 'active',
        filingType: 'UCC-1'
      },
      {
        filingNumber: 'CA-UCC3-101',
        debtorName: 'Acme Equipment LLC',
        securedParty: 'Term Lender',
        filingDate: '2026-06-08',
        collateral: '',
        status: 'terminated',
        filingType: 'UCC-3'
      }
    ])
    expect(result.parsingErrors).toEqual(['Filing 3 validation errors: Missing secured party'])
    expect(rawPage.close).toHaveBeenCalledTimes(1)
  })

  it('returns a portal-blocked failure when California anti-bot protection is detected', async () => {
    const { page, rawPage } = createPage(
      '<main>Request unsuccessful. Incapsula incident ID.</main>'
    )
    mockBrowser(page)
    const scraper = new CaliforniaScraper()
    const expectedSearchUrl =
      'https://bizfileonline.sos.ca.gov/search/ucc?searchType=debtor&' + 'searchCriteria=Acme%20LLC'

    await expect(scraper.search('Acme LLC')).resolves.toMatchObject({
      success: false,
      retryCount: 0,
      error: 'California UCC portal blocked by anti-bot protection (Incapsula/Imperva).',
      searchUrl: expectedSearchUrl
    })
    expect(rawPage.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed page open when diagnostics are requested', async () => {
    const { page, rawPage } = createPage('<main>Access denied by Incapsula.</main>')
    mockBrowser(page)
    const scraper = new CaliforniaScraper({ keepPageOpenOnFailure: true })

    const result = await scraper.search('Acme LLC')

    expect(result.success).toBe(false)
    expect(rawPage.close).not.toHaveBeenCalled()
  })

  it('captures screenshot and HTML diagnostics from the last page', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ca-scraper-'))
    const { page, rawPage } = createPage('<main><h1>California portal changed</h1></main>')
    const scraper = new CaliforniaScraper()
    ;(scraper as unknown as { lastPage: Page }).lastPage = page

    try {
      const result = await scraper.captureDiagnostics(tempDir, 'ca-failure')

      expect(result).toEqual({
        screenshotPath: join(tempDir, 'ca-failure.png'),
        htmlPath: join(tempDir, 'ca-failure.html')
      })
      expect(rawPage.screenshot).toHaveBeenCalledWith({
        path: join(tempDir, 'ca-failure.png'),
        fullPage: true
      })
      expect(existsSync(join(tempDir, 'ca-failure.png'))).toBe(true)
      expect(readFileSync(join(tempDir, 'ca-failure.html'), 'utf8')).toContain(
        'California portal changed'
      )
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects invalid company names before launching a browser', async () => {
    const scraper = new CaliforniaScraper()

    await expect(scraper.search('')).resolves.toMatchObject({
      success: false,
      error: 'Invalid company name'
    })
    expect(puppeteerMock.launch).not.toHaveBeenCalled()
  })

  it('builds encoded manual search URLs', () => {
    const expectedUrl =
      'https://bizfileonline.sos.ca.gov/search/ucc?searchType=debtor&' +
      'searchCriteria=A%26B%20Equipment%20LLC'

    expect(new CaliforniaScraper().getManualSearchUrl('A&B Equipment LLC')).toBe(expectedUrl)
  })
})
