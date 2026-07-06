import { Router } from 'express'
import { z } from 'zod'
import { database } from '../database/connection'
import { asyncHandler } from '../middleware/errorHandler'
import { validateRequest } from '../middleware/validateRequest'
import { getResolvedDataTier } from '../middleware/dataTier'
import { listEnabledIntegrations, resolveUccProvider } from '../config/tieredIntegrations'
import { getIngestionCoverageTelemetry, resolveStateIngestionStrategyChain } from '../queue/queues'

const router = Router()

type CoverageStatus = 'green' | 'yellow' | 'red'
type CoverageStrategy = 'api' | 'bulk' | 'vendor' | 'scrape'

interface StateCoverageSnapshot {
  stateCode: string
  stateName: string
  status: CoverageStatus
  statusReason: string
  isHighValue: boolean
  scheduled: boolean
  implemented: boolean
  primaryStrategy: CoverageStrategy | null
  fallbackStrategy: CoverageStrategy | null
  availableStrategies: CoverageStrategy[]
  vendorInsuranceEnabled: boolean
  telemetry: {
    lastSuccessfulPull: string | null
    records24h: number | null
    records7d: number | null
    records30d: number | null
    errorRate: number | null
    currentStrategy: CoverageStrategy | null
    circuitState: 'closed' | 'open' | 'half-open'
    circuitBackoffUntil: string | null
    lastEscalatedAt: string | null
    lastEscalationReason: string | null
    escalationCount: number
  }
  notes: string[]
}

type StateDefinition = {
  code: string
  name: string
}

type RuntimeTelemetry = ReturnType<typeof getIngestionCoverageTelemetry>[number]

type ImplementationBlueprint = {
  primaryStrategy: CoverageStrategy
  availableStrategies: CoverageStrategy[]
  fallbackStrategy?: CoverageStrategy
  readiness: 'operational' | 'partial' | 'blocked'
  notes: string[]
}

const HIGH_VALUE_STATES = new Set(['CA', 'TX', 'FL', 'NY'])

function getImplementationBlueprint(stateCode: string): ImplementationBlueprint | undefined {
  switch (stateCode) {
    case 'CA': {
      const hasApiAccess = Boolean(process.env.CA_SOS_API_KEY)
      return {
        primaryStrategy: 'api',
        availableStrategies: hasApiAccess ? ['api'] : [],
        readiness: hasApiAccess ? 'operational' : 'blocked',
        notes: hasApiAccess
          ? ['CA API collector is credentialed and available for scheduled ingestion.']
          : ['CA API collector is real, but CA_SOS_API_KEY is not configured in this environment.']
      }
    }
    case 'TX': {
      const hasBulkAccess = Boolean(
        process.env.TX_SOSDIRECT_API_KEY && process.env.TX_SOSDIRECT_ACCOUNT_ID
      )
      return {
        primaryStrategy: 'bulk',
        availableStrategies: hasBulkAccess ? ['bulk'] : [],
        readiness: hasBulkAccess ? 'operational' : 'blocked',
        notes: hasBulkAccess
          ? ['TX bulk collector is credentialed and available for scheduled ingestion.']
          : ['TX bulk collector is real, but TX SOSDirect credentials are not configured.']
      }
    }
    case 'FL': {
      const hasVendorAccess = Boolean(
        process.env.FL_VENDOR_API_KEY &&
        process.env.FL_VENDOR_API_SECRET &&
        process.env.FL_VENDOR_CONTRACT_ACTIVE === 'true'
      )
      return {
        primaryStrategy: 'vendor',
        availableStrategies: hasVendorAccess ? ['vendor'] : [],
        readiness: hasVendorAccess ? 'operational' : 'blocked',
        notes: hasVendorAccess
          ? ['Florida vendor feed is contract-backed and available for scheduled ingestion.']
          : ['Florida requires an active vendor contract before live ingestion can run.']
      }
    }
    case 'NY':
      return {
        primaryStrategy: 'scrape',
        availableStrategies: [],
        readiness: 'blocked',
        notes: [
          'NY has portal-search code, but no production-ready incremental ingestion collector is wired yet.'
        ]
      }
    default:
      return undefined
  }
}

const US_STATES: StateDefinition[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' }
]

const stateCodeParamSchema = z.object({
  stateCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{2}$/.test(value), {
      message: 'stateCode must be a 2-letter code'
    })
})

