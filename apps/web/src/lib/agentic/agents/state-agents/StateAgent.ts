/**
 * State Agent - Specialized agent for state-specific UCC filing data collection and analysis
 *
 * Each state has unique:
 * - Filing requirements and formats
 * - Portal structures and APIs
 * - Business regulations and laws
 * - Data refresh schedules
 * - Rate limits and access policies
 */

import { BaseAgent } from '../../BaseAgent'
import type {
  Agent,
  AgentAnalysis,
  SystemContext,
  ImprovementSuggestion,
  Finding
} from '../../types'
import {
  getCollectorForState,
  hasCollectorForState
} from '../../../collectors/StateCollectorFactory'
import type { StateCollector, UCCFiling } from '../../../collectors/types'

export interface StateConfig {
  stateCode: string
  stateName: string
  portalUrl: string
  apiEndpoint?: string
  requiresAuth: boolean
  rateLimit: {
    requestsPerMinute: number
    requestsPerHour: number
    requestsPerDay: number
  }
  businessHours?: {
    timezone: string
    start: string
    end: string
  }
  specialRequirements?: string[]
  dataFormat: 'json' | 'xml' | 'csv' | 'html'
  updateFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly'
}

export interface StateMetrics {
  totalFilings: number
  recentFilings: number
  activeFilings: number
  averageProcessingTime: number
  successRate: number
  lastUpdate: string
  errors: number
}

export class StateAgent extends BaseAgent implements Agent {
  private stateConfig: StateConfig
  private metrics: StateMetrics
  private customId: string
  private collector?: StateCollector

  constructor(config: StateConfig) {
    const customId = `state-agent-${config.stateCode.toLowerCase()}`
    const agentName = `${config.stateName} State Agent`
    const capabilities = [
      `Collect UCC filings from ${config.stateName}`,
      `Parse ${config.dataFormat.toUpperCase()} format data`,
      `Respect ${config.rateLimit.requestsPerMinute} req/min rate limit`,
      `Monitor ${config.updateFrequency} updates`,
      'Detect data quality issues',
      'Track state-specific trends'
    ]

    super('state-collector', agentName, capabilities)
    this.customId = customId

    this.stateConfig = config
    this.collector = getCollectorForState(config.stateCode)

    this.metrics = {
      totalFilings: 0,
      recentFilings: 0,
      activeFilings: 0,
      averageProcessingTime: 0,
      successRate: 100,
      lastUpdate: new Date().toISOString(),
      errors: 0
    }
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Check if state data is stale
    const lastUpdate = new Date(this.metrics.lastUpdate)
    const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60)

    if (hoursSinceUpdate > 24) {
      findings.push({
        id: `${this.customId}-stale-data`,
        category: 'data-quality',
        severity: 'warning',
        description: `${this.stateConfig.stateName} data is ${Math.floor(hoursSinceUpdate)} hours old`,
        evidence: { lastUpdate: this.metrics.lastUpdate, hoursSinceUpdate }
      })

      improvements.push({
        id: `${this.customId}-refresh-data`,
        category: 'data-quality',
        priority: 'high',
        title: `Refresh ${this.stateConfig.stateName} UCC data`,
        description: `Data from ${this.stateConfig.stateName} hasn't been updated in ${Math.floor(hoursSinceUpdate)} hours`,
        reasoning: `Fresh data ensures accurate lead qualification and timely opportunity detection`,
        estimatedImpact: `Update ${this.stateConfig.stateName} database with latest ${this.metrics.recentFilings} filings`,
        automatable: true,
        safetyScore: 95
      })
    }

    // Check success rate
    if (this.metrics.successRate < 90) {
      findings.push({
        id: `${this.customId}-low-success`,
        category: 'performance',
        severity: 'critical',
        description: `${this.stateConfig.stateName} collection success rate is ${this.metrics.successRate}%`,
        evidence: { successRate: this.metrics.successRate, errors: this.metrics.errors }
      })

      improvements.push({
        id: `${this.customId}-fix-collection`,
        category: 'performance',
        priority: 'critical',
        title: `Fix ${this.stateConfig.stateName} data collection issues`,
        description: `Success rate dropped to ${this.metrics.successRate}% indicating portal changes or API issues`,
        reasoning: 'Failed collections mean missed opportunities and incomplete market coverage',
        estimatedImpact: 'Restore 95%+ success rate, recover missed filings',
        automatable: false,
        safetyScore: 70,
        implementation: {
          steps: [
            `Inspect ${this.stateConfig.portalUrl} for structure changes`,
            'Update scraper selectors or API endpoints',
            'Test with recent filing IDs',
            'Deploy updated collector',
            'Monitor success rate for 24 hours'
          ],
          risks: [
            'Portal may have new anti-scraping measures',
            'API authentication may have changed',
            'Rate limits may have been tightened'
          ],
          rollbackPlan: [
            'Revert to previous collector version',
            'Switch to manual data entry temporarily',
            'Alert team of portal issues'
          ],
          validationCriteria: [
            'Success rate above 95%',
            'No rate limit violations',
            'Data format matches schema'
          ]
        }
      })
    }

