import { Queue } from 'bullmq'
import type { ResolvedDataTier } from '../middleware/dataTier'
import type { UccProvider } from '../config/tieredIntegrations'
import { redisConnection } from './connection'
import { TelemetryPersistenceService } from '../services/TelemetryPersistenceService'
import type { PortalProbeJobData } from './workers/portalProbeWorker'
import type { DigestJobData } from './workers/digestWorker'
import type { OutreachJobData } from './workers/outreachWorker'

export type IngestionStrategy = 'api' | 'bulk' | 'vendor' | 'scrape'
export type IngestionCircuitState = 'closed' | 'open' | 'half-open'
export type IngestionQueueOrigin = 'scheduler' | 'manual' | 'self-heal'

// Tenant attribution carried on every manually-enqueued job so reads/deletes
// can be scoped to the owning org. Optional because scheduler/self-heal jobs
// have no requesting user; absence means "system-owned" (admin-only access).
export interface JobTenantAttribution {
  orgId?: string
  requestedBy?: string
}

// Job data interfaces
export interface IngestionJobData extends JobTenantAttribution {
  state: string
  startDate?: string
  endDate?: string
  batchSize?: number
  dataTier?: ResolvedDataTier
  uccProvider?: UccProvider
  strategy?: IngestionStrategy
  fallbackDepth?: number
  selfHealReason?: string
  manualOverride?: boolean
}

export interface EnrichmentJobData extends JobTenantAttribution {
  prospectIds: string[]
  force?: boolean
  dataTier?: ResolvedDataTier
}

export interface HealthScoreJobData extends JobTenantAttribution {
  portfolioCompanyId?: string
  batchSize?: number
  dataTier?: ResolvedDataTier
}

export interface IngestionSuccessRecord {
  completedAt: string
  recordsProcessed: number
}

export interface IngestionFailureRecord {
  failedAt: string
  error: string
}

export interface IngestionFallbackRecord {
  escalatedAt: string
  fromStrategy: IngestionStrategy | null
  toStrategy: IngestionStrategy
  reason: string
  delayMs: number
}

export interface IngestionCoverageTelemetry {
  state: string
  currentStatus: 'idle' | 'queued' | 'running' | 'success' | 'failed'
  lastJobId: string | null
  lastQueuedAt: string | null
  lastStartedAt: string | null
  lastSuccessfulPull: string | null
  lastFailedAt: string | null
  lastError: string | null
  lastRecordsProcessed: number | null
  dataTier: ResolvedDataTier | null
  uccProvider: UccProvider | null
  queuedBy: IngestionQueueOrigin | null
  currentStrategy: IngestionStrategy | null
  availableStrategies: IngestionStrategy[]
  circuitState: IngestionCircuitState
  circuitOpenedAt: string | null
  circuitBackoffUntil: string | null
  circuitTripCount: number
  escalationCount: number
  lastEscalatedAt: string | null
  lastEscalationReason: string | null
  successCount: number
  failureCount: number
  consecutiveFailures: number
  successes: IngestionSuccessRecord[]
  failures: IngestionFailureRecord[]
  fallbacks: IngestionFallbackRecord[]
}

interface QueueEventContext {
  state: string
  jobId?: string | null
  dataTier?: ResolvedDataTier | null
  uccProvider?: UccProvider | null
  strategy?: IngestionStrategy | null
  availableStrategies?: IngestionStrategy[]
  timestamp?: string
}

interface CompletionContext extends QueueEventContext {
  recordsProcessed: number
}

interface FailureContext extends QueueEventContext {
  error: string
}

interface FallbackEscalationContext {
  state: string
  fromStrategy: IngestionStrategy | null
  toStrategy: IngestionStrategy
  reason: string
  delayMs: number
  timestamp?: string
}

export interface IngestionCircuitGate {
  allowed: boolean
  circuitState: IngestionCircuitState
  backoffUntil: string | null
  reason: string | null
}

export interface IngestionRecoveryAction {
  action: 'fallback' | 'retry' | 'open-circuit' | 'none'
  nextStrategy: IngestionStrategy | null
  delayMs: number
  backoffUntil: string | null
  reason: string
}

export interface TelemetryHydrationOptions {
  historyLimitPerState?: number
}

export interface TerminationDetectionJobData {
  triggeredBy: 'scheduler' | 'manual'
}

export interface VelocityAnalysisJobData {
  triggeredBy: 'scheduler' | 'manual'
  limit?: number
}