function sumRecordsSince(telemetry: RuntimeTelemetry | undefined, days: number): number | null {
  if (!telemetry || telemetry.successes.length === 0) {
    return null
  }

  const threshold = Date.now() - days * 24 * 60 * 60 * 1000

  return telemetry.successes
    .filter((entry) => new Date(entry.completedAt).getTime() >= threshold)
    .reduce((total, entry) => total + entry.recordsProcessed, 0)
}

function calculateErrorRate(telemetry: RuntimeTelemetry | undefined): number | null {
  if (!telemetry) {
    return null
  }

  const attempts = telemetry.successCount + telemetry.failureCount
  if (attempts === 0) {
    return null
  }

  return Number((telemetry.failureCount / attempts).toFixed(2))
}

function resolveRuntimeStatus(
  baseStatus: CoverageStatus,
  telemetry: RuntimeTelemetry | undefined,
  implemented: boolean
): CoverageStatus {
  if (!implemented || !telemetry) {
    return baseStatus
  }

  if (telemetry.circuitState === 'open') {
    return telemetry.lastSuccessfulPull ? 'yellow' : 'red'
  }

  if (telemetry.circuitState === 'half-open') {
    return 'yellow'
  }

  if (telemetry.currentStatus === 'failed') {
    if (!telemetry.lastSuccessfulPull || telemetry.consecutiveFailures >= 2) {
      return 'red'
    }
    return 'yellow'
  }

  if (telemetry.currentStatus === 'running' || telemetry.currentStatus === 'queued') {
    return baseStatus === 'red' ? 'red' : 'yellow'
  }

  return baseStatus
}

function resolveStatusReason(
  state: StateDefinition,
  baseReason: string,
  telemetry: RuntimeTelemetry | undefined
): string {
  if (!telemetry) {
    return baseReason
  }

  if (
    telemetry.currentStatus === 'running' &&
    telemetry.circuitState === 'half-open' &&
    telemetry.currentStrategy
  ) {
    return `Half-open recovery probe running on ${telemetry.currentStrategy}`
  }

  if (telemetry.currentStatus === 'queued' && telemetry.queuedBy === 'self-heal') {
    return (
      telemetry.lastEscalationReason ??
      `Self-healing queued on ${telemetry.currentStrategy ?? 'fallback'}`
    )
  }

  if (telemetry.circuitState === 'open') {
    return telemetry.lastEscalationReason ?? 'Circuit breaker open with exponential backoff'
  }

  if (telemetry.circuitState === 'half-open' && telemetry.currentStrategy) {
    return `Recovery probe active on ${telemetry.currentStrategy}`
  }

  if (telemetry.currentStatus === 'running') {
    return `Ingestion running for ${state.code}`
  }

  if (telemetry.currentStatus === 'queued') {
    return `Queued for ingestion via ${telemetry.queuedBy ?? 'unknown source'}`
  }

  if (telemetry.currentStatus === 'failed' && telemetry.lastError) {
    return `Recent ingestion failure: ${telemetry.lastError}`
  }

  if (telemetry.currentStatus === 'success' && telemetry.lastSuccessfulPull) {
    return 'Operational with recent successful pull'
  }

  return baseReason
}

