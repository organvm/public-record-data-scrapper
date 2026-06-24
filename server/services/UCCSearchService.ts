/**
 * UCC Filing Search Service
 *
 * Provides on-demand search for UCC filings by company name and state.
 * Wraps state-specific collectors and handles fallback logic.
 *
 * @module server/services/UCCSearchService
 */

import type { UCCFiling } from '@public-records/core'
import { StateCollectorFactory } from '../../apps/web/src/lib/collectors/StateCollectorFactory'

export interface UCCSearchRequest {
  companyName: string
  state: string
  limit?: number
}

export interface UCCSearchResponse {
  filings: UCCFiling[]
  total: number
  state: string
  companyName: string
  timestamp: string
}

export interface UCCStateReadiness {
  state: string
  canSearch: boolean
  reason: string
}

export class UCCSearchService {
  private factory: StateCollectorFactory

  constructor() {
    this.factory = new StateCollectorFactory({
      cacheCollectors: true,
      lazyLoad: true,
      enableFallback: true
    })
  }

  async search(req: UCCSearchRequest): Promise<UCCSearchResponse> {
    const normalizedState = req.state.toUpperCase()
    const readiness = this.getStateReadiness(normalizedState)

    if (!readiness.canSearch) {
      throw new Error(readiness.reason)
    }

    const collector = this.factory.getCollector(normalizedState)

    if (!collector) {
      throw new Error(`No UCC data available for state: ${normalizedState}`)
    }

    const result = await collector.searchByBusinessName(req.companyName)

    return {
      filings: result.filings.slice(0, req.limit || 100),
      total: result.total,
      state: normalizedState,
      companyName: req.companyName,
      timestamp: new Date().toISOString()
    }
  }

  getStateReadiness(state: string): UCCStateReadiness {
    const normalizedState = state.toUpperCase()
    const collector = this.factory.getCollector(normalizedState)

    if (!collector) {
      return {
        state: normalizedState,
        canSearch: false,
        reason: `No UCC data available for state: ${normalizedState}`
      }
    }

    return {
      state: normalizedState,
      canSearch: true,
      reason: `Collector ready for state: ${normalizedState}`
    }
  }
}
