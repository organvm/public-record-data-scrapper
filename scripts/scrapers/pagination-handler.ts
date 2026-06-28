/**
 * Pagination Handler for UCC Scrapers
 *
 * Provides common pagination detection and navigation logic for state UCC portals.
 * Handles various pagination patterns:
 * - Numbered page links (1, 2, 3, ...)
 * - Next/Previous buttons
 * - "Load More" buttons
 * - Infinite scroll
 * - URL parameter-based pagination
 */

import { Page } from 'puppeteer'

export interface PaginationConfig {
  maxPages?: number // Maximum pages to scrape (default: 10)
  resultsPerPage?: number // Expected results per page (for validation)
  waitBetweenPages?: number // Milliseconds to wait between page navigations (default: 2000)
  detectInfiniteScroll?: boolean // Try to detect infinite scroll patterns
}

export interface PaginationResult {
  currentPage: number
  totalPages?: number // If portal displays total pages
  hasNextPage: boolean
  nextPageUrl?: string
  paginationType: 'numbered' | 'next-prev' | 'load-more' | 'infinite-scroll' | 'url-param' | 'none'
}

export class PaginationHandler {
  private config: Required<PaginationConfig>

  constructor(config: PaginationConfig = {}) {
    this.config = {
      maxPages: config.maxPages || 10,
      resultsPerPage: config.resultsPerPage || 25,
      waitBetweenPages: config.waitBetweenPages || 2000,
      detectInfiniteScroll: config.detectInfiniteScroll ?? false
    }
  }

  /**
   * Detect pagination on current page
   */
  async detectPagination(page: Page): Promise<PaginationResult> {
    try {
      const result = await page.evaluate(() => {
        const findButton = (selector: string, labels: string[]) => {
          const directButton = document.querySelector(selector)
          if (directButton) return directButton

          const elements = document.querySelectorAll('a, button')
          for (let i = 0; i < elements.length; i++) {
            const element = elements[i]
            const text = element.textContent?.trim().toLowerCase() || ''
            
            for (let j = 0; j < labels.length; j++) {
              const label = labels[j]
              if (text === label) return element
              
              const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
              const title = element.getAttribute('title')?.toLowerCase() || ''
              if (ariaLabel.includes(label) || title.includes(label)) return element
            }
          }
          return null
        }

        // Check for numbered pagination
        const numberedLinks = document.querySelectorAll(
          'a[class*="page"], a[class*="pagination"], ' +
            '.pagination a, .pager a, ' +
            'a[href*="page="], a[href*="pageNumber="], a[href*="pageNum="]'
        )

        if (numberedLinks.length > 0) {
          // Try to extract current page and total pages
          let currentPage = 1
          let totalPages: number | undefined

          numberedLinks.forEach((link) => {
            const text = link.textContent?.trim() || ''
            // Check if this link is active/current
            if (
              link.classList.contains('active') ||
              link.classList.contains('current') ||
              link.getAttribute('aria-current') === 'page'
            ) {
              const pageNum = parseInt(text)
              if (!isNaN(pageNum)) {
                currentPage = pageNum
              }
            }

            // Try to find total pages
            const pageMatch = text.match(/\d+/)
            if (pageMatch) {
              const num = parseInt(pageMatch[0])
              if (!totalPages || num > totalPages) {
                totalPages = num
              }
            }
          })

          return {
            currentPage,
            totalPages,
            hasNextPage: currentPage < (totalPages || Infinity),
            paginationType: 'numbered' as const
          }
        }

        // Check for Next/Previous buttons
        const nextLabels = ['next', '›', '→', '»']
        const nextButton = findButton('.next, .next-page, [aria-label*="next" i]', nextLabels)

        if (nextButton) {
          return {
            currentPage: 1,
            hasNextPage: !!nextButton && !nextButton.hasAttribute('disabled'),
            paginationType: 'next-prev' as const
          }
        }

        // Check for "Load More" button
        const loadMoreLabels = ['load more', 'show more']
        const loadMoreButton = findButton('.load-more, .show-more', loadMoreLabels)

        if (loadMoreButton) {
          return {
            currentPage: 1,
            hasNextPage: !!loadMoreButton && !loadMoreButton.hasAttribute('disabled'),
            paginationType: 'load-more' as const
          }
        }

        // Check URL for pagination parameters
        const url = new URL(window.location.href)
        const pageParam =
          url.searchParams.get('page') ||
          url.searchParams.get('pageNum') ||
          url.searchParams.get('pageNumber')

        if (pageParam) {
          return {
            currentPage: parseInt(pageParam) || 1,
            hasNextPage: true, // Assume more pages exist
            paginationType: 'url-param' as const
          }
        }

        // No pagination detected
        return {
          currentPage: 1,
          hasNextPage: false,
          paginationType: 'none' as const
        }
      })

      return result
    } catch (error) {
      console.warn('Pagination detection failed, falling back to single-page results.', error)
      return {
        currentPage: 1,
        hasNextPage: false,
        paginationType: 'none'
      }
    }
  }

  /**
   * Navigate to next page
   */

