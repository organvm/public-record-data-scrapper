import { useMemo, type ElementType } from 'react'
import type { CompetitorData, DataTier, PortfolioCompany, Prospect } from '@public-records/core'
import type { UserAction } from '@/lib/agentic/types'
import { Badge } from '@public-records/ui/badge'
import { Button } from '@public-records/ui/button'
import { Card } from '@public-records/ui/card'
import {
  ArrowClockwise,
  Broadcast,
  ChartBar,
  Clock,
  Database,
  Pulse,
  Target,
  TrendUp,
  Users,
  WarningCircle
} from '@phosphor-icons/react'

export type StatusTone = 'ok' | 'loading' | 'attention'

interface StatusDashboardProps {
  prospects: Prospect[]
  portfolio: PortfolioCompany[]
  competitors: CompetitorData[]
  userActions: UserAction[]
  isLoading: boolean
  loadError: string | null
  lastDataRefresh: string
  usePreviewData: boolean
  dataTier: DataTier
  onRefresh: () => void
}

export interface StatusDashboardMetricInput {
  prospects: Prospect[]
  portfolio: PortfolioCompany[]
  competitors: CompetitorData[]
  userActions: UserAction[]
  isLoading: boolean
  loadError: string | null
  lastDataRefresh: string
  usePreviewData: boolean
  dataTier: DataTier
}

export interface StateUsageBreakdown {
  state: string
  prospects: number
  filings: number
}

