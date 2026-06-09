import { Worker, Job } from 'bullmq'
import { redisConnection } from '../connection'
import { IngestionJobData } from '../queues'
import { database } from '../../database/connection'
import { DataQualityService } from '../../services/DataQualityService'
import { ScoringService } from '../../services/ScoringService'
import { listEnabledIntegrations, resolveUccProvider } from '../../config/tieredIntegrations'
import type {
  StateCollector,
  UCCFiling as CollectedUCCFiling
} from '../../../apps/web/src/lib/collectors/types'
import { createCAApiCollector } from '../../../apps/web/src/lib/collectors/state-collectors/CAApiCollector'
import { createTXBulkCollector } from '../../../apps/web/src/lib/collectors/state-collectors/TXBulkCollector'
import { createFLVendorCollector } from '../../../apps/web/src/lib/collectors/state-collectors/FLVendorCollector'
import { createNYScraperCollector } from '../../../apps/web/src/lib/collectors/state-collectors/NYScraperCollector'
import {
  evaluateIngestionRecoveryAction,
  getIngestionQueue,
  recordIngestionStarted,
  recordIngestionCompleted,
  recordIngestionFailed,
  recordIngestionQueued,
  recordIngestionFallbackEscalated,
  resolveStateIngestionStrategyChain
} from '../queues'

class NonRetryableIngestionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableIngestionError'
  }
}