// Queue instances
let ingestionQueue: Queue<IngestionJobData> | null = null
let enrichmentQueue: Queue<EnrichmentJobData> | null = null
let healthScoreQueue: Queue<HealthScoreJobData> | null = null
let portalProbeQueue: Queue<PortalProbeJobData> | null = null
let digestQueue: Queue<DigestJobData> | null = null
let terminationDetectionQueue: Queue<TerminationDetectionJobData> | null = null
let velocityAnalysisQueue: Queue<VelocityAnalysisJobData> | null = null
let outreachQueue: Queue<OutreachJobData> | null = null
const ingestionCoverageTelemetry = new Map<string, IngestionCoverageTelemetry>()

// Persistence layer — initialized at server startup
let persistenceService: TelemetryPersistenceService | null = null

export function initTelemetryPersistence(db: {
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>
}): void {
  persistenceService = new TelemetryPersistenceService(db)
}

export async function hydrateTelemetryFromDatabase(
  options: TelemetryHydrationOptions = {}
): Promise<number> {
  if (!persistenceService) return 0
  try {
    const persisted = await persistenceService.hydrateAll(options)
    let hydrated = 0
    for (const [state, telemetry] of persisted) {
      if (!ingestionCoverageTelemetry.has(state)) {
        ingestionCoverageTelemetry.set(state, telemetry)
        hydrated++
      }
    }
    return hydrated
  } catch (err) {
    console.error('[telemetry] Failed to hydrate from database:', (err as Error).message)
    return 0
  }
}

const STATE_STRATEGY_PROFILES: Partial<Record<string, IngestionStrategy[]>> = {
  CA: ['api'],
  TX: ['bulk'],
  FL: ['vendor'],
  // NY portal supports per-debtor search only; the scrape collector iterates
  // NY_UCC_DEBTOR_SEEDS and relies on external_id upsert dedupe.
  NY: ['scrape']
}

function resolveTimestamp(timestamp?: string): string {
  return timestamp ?? new Date().toISOString()
}

function pruneTelemetryHistory(telemetry: IngestionCoverageTelemetry, nowIso: string): void {
  const horizonMs = 30 * 24 * 60 * 60 * 1000
  const horizon = new Date(nowIso).getTime() - horizonMs

  telemetry.successes = telemetry.successes.filter(
    (entry) => new Date(entry.completedAt).getTime() >= horizon
  )
  telemetry.failures = telemetry.failures.filter(
    (entry) => new Date(entry.failedAt).getTime() >= horizon
  )
  telemetry.fallbacks = telemetry.fallbacks.filter(
    (entry) => new Date(entry.escalatedAt).getTime() >= horizon
  )
}

function dedupeStrategies(strategies: IngestionStrategy[]): IngestionStrategy[] {
  return Array.from(new Set(strategies))
}

function resolveCircuitBackoffMs(consecutiveFailures: number): number {
  const baseDelayMs = 2 * 60 * 1000
  const multiplier = 2 ** Math.max(0, consecutiveFailures - 1)
  return Math.min(baseDelayMs * multiplier, 30 * 60 * 1000)
}

function ensureStrategyMetadata(
  telemetry: IngestionCoverageTelemetry,
  context: Pick<QueueEventContext, 'state' | 'strategy' | 'availableStrategies'>
): void {
  const resolvedStrategies =
    context.availableStrategies ??
    telemetry.availableStrategies ??
    resolveStateIngestionStrategyChain(context.state)

  telemetry.availableStrategies = dedupeStrategies(resolvedStrategies)
  telemetry.currentStrategy =
    context.strategy ?? telemetry.currentStrategy ?? telemetry.availableStrategies[0] ?? null
}

function setCircuitOpen(
  telemetry: IngestionCoverageTelemetry,
  openedAt: string,
  backoffUntil: string
): void {
  telemetry.circuitState = 'open'
  telemetry.circuitOpenedAt = openedAt
  telemetry.circuitBackoffUntil = backoffUntil
  telemetry.circuitTripCount += 1
}

export function resolveStateIngestionStrategyChain(state: string): IngestionStrategy[] {
  const normalizedState = state.trim().toUpperCase()
  return [...(STATE_STRATEGY_PROFILES[normalizedState] ?? [])]
}

export function resolvePrimaryIngestionStrategy(state: string): IngestionStrategy | null {
  return resolveStateIngestionStrategyChain(state)[0] ?? null
}