export interface StatusDashboardMetrics {
  statusTone: StatusTone
  statusLabel: string
  statusDetail: string
  dataModeLabel: string
  dataTierLabel: string
  lastRefreshLabel: string
  totalProspects: number
  totalFilings: number
  activeFilings: number
  statesCovered: number
  highValueProspects: number
  highValueRate: number
  signals24h: number
  portfolioAtRisk: number
  competitorCount: number
  actions24h: number
  totalActions: number
  latestActionLabel: string
  latestActionTimeLabel: string
  mostCommonActionLabel: string
  stateBreakdown: StateUsageBreakdown[]
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function isWithinLast24Hours(value: string, now: Date): boolean {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return false
  const ageMs = now.getTime() - timestamp
  return ageMs >= 0 && ageMs <= ONE_DAY_MS
}

function formatActionType(type: string | null | undefined): string {
  if (!type) return 'None'

  const spaced = type
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()

  if (!spaced) return 'None'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function formatRelativeTime(value: string | null | undefined, now: Date): string {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return 'Never'

  const diffMs = now.getTime() - timestamp
  const absMs = Math.abs(diffMs)
  const suffix = diffMs >= 0 ? 'ago' : 'from now'

  if (absMs < 60_000) return diffMs >= 0 ? 'Just now' : 'Soon'

  const minutes = Math.round(absMs / 60_000)
  if (minutes < 60) return `${minutes}m ${suffix}`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ${suffix}`

  const days = Math.round(hours / 24)
  return `${days}d ${suffix}`
}

function buildStateBreakdown(prospects: Prospect[]): StateUsageBreakdown[] {
  const states = new Map<string, StateUsageBreakdown>()

  for (const prospect of prospects) {
    const state = prospect.state || 'Unknown'
    const current = states.get(state) ?? { state, prospects: 0, filings: 0 }
    current.prospects += 1
    current.filings += prospect.uccFilings.length
    states.set(state, current)
  }

  return [...states.values()].sort((left, right) => {
    if (right.prospects !== left.prospects) return right.prospects - left.prospects
    if (right.filings !== left.filings) return right.filings - left.filings
    return left.state.localeCompare(right.state)
  })
}

function findLatestAction(userActions: UserAction[]): UserAction | null {
  return userActions.reduce<UserAction | null>((latest, action) => {
    const actionTime = parseTimestamp(action.timestamp)
    if (actionTime === null) return latest

    const latestTime = parseTimestamp(latest?.timestamp)
    return latestTime === null || actionTime > latestTime ? action : latest
  }, null)
}

function findMostCommonAction(userActions: UserAction[]): string {
  if (userActions.length === 0) return 'None'

  const counts = new Map<string, number>()
  for (const action of userActions) {
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1)
  }

  let mostCommon = ''
  let mostCommonCount = 0
  for (const [type, count] of counts.entries()) {
    if (count > mostCommonCount || (count === mostCommonCount && type < mostCommon)) {
      mostCommon = type
      mostCommonCount = count
    }
  }

  return formatActionType(mostCommon)
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildStatusDashboardMetrics(
  input: StatusDashboardMetricInput,
  now: Date = new Date()
): StatusDashboardMetrics {
  const {
    prospects,
    portfolio,
    competitors,
    userActions,
    isLoading,
    loadError,
    lastDataRefresh,
    usePreviewData,
    dataTier
  } = input

  const totalFilings = prospects.reduce((sum, prospect) => sum + prospect.uccFilings.length, 0)
  const activeFilings = prospects.reduce(
    (sum, prospect) =>
      sum + prospect.uccFilings.filter((filing) => filing.status === 'active').length,
    0
  )
  const highValueProspects = prospects.filter((prospect) => prospect.priorityScore >= 70).length
  const highValueRate =
    prospects.length > 0 ? Math.round((highValueProspects / prospects.length) * 100) : 0
  const signals24h = prospects.reduce(
    (sum, prospect) =>
      sum +
      prospect.growthSignals.filter((signal) => isWithinLast24Hours(signal.detectedDate, now))
        .length,
    0
  )
  const portfolioAtRisk = portfolio.filter(
    (company) => company.currentStatus === 'at-risk' || company.currentStatus === 'default'
  ).length
  const actions24h = userActions.filter((action) =>
    isWithinLast24Hours(action.timestamp, now)
  ).length
  const latestAction = findLatestAction(userActions)
  const stateBreakdown = buildStateBreakdown(prospects)

  const statusTone: StatusTone = isLoading ? 'loading' : loadError ? 'attention' : 'ok'
  const statusLabel =
    statusTone === 'loading' ? 'Loading' : statusTone === 'attention' ? 'Needs attention' : 'Online'
  const statusDetail =
    statusTone === 'loading'
      ? 'Data refresh in progress'
      : loadError
        ? loadError
        : `${prospects.length.toLocaleString()} prospects loaded`

  return {
    statusTone,
    statusLabel,
    statusDetail,
    dataModeLabel: usePreviewData ? 'Preview data' : 'Live API',
    dataTierLabel: dataTier === 'paid' ? 'Paid' : 'OSS',
    lastRefreshLabel: formatRelativeTime(lastDataRefresh, now),
    totalProspects: prospects.length,
    totalFilings,
    activeFilings,
    statesCovered: stateBreakdown.length,
    highValueProspects,
    highValueRate,
    signals24h,
    portfolioAtRisk,
    competitorCount: competitors.length,
    actions24h,
    totalActions: userActions.length,
    latestActionLabel: formatActionType(latestAction?.type),
    latestActionTimeLabel: latestAction ? formatRelativeTime(latestAction.timestamp, now) : 'Never',
    mostCommonActionLabel: findMostCommonAction(userActions),
    stateBreakdown
  }
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  className = ''
}: {
  label: string
  value: string
  detail: string
  icon: ElementType
  className?: string
}) {
  return (
    <Card className={`glass-effect rounded-lg border-white/10 p-4 gap-0 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-white/60">{label}</span>
        <Icon size={18} weight="fill" className="shrink-0 text-white/70" />
      </div>
      <div className="mt-3 text-2xl font-semibold font-mono text-white">{value}</div>
      <div className="mt-1 min-h-[1rem] text-xs text-white/60">{detail}</div>
    </Card>
  )
}

const statusToneClass: Record<StatusTone, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  loading: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  attention: 'border-rose-500/30 bg-rose-500/10 text-rose-200'
}

const statusRowClass = [
  'flex items-center justify-between gap-4 border-b border-white/10',
  'py-2.5 last:border-b-0'
].join(' ')

const stateRowClass = [
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4',
  'border-b border-white/10 px-3 py-3 text-sm last:border-b-0'
].join(' ')

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={statusRowClass}>
      <span className="text-sm text-white/60">{label}</span>
      <span className="text-right text-sm font-medium text-white">{value}</span>
    </div>
  )
}