  /**
   * Helper to find and click a button based on selector and labels
   */
  private async findAndClickButton(page: Page, selector: string, labels: string[]): Promise<boolean> {
    return await page.evaluate((sel, labs) => {
      const directSelector = document.querySelector(sel) as HTMLElement | null
      const directVisible =
        !!directSelector &&
        (directSelector.offsetWidth ||
          directSelector.offsetHeight ||
          directSelector.getClientRects().length)
      if (directSelector && !directSelector.hasAttribute('disabled') && directVisible) {
        directSelector.click()
        return true
      }

      const candidates = Array.from(document.querySelectorAll('a, button')) as HTMLElement[]
      let targetButton: HTMLElement | null = null

      for (let i = 0; i < candidates.length; i++) {
        const element = candidates[i]
        const text = element.textContent?.trim().toLowerCase() || ''
        
        for (let j = 0; j < labs.length; j++) {
          const label = labs[j]
          if (text === label) {
            targetButton = element
            break
          }

          const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || ''
          const title = element.getAttribute('title')?.toLowerCase() || ''
          if (ariaLabel.includes(label) || title.includes(label)) {
            targetButton = element
            break
          }
        }

        if (targetButton) {
          break
        }
      }

      const targetVisible =
        !!targetButton &&
        (targetButton.offsetWidth || targetButton.offsetHeight || targetButton.getClientRects().length)
      if (targetButton && !targetButton.hasAttribute('disabled') && targetVisible) {
        targetButton.click()
        return true
      }
      return false
    }, selector, labels)
  }

  async goToNextPage(page: Page, pagination: PaginationResult): Promise<boolean> {
    if (!pagination.hasNextPage) {
      return false
    }

    try {
      switch (pagination.paginationType) {
        case 'numbered':
          return await this.handleNumberedPagination(page, pagination)

        case 'next-prev':
          return await this.handleNextPrevPagination(page)

        case 'load-more':
          return await this.handleLoadMorePagination(page)

        case 'url-param':
          return await this.handleUrlParamPagination(page, pagination)

        case 'infinite-scroll':
          return await this.handleInfiniteScroll(page)

        default:
          return false
      }
    } catch (error) {
      console.error('Error navigating to next page:', error)
      return false
    }
  }

  /**
   * Handle numbered pagination (1, 2, 3, ...)
   */
  private async handleNumberedPagination(
    page: Page,
    pagination: PaginationResult
  ): Promise<boolean> {
    const nextPage = pagination.currentPage + 1

    // Try to click the next page number
    const clicked = await page.evaluate((pageNum) => {
      const links = Array.from(
        document.querySelectorAll('a[class*="page"], .pagination a, .pager a')
      )
      const nextLink = links.find((link) => {
        const text = link.textContent?.trim() || ''
        return text === String(pageNum)
      })

      if (nextLink) {
        ;(nextLink as HTMLElement).click()
        return true
      }
      return false
    }, nextPage)

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      await this.sleep(this.config.waitBetweenPages)
      return true
    }

    return false
  }

  /**
   * Handle Next/Previous button pagination
   */
  private async handleNextPrevPagination(page: Page): Promise<boolean> {
    const clicked = await this.findAndClickButton(
      page,
      '.next, .next-page, [aria-label*="next" i]',
      ['next', '›', '→', '»']
    )

    if (clicked) {
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      await this.sleep(this.config.waitBetweenPages)
      return true
    }

    return false
  }

  /**
   * Handle "Load More" button pagination
   */
  private async handleLoadMorePagination(page: Page): Promise<boolean> {
    const clicked = await this.findAndClickButton(
      page,
      '.load-more, .show-more',
      ['load more', 'show more']
    )

    if (clicked) {
      await this.sleep(this.config.waitBetweenPages)
      return true
    }

    return false
  }

  /**
   * Handle URL parameter-based pagination
   */
  private async handleUrlParamPagination(
    page: Page,
    pagination: PaginationResult
  ): Promise<boolean> {
    const currentUrl = new URL(page.url())
    const nextPage = pagination.currentPage + 1

    // Try different parameter names
    const paramNames = ['page', 'pageNum', 'pageNumber', 'p']

    for (const paramName of paramNames) {
      if (currentUrl.searchParams.has(paramName)) {
        currentUrl.searchParams.set(paramName, String(nextPage))
        await page.goto(currentUrl.toString(), { waitUntil: 'networkidle2' })
        await this.sleep(this.config.waitBetweenPages)
        return true
      }
    }

    // If no param found, add default "page" param
    currentUrl.searchParams.set('page', String(nextPage))
    await page.goto(currentUrl.toString(), { waitUntil: 'networkidle2' })
    await this.sleep(this.config.waitBetweenPages)
    return true
  }

  /**
   * Handle infinite scroll pagination
   */
  private async handleInfiniteScroll(page: Page): Promise<boolean> {
    // Scroll to bottom of page
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })

    // Wait for new content to load
    await this.sleep(this.config.waitBetweenPages)

    // Check if new content appeared
    const hasNewContent = await page.evaluate(() => {
      // This is a simple heuristic - may need adjustment per site
      return document.body.scrollHeight > window.innerHeight + window.scrollY
    })

    return hasNewContent
  }

  /**
   * Check if we should continue paginating
   */
  shouldContinue(currentPage: number, pagination: PaginationResult): boolean {
    if (currentPage >= this.config.maxPages) {
      return false
    }

    if (!pagination.hasNextPage) {
      return false
    }

    if (pagination.totalPages && currentPage >= pagination.totalPages) {
      return false
    }

    return true
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