function getOrCreateIngestionTelemetry(state: string): IngestionCoverageTelemetry {
  const normalizedState = state.trim().toUpperCase()
  const existing = ingestionCoverageTelemetry.get(normalizedState)

  if (existing) {
    return existing
  }

  const created: IngestionCoverageTelemetry = {
    state: normalizedState,
    currentStatus: 'idle',
    lastJobId: null,
    lastQueuedAt: null,
    lastStartedAt: null,
    lastSuccessfulPull: null,
    lastFailedAt: null,
    lastError: null,
    lastRecordsProcessed: null,
    dataTier: null,
    uccProvider: null,
    queuedBy: null,
    currentStrategy: null,
    availableStrategies: resolveStateIngestionStrategyChain(normalizedState),
    circuitState: 'closed',
    circuitOpenedAt: null,
    circuitBackoffUntil: null,
    circuitTripCount: 0,
    escalationCount: 0,
    lastEscalatedAt: null,
    lastEscalationReason: null,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    successes: [],
    failures: [],
    fallbacks: []
  }

  ingestionCoverageTelemetry.set(normalizedState, created)
  return created
}

export function recordIngestionQueued(
  context: QueueEventContext & { queuedBy: IngestionQueueOrigin }
): void {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)

  telemetry.currentStatus = 'queued'
  telemetry.lastJobId = context.jobId ?? telemetry.lastJobId
  telemetry.lastQueuedAt = timestamp
  telemetry.dataTier = context.dataTier ?? telemetry.dataTier
  telemetry.uccProvider = context.uccProvider ?? telemetry.uccProvider
  telemetry.queuedBy = context.queuedBy
  ensureStrategyMetadata(telemetry, context)

  if (
    telemetry.circuitState === 'open' &&
    telemetry.circuitBackoffUntil &&
    new Date(timestamp).getTime() >= new Date(telemetry.circuitBackoffUntil).getTime()
  ) {
    telemetry.circuitState = 'half-open'
  }
}

export function recordIngestionStarted(context: QueueEventContext): void {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)

  telemetry.currentStatus = 'running'
  telemetry.lastJobId = context.jobId ?? telemetry.lastJobId
  telemetry.lastStartedAt = timestamp
  telemetry.dataTier = context.dataTier ?? telemetry.dataTier
  telemetry.uccProvider = context.uccProvider ?? telemetry.uccProvider
  ensureStrategyMetadata(telemetry, context)

  if (telemetry.circuitState === 'open' || telemetry.circuitState === 'half-open') {
    telemetry.circuitState = 'half-open'
  }
}

export function recordIngestionCompleted(context: CompletionContext): void {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)

  telemetry.currentStatus = 'success'
  telemetry.lastJobId = context.jobId ?? telemetry.lastJobId
  telemetry.lastSuccessfulPull = timestamp
  telemetry.lastError = null
  telemetry.lastRecordsProcessed = context.recordsProcessed
  telemetry.dataTier = context.dataTier ?? telemetry.dataTier
  telemetry.uccProvider = context.uccProvider ?? telemetry.uccProvider
  telemetry.successCount += 1
  telemetry.consecutiveFailures = 0
  telemetry.circuitState = 'closed'
  telemetry.circuitOpenedAt = null
  telemetry.circuitBackoffUntil = null
  telemetry.successes.unshift({
    completedAt: timestamp,
    recordsProcessed: context.recordsProcessed
  })
  ensureStrategyMetadata(telemetry, context)
  pruneTelemetryHistory(telemetry, timestamp)

  // Persist to database (fire-and-forget)
  if (persistenceService) {
    persistenceService
      .persistState(context.state, telemetry)
      .catch((err) =>
        console.error(`[telemetry] persist ${context.state}:`, (err as Error).message)
      )
    persistenceService
      .recordSuccess(
        context.state,
        timestamp,
        context.recordsProcessed,
        telemetry.currentStrategy ?? undefined
      )
      .catch((err) => console.error(`[telemetry] record success:`, (err as Error).message))
  }
}

export function recordIngestionFailed(context: FailureContext): void {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)

  telemetry.currentStatus = 'failed'
  telemetry.lastJobId = context.jobId ?? telemetry.lastJobId
  telemetry.lastFailedAt = timestamp
  telemetry.lastError = context.error
  telemetry.dataTier = context.dataTier ?? telemetry.dataTier
  telemetry.uccProvider = context.uccProvider ?? telemetry.uccProvider
  telemetry.failureCount += 1
  telemetry.consecutiveFailures += 1
  ensureStrategyMetadata(telemetry, context)
  telemetry.failures.unshift({
    failedAt: timestamp,
    error: context.error
  })
  pruneTelemetryHistory(telemetry, timestamp)

  // Persist to database (fire-and-forget)
  if (persistenceService) {
    persistenceService
      .persistState(context.state, telemetry)
      .catch((err) =>
        console.error(`[telemetry] persist ${context.state}:`, (err as Error).message)
      )
    persistenceService
      .recordFailure(
        context.state,
        timestamp,
        context.error,
        telemetry.currentStrategy ?? undefined
      )
      .catch((err) => console.error(`[telemetry] record failure:`, (err as Error).message))
  }
}

