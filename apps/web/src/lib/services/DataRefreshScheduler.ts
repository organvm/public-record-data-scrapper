/**
 * Data Refresh Scheduler
 *
 * Manages periodic data refresh operations including:
 * - UCC filing ingestion
 * - Prospect data enrichment
 * - Health score updates
 * - Growth signal detection
 */

import { DataIngestionService, IngestionConfig, IngestionResult } from './DataIngestionService'
import { DataEnrichmentService, EnrichmentSource } from './DataEnrichmentService'
import { Prospect } from '@public-records/core'

export interface ScheduleConfig {
  enabled: boolean

  // Ingestion schedule
  ingestionInterval: number // milliseconds between ingestion runs
  ingestionStates?: string[] // States to ingest

  // Enrichment schedule
  enrichmentInterval: number // milliseconds between enrichment runs
  enrichmentBatchSize: number

  // Refresh schedule for stale data
  refreshInterval: number // milliseconds between refresh runs
  staleDataThreshold: number // days before data is considered stale

  // Auto-start on initialization
  autoStart: boolean
}

export interface SchedulerStatus {
  running: boolean
  lastIngestionRun?: string
  lastEnrichmentRun?: string
  lastRefreshRun?: string
  nextScheduledRun?: string
  totalProspectsProcessed: number
  totalErrors: number
}

export type SchedulerEventType =
  | 'ingestion-started'
  | 'ingestion-completed'
  | 'enrichment-started'
  | 'enrichment-completed'
  | 'refresh-started'
  | 'refresh-completed'
  | 'error'

export interface SchedulerEventData {
  ingestionResults?: IngestionResult[]
  enrichmentResults?: { prospectId: string; success: boolean }[]
  refreshedCount?: number
  prospectIds?: string[]
  filingsFound?: number
  prospectsCreated?: number
  sources?: number
  prospectsEnriched?: number
  remaining?: number
  prospectsRefreshed?: number
}

export interface SchedulerEvent {
  type: SchedulerEventType
  timestamp: string
  data?: SchedulerEventData
  error?: string
}

export type SchedulerEventHandler = (event: SchedulerEvent) => void

export class DataRefreshScheduler {
  private config: ScheduleConfig
  private ingestionService: DataIngestionService
  private enrichmentService: DataEnrichmentService

  private ingestionTimer?: ReturnType<typeof setTimeout>
  private enrichmentTimer?: ReturnType<typeof setTimeout>
  private refreshTimer?: ReturnType<typeof setTimeout>

  private status: SchedulerStatus = {
    running: false,
    totalProspectsProcessed: 0,
    totalErrors: 0
  }

  private eventHandlers: SchedulerEventHandler[] = []
  private prospects: Map<string, Prospect> = new Map()

  constructor(
    config: ScheduleConfig,
    ingestionConfig: IngestionConfig,
    enrichmentSources: EnrichmentSource[]
  ) {
    this.config = config
    this.ingestionService = new DataIngestionService(ingestionConfig)
    this.enrichmentService = new DataEnrichmentService(enrichmentSources)

    if (config.autoStart) {
      this.start()
    }
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.status.running) {
      console.warn('Scheduler is already running')
      return
    }

    this.status.running = true
    console.log('Data refresh scheduler started')

    if (this.config.enabled) {
      this.scheduleIngestion()
      this.scheduleEnrichment()
      this.scheduleRefresh()
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.status.running) {
      console.warn('Scheduler is not running')
      return
    }

    this.status.running = false

    if (this.ingestionTimer) {
      clearTimeout(this.ingestionTimer)
      this.ingestionTimer = undefined
    }

    if (this.enrichmentTimer) {
      clearTimeout(this.enrichmentTimer)
      this.enrichmentTimer = undefined
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }

    console.log('Data refresh scheduler stopped')
  }

  /**
   * Schedule ingestion runs
   */
  private scheduleIngestion(): void {
    const runIngestion = async () => {
      if (!this.status.running) return

      try {
        this.emitEvent({
          type: 'ingestion-started',
          timestamp: new Date().toISOString()
        })

        console.log('Running scheduled ingestion...')
        const results = await this.ingestionService.ingestData(this.config.ingestionStates)

        this.status.lastIngestionRun = new Date().toISOString()

        // Get all filings from results
        const allFilings = results.flatMap((r) => r.filings)

        // Enrich the filings into prospects
        const { prospects } = await this.enrichmentService.enrichProspects(
          allFilings,
          this.config.enrichmentBatchSize
        )

        // Store prospects
        prospects.forEach((p) => this.prospects.set(p.id, p))
        this.status.totalProspectsProcessed += prospects.length

        this.emitEvent({
          type: 'ingestion-completed',
          timestamp: new Date().toISOString(),
          data: {
            filingsFound: allFilings.length,
            prospectsCreated: prospects.length,
            sources: results.length
          }
        })

        console.log(`Ingestion complete: ${prospects.length} prospects processed`)
      } catch (error) {
        this.status.totalErrors++
        this.emitEvent({
          type: 'error',
          timestamp: new Date().toISOString(),
          error: `Ingestion error: ${error instanceof Error ? error.message : 'Unknown error'}`
        })
        console.error('Ingestion error:', error)
      }

      // Schedule next run
      if (this.status.running) {
        this.ingestionTimer = setTimeout(runIngestion, this.config.ingestionInterval)
      }
    }

    // Run immediately, then schedule
    runIngestion()
  }

  /**
   * Schedule enrichment runs
   */
  private scheduleEnrichment(): void {
    const runEnrichment = async () => {
      if (!this.status.running) return

      try {
        this.emitEvent({
          type: 'enrichment-started',
          timestamp: new Date().toISOString()
        })

        console.log('Running scheduled enrichment...')

        // Get prospects that need enrichment (incomplete data)
        const prospectsToEnrich = Array.from(this.prospects.values()).filter(
          (p) => !p.estimatedRevenue || p.growthSignals.length === 0
        )

        if (prospectsToEnrich.length > 0) {
          let enrichedCount = 0

          for (const prospect of prospectsToEnrich.slice(0, this.config.enrichmentBatchSize)) {
            const { prospect: enriched } = await this.enrichmentService.enrichProspect(
              prospect.uccFilings[0],
              prospect
            )
            this.prospects.set(enriched.id, enriched)
            enrichedCount++
          }

          this.status.lastEnrichmentRun = new Date().toISOString()
          this.status.totalProspectsProcessed += enrichedCount

          this.emitEvent({
            type: 'enrichment-completed',
            timestamp: new Date().toISOString(),
            data: {
              prospectsEnriched: enrichedCount,
              remaining: prospectsToEnrich.length - enrichedCount
            }
          })

          console.log(`Enrichment complete: ${enrichedCount} prospects enriched`)
        }
      } catch (error) {
        this.status.totalErrors++
        this.emitEvent({
          type: 'error',
          timestamp: new Date().toISOString(),
          error: `Enrichment error: ${error instanceof Error ? error.message : 'Unknown error'}`
        })
        console.error('Enrichment error:', error)
      }

      // Schedule next run
      if (this.status.running) {
        this.enrichmentTimer = setTimeout(runEnrichment, this.config.enrichmentInterval)
      }
    }

    // Delay first enrichment run slightly to allow ingestion to complete
    setTimeout(runEnrichment, 5000)
  }

  /**
   * Schedule refresh runs for stale data
   */
  private scheduleRefresh(): void {
    const runRefresh = async () => {
      if (!this.status.running) return

      try {
        this.emitEvent({
          type: 'refresh-started',
          timestamp: new Date().toISOString()
        })

        console.log('Running scheduled refresh...')

        // Find stale prospects
        const staleProspects = this.findStaleProspects()

        if (staleProspects.length > 0) {
          let refreshedCount = 0

          for (const prospect of staleProspects.slice(0, this.config.enrichmentBatchSize)) {
            const { prospect: refreshed } =
              await this.enrichmentService.refreshProspectData(prospect)
            this.prospects.set(refreshed.id, refreshed)
            refreshedCount++
          }

          this.status.lastRefreshRun = new Date().toISOString()

          this.emitEvent({
            type: 'refresh-completed',
            timestamp: new Date().toISOString(),
            data: {
              prospectsRefreshed: refreshedCount,
              remaining: staleProspects.length - refreshedCount
            }
          })

          console.log(`Refresh complete: ${refreshedCount} prospects refreshed`)
        }
      } catch (error) {
        this.status.totalErrors++
        this.emitEvent({
          type: 'error',
          timestamp: new Date().toISOString(),
          error: `Refresh error: ${error instanceof Error ? error.message : 'Unknown error'}`
        })
        console.error('Refresh error:', error)
      }

      // Schedule next run
      if (this.status.running) {
        this.refreshTimer = setTimeout(runRefresh, this.config.refreshInterval)
      }
    }

    // Delay first refresh run
    setTimeout(runRefresh, 10000)
  }

  /**
   * Find prospects with stale data
   */
  private findStaleProspects(): Prospect[] {
    const now = new Date()
    const thresholdMs = this.config.staleDataThreshold * 24 * 60 * 60 * 1000

    return Array.from(this.prospects.values()).filter((prospect) => {
      const lastUpdate = new Date(prospect.healthScore.lastUpdated)
      const age = now.getTime() - lastUpdate.getTime()
      return age > thresholdMs
    })
  }

  /**
   * Manually trigger ingestion
   */
  async triggerIngestion(): Promise<void> {
    console.log('Manual ingestion triggered')
    // Temporarily stop scheduled runs
    if (this.ingestionTimer) {
      clearTimeout(this.ingestionTimer)
    }

    const results = await this.ingestionService.ingestData(this.config.ingestionStates)
    const allFilings = results.flatMap((r) => r.filings)
    const { prospects } = await this.enrichmentService.enrichProspects(
      allFilings,
      this.config.enrichmentBatchSize
    )

    prospects.forEach((p) => this.prospects.set(p.id, p))
    this.status.lastIngestionRun = new Date().toISOString()
    this.status.totalProspectsProcessed += prospects.length

    // Reschedule
    if (this.status.running) {
      this.scheduleIngestion()
    }
  }

  /**
   * Manually trigger refresh for specific prospect
   */
  async refreshProspect(prospectId: string): Promise<Prospect | null> {
    const prospect = this.prospects.get(prospectId)
    if (!prospect) {
      console.warn(`Prospect ${prospectId} not found`)
      return null
    }

    const { prospect: refreshed } = await this.enrichmentService.refreshProspectData(prospect)
    this.prospects.set(refreshed.id, refreshed)

    return refreshed
  }

  /**
   * Get all prospects
   */
  getProspects(): Prospect[] {
    return Array.from(this.prospects.values())
  }

  /**
   * Get scheduler status
   */
  getStatus(): SchedulerStatus {
    return { ...this.status }
  }

  /**
   * Subscribe to scheduler events
   */
  on(handler: SchedulerEventHandler): () => void {
    this.eventHandlers.push(handler)

    // Return unsubscribe function
    return () => {
      const index = this.eventHandlers.indexOf(handler)
      if (index > -1) {
        this.eventHandlers.splice(index, 1)
      }
    }
  }

  /**
   * Emit event to all handlers
   */
  private emitEvent(event: SchedulerEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event)
      } catch (error) {
        console.error('Error in event handler:', error)
      }
    })
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScheduleConfig>): void {
    this.config = { ...this.config, ...config }

    // Restart if running
    if (this.status.running) {
      this.stop()
      this.start()
    }
  }
}

/**
 * Default scheduler configuration
 */
export const defaultScheduleConfig: ScheduleConfig = {
  enabled: true,
  ingestionInterval: 24 * 60 * 60 * 1000, // 24 hours
  enrichmentInterval: 6 * 60 * 60 * 1000, // 6 hours
  enrichmentBatchSize: 50,
  refreshInterval: 12 * 60 * 60 * 1000, // 12 hours
  staleDataThreshold: 7, // 7 days
  autoStart: false
}
