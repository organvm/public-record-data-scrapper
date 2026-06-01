import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { AnalyticsDashboard } from '../AnalyticsDashboard'
import type { Prospect, PortfolioCompany } from '@public-records/core'

// Mock UI components
vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    size,
    className
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
    size?: string
    className?: string
  }) => (
    <button onClick={onClick} data-variant={variant} data-size={size} className={className}>
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/input', () => ({
  Input: ({
    type,
    value,
    onChange,
    className
  }: {
    type?: string
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    className?: string
  }) => (
    <input
      type={type}
      value={value}
      onChange={onChange}
      className={className}
      data-testid={`input-${type || 'text'}`}
    />
  )
}))

vi.mock('@public-records/ui/label', () => ({
  Label: ({ children, className }: { children: ReactNode; className?: string }) => (
    <label className={className}>{children}</label>
  )
}))

vi.mock('@public-records/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange
  }: {
    children: ReactNode
    value?: string
    onValueChange?: (val: string) => void
  }) => (
    <div data-testid="select">
      <select
        data-testid="select-native"
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        <option value="7d">Last 7 Days</option>
        <option value="30d">Last 30 Days</option>
        <option value="90d">Last 90 Days</option>
        <option value="custom">Custom Range</option>
        <option value="all">All Industries</option>
        <option value="construction">construction</option>
        <option value="restaurant">restaurant</option>
      </select>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null
}))

// Mock CoverageDashboard to avoid deep transitive import chain
vi.mock('@/components/CoverageDashboard', () => ({
  CoverageDashboard: () => <div data-testid="coverage-dashboard">Coverage</div>
}))

vi.mock('@phosphor-icons/react', () => {
  const stub = ({ className }: { className?: string }) => (
    <span data-testid="icon-stub" className={className} />
  )
  return {
    ChartBar: ({ className }: { className?: string }) => (
      <span data-testid="chart-icon" className={className} />
    ),
    Calendar: ({ className }: { className?: string }) => (
      <span data-testid="calendar-icon" className={className} />
    ),
    Download: ({ className }: { className?: string }) => (
      <span data-testid="download-icon" className={className} />
    ),
    // Icons used by CoverageDashboard (imported by AnalyticsDashboard)
    ShieldCheck: stub,
    WarningCircle: stub,
    WarningOctagon: stub,
    ArrowsClockwise: stub,
    Broadcast: stub,
    Pulse: stub,
    LockKey: stub
  }
})

// Mock recharts
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  BarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  PieChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  )
}))

// Mock URL
const mockCreateObjectURL = vi.fn(() => 'mock-url')
const mockRevokeObjectURL = vi.fn()

// Recent date within the default 30-day range. The dashboard's date filter is
// now functional (the previous `|| true` no-op was removed), so prospects with
// signals must fall inside the active window to be counted.
const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()