    // Check rate limit compliance
    const isWithinRateLimit = this.checkRateLimitCompliance()
    if (!isWithinRateLimit) {
      findings.push({
        id: `${this.customId}-rate-limit`,
        category: 'security',
        severity: 'warning',
        description: `${this.stateConfig.stateName} rate limit may be exceeded`,
        evidence: { rateLimit: this.stateConfig.rateLimit }
      })
    }

    // Analyze state-specific trends
    const stateTrends = this.analyzeStateTrends(context)
    findings.push(...stateTrends.findings)
    improvements.push(...stateTrends.improvements)

    return {
      agentId: this.customId,
      agentRole: this.role,
      findings,
      improvements,
      timestamp: new Date().toISOString()
    }
  }

  private checkRateLimitCompliance(): boolean {
    // In production, this would check actual request rates
    return true
  }

  private analyzeStateTrends(context: SystemContext): {
    findings: Finding[]
    improvements: ImprovementSuggestion[]
  } {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Analyze filings from this state
    const stateProspects = (
      context.prospects as Array<{ state?: string; priorityScore: number }>
    ).filter((p) => p.state === this.stateConfig.stateCode)

    if (stateProspects.length > 0) {
      const avgPriorityScore =
        stateProspects.reduce((sum, p) => sum + p.priorityScore, 0) / stateProspects.length

      findings.push({
        id: `${this.customId}-trend`,
        category: 'data-quality',
        severity: 'info',
        description: `${this.stateConfig.stateName} has ${stateProspects.length} prospects with avg score ${avgPriorityScore.toFixed(1)}`,
        evidence: {
          count: stateProspects.length,
          avgScore: avgPriorityScore,
          stateCode: this.stateConfig.stateCode
        }
      })

      // Suggest focusing on high-value states
      if (avgPriorityScore > 70 && stateProspects.length > 10) {
        improvements.push({
          id: `${this.customId}-increase-focus`,
          category: 'opportunity-analysis',
          priority: 'medium',
          title: `Increase collection frequency for ${this.stateConfig.stateName}`,
          description: `High-quality prospects (avg score ${avgPriorityScore.toFixed(1)}) suggest strong market`,
          reasoning: `${this.stateConfig.stateName} shows ${stateProspects.length} high-value prospects, indicating fertile market`,
          estimatedImpact: 'Capture more opportunities by increasing update frequency',
          automatable: true,
          safetyScore: 90
        })
      }
    }

    return { findings, improvements }
  }

  // Public methods for state-specific operations
  async collectFilings(options?: {
    since?: Date
    limit?: number
    filingTypes?: string[]
  }): Promise<UCCFiling[]> {
    console.log(`[${this.customId}] Collecting filings from ${this.stateConfig.stateName}`, options)

    // Use real collector if available
    if (this.collector) {
      try {
        const startTime = Date.now()
        const filings = await this.collector.collectNewFilings({
          since: options?.since,
          limit: options?.limit,
          filingTypes: options?.filingTypes
        })

        const processingTime = Date.now() - startTime

        // Update metrics
        this.updateMetrics({
          totalFilings: this.metrics.totalFilings + filings.length,
          recentFilings: filings.length,
          averageProcessingTime: processingTime,
          lastUpdate: new Date().toISOString(),
          successRate: 100 // Success
        })

        return filings
      } catch (error) {
        // Update error metrics
        this.updateMetrics({
          errors: this.metrics.errors + 1,
          successRate: Math.max(0, this.metrics.successRate - 5)
        })

        console.error(`[${this.customId}] Collection error:`, error)
        return []
      }
    }

    // Fallback for states without collectors
    console.warn(`[${this.customId}] No collector implemented for ${this.stateConfig.stateName}`)
    return []
  }

  async validateFiling(filingId: string): Promise<boolean> {
    void filingId
    // Implementation would validate against state-specific rules
    return true
  }

  getMetrics(): StateMetrics {
    return { ...this.metrics }
  }

  getConfig(): StateConfig {
    return { ...this.stateConfig }
  }

  updateMetrics(updates: Partial<StateMetrics>): void {
    this.metrics = { ...this.metrics, ...updates }
  }

  /**
   * Public accessor for this agent's stable custom identifier
   * (e.g. "state-agent-ca"). Prefer this over reaching into the private
   * `customId` field via bracket notation.
   */
  getCustomId(): string {
    return this.customId
  }

  /**
   * Check if this state has a collector implementation
   */
  hasCollector(): boolean {
    return hasCollectorForState(this.stateConfig.stateCode)
  }

  /**
   * Get collector status if available
   */
  getCollectorStatus() {
    if (this.collector) {
      return this.collector.getStatus()
    }
    return undefined
  }
}

// Export state configurations
export const US_STATES: Omit<StateConfig, 'stateCode' | 'stateName'>[] = [
  {
    portalUrl: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
    apiEndpoint: undefined,
    requiresAuth: false,
    rateLimit: { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5000 },
    dataFormat: 'html',
    updateFrequency: 'daily'
  }
  // Additional states would be configured here
]
