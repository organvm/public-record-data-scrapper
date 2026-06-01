/**
 * Scraper Agent
 *
 * Manages UCC filing scraping from state Secretary of State portals
 */

import { BaseAgent } from '../BaseAgent'
import {
  AgentAnalysis,
  SystemContext,
  AgentTask,
  AgentTaskResult,
  Finding,
  ImprovementSuggestion
} from '../types'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - scripts directory not in tsconfig include; import resolved by bundler
import { CaliforniaScraper } from '../../../../scripts/scrapers/states/california'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - scripts directory not in tsconfig include; import resolved by bundler
import { TexasScraper } from '../../../../scripts/scrapers/states/texas'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - scripts directory not in tsconfig include; import resolved by bundler
import { FloridaScraper } from '../../../../scripts/scrapers/states/florida'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - scripts directory not in tsconfig include; import resolved by bundler
import { NewYorkScraper } from '../../../../scripts/scrapers/states/newyork'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - scripts directory not in tsconfig include; import resolved by bundler
import { BaseScraper } from '../../../../scripts/scrapers/base-scraper'

export class ScraperAgent extends BaseAgent {
  private scrapers: Map<string, BaseScraper> = new Map()

  constructor() {
    super('scraper', 'Scraper Agent', [
      'UCC filing scraping',
      'Multi-state support',
      'Rate limiting',
      'Anti-detection measures',
      'CAPTCHA handling',
      'Pagination support'
    ])

    this.initializeScrapers()
  }

  private initializeScrapers(): void {
    this.scrapers.set('CA', new CaliforniaScraper())
    this.scrapers.set('TX', new TexasScraper())
    this.scrapers.set('FL', new FloridaScraper())
    this.scrapers.set('NY', new NewYorkScraper())
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    void context
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    const states = ['CA', 'TX', 'FL', 'NY']
    const unavailable = states.filter((state) => !this.scrapers.has(state))

    if (unavailable.length > 0) {
      findings.push(
        this.createFinding(
          'data-quality',
          'warning',
          `Scrapers not available for ${unavailable.length} states`,
          { unavailableStates: unavailable }
        )
      )
    }

    return this.createAnalysis(findings, improvements)
  }

  async executeTask(task: AgentTask): Promise<AgentTaskResult> {
    const { type, payload } = task
    const data = payload as { companyName?: string; state?: string }

    try {
      switch (type) {
        case 'scrape-ucc':
          if (!data.companyName || !data.state) {
            return {
              success: false,
              error: 'Missing companyName or state',
              timestamp: new Date().toISOString()
            }
          }
          return await this.scrapeUCC(data.companyName, data.state)
        case 'get-manual-url':
          if (!data.companyName || !data.state) {
            return {
              success: false,
              error: 'Missing companyName or state',
              timestamp: new Date().toISOString()
            }
          }
          return this.getManualSearchUrl(data.companyName, data.state)
        case 'check-scraper-status':
          if (!data.state) {
            return {
              success: false,
              error: 'Missing state',
              timestamp: new Date().toISOString()
            }
          }
          return this.checkScraperStatus(data.state)
        case 'list-available-states':
          return this.listAvailableStates()
        default:
          return {
            success: false,
            error: `Unknown task type: ${type}`,
            timestamp: new Date().toISOString()
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    }
  }

  private async scrapeUCC(companyName: string, state: string): Promise<AgentTaskResult> {
    const scraper = this.scrapers.get(state.toUpperCase())

    if (!scraper) {
      return {
        success: false,
        error: `No scraper available for state: ${state}`,
        data: {
          availableStates: Array.from(this.scrapers.keys())
        },
        timestamp: new Date().toISOString()
      }
    }

    const result = await scraper.search(companyName)

    return {
      success: result.success,
      data: {
        state,
        companyName,
        filings: result.filings || [],
        filingCount: result.filings?.length || 0,
        searchUrl: result.searchUrl,
        retryCount: result.retryCount,
        parsingErrors: result.parsingErrors
      },
      error: result.error,
      timestamp: new Date().toISOString()
    }
  }

  private getManualSearchUrl(companyName: string, state: string): AgentTaskResult {
    const scraper = this.scrapers.get(state.toUpperCase())

    if (!scraper) {
      return {
        success: false,
        error: `No scraper available for state: ${state}`,
        timestamp: new Date().toISOString()
      }
    }

    const url = scraper.getManualSearchUrl(companyName)

    return {
      success: true,
      data: {
        state,
        companyName,
        manualSearchUrl: url
      },
      timestamp: new Date().toISOString()
    }
  }

  private checkScraperStatus(state: string): AgentTaskResult {
    const available = this.scrapers.has(state.toUpperCase())

    return {
      success: true,
      data: {
        state: state.toUpperCase(),
        available,
        message: available
          ? `Scraper available for ${state}`
          : `Scraper not yet implemented for ${state}`
      },
      timestamp: new Date().toISOString()
    }
  }

  private listAvailableStates(): AgentTaskResult {
    const states = Array.from(this.scrapers.keys())

    return {
      success: true,
      data: {
        states,
        count: states.length,
        supported: states.map((state) => ({
          code: state,
          scraper: this.scrapers.get(state)?.getState()
        }))
      },
      timestamp: new Date().toISOString()
    }
  }

  addScraper(state: string, scraper: BaseScraper): void {
    this.scrapers.set(state.toUpperCase(), scraper)
  }

  isStateSupported(state: string): boolean {
    return this.scrapers.has(state.toUpperCase())
  }
}
