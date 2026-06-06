import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

// Mock the queue module before importing the router so the mock is in place
// when metrics.ts resolves its imports. Each queue getter and the telemetry
// reader is a vi.fn() we drive per-test.
vi.mock('@/queue/queues', () => ({
  getIngestionQueue: vi.fn(),
  getEnrichmentQueue: vi.fn(),
  getHealthScoreQueue: vi.fn(),
  getPortalProbeQueue: vi.fn(),
  getDigestQueue: vi.fn(),
  getTerminationDetectionQueue: vi.fn(),
  getVelocityAnalysisQueue: vi.fn(),
  getOutreachQueue: vi.fn(),
  getIngestionCoverageTelemetry: vi.fn()
}))

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
} from '@/queue/queues'
import metricsRouter, { __resetQueueDepthCache } from '@/routes/metrics'
import { renderPrometheus, escapeLabelValue, PrometheusMetric } from '@/observability/prometheus'

// ---------------------------------------------------------------------------
// Pure renderer unit tests
// ---------------------------------------------------------------------------

describe('renderPrometheus', () => {
  it('emits HELP and TYPE lines and a trailing newline', () => {
    const out = renderPrometheus([
      {
        name: 'process_uptime_seconds',
        help: 'Process uptime in seconds.',
        type: 'gauge',
        samples: [{ value: 42 }]
      }
    ])
    expect(out).toBe(
      '# HELP process_uptime_seconds Process uptime in seconds.\n' +
        '# TYPE process_uptime_seconds gauge\n' +
        'process_uptime_seconds 42\n'
    )
  })

  it('renders labelled samples with escaped label values', () => {
    const out = renderPrometheus([
      {
        name: 'bullmq_queue_jobs',
        help: 'jobs',
        type: 'gauge',
        samples: [{ labels: { queue: 'ucc-ingestion', state: 'waiting' }, value: 3 }]
      }
    ])
    expect(out).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="waiting"} 3\n')
  })

  it('escapes backslash, double-quote and newline in label values', () => {
    expect(escapeLabelValue('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd')
    const out = renderPrometheus([
      {
        name: 'm',
        help: 'h',
        type: 'gauge',
        samples: [{ labels: { l: 'a"b\\c\nd' }, value: 1 }]
      }
    ])
    expect(out).toContain('m{l="a\\"b\\\\c\\nd"} 1\n')
  })

  it('escapes backslash and newline in HELP text', () => {
    const out = renderPrometheus([
      { name: 'm', help: 'line1\nline2\\end', type: 'counter', samples: [] }
    ])
    expect(out).toContain('# HELP m line1\\nline2\\\\end\n')
  })

  it('renders non-finite values as Prometheus tokens', () => {
    const out = renderPrometheus([
      {
        name: 'm',
        help: 'h',
        type: 'gauge',
        samples: [
          { labels: { k: 'nan' }, value: NaN },
          { labels: { k: 'pinf' }, value: Number.POSITIVE_INFINITY },
          { labels: { k: 'ninf' }, value: Number.NEGATIVE_INFINITY }
        ]
      }
    ])
    expect(out).toContain('m{k="nan"} NaN\n')
    expect(out).toContain('m{k="pinf"} +Inf\n')
    expect(out).toContain('m{k="ninf"} -Inf\n')
  })

  it('emits only header lines for a metric with zero samples', () => {
    const metric: PrometheusMetric = { name: 'm', help: 'h', type: 'counter', samples: [] }
    const out = renderPrometheus([metric])
    expect(out).toBe('# HELP m h\n# TYPE m counter\n')
  })

  it('returns empty string for no metrics', () => {
    expect(renderPrometheus([])).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

function mockQueueCounts(counts: {
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
}) {
  return {
    getWaitingCount: vi.fn().mockResolvedValue(counts.waiting),
    getActiveCount: vi.fn().mockResolvedValue(counts.active),
    getCompletedCount: vi.fn().mockResolvedValue(counts.completed),
    getFailedCount: vi.fn().mockResolvedValue(counts.failed),
    getDelayedCount: vi.fn().mockResolvedValue(counts.delayed)
  } as unknown as ReturnType<typeof getIngestionQueue>
}

function buildTelemetry(state: string, overrides: Record<string, unknown> = {}) {
  return {
    state,
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
    availableStrategies: [],
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
    fallbacks: [],
    ...overrides
  } as ReturnType<typeof getIngestionCoverageTelemetry>[number]
}

describe('GET /api/metrics', () => {
  let app: Express
  const originalMetricsToken = process.env.METRICS_TOKEN

  function buildApp() {
    const a = express()
    a.use('/api/metrics', metricsRouter)
    return a
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Drop the module-level queue-depth cache so each test fires its own
    // (mocked) Redis collection rather than reusing a prior test's snapshot.
    __resetQueueDepthCache()
    delete process.env.METRICS_TOKEN

    // Default: all 8 queues initialized and returning zeros.
    const zero = () =>
      mockQueueCounts({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 })
    vi.mocked(getIngestionQueue).mockReturnValue(zero())
    vi.mocked(getEnrichmentQueue).mockReturnValue(zero())
    vi.mocked(getHealthScoreQueue).mockReturnValue(zero())
    vi.mocked(getPortalProbeQueue).mockReturnValue(zero())
    vi.mocked(getDigestQueue).mockReturnValue(zero())
    vi.mocked(getTerminationDetectionQueue).mockReturnValue(zero())
    vi.mocked(getVelocityAnalysisQueue).mockReturnValue(zero())
    vi.mocked(getOutreachQueue).mockReturnValue(zero())
    vi.mocked(getIngestionCoverageTelemetry).mockReturnValue([])

    app = buildApp()
  })

  afterEach(() => {
    if (originalMetricsToken === undefined) {
      delete process.env.METRICS_TOKEN
    } else {
      process.env.METRICS_TOKEN = originalMetricsToken
    }
  })

  it('returns 401 with no credentials and no METRICS_TOKEN configured (fail closed)', async () => {
    const res = await request(app).get('/api/metrics')
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('returns 401 when METRICS_TOKEN is set but the wrong token is presented', async () => {
    process.env.METRICS_TOKEN = 'correct-token'
    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'wrong-token')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid JWT when no METRICS_TOKEN is configured', async () => {
    const res = await request(app).get('/api/metrics').set('Authorization', 'Bearer not-a-real-jwt')
    expect(res.status).toBe(401)
  })

  it('authorizes via a valid JWT and renders Prometheus text', async () => {
    const token = jwt.sign({ sub: 'user-1', role: 'admin' }, JWT_SECRET, { algorithm: 'HS256' })
    const res = await request(app).get('/api/metrics').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/plain')
    expect(res.headers['content-type']).toContain('version=0.0.4')
    expect(res.text).toContain('# HELP process_uptime_seconds')
    expect(res.text).toContain('# TYPE process_uptime_seconds gauge')
    expect(res.text).toContain('process_resident_memory_bytes ')
    expect(res.text).toContain('process_heap_bytes{kind="used"} ')
    expect(res.text).toContain('process_heap_bytes{kind="total"} ')
  })

  it('authorizes via METRICS_TOKEN as a bearer token', async () => {
    process.env.METRICS_TOKEN = 'secret-scrape-token'
    const res = await request(app)
      .get('/api/metrics')
      .set('Authorization', 'Bearer secret-scrape-token')
    expect(res.status).toBe(200)
  })

  it('authorizes via METRICS_TOKEN in the X-Metrics-Token header', async () => {
    process.env.METRICS_TOKEN = 'secret-scrape-token'
    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'secret-scrape-token')
    expect(res.status).toBe(200)
  })

  it('renders per-queue gauges for all initialized queues', async () => {
    process.env.METRICS_TOKEN = 'tok'
    vi.mocked(getIngestionQueue).mockReturnValue(
      mockQueueCounts({ waiting: 5, active: 2, completed: 100, failed: 1, delayed: 3 })
    )
    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')

    expect(res.status).toBe(200)
    expect(res.text).toContain('# TYPE bullmq_queue_jobs gauge')
    expect(res.text).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="waiting"} 5')
    expect(res.text).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="completed"} 100')
    // Other queues present at zero.
    expect(res.text).toContain('bullmq_queue_jobs{queue="outreach",state="waiting"} 0')
  })

  it('omits an uninitialized queue and emits an explanatory comment line', async () => {
    process.env.METRICS_TOKEN = 'tok'
    vi.mocked(getOutreachQueue).mockImplementation(() => {
      throw new Error('Outreach queue not initialized')
    })
    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')

    expect(res.status).toBe(200)
    // No outreach gauge lines at all.
    expect(res.text).not.toContain('bullmq_queue_jobs{queue="outreach"')
    // But a comment line explaining the omission.
    expect(res.text).toContain('# queue "outreach" unavailable: Outreach queue not initialized')
    // Other queues still rendered.
    expect(res.text).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="waiting"} 0')
  })

  it('omits a queue whose count call rejects (Redis unreachable)', async () => {
    process.env.METRICS_TOKEN = 'tok'
    vi.mocked(getDigestQueue).mockReturnValue({
      getWaitingCount: vi.fn().mockRejectedValue(new Error('ECONNREFUSED redis')),
      getActiveCount: vi.fn().mockResolvedValue(0),
      getCompletedCount: vi.fn().mockResolvedValue(0),
      getFailedCount: vi.fn().mockResolvedValue(0),
      getDelayedCount: vi.fn().mockResolvedValue(0)
    } as unknown as ReturnType<typeof getDigestQueue>)

    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('bullmq_queue_jobs{queue="coverage-digest"')
    expect(res.text).toContain('# queue "coverage-digest" unavailable: ECONNREFUSED redis')
  })

  it('renders ingestion telemetry counters per state', async () => {
    process.env.METRICS_TOKEN = 'tok'
    vi.mocked(getIngestionCoverageTelemetry).mockReturnValue([
      buildTelemetry('CA', { successCount: 7, failureCount: 2, consecutiveFailures: 1 }),
      buildTelemetry('TX', { successCount: 3, failureCount: 0, consecutiveFailures: 0 })
    ])

    const res = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(res.status).toBe(200)
    expect(res.text).toContain('# TYPE ingestion_success_total counter')
    expect(res.text).toContain('ingestion_success_total{state="CA"} 7')
    expect(res.text).toContain('ingestion_failure_total{state="CA"} 2')
    expect(res.text).toContain('ingestion_consecutive_failures{state="CA"} 1')
    expect(res.text).toContain('ingestion_success_total{state="TX"} 3')
  })

  it('reuses the cached queue depths on a second scrape within the TTL', async () => {
    process.env.METRICS_TOKEN = 'tok'
    const ingestion = mockQueueCounts({
      waiting: 5,
      active: 2,
      completed: 100,
      failed: 1,
      delayed: 3
    })
    vi.mocked(getIngestionQueue).mockReturnValue(ingestion)

    // First scrape: fires the live Redis collection (one count call per state).
    const first = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(first.status).toBe(200)
    expect(first.text).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="waiting"} 5')
    const waitingCalls = (ingestion as unknown as { getWaitingCount: ReturnType<typeof vi.fn> })
      .getWaitingCount
    expect(waitingCalls).toHaveBeenCalledTimes(1)

    // Second scrape within the 5s TTL: the cache answers, no new Redis calls.
    const second = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(second.status).toBe(200)
    // Same cached depth surfaces.
    expect(second.text).toContain('bullmq_queue_jobs{queue="ucc-ingestion",state="waiting"} 5')
    // No additional count calls were issued (depths served from cache).
    expect(waitingCalls).toHaveBeenCalledTimes(1)

    // Process metrics stay live (recomputed each scrape, never cached).
    expect(second.text).toContain('# HELP process_uptime_seconds')
  })

  it('caches the fail-closed unavailable list (omission survives a cache hit)', async () => {
    process.env.METRICS_TOKEN = 'tok'
    vi.mocked(getOutreachQueue).mockImplementation(() => {
      throw new Error('Outreach queue not initialized')
    })

    const first = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(first.status).toBe(200)
    expect(first.text).toContain('# queue "outreach" unavailable: Outreach queue not initialized')

    // Second scrape within TTL: still omitted with the comment, served from cache.
    const second = await request(app).get('/api/metrics').set('X-Metrics-Token', 'tok')
    expect(second.status).toBe(200)
    expect(second.text).not.toContain('bullmq_queue_jobs{queue="outreach"')
    expect(second.text).toContain('# queue "outreach" unavailable: Outreach queue not initialized')
  })
})
