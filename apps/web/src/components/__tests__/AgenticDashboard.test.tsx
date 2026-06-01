/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { AgenticDashboard } from '../AgenticDashboard'
import type { CompetitorData } from '@public-records/core'
import type { Improvement, SystemHealth } from '@/lib/agentic/types'
import type { UseAgenticEngineResult } from '@/hooks/use-agentic-engine'

// Note: AgenticDashboard has complex internal components that are difficult to mock
// These tests focus on the main dashboard rendering and interactions

// Mock nested components
vi.mock('../CompetitorAnalysis', () => ({
  default: () => <div data-testid="competitor-analysis">Competitor Analysis</div>
}))

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
    disabled,
    className
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    className?: string
  }) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/badge', () => ({
  Badge: ({
    children,
    variant,
    className
  }: {
    children: ReactNode
    variant?: string
    className?: string
  }) => (
    <span data-testid="badge" data-variant={variant} className={className}>
      {children}
    </span>
  )
}))

vi.mock('@public-records/ui/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid="progress" data-value={value} className={className} />
  )
}))

vi.mock('@public-records/ui/tabs', () => ({
  Tabs: ({ children, value }: { children: ReactNode; value?: string }) => (
    <div data-testid="tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsContent: ({
    children,
    value,
    className
  }: {
    children: ReactNode
    value: string
    className?: string
  }) => (
    <div data-testid={`tab-content-${value}`} className={className}>
      {children}
    </div>
  ),
  TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="tabs-list" className={className}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
    <button data-testid={`tab-trigger-${value}`}>{children}</button>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  Robot: ({ className }: { className?: string }) => (
    <span data-testid="robot-icon" className={className} />
  ),
  Brain: ({ className }: { className?: string }) => (
    <span data-testid="brain-icon" className={className} />
  ),
  CheckCircle: ({ className }: { className?: string }) => (
    <span data-testid="check-icon" className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span data-testid="clock-icon" className={className} />
  ),
  Warning: ({ className }: { className?: string }) => (
    <span data-testid="warning-icon" className={className} />
  ),
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up" className={className} />
  ),
  Shield: ({ className }: { className?: string }) => (
    <span data-testid="shield-icon" className={className} />
  ),
  Sparkle: ({ className }: { className?: string }) => (
    <span data-testid="sparkle-icon" className={className} />
  ),
  Users: ({ className }: { className?: string }) => (
    <span data-testid="users-icon" className={className} />
  ),
  Target: ({ className }: { className?: string }) => (
    <span data-testid="target-icon" className={className} />
  ),
  LightbulbFilament: ({ className }: { className?: string }) => (
    <span data-testid="lightbulb-icon" className={className} />
  )
}))

describe('AgenticDashboard', () => {
  const mockSystemHealth: SystemHealth = {
    totalImprovements: 15,
    implemented: 10,
    pending: 3,
    successRate: 85,
    avgSafetyScore: 92
  }

  const mockImprovements: Improvement[] = []

  const mockCompetitors: CompetitorData[] = [
    {
      lenderName: 'Competitor A',
      filingCount: 1000,
      avgDealSize: 200000,
      marketShare: 25,
      monthlyTrend: 5,
      topState: 'CA',
      industries: ['construction']
    }
  ]

  const mockAgentic: UseAgenticEngineResult = {
    systemHealth: mockSystemHealth,
    improvements: mockImprovements,
    isRunning: false,
    runCycle: vi.fn().mockResolvedValue(undefined),
    approveImprovement: vi.fn().mockResolvedValue(undefined),
    engine: null as any,
    getImprovementsByStatus: vi.fn(() => [])
  }

  const defaultProps = {
    agentic: mockAgentic,
    competitors: mockCompetitors
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the dashboard title', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Agentic Forces')).toBeInTheDocument()
    })

    it('renders subtitle', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText(/Autonomous System Improvement/)).toBeInTheDocument()
    })

    it('renders robot icon', () => {
      render(<AgenticDashboard {...defaultProps} />)
      const robotIcons = screen.getAllByTestId('robot-icon')
      expect(robotIcons.length).toBeGreaterThan(0)
    })
  })

  describe('run cycle button', () => {
    it('renders run council review button', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByRole('button', { name: /run council review/i })).toBeInTheDocument()
    })

    it('calls runCycle when button clicked', async () => {
      const runCycle = vi.fn()
      const agentic = { ...mockAgentic, runCycle }
      render(<AgenticDashboard {...defaultProps} agentic={agentic} />)

      await userEvent.click(screen.getByRole('button', { name: /run council review/i }))
      expect(runCycle).toHaveBeenCalled()
    })

    it('shows loading state when running', () => {
      const running = { ...mockAgentic, isRunning: true }
      render(<AgenticDashboard {...defaultProps} agentic={running} />)

      expect(screen.getByRole('button', { name: /running analysis/i })).toBeDisabled()
    })

    it('disables button when running', () => {
      const running = { ...mockAgentic, isRunning: true }
      render(<AgenticDashboard {...defaultProps} agentic={running} />)

      expect(screen.getByRole('button', { name: /running/i })).toBeDisabled()
    })
  })

  describe('system health metrics', () => {
    it('displays total improvements', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Total Improvements')).toBeInTheDocument()
      expect(screen.getByText('15')).toBeInTheDocument()
    })

    it('displays implemented count', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Implemented')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('displays pending count', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Pending Review')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('displays success rate', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Success Rate')).toBeInTheDocument()
      expect(screen.getByText('85%')).toBeInTheDocument()
    })
  })

  describe('safety score', () => {
    it('displays average safety score', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('Average Safety Score')).toBeInTheDocument()
      expect(screen.getByText('92/100')).toBeInTheDocument()
    })

    it('renders safety score progress bar', () => {
      render(<AgenticDashboard {...defaultProps} />)
      const progress = screen.getAllByTestId('progress')
      expect(progress.some((p) => p.getAttribute('data-value') === '92')).toBe(true)
    })
  })

  describe('tabs', () => {
    it('renders tabs container', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByTestId('tabs')).toBeInTheDocument()
    })

    it('renders overview tab trigger', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-overview')).toBeInTheDocument()
    })

    it('renders pending tab trigger', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-pending')).toBeInTheDocument()
    })

    it('renders competitor tab trigger', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-competitor')).toBeInTheDocument()
    })
  })

  describe('empty improvements state', () => {
    it('shows empty message when no improvements', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('No Improvements Yet')).toBeInTheDocument()
    })

    it('shows description in empty state', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText(/Run a council review to analyze/)).toBeInTheDocument()
    })

    it('shows start analysis button in empty state', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByRole('button', { name: /start analysis/i })).toBeInTheDocument()
    })

    it('renders robot icon in empty state', () => {
      render(<AgenticDashboard {...defaultProps} />)
      const robotIcons = screen.getAllByTestId('robot-icon')
      expect(robotIcons.length).toBeGreaterThan(0)
    })
  })

  describe('pending tab empty state', () => {
    it('shows all clear message when no pending improvements', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('All Clear!')).toBeInTheDocument()
    })

    it('shows no pending message', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByText('No pending improvements requiring review')).toBeInTheDocument()
    })
  })

  describe('competitor tab', () => {
    it('renders competitor analysis component', () => {
      render(<AgenticDashboard {...defaultProps} />)
      expect(screen.getByTestId('competitor-analysis')).toBeInTheDocument()
    })
  })
})