export function recordIngestionFallbackEscalated(context: FallbackEscalationContext): void {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)

  telemetry.currentStrategy = context.toStrategy
  telemetry.escalationCount += 1
  telemetry.lastEscalatedAt = timestamp
  telemetry.lastEscalationReason = context.reason
  telemetry.fallbacks.unshift({
    escalatedAt: timestamp,
    fromStrategy: context.fromStrategy,
    toStrategy: context.toStrategy,
    reason: context.reason,
    delayMs: context.delayMs
  })
  pruneTelemetryHistory(telemetry, timestamp)

  // Persist to database (fire-and-forget)
  if (persistenceService) {
    persistenceService
      .persistState(context.state, telemetry)
      .catch((err) =>
        console.error(`[telemetry] persist ${context.state}:`, (err as Error).message)
      )
    persistenceService
      .recordFallback(
        context.state,
        timestamp,
        context.fromStrategy ?? 'unknown',
        context.toStrategy,
        context.reason,
        context.delayMs
      )
      .catch((err) => console.error(`[telemetry] record fallback:`, (err as Error).message))
  }
}

export function getIngestionCircuitGate(state: string, timestamp?: string): IngestionCircuitGate {
  const nowIso = resolveTimestamp(timestamp)
  const telemetry = ingestionCoverageTelemetry.get(state.trim().toUpperCase())

  if (!telemetry || telemetry.circuitState !== 'open' || !telemetry.circuitBackoffUntil) {
    return {
      allowed: true,
      circuitState: telemetry?.circuitState ?? 'closed',
      backoffUntil: telemetry?.circuitBackoffUntil ?? null,
      reason: null
    }
  }

  const nowMs = new Date(nowIso).getTime()
  const backoffUntilMs = new Date(telemetry.circuitBackoffUntil).getTime()

  if (Number.isNaN(backoffUntilMs) || nowMs >= backoffUntilMs) {
    return {
      allowed: true,
      circuitState: 'half-open',
      backoffUntil: telemetry.circuitBackoffUntil,
      reason: null
    }
  }

  return {
    allowed: false,
    circuitState: 'open',
    backoffUntil: telemetry.circuitBackoffUntil,
    reason: telemetry.lastEscalationReason ?? telemetry.lastError ?? 'Circuit breaker is open'
  }
}

export function evaluateIngestionRecoveryAction(context: {
  state: string
  currentStrategy: IngestionStrategy | null
  error: string
  timestamp?: string
}): IngestionRecoveryAction {
  const telemetry = getOrCreateIngestionTelemetry(context.state)
  const timestamp = resolveTimestamp(context.timestamp)
  const strategyChain =
    telemetry.availableStrategies.length > 0
      ? telemetry.availableStrategies
      : resolveStateIngestionStrategyChain(context.state)
  const currentIndex = context.currentStrategy ? strategyChain.indexOf(context.currentStrategy) : -1
  const nextStrategy = currentIndex >= 0 ? (strategyChain[currentIndex + 1] ?? null) : null
  const delayMs = resolveCircuitBackoffMs(Math.max(1, telemetry.consecutiveFailures))
  const backoffUntil = new Date(new Date(timestamp).getTime() + delayMs).toISOString()

  setCircuitOpen(telemetry, timestamp, backoffUntil)

  if (nextStrategy) {
    return {
      action: 'fallback',
      nextStrategy,
      delayMs,
      backoffUntil,
      reason: `Escalating from ${context.currentStrategy ?? 'unknown'} to ${nextStrategy} after ${context.error}`
    }
  }

  if (context.currentStrategy && telemetry.consecutiveFailures === 1) {
    return {
      action: 'retry',
      nextStrategy: context.currentStrategy,
      delayMs,
      backoffUntil,
      reason: `Retrying ${context.currentStrategy} after ${context.error}`
    }
  }

  return {
    action: 'open-circuit',
    nextStrategy: null,
    delayMs,
    backoffUntil,
    reason: `Circuit opened after ${telemetry.consecutiveFailures} consecutive failures: ${context.error}`
  }
}

