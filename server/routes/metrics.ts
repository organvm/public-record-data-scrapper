import { Router, Request, Response, NextFunction } from 'express'
import { Queue } from 'bullmq'
import jwt from 'jsonwebtoken'
import { config } from '../config'
import { asyncHandler } from '../middleware/errorHandler'
import {
  PROMETHEUS_CONTENT_TYPE,
  PrometheusMetric,
  PrometheusSample,
  renderPrometheus
} from '../observability/prometheus'
import {
  getIngestionQueue,
  getEnrichmentQueue,
  getHealthScoreQueue,
  getPortalProbeQueue,
  getDigestQueue,
  getTerminationDetectionQueue,
  getVelocityAnalysisQueue,
  getOutreachQueue,
  getIngestionCoverageTelemetry
} from '../queue/queues'

const router = Router()

/**
 * Auth for the metrics endpoint. Fail-closed:
 *
 *   1. If a valid `Authorization: Bearer <jwt>` is presented (verified with the
 *      same HS256-pinned options as the main authMiddleware), allow.
 *   2. Else, if `METRICS_TOKEN` is configured AND the request presents it via
 *      `Authorization: Bearer <token>` or the `X-Metrics-Token` header, allow.
 *   3. Otherwise deny with 401.
 *
 * Crucially: when NEITHER a JWT secret nor a METRICS_TOKEN can authorize the
 * request, we deny. There is no "public when unconfigured" path — an
 * unconfigured deployment yields 401, never an open metrics endpoint that
 * leaks queue depths / telemetry to anonymous scrapers.
 */
export const metricsAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const deny = () =>
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Metrics endpoint requires a valid JWT or the configured metrics token'
    })

  const authHeader = req.headers.authorization
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined

  // (1) Try JWT verification first when a bearer token and a JWT secret exist.
  if (bearerToken && config.jwt.secret) {
    try {
      const verifyOptions: jwt.VerifyOptions = { algorithms: ['HS256'] }
      if (config.jwt.issuer) verifyOptions.issuer = config.jwt.issuer
      if (config.jwt.audience) verifyOptions.audience = config.jwt.audience
      jwt.verify(bearerToken, config.jwt.secret, verifyOptions)
      return next()
    } catch {
      // Fall through to static-token check; a bad JWT is not fatal if a
      // METRICS_TOKEN path can still authorize this request.
    }
  }

  // (2) Static metrics token, presented as bearer or via X-Metrics-Token.
  const metricsToken = process.env.METRICS_TOKEN
  if (metricsToken && metricsToken.length > 0) {
    const headerToken = req.headers['x-metrics-token']
    const presented =
      bearerToken ?? (typeof headerToken === 'string' ? headerToken.trim() : undefined)
    if (presented !== undefined && timingSafeEqualString(presented, metricsToken)) {
      return next()
    }
  }

  // (3) Nothing authorized this request. Fail closed.
  return deny()
}

/**
 * Constant-time-ish string comparison to avoid leaking the metrics token length
 * / prefix via early-exit timing. Lengths differing short-circuit (the length
 * itself is not secret in practice), then every remaining char is compared.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

interface NamedQueue {
  name: string
  get: () => Queue
}

// All 8 BullMQ queues. Getters throw when the queue is not initialized; we
// catch per-queue and OMIT that queue's gauges (with a comment line) rather
// than inventing zeros — fail closed, never report fabricated depth.
const QUEUE_REGISTRY: NamedQueue[] = [
  { name: 'ucc-ingestion', get: getIngestionQueue },
  { name: 'data-enrichment', get: getEnrichmentQueue },
  { name: 'health-scores', get: getHealthScoreQueue },
  { name: 'portal-health-probes', get: getPortalProbeQueue },
  { name: 'coverage-digest', get: getDigestQueue },
  { name: 'termination-detection', get: getTerminationDetectionQueue },
  { name: 'velocity-analysis', get: getVelocityAnalysisQueue },
  { name: 'outreach', get: getOutreachQueue }
]

type QueueState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
const QUEUE_STATES: QueueState[] = ['waiting', 'active', 'completed', 'failed', 'delayed']

interface QueueDepth {
  queue: string
  counts: Record<QueueState, number>
}

/**
 * Collect per-queue job counts for every initialized queue. Each queue is
 * probed independently; a queue whose getter throws (not initialized) or whose
 * count call rejects (Redis unreachable) is reported in `unavailable` so the
 * renderer can emit a comment line instead of fabricated data.
 */
async function collectQueueDepths(): Promise<{
  depths: QueueDepth[]
  unavailable: { queue: string; reason: string }[]
}> {
  const depths: QueueDepth[] = []
  const unavailable: { queue: string; reason: string }[] = []

  await Promise.all(
    QUEUE_REGISTRY.map(async ({ name, get }) => {
      let queue: Queue
      try {
        queue = get()
      } catch (err) {
        unavailable.push({ queue: name, reason: (err as Error).message })
        return
      }

      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount()
        ])
        depths.push({
          queue: name,
          counts: { waiting, active, completed, failed, delayed }
        })
      } catch (err) {
        unavailable.push({ queue: name, reason: (err as Error).message })
      }
    })
  )

  // Stable ordering (Promise.all resolution order is non-deterministic for the
  // push side-effects) so output is deterministic and diff-friendly.
  depths.sort((a, b) => a.queue.localeCompare(b.queue))
  unavailable.sort((a, b) => a.queue.localeCompare(b.queue))
  return { depths, unavailable }
}

