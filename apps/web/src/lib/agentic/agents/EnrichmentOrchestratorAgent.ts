/**
 * Enrichment Orchestrator Agent
 *
 * Coordinates the enrichment workflow across all agents
 */

import { BaseAgent } from '../BaseAgent'
import {
  AgentAnalysis,
  SystemContext,
  AgentTask,
  AgentTaskResult,
  EnrichmentRequest,
  EnrichmentResult,
  Finding,
  ImprovementSuggestion
} from '../types'
import { DataAcquisitionAgent } from './DataAcquisitionAgent'
import { ScraperAgent } from './ScraperAgent'
import { DataNormalizationAgent } from './DataNormalizationAgent'
import { MonitoringAgent } from './MonitoringAgent'

export interface EnrichmentProgress {
  stage: string
  status: 'pending' | 'in-progress' | 'completed' | 'failed'
  timestamp: string
  data?: unknown
  error?: string
}

export class EnrichmentOrchestratorAgent extends BaseAgent {
  private dataAcquisitionAgent: DataAcquisitionAgent
  private scraperAgent: ScraperAgent
  private normalizationAgent: DataNormalizationAgent
  private monitoringAgent: MonitoringAgent

  constructor() {
    super('enrichment-orchestrator', 'Enrichment Orchestrator Agent', [
      'Workflow coordination',
      'Task orchestration',
      'Parallel processing',
      'Error handling',
      'Progress tracking',
      'Result aggregation'
    ])

    // Initialize sub-agents
    this.dataAcquisitionAgent = new DataAcquisitionAgent()
    this.scraperAgent = new ScraperAgent()
    this.normalizationAgent = new DataNormalizationAgent()
    this.monitoringAgent = new MonitoringAgent()
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Aggregate analyses from all sub-agents
    const analyses = await Promise.all([
      this.dataAcquisitionAgent.analyze(context),
      this.scraperAgent.analyze(context),
      this.normalizationAgent.analyze(context),
      this.monitoringAgent.analyze(context)
    ])

    // Collect all findings and improvements
    analyses.forEach((analysis) => {
      findings.push(...analysis.findings)
      improvements.push(...analysis.improvements)
    })

    return this.createAnalysis(findings, improvements)
  }