function buildStateCoverageSnapshot(
  state: StateDefinition,
  commercialInsuranceEnabled: boolean,
  telemetry: RuntimeTelemetry | undefined
): StateCoverageSnapshot {
  const blueprint = getImplementationBlueprint(state.code)
  const isHighValue = HIGH_VALUE_STATES.has(state.code)
  const scheduled = resolveStateIngestionStrategyChain(state.code).length > 0
  const vendorInsuranceEnabled = commercialInsuranceEnabled && isHighValue

  if (!blueprint) {
    const notes = ['No collector implementation is registered for this state yet.']

    if (scheduled) {
      notes.push(
        'The scheduler references this state, but the collector implementation has not been built.'
      )
    }

    if (isHighValue && !vendorInsuranceEnabled) {
      notes.push('High-value state is missing vendor feed insurance.')
    }

    return {
      stateCode: state.code,
      stateName: state.name,
      status: 'red',
      statusReason: 'Not implemented',
      isHighValue,
      scheduled,
      implemented: false,
      primaryStrategy: null,
      fallbackStrategy: null,
      availableStrategies: [],
      vendorInsuranceEnabled,
      telemetry: {
        lastSuccessfulPull: telemetry?.lastSuccessfulPull ?? null,
        records24h: sumRecordsSince(telemetry, 1),
        records7d: sumRecordsSince(telemetry, 7),
        records30d: sumRecordsSince(telemetry, 30),
        errorRate: calculateErrorRate(telemetry),
        currentStrategy: telemetry?.currentStrategy ?? null,
        circuitState: telemetry?.circuitState ?? 'closed',
        circuitBackoffUntil: telemetry?.circuitBackoffUntil ?? null,
        lastEscalatedAt: telemetry?.lastEscalatedAt ?? null,
        lastEscalationReason: telemetry?.lastEscalationReason ?? null,
        escalationCount: telemetry?.escalationCount ?? 0
      },
      notes
    }
  }

  const status =
    blueprint.readiness === 'operational'
      ? 'green'
      : blueprint.readiness === 'partial'
        ? 'yellow'
        : 'red'

  const notes = [
    ...blueprint.notes,
    'Runtime telemetry is currently in-memory until it is persisted.'
  ]

  if (isHighValue && !vendorInsuranceEnabled) {
    notes.push('High-value state still needs vendor feed insurance for failover coverage.')
  }

  if (telemetry?.escalationCount) {
    notes.push(`Self-healing escalated ${telemetry.escalationCount} time(s) for this state.`)
  }

  if (telemetry?.circuitState === 'open' && telemetry.circuitBackoffUntil) {
    notes.push(`Circuit open until ${telemetry.circuitBackoffUntil}.`)
  }

  const baseReason =
    blueprint.readiness === 'operational'
      ? blueprint.fallbackStrategy
        ? 'Operational with fallback'
        : 'Operational'
      : blueprint.readiness === 'partial'
        ? blueprint.fallbackStrategy
          ? 'Partial coverage with fallback'
          : 'Partial coverage'
        : 'Blocked pending external dependency'

  const resolvedStatus = resolveRuntimeStatus(status, telemetry, true)

  return {
    stateCode: state.code,
    stateName: state.name,
    status: resolvedStatus,
    statusReason: resolveStatusReason(state, baseReason, telemetry),
    isHighValue,
    scheduled,
    implemented: true,
    primaryStrategy: blueprint.primaryStrategy,
    fallbackStrategy: blueprint.fallbackStrategy ?? null,
    availableStrategies: blueprint.availableStrategies,
    vendorInsuranceEnabled,
    telemetry: {
      lastSuccessfulPull: telemetry?.lastSuccessfulPull ?? null,
      records24h: sumRecordsSince(telemetry, 1),
      records7d: sumRecordsSince(telemetry, 7),
      records30d: sumRecordsSince(telemetry, 30),
      errorRate: calculateErrorRate(telemetry),
      currentStrategy: telemetry?.currentStrategy ?? blueprint.primaryStrategy,
      circuitState: telemetry?.circuitState ?? 'closed',
      circuitBackoffUntil: telemetry?.circuitBackoffUntil ?? null,
      lastEscalatedAt: telemetry?.lastEscalatedAt ?? null,
      lastEscalationReason: telemetry?.lastEscalationReason ?? null,
      escalationCount: telemetry?.escalationCount ?? 0
    },
    notes
  }
}