interface QueueDepthSnapshot {
  depths: QueueDepth[]
  unavailable: { queue: string; reason: string }[]
}

/** TTL (ms) for the queue-depth cache. A scrape within this window reuses the
 *  last snapshot rather than re-firing ~40 Redis count calls. */
const QUEUE_DEPTH_CACHE_TTL_MS = 5000

// Module-level cache. Only the queue-depth collection (the expensive Redis
// fan-out) is cached; process/ingestion-telemetry metrics are recomputed live
// on every scrape. The cached snapshot carries the fail-closed `unavailable`
// list verbatim, so omission semantics survive a cache hit unchanged.
let queueDepthCache: { at: number; snapshot: QueueDepthSnapshot } | null = null

/**
 * Queue depths with a short TTL cache. Within {@link QUEUE_DEPTH_CACHE_TTL_MS}
 * of the last collection, the cached snapshot is returned and NO Redis calls
 * are made; otherwise the live collection runs and refreshes the cache.
 */
async function getQueueDepths(now: number = Date.now()): Promise<QueueDepthSnapshot> {
  if (queueDepthCache && now - queueDepthCache.at < QUEUE_DEPTH_CACHE_TTL_MS) {
    return queueDepthCache.snapshot
  }
  const snapshot = await collectQueueDepths()
  queueDepthCache = { at: now, snapshot }
  return snapshot
}

/** Test-only: drop the cached queue-depth snapshot. */
export function __resetQueueDepthCache(): void {
  queueDepthCache = null
}

/**
 * Build the full metric set. Pure given the inputs so the route stays thin.
 * Exposed for unit testing of the assembled metric/sample shapes.
 */
export function buildMetrics(input: {
  uptimeSeconds: number
  memory: NodeJS.MemoryUsage
  queueDepths: QueueDepth[]
  telemetry: ReturnType<typeof getIngestionCoverageTelemetry>
}): PrometheusMetric[] {
  const { uptimeSeconds, memory, queueDepths, telemetry } = input

  const metrics: PrometheusMetric[] = [
    {
      name: 'process_uptime_seconds',
      help: 'Process uptime in seconds.',
      type: 'gauge',
      samples: [{ value: uptimeSeconds }]
    },
    {
      name: 'process_resident_memory_bytes',
      help: 'Resident set size (RSS) in bytes.',
      type: 'gauge',
      samples: [{ value: memory.rss }]
    },
    {
      name: 'process_heap_bytes',
      help: 'V8 heap used and total in bytes.',
      type: 'gauge',
      samples: [
        { labels: { kind: 'used' }, value: memory.heapUsed },
        { labels: { kind: 'total' }, value: memory.heapTotal }
      ]
    }
  ]

  // Queue depth gauge: one metric, one sample per (queue, state).
  const queueSamples: PrometheusSample[] = []
  for (const { queue, counts } of queueDepths) {
    for (const state of QUEUE_STATES) {
      queueSamples.push({ labels: { queue, state }, value: counts[state] })
    }
  }
  metrics.push({
    name: 'bullmq_queue_jobs',
    help: 'Number of BullMQ jobs per queue and state.',
    type: 'gauge',
    samples: queueSamples
  })

  // Ingestion telemetry counters (per state).
  const successSamples: PrometheusSample[] = []
  const failureSamples: PrometheusSample[] = []
  const consecutiveFailureSamples: PrometheusSample[] = []
  for (const t of telemetry) {
    successSamples.push({ labels: { state: t.state }, value: t.successCount })
    failureSamples.push({ labels: { state: t.state }, value: t.failureCount })
    consecutiveFailureSamples.push({ labels: { state: t.state }, value: t.consecutiveFailures })
  }
  metrics.push(
    {
      name: 'ingestion_success_total',
      help: 'Total successful ingestion pulls per state.',
      type: 'counter',
      samples: successSamples
    },
    {
      name: 'ingestion_failure_total',
      help: 'Total failed ingestion pulls per state.',
      type: 'counter',
      samples: failureSamples
    },
    {
      name: 'ingestion_consecutive_failures',
      help: 'Current consecutive ingestion failure count per state.',
      type: 'gauge',
      samples: consecutiveFailureSamples
    }
  )

  return metrics
}

// GET /api/metrics — Prometheus text exposition format. Auth: JWT or
// METRICS_TOKEN; fail-closed 401 when neither authorizes.
router.get(
  '/',
  metricsAuthMiddleware,
  asyncHandler(async (_req, res) => {
    const { depths, unavailable } = await getQueueDepths()

    const metrics = buildMetrics({
      uptimeSeconds: process.uptime(),
      memory: process.memoryUsage(),
      queueDepths: depths,
      telemetry: getIngestionCoverageTelemetry()
    })

    let body = renderPrometheus(metrics)

    // Surface omitted (uninitialized / unreachable) queues as comment lines so
    // a scraper operator can see *why* a queue's gauges are missing rather than
    // silently assuming zero.
    if (unavailable.length > 0) {
      const comments = unavailable
        .map(({ queue, reason }) => `# queue "${queue}" unavailable: ${reason.replace(/\n/g, ' ')}`)
        .join('\n')
      body = `${body}${comments}\n`
    }

    res.setHeader('Content-Type', PROMETHEUS_CONTENT_TYPE)
    res.status(200).send(body)
  })
)

export default router
