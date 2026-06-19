import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import type { Page } from 'puppeteer'
import { PaginationHandler, type PaginationResult } from './pagination-handler'

type PageDouble = {
  evaluate: ReturnType<typeof vi.fn>
  waitForNavigation: ReturnType<typeof vi.fn>
  goto: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
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
    HTMLButtonElement: { configurable: true, writable: true, value: dom.window.HTMLButtonElement },
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

function createPage(html: string, url = 'https://portal.example.test/search') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url,
    pretendToBeVisual: true
  })

  const nativeClick = dom.window.HTMLElement.prototype.click
  dom.window.HTMLElement.prototype.click = function click(this: HTMLElement) {
    this.setAttribute('data-clicked', 'true')
    nativeClick.call(this)
  }

  const rawPage: PageDouble = {
    evaluate: vi.fn(
      async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        runInDom(dom, () => fn(...args))
    ),
    waitForNavigation: vi.fn(async () => undefined),
    goto: vi.fn(async (nextUrl: string) => {
      dom.reconfigure({ url: nextUrl })
    }),
    url: vi.fn(() => dom.window.location.href)
  }

  return {
    dom,
    rawPage,
    page: rawPage as unknown as Page
  }
}

function pagination(overrides: Partial<PaginationResult>): PaginationResult {
  return {
    currentPage: 1,
    hasNextPage: true,
    paginationType: 'none',
    ...overrides
  }
}

describe('PaginationHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects numbered pagination with current and total pages', async () => {
    const { page } = createPage(`
      <nav class="pagination">
        <a href="?page=1">1</a>
        <a class="active" href="?page=2">2</a>
        <a href="?page=3">3</a>
      </nav>
    `)

    await expect(new PaginationHandler().detectPagination(page)).resolves.toEqual({
      currentPage: 2,
      totalPages: 3,
      hasNextPage: true,
      paginationType: 'numbered'
    })
  })

  it('detects disabled next and enabled load-more controls', async () => {
    const nextPage = createPage('<button class="next" disabled>Next</button>').page
    await expect(new PaginationHandler().detectPagination(nextPage)).resolves.toMatchObject({
      hasNextPage: false,
      paginationType: 'next-prev'
    })

    const loadMorePage = createPage('<button class="load-more">Load more</button>').page
    await expect(new PaginationHandler().detectPagination(loadMorePage)).resolves.toMatchObject({
      hasNextPage: true,
      paginationType: 'load-more'
    })
  })

  it('falls back to URL parameter pagination and no-pagination states', async () => {
    const urlPage = createPage('<main>Results</main>', 'https://portal.example.test/search?page=4')
      .page
    await expect(new PaginationHandler().detectPagination(urlPage)).resolves.toEqual({
      currentPage: 4,
      hasNextPage: true,
      paginationType: 'url-param'
    })

    const plainPage = createPage('<main>Only one page</main>').page
    await expect(new PaginationHandler().detectPagination(plainPage)).resolves.toEqual({
      currentPage: 1,
      hasNextPage: false,
      paginationType: 'none'
    })
  })

  it('returns a single-page result when DOM evaluation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const page = {
      evaluate: vi.fn(async () => {
        throw new Error('DOM unavailable')
      })
    } as unknown as Page

    await expect(new PaginationHandler().detectPagination(page)).resolves.toEqual({
      currentPage: 1,
      hasNextPage: false,
      paginationType: 'none'
    })
    expect(warn).toHaveBeenCalledWith(
      'Pagination detection failed, falling back to single-page results.',
      expect.any(Error)
    )
  })

  it('clicks numbered pagination and waits for navigation', async () => {
    const handler = new PaginationHandler({ waitBetweenPages: 25 })
    vi.spyOn(handler as unknown as { sleep(ms: number): Promise<void> }, 'sleep').mockResolvedValue(
      undefined
    )

    const { dom, page, rawPage } = createPage(`
      <nav class="pagination">
        <a href="?page=1">1</a>
        <a href="?page=2">2</a>
      </nav>
    `)

    await expect(
      handler.goToNextPage(
        page,
        pagination({
          currentPage: 1,
          totalPages: 2,
          paginationType: 'numbered'
        })
      )
    ).resolves.toBe(true)

    expect(dom.window.document.querySelector('[data-clicked="true"]')?.textContent).toBe('2')
    expect(rawPage.waitForNavigation).toHaveBeenCalledWith({
      waitUntil: 'networkidle2',
      timeout: 15000
    })
  })

  it('advances URL parameter pagination using the current page number', async () => {
    const handler = new PaginationHandler({ waitBetweenPages: 25 })
    vi.spyOn(handler as unknown as { sleep(ms: number): Promise<void> }, 'sleep').mockResolvedValue(
      undefined
    )
    const { page, rawPage } = createPage(
      '<main>Results</main>',
      'https://portal.example.test/search?q=acme&pageNum=4'
    )

    await expect(
      handler.goToNextPage(
        page,
        pagination({
          currentPage: 4,
          paginationType: 'url-param'
        })
      )
    ).resolves.toBe(true)

    expect(rawPage.goto).toHaveBeenCalledWith(
      'https://portal.example.test/search?q=acme&pageNum=5',
      { waitUntil: 'networkidle2' }
    )
  })

  it('stops pagination at configured page, terminal page, or no next page', () => {
    const handler = new PaginationHandler({ maxPages: 3 })

    expect(
      handler.shouldContinue(
        2,
        pagination({
          currentPage: 2,
          totalPages: 3,
          paginationType: 'numbered'
        })
      )
    ).toBe(true)
    expect(
      handler.shouldContinue(
        3,
        pagination({
          currentPage: 3,
          totalPages: 5,
          paginationType: 'numbered'
        })
      )
    ).toBe(false)
    expect(
      handler.shouldContinue(
        2,
        pagination({
          currentPage: 2,
          totalPages: 2,
          paginationType: 'numbered'
        })
      )
    ).toBe(false)
    expect(
      handler.shouldContinue(
        1,
        pagination({
          hasNextPage: false,
          paginationType: 'none'
        })
      )
    ).toBe(false)
  })
})