async function processIngestion(job: Job<IngestionJobData>): Promise<void> {
  const { state, startDate, endDate, batchSize = 1000, dataTier } = job.data
  const resolvedTier = dataTier ?? 'free-tier'
  const resolvedProvider = job.data.uccProvider ?? resolveUccProvider(resolvedTier)
  const enabledIntegrations = listEnabledIntegrations(resolvedTier)
  const strategyChain = resolveStateIngestionStrategyChain(state)
  const currentStrategy = job.data.strategy ?? strategyChain[0] ?? null

  await job.updateProgress(0)

  console.log(
    `[Ingestion Worker] Starting UCC ingestion for state: ${state} (${resolvedTier})${currentStrategy ? ` using ${currentStrategy}` : ''}`
  )
  console.log(`[Ingestion Worker] UCC provider: ${resolvedProvider}`)
  console.log(
    `[Ingestion Worker] Tier integrations: ${enabledIntegrations.length > 0 ? enabledIntegrations.join(', ') : 'none'}`
  )

  recordIngestionStarted({
    state,
    jobId: job.id?.toString() ?? null,
    dataTier: resolvedTier,
    uccProvider: resolvedProvider,
    strategy: currentStrategy,
    availableStrategies: strategyChain
  })

  try {
    const collector = resolveCollectorForJob(state, currentStrategy)

    await job.updateProgress(25)

    console.log(`[Ingestion Worker] Collecting live filings from ${state}...`)
    const filings = await collector.collectNewFilings({
      since: parseIsoDate(startDate),
      limit: batchSize,
      includeInactive: true
    })
    await job.updateProgress(60)

    console.log(`[Ingestion Worker] Persisting ${filings.length} live filings to database...`)
    const upsertedFilingIds = await persistCollectedFilings(state, currentStrategy, filings)
    await job.updateProgress(85)

    // Recompute live priority scores for prospects touched by these filings.
    // Error-isolated (see scoreAffectedProspects) so scoring never fails the job.
    await scoreAffectedProspects(state, upsertedFilingIds)

    const dqService = new DataQualityService(database)
    const dqReport = dqService.validateBatch(job.data.state, job.id ?? 'unknown', filings)

    if (!dqReport.passed) {
      console.warn(`[ingestion] Data quality warnings for ${job.data.state}:`, dqReport.warnings)
    }

    dqService
      .persistReport(dqReport)
      .catch((err) =>
        console.error(`[ingestion] Failed to persist DQ report:`, (err as Error).message)
      )

    await database.query(
      `INSERT INTO data_ingestion_logs (source, status, records_processed, started_at, completed_at, metadata)
       VALUES ($1, $2, $3, NOW(), NOW(), $4)`,
      [
        buildIngestionSource(state, currentStrategy),
        'success',
        filings.length,
        JSON.stringify({
          state,
          batchSize,
          startDate,
          endDate,
          dataTier: resolvedTier,
          uccProvider: resolvedProvider,
          strategy: currentStrategy,
          fallbackDepth: job.data.fallbackDepth ?? 0,
          liveCollector: collector.constructor.name,
          recordsPersisted: filings.length,
          integrations: enabledIntegrations
        })
      ]
    )

    await job.updateProgress(100)

    recordIngestionCompleted({
      state,
      jobId: job.id?.toString() ?? null,
      dataTier: resolvedTier,
      uccProvider: resolvedProvider,
      strategy: currentStrategy,
      availableStrategies: strategyChain,
      recordsProcessed: filings.length
    })

    console.log(`[Ingestion Worker] Successfully ingested ${filings.length} filings for ${state}`)
  } catch (error) {
    console.error(`[Ingestion Worker] Error processing ${state}:`, error)

    // Log failure
    await database.query(
      `INSERT INTO data_ingestion_logs (source, status, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [
        buildIngestionSource(state, currentStrategy),
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      ]
    )

    recordIngestionFailed({
      state,
      jobId: job.id?.toString() ?? null,
      dataTier: resolvedTier,
      uccProvider: resolvedProvider,
      strategy: currentStrategy,
      availableStrategies: strategyChain,
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    if (error instanceof NonRetryableIngestionError) {
      console.error(
        `[Ingestion Worker] Skipping self-heal for ${state} because the failure is not retryable`
      )
      throw error
    }

    const recovery = evaluateIngestionRecoveryAction({
      state,
      currentStrategy,
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    if ((recovery.action === 'fallback' || recovery.action === 'retry') && recovery.nextStrategy) {
      const ingestionQueue = getIngestionQueue()
      const fallbackJob = await ingestionQueue.add(
        `ingest-${state}-${recovery.nextStrategy}-${Date.now()}`,
        {
          ...job.data,
          state,
          dataTier: resolvedTier,
          uccProvider: resolvedProvider,
          strategy: recovery.nextStrategy,
          fallbackDepth:
            recovery.action === 'fallback'
              ? (job.data.fallbackDepth ?? 0) + 1
              : (job.data.fallbackDepth ?? 0),
          selfHealReason: recovery.reason
        },
        {
          priority: recovery.action === 'fallback' ? 1 : 2,
          delay: recovery.delayMs,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false
        }
      )

      if (recovery.action === 'fallback') {
        recordIngestionFallbackEscalated({
          state,
          fromStrategy: currentStrategy,
          toStrategy: recovery.nextStrategy,
          reason: recovery.reason,
          delayMs: recovery.delayMs
        })
      }

      recordIngestionQueued({
        state,
        jobId: fallbackJob.id?.toString() ?? null,
        dataTier: resolvedTier,
        uccProvider: resolvedProvider,
        strategy: recovery.nextStrategy,
        availableStrategies: strategyChain,
        queuedBy: 'self-heal'
      })

      console.error(
        `[Ingestion Worker] Scheduled self-healing ${recovery.action} for ${state} on ${recovery.nextStrategy} after ${recovery.delayMs}ms`
      )
    } else if (recovery.action === 'open-circuit') {
      console.error(
        `[Ingestion Worker] Opened circuit for ${state} until ${recovery.backoffUntil}: ${recovery.reason}`
      )
    }

    throw error
  }
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value) {
    return undefined
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function buildIngestionSource(state: string, strategy: IngestionJobData['strategy']): string {
  return `ucc_${state.toLowerCase()}_${strategy ?? 'unknown'}`
}

function normalizeDbStatus(
  status: CollectedUCCFiling['status']
): 'active' | 'terminated' | 'lapsed' {
  if (status === 'terminated') return 'terminated'
  if (status === 'lapsed') return 'lapsed'
  return 'active'
}

function normalizeDbFilingType(filingType: string): 'UCC-1' | 'UCC-3' {
  return filingType === 'UCC-1' ? 'UCC-1' : 'UCC-3'
}

function resolveCollectorForJob(
  state: string,
  strategy: IngestionJobData['strategy']
): StateCollector {
  switch (`${state}:${strategy}`) {
    case 'CA:api': {
      const collector = createCAApiCollector()
      if (!collector) {
        throw new NonRetryableIngestionError(
          'CA API collector is not configured in this environment.'
        )
      }
      return collector
    }
    case 'TX:bulk': {
      const collector = createTXBulkCollector()
      if (!collector) {
        throw new NonRetryableIngestionError(
          'TX bulk collector is not configured in this environment.'
        )
      }
      return collector
    }
    case 'FL:vendor': {
      const collector = createFLVendorCollector()
      if (!collector || !collector.isReady()) {
        throw new NonRetryableIngestionError(
          'FL vendor collector is not ready because the contract is not active.'
        )
      }
      return collector
    }
    case 'NY:scrape': {
      const collector = createNYScraperCollector()
      // NY needs no credentials but is portal-driven: the collector can only run
      // with a configured debtor-seed list (NY_UCC_DEBTOR_SEEDS). Gate on
      // isReady() exactly like FL so an unconfigured environment fails closed
      // instead of running an empty collection.
      if (!collector || !collector.isReady()) {
        throw new NonRetryableIngestionError(
          'NY scraper collector is not ready because no debtor seeds are configured (set NY_UCC_DEBTOR_SEEDS).'
        )
      }
      return collector
    }
    default:
      throw new NonRetryableIngestionError(
        strategy
          ? `No production ingestion collector is implemented for ${state} using ${strategy}.`
          : `No production ingestion strategy is configured for ${state}.`
      )
  }
}

function resolveLastAmendmentDate(amendments: CollectedUCCFiling['amendments']): string | null {
  if (!amendments || amendments.length === 0) return null
  const sorted = [...amendments].sort((a, b) => b.filingDate.localeCompare(a.filingDate))
  return sorted[0].filingDate
}

function resolveTerminationDate(filing: CollectedUCCFiling): string | null {
  if (filing.status !== 'terminated') return null
  const terminationAmendment = filing.amendments?.find((a) => a.amendmentType === 'termination')
  return terminationAmendment?.filingDate ?? filing.filingDate
}

async function persistCollectedFilings(
  state: string,
  strategy: IngestionJobData['strategy'],
  filings: CollectedUCCFiling[]
): Promise<string[]> {
  const upsertedFilingIds: string[] = []
  for (const filing of filings) {
    const amendmentCount = filing.amendments?.length ?? 0
    const lastAmendmentDate = resolveLastAmendmentDate(filing.amendments)
    const terminationDate = resolveTerminationDate(filing)

    const result = await database.query(
      `INSERT INTO ucc_filings (
         external_id,
         filing_date,
         debtor_name,
         secured_party,
         state,
         lien_amount,
         status,
         filing_type,
         source,
         raw_data,
         expiration_date,
         amendment_count,
         last_amendment_date,
         termination_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (external_id) DO UPDATE SET
         filing_date = EXCLUDED.filing_date,
         debtor_name = EXCLUDED.debtor_name,
         secured_party = EXCLUDED.secured_party,
         state = EXCLUDED.state,
         lien_amount = EXCLUDED.lien_amount,
         status = EXCLUDED.status,
         filing_type = EXCLUDED.filing_type,
         source = EXCLUDED.source,
         raw_data = EXCLUDED.raw_data,
         expiration_date = EXCLUDED.expiration_date,
         amendment_count = EXCLUDED.amendment_count,
         last_amendment_date = EXCLUDED.last_amendment_date,
         termination_date = EXCLUDED.termination_date,
         updated_at = NOW()
      RETURNING id`,
      [
        `${state}:${filingSafeId(filing.filingNumber)}`,
        filing.filingDate,
        filing.debtor.name,
        filing.securedParty.name,
        filing.state,
        null,
        normalizeDbStatus(filing.status),
        normalizeDbFilingType(filing.filingType),
        buildIngestionSource(state, strategy),
        JSON.stringify(filing),
        filing.expirationDate ?? null,
        amendmentCount,
        lastAmendmentDate,
        terminationDate
      ]
    )

    const filingId: string | undefined = (result as { rows?: { id: string }[] })?.rows?.[0]?.id

    if (filingId) {
      upsertedFilingIds.push(filingId)
    }

    if (filingId && filing.amendments && filing.amendments.length > 0) {
      for (let i = 0; i < filing.amendments.length; i++) {
        const amendment = filing.amendments[i]
        const externalId = `${filing.filingNumber}:${amendment.filingNumber || i}`

        await database.query(
          `INSERT INTO ucc_amendments (
             filing_id,
             external_id,
             amendment_type,
             amendment_date,
             description,
             raw_data
           ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (external_id) DO UPDATE SET
             amendment_date = EXCLUDED.amendment_date,
             raw_data = EXCLUDED.raw_data`,
          [
            filingId,
            externalId,
            amendment.amendmentType,
            amendment.filingDate,
            amendment.description ?? null,
            JSON.stringify(amendment)
          ]
        )
      }
    }
  }

  return upsertedFilingIds
}

/**
 * Recompute and persist priority_score for every prospect linked to the filings
 * just upserted in this ingestion run, so the dashboard's score reflects real
 * filing data on each run instead of whatever stale value sits in the row.
 *
 * Error-isolated to match the worker's existing DataQualityService pattern: a
 * scoring failure (per-prospect or for the whole step) is logged and swallowed
 * so it can never fail the ingestion job.
 */
async function scoreAffectedProspects(state: string, filingIds: string[]): Promise<void> {
  if (filingIds.length === 0) {
    return
  }

  let affectedProspectIds: string[]
  try {
    const rows = await database.query<{ prospect_id: string }>(
      `SELECT DISTINCT prospect_id
       FROM prospect_ucc_filings
       WHERE ucc_filing_id = ANY($1::uuid[])`,
      [filingIds]
    )
    affectedProspectIds = rows.map((r) => r.prospect_id)
  } catch (err) {
    console.error(
      `[ingestion] Failed to resolve affected prospects for ${state} scoring:`,
      (err as Error).message
    )
    return
  }

  if (affectedProspectIds.length === 0) {
    return
  }

  const scoringService = new ScoringService()
  let scored = 0
  for (const prospectId of affectedProspectIds) {
    try {
      const result = await scoringService.scoreProspect(prospectId)
      await database.query(
        `UPDATE prospects
         SET priority_score = $2, narrative = $3, updated_at = NOW()
         WHERE id = $1`,
        [prospectId, result.compositeScore, result.narrative]
      )
      scored++
    } catch (err) {
      // Isolate per-prospect failures: log and continue so one bad prospect
      // never aborts scoring for the rest or the ingestion job itself.
      console.error(
        `[ingestion] Failed to score prospect ${prospectId} for ${state}:`,
        (err as Error).message
      )
    }
  }

  console.log(
    `[ingestion] Recomputed scores for ${scored}/${affectedProspectIds.length} prospects affected by ${state} ingestion`
  )
}

function filingSafeId(filingNumber: string): string {
  return filingNumber.trim()
}

export function createIngestionWorker() {
  const { client } = redisConnection.connect()

  const worker = new Worker<IngestionJobData>('ucc-ingestion', processIngestion, {
    connection: client,
    concurrency: 2, // Process 2 states concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 60000 // per minute
    }
  })

  worker.on('completed', (job) => {
    console.log(`[Ingestion Worker] Job ${job.id} completed successfully`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[Ingestion Worker] Job ${job?.id} failed:`, err.message)
  })

  worker.on('error', (err) => {
    console.error('[Ingestion Worker] Worker error:', err)
  })

  console.log('✓ Ingestion worker started')

  return worker
}
