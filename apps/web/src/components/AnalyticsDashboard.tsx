import { useState, useMemo } from 'react'
import { Prospect, PortfolioCompany, type DataTier } from '@public-records/core'
import { Card } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Label } from '@public-records/ui/label'
import { CoverageDashboard } from '@/components/CoverageDashboard'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import { ChartBar, Download } from '@phosphor-icons/react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type PieLabelRenderProps
} from 'recharts'

interface AnalyticsDashboardProps {
  prospects: Prospect[]
  portfolio: PortfolioCompany[]
  dataTier?: DataTier
  usePreviewData?: boolean
}

type DateRangeOption = '7d' | '30d' | '90d' | 'custom'

export function AnalyticsDashboard({
  prospects,
  portfolio,
  dataTier = 'oss',
  usePreviewData = false
}: AnalyticsDashboardProps) {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [industryFilter, setIndustryFilter] = useState<string>('all')

  const dateRangeFilter = useMemo(() => {
    const now = new Date()
    let startDate: Date

    if (dateRange === 'custom') {
      startDate = customStartDate ? new Date(customStartDate) : new Date(0)
    } else {
      const daysMap = { '7d': 7, '30d': 30, '90d': 90 }
      startDate = new Date(now.getTime() - daysMap[dateRange] * 24 * 60 * 60 * 1000)
    }

    const endDate = dateRange === 'custom' && customEndDate ? new Date(customEndDate) : now

    return { startDate, endDate }
  }, [dateRange, customStartDate, customEndDate])

  const filteredData = useMemo(() => {
    const { startDate, endDate } = dateRangeFilter

    return {
      prospects: prospects.filter((p) => {
        const matchesIndustry = industryFilter === 'all' || p.industry === industryFilter
        // Filter by growth signal dates within range
        const hasRecentSignals = p.growthSignals.some((s) => {
          const signalDate = new Date(s.detectedDate)
          return signalDate >= startDate && signalDate <= endDate
        })
        // A prospect with no signals at all has nothing to date-filter on, so it
        // stays visible; otherwise require at least one signal inside the range.
        const hasNoSignals = p.growthSignals.length === 0
        return matchesIndustry && (hasNoSignals || hasRecentSignals)
      })
    }
  }, [prospects, industryFilter, dateRangeFilter])

  // Calculate metrics
  const metrics = useMemo(() => {
    const { prospects: filteredProspects } = filteredData

    const avgPriorityScore =
      filteredProspects.length > 0
        ? Math.round(
            filteredProspects.reduce((sum, p) => sum + p.priorityScore, 0) /
              filteredProspects.length
          )
        : 0

    const avgMLConfidence =
      filteredProspects.length > 0
        ? Math.round(
            filteredProspects.reduce((sum, p) => sum + (p.mlScoring?.confidence || 0), 0) /
              filteredProspects.length
          )
        : 0

    const avgRecoveryLikelihood =
      filteredProspects.length > 0
        ? Math.round(
            filteredProspects.reduce((sum, p) => sum + (p.mlScoring?.recoveryLikelihood || 0), 0) /
              filteredProspects.length
          )
        : 0

    const highValueProspects = filteredProspects.filter((p) => p.priorityScore >= 70).length
    const totalSignals = filteredProspects.reduce((sum, p) => sum + p.growthSignals.length, 0)

    return {
      totalProspects: filteredProspects.length,
      highValueProspects,
      avgPriorityScore,
      avgMLConfidence,
      avgRecoveryLikelihood,
      totalSignals
    }
  }, [filteredData])

  // Industry distribution
  const industryData = useMemo(() => {
    const distribution = filteredData.prospects.reduce(
      (acc, p) => {
        acc[p.industry] = (acc[p.industry] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    return Object.entries(distribution).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value
    }))
  }, [filteredData])

  // Score distribution
  const scoreDistribution = useMemo(() => {
    const ranges = [
      { name: '0-20', min: 0, max: 20 },
      { name: '21-40', min: 21, max: 40 },
      { name: '41-60', min: 41, max: 60 },
      { name: '61-80', min: 61, max: 80 },
      { name: '81-100', min: 81, max: 100 }
    ]

    return ranges.map((range) => ({
      name: range.name,
      prospects: filteredData.prospects.filter(
        (p) => p.priorityScore >= range.min && p.priorityScore <= range.max
      ).length
    }))
  }, [filteredData])

  // Signal trend over time
  const signalTrend = useMemo(() => {
    const { startDate, endDate } = dateRangeFilter
    // Guard against malformed custom ranges (start after end) and runaway loops
    // from absurd ranges by clamping the span to a sane maximum.
    const MAX_TREND_DAYS = 365 * 5
    const rawDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const days = Math.min(MAX_TREND_DAYS, Math.max(0, Number.isFinite(rawDays) ? rawDays : 0))
    const interval = Math.max(1, Math.floor(days / 10)) // Show max 10 data points

    const data: { date: string; signals: number }[] = []

    for (let i = 0; i <= days; i += interval) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000)
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

      const signalCount = filteredData.prospects.reduce((sum, p) => {
        return (
          sum +
          p.growthSignals.filter((s) => {
            const signalDate = new Date(s.detectedDate)
            return signalDate <= date
          }).length
        )
      }, 0)

      data.push({ date: dateStr, signals: signalCount })
    }

    return data
  }, [filteredData, dateRangeFilter])

  // Health grade distribution
  const healthGradeData = useMemo(() => {
    const grades = ['A', 'B', 'C', 'D', 'F']
    return grades.map((grade) => ({
      name: grade,
      count: filteredData.prospects.filter((p) => p.healthScore.grade === grade).length
    }))
  }, [filteredData])

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

  const industries = Array.from(new Set(prospects.map((p) => p.industry)))

  const exportData = () => {
    const data = {
      dateRange: dateRange === 'custom' ? `${customStartDate} to ${customEndDate}` : dateRange,
      portfolioCount: portfolio.length,
      industryFilter,
      metrics,
      industryDistribution: industryData,
      scoreDistribution,
      healthGradeDistribution: healthGradeData,
      signalTrend
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analytics-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <CoverageDashboard dataTier={dataTier} usePreviewData={usePreviewData} />

      {/* Filters */}
      <Card className="p-6 glass-effect">
        <div className="flex items-center gap-2 mb-4">
          <ChartBar size={24} weight="fill" className="text-primary" />
          <h2 className="text-xl font-semibold">Analytics Dashboard</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="mb-2 block">Date Range</Label>
            <Select value={dateRange} onValueChange={(val) => setDateRange(val as DateRangeOption)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {dateRange === 'custom' && (
            <>
              <div>
                <Label className="mb-2 block">Start Date</Label>
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-2 block">End Date</Label>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <Label className="mb-2 block">Industry</Label>
            <Select value={industryFilter} onValueChange={setIndustryFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Industries</SelectItem>
                {industries.map((ind) => (
                  <SelectItem key={ind} value={ind} className="capitalize">
                    {ind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button variant="outline" size="sm" onClick={exportData}>
            <Download size={16} weight="bold" className="mr-2" />
            Export Analytics
          </Button>
        </div>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">Total Prospects</div>
          <div className="text-2xl font-bold">{metrics.totalProspects}</div>
        </Card>
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">High Value</div>
          <div className="text-2xl font-bold text-success">{metrics.highValueProspects}</div>
        </Card>
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">Avg Priority</div>
          <div className="text-2xl font-bold">{metrics.avgPriorityScore}</div>
        </Card>
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">Avg ML Confidence</div>
          <div className="text-2xl font-bold">{metrics.avgMLConfidence}%</div>
        </Card>
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">Avg Recovery</div>
          <div className="text-2xl font-bold">{metrics.avgRecoveryLikelihood}%</div>
        </Card>
        <Card className="p-4 glass-effect">
          <div className="text-sm text-muted-foreground mb-1">Total Signals</div>
          <div className="text-2xl font-bold">{metrics.totalSignals}</div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Signal Trend */}
        <Card className="p-6 glass-effect">
          <h3 className="font-semibold mb-4">Growth Signals Over Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={signalTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="signals" stroke="#8884d8" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Score Distribution */}
        <Card className="p-6 glass-effect">
          <h3 className="font-semibold mb-4">Priority Score Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={scoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="prospects" fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Industry Distribution */}
        <Card className="p-6 glass-effect">
          <h3 className="font-semibold mb-4">Industry Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={industryData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry: PieLabelRenderProps) =>
                  `${String(entry.name ?? '')} ${((entry.percent ?? 0) * 100).toFixed(0)}%`
                }
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {industryData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        {/* Health Grade Distribution */}
        <Card className="p-6 glass-effect">
          <h3 className="font-semibold mb-4">Health Grade Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={healthGradeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#ff7300" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}