function getCoverageDashboardSnapshot(dataTier: 'free-tier' | 'starter-tier') {
  const enabledIntegrations = listEnabledIntegrations(dataTier).filter((name) =>
    name.startsWith('ucc')
  )
  const insuranceProvider =
    dataTier === 'starter-tier' ? resolveUccProvider(dataTier) : 'unconfigured'
  const commercialInsuranceEnabled = insuranceProvider !== 'unconfigured'
  const telemetryByState = new Map(
    getIngestionCoverageTelemetry().map((telemetry) => [telemetry.state, telemetry])
  )
  const states = US_STATES.map((state) =>
    buildStateCoverageSnapshot(state, commercialInsuranceEnabled, telemetryByState.get(state.code))
  )

  const summary = {
    totalStates: states.length,
    greenStates: states.filter((state) => state.status === 'green').length,
    yellowStates: states.filter((state) => state.status === 'yellow').length,
    redStates: states.filter((state) => state.status === 'red').length,
    implementedStates: states.filter((state) => state.implemented).length,
    scheduledStates: states.filter((state) => state.scheduled).length,
    highValueOperationalStates: states.filter(
      (state) => state.isHighValue && state.status !== 'red'
    ).length,
    highValueProtectedStates: states.filter(
      (state) => state.isHighValue && state.vendorInsuranceEnabled
    ).length,
    telemetryWiredStates: states.filter((state) => state.telemetry.lastSuccessfulPull !== null)
      .length,
    openCircuitStates: states.filter((state) => state.telemetry.circuitState === 'open').length,
    statesWithEscalations: states.filter((state) => state.telemetry.escalationCount > 0).length
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'readiness' as const,
    tier: dataTier,
    overallStatus: summary.redStates > 10 ? 'red' : summary.redStates > 0 ? 'yellow' : 'green',
    summary,
    insuranceProvider: commercialInsuranceEnabled ? insuranceProvider : null,
    enabledIntegrations,
    automaticFallbackEnabled: true,
    nextActions: [
      'Persist per-state resilience telemetry so circuit state survives restarts.',
      'Enable vendor feed insurance for CA, TX, FL, and NY.',
      'Expand collectors beyond CA, TX, FL, and NY so scheduled states are not red by default.',
      'Add scheduled portal probes so self-healing reacts before full ingestion failures.'
    ],
    states
  }
}

function getStateCoverageSnapshot(stateCode: string, dataTier: 'free-tier' | 'starter-tier') {
  const normalizedStateCode = stateCode.trim().toUpperCase()
  return (
    getCoverageDashboardSnapshot(dataTier).states.find(
      (state) => state.stateCode === normalizedStateCode
    ) ?? null
  )
}

// GET /api/health - Basic health check
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const isDev = process.env.NODE_ENV === 'development'

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...(isDev && { environment: process.env.NODE_ENV || 'development' })
    })
  })
)

// GET /api/health/detailed - Detailed health check with dependencies
router.get(
  '/detailed',
  asyncHandler(async (req, res) => {
    const isDev = process.env.NODE_ENV === 'development'

    interface HealthCheck {
      status: string
      timestamp: string
      uptime: number
      environment?: string
      services?: {
        database: string
        memory: string
        cpu: string
      }
    }

    const checks: HealthCheck = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      ...(isDev && {
        environment: process.env.NODE_ENV || 'development',
        services: {
          database: 'unknown',
          memory: 'ok',
          cpu: 'ok'
        }
      })
    }

    // Check database
    try {
      await database.query('SELECT 1')
      if (checks.services) {
        checks.services.database = 'ok'
      }
    } catch {
      if (checks.services) {
        checks.services.database = 'error'
      }
      checks.status = 'degraded'
    }

    // Check memory usage (only report in dev)
    if (isDev && checks.services) {
      const memUsage = process.memoryUsage()
      const memUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
      const memTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024)

      if (memUsedMB / memTotalMB > 0.9) {
        checks.services.memory = 'warning'
        checks.status = 'degraded'
      }
    }

    res.json(checks)
  })
)

// GET /api/health/ready - Readiness probe for Kubernetes
router.get(
  '/ready',
  asyncHandler(async (req, res) => {
    try {
      // Check if database is ready
      await database.query('SELECT 1')

      res.status(200).json({
        ready: true,
        timestamp: new Date().toISOString()
      })
    } catch {
      res.status(503).json({
        ready: false,
        error: 'Database not ready',
        timestamp: new Date().toISOString()
      })
    }
  })
)

// GET /api/health/live - Liveness probe for Kubernetes
router.get('/live', (req, res) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString()
  })
})

// GET /api/health/coverage - 50-state readiness snapshot
router.get(
  '/coverage',
  asyncHandler(async (req, res) => {
    const dataTier = getResolvedDataTier(req)
    res.json(getCoverageDashboardSnapshot(dataTier))
  })
)

// GET /api/health/coverage/:stateCode - state-specific readiness snapshot
router.get(
  '/coverage/:stateCode',
  validateRequest({ params: stateCodeParamSchema }),
  asyncHandler(async (req, res) => {
    const dataTier = getResolvedDataTier(req)
    const { stateCode } = req.params as z.infer<typeof stateCodeParamSchema>
    const state = getStateCoverageSnapshot(stateCode, dataTier)

    if (!state) {
      res.status(404).json({
        message: `Unknown state code: ${stateCode}`
      })
      return
    }

    res.json(state)
  })
)

export default router