export function StatusDashboard({
  prospects,
  portfolio,
  competitors,
  userActions,
  isLoading,
  loadError,
  lastDataRefresh,
  usePreviewData,
  dataTier,
  onRefresh
}: StatusDashboardProps) {
  const metrics = useMemo(
    () =>
      buildStatusDashboardMetrics({
        prospects,
        portfolio,
        competitors,
        userActions,
        isLoading,
        loadError,
        lastDataRefresh,
        usePreviewData,
        dataTier
      }),
    [
      prospects,
      portfolio,
      competitors,
      userActions,
      isLoading,
      loadError,
      lastDataRefresh,
      usePreviewData,
      dataTier
    ]
  )

  const summaryCards = [
    {
      label: 'Prospects',
      value: metrics.totalProspects.toLocaleString(),
      detail: `${metrics.highValueProspects.toLocaleString()} high-value`,
      icon: Target
    },
    {
      label: 'UCC filings',
      value: metrics.totalFilings.toLocaleString(),
      detail: `${metrics.activeFilings.toLocaleString()} active`,
      icon: Database
    },
    {
      label: 'States covered',
      value: metrics.statesCovered.toLocaleString(),
      detail: metrics.stateBreakdown[0]?.state
        ? `Top state: ${metrics.stateBreakdown[0].state}`
        : 'No state data',
      icon: Broadcast
    },
    {
      label: 'Signals 24h',
      value: metrics.signals24h.toLocaleString(),
      detail: `${metrics.highValueRate}% high-value rate`,
      icon: TrendUp
    },
    {
      label: 'Portfolio risk',
      value: metrics.portfolioAtRisk.toLocaleString(),
      detail: `${metrics.competitorCount.toLocaleString()} competitors tracked`,
      icon: WarningCircle
    },
    {
      label: 'Actions 24h',
      value: metrics.actions24h.toLocaleString(),
      detail: `${metrics.totalActions.toLocaleString()} total tracked`,
      icon: Users
    }
  ]

  const topStates = metrics.stateBreakdown.slice(0, 5)

  return (
    <div className="space-y-4 sm:space-y-6">
      <section
        className={`rounded-lg border p-4 sm:p-5 ${statusToneClass[metrics.statusTone]}`}
        aria-label="Product status"
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Pulse size={22} weight="fill" />
              <h2 className="text-xl font-semibold text-white">Product Status</h2>
              <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
                {metrics.statusLabel}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/75">
              <span>{metrics.statusDetail}</span>
              <span>Last refresh: {metrics.lastRefreshLabel}</span>
              <span>{metrics.dataModeLabel}</span>
              <span>{metrics.dataTierLabel}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-10 shrink-0 border-white/30 bg-white/10 text-white hover:bg-white/15"
          >
            <ArrowClockwise size={16} weight="bold" className={isLoading ? 'animate-spin' : ''} />
            <span className="ml-2">Refresh status</span>
          </Button>
        </div>
      </section>

      <section
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
        aria-label="Key metrics"
      >
        {summaryCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass-effect rounded-lg border border-white/10 p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <ChartBar size={18} weight="fill" className="text-white/80" />
            <h3 className="text-base font-semibold text-white">Data Status</h3>
          </div>
          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            <StatusRow label="Mode" value={metrics.dataModeLabel} />
            <StatusRow label="Tier" value={metrics.dataTierLabel} />
            <StatusRow label="Last refresh" value={metrics.lastRefreshLabel} />
            <StatusRow label="States covered" value={metrics.statesCovered.toLocaleString()} />
            <StatusRow label="Active filings" value={metrics.activeFilings.toLocaleString()} />
            <StatusRow label="Total filings" value={metrics.totalFilings.toLocaleString()} />
          </div>
        </div>

        <div className="glass-effect rounded-lg border border-white/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock size={18} weight="fill" className="text-white/80" />
            <h3 className="text-base font-semibold text-white">Usage</h3>
          </div>
          <StatusRow label="Actions 24h" value={metrics.actions24h.toLocaleString()} />
          <StatusRow label="Tracked actions" value={metrics.totalActions.toLocaleString()} />
          <StatusRow label="Top action" value={metrics.mostCommonActionLabel} />
          <StatusRow label="Latest action" value={metrics.latestActionLabel} />
          <StatusRow label="Latest activity" value={metrics.latestActionTimeLabel} />
        </div>
      </section>

      <section className="glass-effect rounded-lg border border-white/10 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Database size={18} weight="fill" className="text-white/80" />
          <h3 className="text-base font-semibold text-white">Top States</h3>
        </div>

        {topStates.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-white/10">
            {topStates.map((state) => (
              <div key={state.state} className={stateRowClass}>
                <span className="font-semibold text-white">{state.state}</span>
                <span className="text-white/70">{state.prospects.toLocaleString()} prospects</span>
                <span className="text-white/70">{state.filings.toLocaleString()} filings</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 px-3 py-4 text-sm text-white/60">
            No state usage has been recorded yet.
          </div>
        )}
      </section>
    </div>
  )
}