  /**
   * Execute an orchestration task
   */
  async executeTask(task: AgentTask): Promise<AgentTaskResult> {
    const { type, payload } = task
    const payloadData = payload as { enrichmentId?: string }

    try {
      switch (type) {
        case 'enrich-prospect':
          return await this.enrichProspect(payload as unknown as EnrichmentRequest)
        case 'get-enrichment-status':
          if (!payloadData.enrichmentId) {
            return {
              success: false,
              error: 'Missing enrichmentId',
              timestamp: new Date().toISOString()
            }
          }
          return this.getEnrichmentStatus(payloadData.enrichmentId)
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
   * Orchestrate the full enrichment workflow
   */
  private async enrichProspect(request: EnrichmentRequest): Promise<AgentTaskResult> {
    const { companyName, state, tier, userId } = request
    const progress: EnrichmentProgress[] = []
    const startTime = Date.now()

    try {
      // Stage 1: Check quota
      progress.push({
        stage: 'quota-check',
        status: 'in-progress',
        timestamp: new Date().toISOString()
      })

      if (userId) {
        const quotaCheck = await this.monitoringAgent.executeTask({
          type: 'enforce-quota',
          payload: { userId }
        })

        if (!quotaCheck.success) {
          progress[progress.length - 1].status = 'failed'
          progress[progress.length - 1].error = quotaCheck.error

          return {
            success: false,
            error: quotaCheck.error,
            data: { progress },
            timestamp: new Date().toISOString()
          }
        }

        progress[progress.length - 1].status = 'completed'
      }

      // Stage 2: Fetch data from sources
      progress.push({
        stage: 'data-acquisition',
        status: 'in-progress',
        timestamp: new Date().toISOString()
      })

      const dataResult = await this.dataAcquisitionAgent.executeTask({
        type: 'fetch-data',
        payload: { companyName, state, tier, userId }
      })

      if (!dataResult.success) {
        progress[progress.length - 1].status = 'failed'
        progress[progress.length - 1].error = dataResult.error
      } else {
        progress[progress.length - 1].status = 'completed'
        progress[progress.length - 1].data = {
          sources: (dataResult.data as Record<string, unknown>)?.sources || [],
          cost: (dataResult.data as Record<string, unknown>)?.totalCost || 0
        }
      }

      // Stage 3: Scrape UCC filings (if state supported)
      progress.push({
        stage: 'ucc-scraping',
        status: 'in-progress',
        timestamp: new Date().toISOString()
      })

      let uccResult: AgentTaskResult | null = null
      if (this.scraperAgent.isStateSupported(state)) {
        uccResult = await this.scraperAgent.executeTask({
          type: 'scrape-ucc',
          payload: { companyName, state }
        })

        if (!uccResult.success) {
          progress[progress.length - 1].status = 'failed'
          progress[progress.length - 1].error = uccResult.error
        } else {
          progress[progress.length - 1].status = 'completed'
          progress[progress.length - 1].data = {
            filingCount: (uccResult.data as Record<string, unknown>)?.filingCount || 0,
            searchUrl: (uccResult.data as Record<string, unknown>)?.searchUrl
          }
        }
      } else {
        progress[progress.length - 1].status = 'completed'
        progress[progress.length - 1].data = {
          message: `State ${state} not yet supported for scraping`
        }
      }

      // Stage 4: Normalize data
      progress.push({
        stage: 'normalization',
        status: 'in-progress',
        timestamp: new Date().toISOString()
      })

      const normalizeResult = await this.normalizationAgent.executeTask({
        type: 'normalize-data',
        payload: {
          data: {
            companyName,
            state,
            ...(((dataResult.data as Record<string, unknown>)?.results as Record<
              string,
              unknown
            >) ?? {})
          }
        }
      })

      if (!normalizeResult.success) {
        progress[progress.length - 1].status = 'failed'
        progress[progress.length - 1].error = normalizeResult.error
      } else {
        progress[progress.length - 1].status = 'completed'
      }

      // Stage 5: Track usage
      if (userId && dataResult.success) {
        await this.monitoringAgent.executeTask({
          type: 'track-usage',
          payload: {
            userId,
            action: 'enrichment',
            cost: (dataResult.data as Record<string, unknown>)?.totalCost || 0,
            success: true,
            metadata: {
              companyName,
              state,
              sources: (dataResult.data as Record<string, unknown>)?.sources || []
            }
          }
        })
      }

      // Aggregate results
      const enrichmentResult: EnrichmentResult = {
        success: true,
        data: {
          companyName,
          state,
          normalizedName:
            (
              (normalizeResult.data as Record<string, unknown>)?.normalized as Record<
                string,
                unknown
              >
            )?.companyName || companyName,
          dataAcquisition: (dataResult.data as Record<string, unknown>)?.results || {},
          uccFilings: ((uccResult?.data as Record<string, unknown>)?.filings as unknown[]) || [],
          sources: ((dataResult.data as Record<string, unknown>)?.sources as string[]) || [],
          searchUrls: {
            ucc: (uccResult?.data as Record<string, unknown>)?.searchUrl
          }
        },
        sources: ((dataResult.data as Record<string, unknown>)?.sources as string[]) || [],
        cost: ((dataResult.data as Record<string, unknown>)?.totalCost as number) || 0,
        timestamp: new Date().toISOString()
      }

      const responseTime = Date.now() - startTime

      return {
        success: true,
        data: {
          ...enrichmentResult,
          progress,
          responseTime,
          stages: progress.filter((p) => p.status === 'completed').length
        },
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: { progress },
        timestamp: new Date().toISOString()
      }
    }
  }

  /**
   * Get enrichment status for async operations.
   */
  private getEnrichmentStatus(enrichmentId: string): AgentTaskResult {
    return {
      success: false,
      data: {
        enrichmentId,
        status: 'unsupported',
        message: 'Enrichment status tracking is not implemented'
      },
      timestamp: new Date().toISOString()
    }
  }

  /**
   * Get all sub-agents
   */
  getAgents() {
    return {
      dataAcquisition: this.dataAcquisitionAgent,
      scraper: this.scraperAgent,
      normalization: this.normalizationAgent,
      monitoring: this.monitoringAgent
    }
  }
}
