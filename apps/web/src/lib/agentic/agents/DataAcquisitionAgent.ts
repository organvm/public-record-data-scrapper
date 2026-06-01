/**
 * Data Acquisition Agent
 *
 * Manages data source integration and routing based on subscription tiers
 */

import { BaseAgent } from '../BaseAgent'
import {
  AgentAnalysis,
  SystemContext,
  AgentTask,
  AgentTaskResult,
  EnrichmentRequest,
  Finding,
  ImprovementSuggestion,
  SubscriptionTier
} from '../types'
import { usageTracker } from '../../subscription/usage-tracker'
import {
  SECEdgarSource,
  OSHASource,
  USPTOSource,
  CensusSource,
  SAMGovSource
} from '../../data-sources/free-tier'
import { DnBSource, GooglePlacesSource, ClearbitSource } from '../../data-sources/starter-tier'
import { BaseDataSource } from '../../data-sources/base-source'

export class DataAcquisitionAgent extends BaseAgent {
  private sources: Map<string, BaseDataSource> = new Map()

  constructor() {
    super('data-acquisition', 'Data Acquisition Agent', [
      'Multi-source data fetching',
      'Tier-based access control',
      'API authentication management',
      'Retry logic and error handling',
      'Response normalization'
    ])

    this.initializeSources()
  }

  private initializeSources(): void {
    // Free tier sources
    this.sources.set('sec-edgar', new SECEdgarSource())
    this.sources.set('osha', new OSHASource())
    this.sources.set('uspto', new USPTOSource())
    this.sources.set('census', new CensusSource())
    this.sources.set('sam-gov', new SAMGovSource())

    // Starter tier sources
    this.sources.set('dnb', new DnBSource())
    this.sources.set('google-places', new GooglePlacesSource())
    this.sources.set('clearbit', new ClearbitSource())
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Check data source availability
    const unavailableSources = this.checkSourceAvailability()
    if (unavailableSources.length > 0) {
      findings.push(
        this.createFinding(
          'data-quality',
          'warning',
          `${unavailableSources.length} data sources are unavailable or misconfigured`,
          { unavailableSources }
        )
      )
    }

    // Analyze data freshness
    const staleSources = this.checkDataFreshness(context)
    if (staleSources.length > 0) {
      findings.push(
        this.createFinding(
          'data-quality',
          'info',
          `${staleSources.length} data sources have stale data`,
          { staleSources }
        )
      )
    }

    return this.createAnalysis(findings, improvements)
  }

  /**
   * Execute a data acquisition task
   */
  async executeTask(task: AgentTask): Promise<AgentTaskResult> {
    const { type, payload } = task
    const sourcePayload = payload as { source?: string; query?: Record<string, unknown> }

    try {
      switch (type) {
        case 'fetch-data':
          return await this.fetchData(payload as unknown as EnrichmentRequest)
        case 'fetch-from-source':
          return await this.fetchFromSource(sourcePayload.source, sourcePayload.query)
        case 'check-source-status':
          return this.checkSourceStatus(sourcePayload.source ?? '')
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

  /**
   * Fetch data from all available sources for a company
   */
  private async fetchData(request: EnrichmentRequest): Promise<AgentTaskResult> {
    const { companyName, state, tier, userId } = request
    const results: Record<string, unknown> = {}
    const errors: string[] = []
    let totalCost = 0

    // Get available sources for tier
    const availableSources = this.getAvailableSourcesForTier(tier)

    // Fetch from each source in parallel
    const fetchPromises = availableSources.map(async (sourceName) => {
      try {
        const source = this.sources.get(sourceName)
        if (!source) {
          return
        }

        const query = { companyName, state }
        const response = await source.fetchData(query)

        if (response.success) {
          results[sourceName] = response.data
          totalCost += source.getConfig().cost

          // Track usage
          if (userId) {
            usageTracker.trackUsage({
              userId,
              action: 'data-fetch',
              source: sourceName,
              cost: source.getConfig().cost,
              timestamp: new Date().toISOString(),
              success: true,
              metadata: { companyName, state }
            })
          }
        } else {
          errors.push(`${sourceName}: ${response.error}`)
        }
      } catch (error) {
        errors.push(`${sourceName}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })

    await Promise.all(fetchPromises)

    return {
      success: Object.keys(results).length > 0,
      data: {
        companyName,
        state,
        tier,
        results,
        sources: Object.keys(results),
        totalCost
      },
      error: errors.length > 0 ? errors.join('; ') : undefined,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Fetch from a specific source
   */
  private async fetchFromSource(
    sourceName?: string,
    query?: Record<string, unknown>
  ): Promise<AgentTaskResult> {
    if (!sourceName) {
      return {
        success: false,
        error: 'Source name is required',
        timestamp: new Date().toISOString()
      }
    }
    const source = this.sources.get(sourceName)

    if (!source) {
      return {
        success: false,
        error: `Source not found: ${sourceName}`,
        timestamp: new Date().toISOString()
      }
    }

    const response = await source.fetchData(query || {})

    return {
      success: response.success,
      data: response.data,
      error: response.error,
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Check if a source is available
   */
  private checkSourceStatus(sourceName: string): AgentTaskResult {
    const source = this.sources.get(sourceName)

    if (!source) {
      return {
        success: false,
        error: `Source not found: ${sourceName}`,
        timestamp: new Date().toISOString()
      }
    }

    const config = source.getConfig()

    return {
      success: true,
      data: {
        name: config.name,
        tier: config.tier,
        cost: config.cost,
        available: true
      },
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Get available sources for a tier
   */
  private getAvailableSourcesForTier(tier: SubscriptionTier): string[] {
    const sources: string[] = []

    this.sources.forEach((source, name) => {
      if (source.isAvailableForTier(tier)) {
        sources.push(name)
      }
    })

    return sources
  }

  /**
   * Check source availability
   */
  private checkSourceAvailability(): string[] {
    const unavailable: string[] = []

    // Check if API keys are configured for commercial sources
    if (!process.env.DNB_API_KEY) unavailable.push('dnb')
    if (!process.env.GOOGLE_PLACES_API_KEY) unavailable.push('google-places')
    if (!process.env.CLEARBIT_API_KEY) unavailable.push('clearbit')

    return unavailable
  }

  /**
   * Check data freshness
   */
  private checkDataFreshness(context: SystemContext): string[] {
    void context
    // TODO: Inspect persisted collector telemetry instead of returning an empty result.
    return []
  }
}
