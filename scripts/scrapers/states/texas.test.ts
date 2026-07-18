import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'fs'
import { JSDOM } from 'jsdom'
import type { Browser, Frame, Page } from 'puppeteer'
import { TexasScraper } from './texas'
import * as authConfig from '../auth-config'

const puppeteerMock = vi.hoisted(() => ({
  launch: vi.fn()
}))

vi.mock('puppeteer', () => ({
  default: {
    launch: puppeteerMock.launch
  }
}))

vi.mock('../auth-config', () => ({
  hasTexasAuth: vi.fn(),
  getTexasCredentials: vi.fn()
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
    type: ReturnType<typeof vi.fn>
  }
  page: Page
}

type BrowserDouble = {
  newPage: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  browser: Browser
}

const originalEnv = process.env
const globalKeys = [
  'window',
  'document',
  'HTMLElement',
  'HTMLButtonElement',
  'Event',
  'Node',
  'URL'
] as const
type GlobalKey = (typeof globalKeys)[number]
function restoreEnv() {
  process.env = { ...originalEnv }
}

async function runInDom<T>(dom: JSDOM, callback: () => T | Promise<T>): Promise<T> {
  const globalRecord = globalThis as unknown as Record<string, unknown>
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
    return await callback()
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

function createPage(html: string, url = 'https://direct.sos.state.tx.us/'): PageDouble {
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

    // Simulate removing login form on submit to mock successful login
    if (this.getAttribute('type') === 'submit' && this.getAttribute('name') === 'submit') {
      const form = dom.window.document.getElementById('login')
      if (form) {
        form.remove()
      }
    }

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
    content: vi.fn(async () => dom.serialize()),
    type: vi.fn(async () => undefined)
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

describe('TexasScraper', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    puppeteerMock.launch.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(TexasScraper.prototype as unknown as Sleepable, 'sleep').mockResolvedValue(undefined)

    vi.mocked(authConfig.hasTexasAuth).mockReturnValue(true)
    vi.mocked(authConfig.getTexasCredentials).mockReturnValue({
      username: 'testuser',
      password: 'testpassword'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv()
  })

  it('rejects invalid company names before launching a browser', async () => {
    const scraper = new TexasScraper()

    await expect(scraper.search('')).resolves.toMatchObject({
      success: false,
      error: 'Invalid company name'
    })
    expect(puppeteerMock.launch).not.toHaveBeenCalled()
  })

  it('returns an error when authentication is not configured', async () => {
    vi.mocked(authConfig.hasTexasAuth).mockReturnValue(false)
    const { page } = createPage('')
    mockBrowser(page)
    const scraper = new TexasScraper()

    const result = await scraper.search('Acme LLC')

    expect(result.success).toBe(false)
    expect(result.error).toContain('Texas authentication credentials not configured')
  })

  it('successfully authenticates, searches, and parses results', async () => {
    const { page } = createPage(`
      <form id="login">
        <input name="client_id" />
        <input name="web_password" />
        <input type="submit" name="submit" value="Login" />
      </form>
      
      <form id="search">
        <input name="debtorName" />
        <input type="submit" value="Search" />
      </form>
      
      <table class="results">
        <tr>
          <th>Filing Number</th>
          <th>Filing Date</th>
          <th>Debtor Name</th>
          <th>Secured Party</th>
          <th>Status</th>
        </tr>
        <tr>
          <td>TX-12345</td>
          <td>2024-01-01</td>
          <td>Acme Corp</td>
          <td>Bank of Texas</td>
          <td>Active</td>
        </tr>
        <tr>
          <td>TX-UCC3-678</td>
          <td>2024-02-01</td>
          <td>Acme Corp</td>
          <td>Capital LLC</td>
          <td>Terminated</td>
        </tr>
      </table>
    `)
    mockBrowser(page)
    const scraper = new TexasScraper()

    const result = await scraper.search('Acme Corp')

    expect(result.success).toBe(true)
    expect(result.filings).toBeDefined()
    expect(result.filings?.length).toBe(2)
    expect(result.filings?.[0]).toMatchObject({
      filingNumber: 'TX-12345',
      debtorName: 'Acme Corp',
      securedParty: 'Bank of Texas',
      filingDate: '2024-01-01',
      status: 'active',
      filingType: 'UCC-1'
    })
    expect(result.filings?.[1]).toMatchObject({
      filingNumber: 'TX-UCC3-678',
      debtorName: 'Acme Corp',
      securedParty: 'Capital LLC',
      filingDate: '2024-02-01',
      status: 'terminated',
      filingType: 'UCC-3'
    })
  })

  it('detects CAPTCHA and returns an error', async () => {
    const { page } = createPage(`
      <form id="login">
        <input name="client_id" />
        <input name="web_password" />
        <input type="submit" name="submit" value="Login" />
      </form>
      <form id="search">
        <input name="debtorName" />
        <input type="submit" value="Search" />
      </form>
      <div>Please solve this CAPTCHA</div>
      <iframe src="recaptcha/api2/anchor"></iframe>
    `)
    mockBrowser(page)
    const scraper = new TexasScraper()

    const result = await scraper.search('Acme Corp')

    expect(result.success).toBe(false)
    expect(result.error).toContain('CAPTCHA detected')
  })

  it('keeps page open on failure when keepPageOpenOnFailure is true', async () => {
    const { page, rawPage } = createPage(`
      <form id="login">
        <input name="client_id" />
        <input name="web_password" />
        <input type="submit" name="submit" value="Login" />
      </form>
      <form id="search">
        <input name="debtorName" />
        <input type="submit" value="Search" />
      </form>
      <div>Please solve this CAPTCHA</div>
      <iframe src="recaptcha/api2/anchor"></iframe>
    `)
    mockBrowser(page)
    const scraper = new TexasScraper({ keepPageOpenOnFailure: true })

    await scraper.search('Acme Corp')

    expect(rawPage.close).not.toHaveBeenCalled()
  })

  it('builds manual search URL correctly', () => {
    const scraper = new TexasScraper()
    const url = scraper.getManualSearchUrl('Test Company LLC')
    expect(url).toBe('https://direct.sos.state.tx.us/home/home-ucc.asp#search=Test%20Company%20LLC')
  })
})