describe('AnalyticsDashboard', () => {
  const mockProspects: Prospect[] = [
    {
      id: 'prospect-1',
      companyName: 'Company A',
      industry: 'construction',
      state: 'CA',
      priorityScore: 85,
      status: 'new',
      healthScore: {
        grade: 'A',
        score: 92,
        sentimentTrend: 'improving',
        reviewCount: 10,
        violationCount: 0,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      },
      timeSinceDefault: 730,
      defaultDate: '2022-01-15',
      narrative: 'Test',
      growthSignals: [
        {
          id: 's1',
          type: 'hiring',
          description: 'Hiring',
          score: 75,
          confidence: 0.9,
          detectedDate: recentDate
        }
      ],
      uccFilings: [],
      mlScoring: {
        confidence: 88,
        recoveryLikelihood: 75,
        modelVersion: '1.0',
        factors: {},
        lastUpdated: '2024-01-15'
      }
    },
    {
      id: 'prospect-2',
      companyName: 'Company B',
      industry: 'restaurant',
      state: 'TX',
      priorityScore: 72,
      status: 'claimed',
      healthScore: {
        grade: 'B',
        score: 78,
        sentimentTrend: 'stable',
        reviewCount: 8,
        violationCount: 1,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      },
      timeSinceDefault: 365,
      defaultDate: '2023-01-15',
      narrative: 'Test',
      growthSignals: [
        {
          id: 's2',
          type: 'expansion',
          description: 'Expanding',
          score: 75,
          confidence: 0.8,
          detectedDate: recentDate
        }
      ],
      uccFilings: [],
      mlScoring: {
        confidence: 75,
        recoveryLikelihood: 68,
        modelVersion: '1.0',
        factors: {},
        lastUpdated: '2024-01-10'
      }
    },
    {
      id: 'prospect-3',
      companyName: 'Company C',
      industry: 'construction',
      state: 'NY',
      priorityScore: 45,
      status: 'new',
      healthScore: {
        grade: 'C',
        score: 55,
        sentimentTrend: 'declining',
        reviewCount: 5,
        violationCount: 2,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      },
      timeSinceDefault: 1095,
      defaultDate: '2021-01-15',
      narrative: 'Test',
      growthSignals: [],
      uccFilings: []
    }
  ]

  const mockPortfolio: PortfolioCompany[] = []

  const defaultProps = {
    prospects: mockProspects,
    portfolio: mockPortfolio
  }

  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = mockCreateObjectURL
    global.URL.revokeObjectURL = mockRevokeObjectURL
  })

  describe('rendering', () => {
    it('renders the dashboard title', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
    })

    it('renders chart icon', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByTestId('chart-icon')).toBeInTheDocument()
    })
  })

  describe('filters', () => {
    it('renders date range selector', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Date Range')).toBeInTheDocument()
    })

    it('renders industry selector', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Industry')).toBeInTheDocument()
    })

    it('shows custom date inputs when custom range selected', async () => {
      render(<AnalyticsDashboard {...defaultProps} />)

      const selects = screen.getAllByTestId('select-native')
      await userEvent.selectOptions(selects[0], 'custom')

      expect(screen.getByText('Start Date')).toBeInTheDocument()
      expect(screen.getByText('End Date')).toBeInTheDocument()
    })
  })

  describe('metrics', () => {
    it('displays total prospects count', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Total Prospects')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('displays high value prospects label', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('High Value')).toBeInTheDocument()
    })

    it('displays average priority score', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Avg Priority')).toBeInTheDocument()
      // (85 + 72 + 45) / 3 = 67 rounded
      expect(screen.getByText('67')).toBeInTheDocument()
    })

    it('displays average ML confidence', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Avg ML Confidence')).toBeInTheDocument()
    })

    it('displays average recovery likelihood', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Avg Recovery')).toBeInTheDocument()
    })

    it('displays total signals label', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Total Signals')).toBeInTheDocument()
    })
  })

  describe('charts', () => {
    it('renders growth signals chart', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Growth Signals Over Time')).toBeInTheDocument()
      expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    })

    it('renders score distribution chart', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Priority Score Distribution')).toBeInTheDocument()
      // Find bar chart for score distribution
      const barCharts = screen.getAllByTestId('bar-chart')
      expect(barCharts.length).toBeGreaterThan(0)
    })

    it('renders industry distribution chart', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Industry Distribution')).toBeInTheDocument()
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument()
    })

    it('renders health grade distribution chart', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Health Grade Distribution')).toBeInTheDocument()
    })
  })

  describe('export functionality', () => {
    it('renders export button', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByRole('button', { name: /export analytics/i })).toBeInTheDocument()
    })

    it('shows download icon', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByTestId('download-icon')).toBeInTheDocument()
    })

    it('has export button functionality', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      const exportButton = screen.getByRole('button', { name: /export analytics/i })
      expect(exportButton).toBeInTheDocument()
    })
  })

  describe('industry filtering', () => {
    it('renders industry filter', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Industry')).toBeInTheDocument()
    })
  })

  describe('date filtering', () => {
    it('renders date range filter', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      expect(screen.getByText('Date Range')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('handles empty prospects array', () => {
      render(<AnalyticsDashboard {...defaultProps} prospects={[]} />)
      expect(screen.getByText('Analytics Dashboard')).toBeInTheDocument()
    })
  })

  describe('responsive containers', () => {
    it('wraps charts in responsive containers', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      const containers = screen.getAllByTestId('responsive-container')
      expect(containers.length).toBeGreaterThan(0)
    })
  })

  describe('metrics cards', () => {
    it('renders metric cards', () => {
      render(<AnalyticsDashboard {...defaultProps} />)
      const cards = screen.getAllByTestId('card')
      expect(cards.length).toBeGreaterThan(0)
    })
  })
})