export function getIngestionCoverageTelemetry(state?: string): IngestionCoverageTelemetry[] {
  if (state) {
    const telemetry = ingestionCoverageTelemetry.get(state.trim().toUpperCase())
    return telemetry
      ? [
          {
            ...telemetry,
            availableStrategies: [...telemetry.availableStrategies],
            successes: [...telemetry.successes],
            failures: [...telemetry.failures],
            fallbacks: [...telemetry.fallbacks]
          }
        ]
      : []
  }

  return Array.from(ingestionCoverageTelemetry.values()).map((telemetry) => ({
    ...telemetry,
    availableStrategies: [...telemetry.availableStrategies],
    successes: [...telemetry.successes],
    failures: [...telemetry.failures],
    fallbacks: [...telemetry.fallbacks]
  }))
}

export function resetIngestionCoverageTelemetry(): void {
  ingestionCoverageTelemetry.clear()
}

export function initializeQueues() {
  const { client } = redisConnection.connect()

  const queueConfig = {
    connection: client,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential' as const,
        delay: 2000
      },
      removeOnComplete: {
        count: 100,
        age: 7 * 24 * 60 * 60 // 7 days
      },
      removeOnFail: {
        count: 500,
        age: 30 * 24 * 60 * 60 // 30 days
      }
    }
  }

  ingestionQueue = new Queue<IngestionJobData>('ucc-ingestion', queueConfig)
  enrichmentQueue = new Queue<EnrichmentJobData>('data-enrichment', queueConfig)
  healthScoreQueue = new Queue<HealthScoreJobData>('health-scores', queueConfig)
  portalProbeQueue = new Queue<PortalProbeJobData>('portal-health-probes', queueConfig)
  digestQueue = new Queue<DigestJobData>('coverage-digest', queueConfig)
  terminationDetectionQueue = new Queue<TerminationDetectionJobData>(
    'termination-detection',
    queueConfig
  )
  velocityAnalysisQueue = new Queue<VelocityAnalysisJobData>('velocity-analysis', queueConfig)
  outreachQueue = new Queue<OutreachJobData>('outreach', queueConfig)

  console.log('✓ Job queues initialized')

  return {
    ingestionQueue,
    enrichmentQueue,
    healthScoreQueue,
    portalProbeQueue,
    digestQueue,
    terminationDetectionQueue,
    velocityAnalysisQueue,
    outreachQueue
  }
}

export function getIngestionQueue(): Queue<IngestionJobData> {
  if (!ingestionQueue) {
    throw new Error('Ingestion queue not initialized. Call initializeQueues() first.')
  }
  return ingestionQueue
}

export function getEnrichmentQueue(): Queue<EnrichmentJobData> {
  if (!enrichmentQueue) {
    throw new Error('Enrichment queue not initialized. Call initializeQueues() first.')
  }
  return enrichmentQueue
}

export function getHealthScoreQueue(): Queue<HealthScoreJobData> {
  if (!healthScoreQueue) {
    throw new Error('Health score queue not initialized. Call initializeQueues() first.')
  }
  return healthScoreQueue
}

export function getPortalProbeQueue(): Queue<PortalProbeJobData> {
  if (!portalProbeQueue) throw new Error('Portal probe queue not initialized')
  return portalProbeQueue
}

export function getDigestQueue(): Queue<DigestJobData> {
  if (!digestQueue) throw new Error('Digest queue not initialized')
  return digestQueue
}

export function getTerminationDetectionQueue(): Queue<TerminationDetectionJobData> {
  if (!terminationDetectionQueue) throw new Error('Termination detection queue not initialized')
  return terminationDetectionQueue
}

export function getVelocityAnalysisQueue(): Queue<VelocityAnalysisJobData> {
  if (!velocityAnalysisQueue) throw new Error('Velocity analysis queue not initialized')
  return velocityAnalysisQueue
}

export function getOutreachQueue(): Queue<OutreachJobData> {
  if (!outreachQueue) throw new Error('Outreach queue not initialized')
  return outreachQueue
}

export async function closeQueues(): Promise<void> {
  const queues = [ingestionQueue, enrichmentQueue, healthScoreQueue]
  await Promise.all(queues.map((q) => q?.close()))
  await portalProbeQueue?.close()
  await digestQueue?.close()
  await terminationDetectionQueue?.close()
  await velocityAnalysisQueue?.close()
  await outreachQueue?.close()
  portalProbeQueue = null
  digestQueue = null
  terminationDetectionQueue = null
  velocityAnalysisQueue = null
  outreachQueue = null
  console.log('✓ Job queues closed')
}
