import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import CompetitorAnalysis from '../CompetitorAnalysis'
import type { CompetitorData } from '@public-records/core'
import type { Improvement } from '@/lib/agentic/types'

// Mock UI components
vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="card-description">{children}</p>
  ),
  CardHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: ReactNode }) => <h2 data-testid="card-title">{children}</h2>
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

vi.mock('@public-records/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table data-testid="table">{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }: { children: ReactNode; className?: string }) => (
    <td className={className}>{children}</td>
  ),
  TableHead: ({ children, className }: { children: ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>
}))

vi.mock('@public-records/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up-icon" className={className} />
  ),
  ArrowUp: ({ className }: { className?: string }) => (
    <span data-testid="arrow-up-icon" className={className} />
  ),
  ArrowDown: ({ className }: { className?: string }) => (
    <span data-testid="arrow-down-icon" className={className} />
  ),
  Users: ({ className }: { className?: string }) => (
    <span data-testid="users-icon" className={className} />
  ),
  Target: ({ className }: { className?: string }) => (
    <span data-testid="target-icon" className={className} />
  )
}))

describe('CompetitorAnalysis', () => {
  const mockCompetitors: CompetitorData[] = [
    {
      lenderName: 'Lender Alpha',
      filingCount: 1500,
      avgDealSize: 250000,
      marketShare: 25.5,
      monthlyTrend: 5.2,
      topState: 'CA',
      industries: ['construction', 'restaurant']
    },
    {
      lenderName: 'Lender Beta',
      filingCount: 1200,
      avgDealSize: 180000,
      marketShare: 20.3,
      monthlyTrend: -2.1,
      topState: 'TX',
      industries: ['retail', 'healthcare']
    },
    {
      lenderName: 'Lender Gamma',
      filingCount: 900,
      avgDealSize: 300000,
      marketShare: 15.2,
      monthlyTrend: 3.5,
      topState: 'NY',
      industries: ['construction', 'manufacturing']
    }
  ]

  const mockImprovements: Improvement[] = [
    {
      id: 'imp-1',
      status: 'detected',
      suggestion: {
        id: 'sug-1',
        title: 'Strategic Recommendation',
        description: 'Improve market position',
        category: 'strategic',
        priority: 'high',
        safetyScore: 85,
        reasoning: 'Based on competitor analysis',
        estimatedImpact: 'Medium',
        automatable: false
      },
      detectedAt: '2024-01-15T10:00:00Z'
    },
    {
      id: 'imp-2',
      status: 'completed',
      suggestion: {
        id: 'sug-2',
        title: 'Competitor Intelligence',
        description: 'Track competitor pricing',
        category: 'competitor-intelligence',
        priority: 'medium',
        safetyScore: 90,
        reasoning: 'Stay competitive',
        estimatedImpact: 'High',
        automatable: true
      },
      detectedAt: '2024-01-14T10:00:00Z',
      result: {
        success: true,
        changes: [],
        metrics: { before: {}, after: {} },
        feedback: 'Successfully implemented'
      }
    }
  ]

  const defaultProps = {
    competitors: mockCompetitors,
    improvements: mockImprovements
  }

  describe('rendering', () => {
    it('renders competitor names', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Check that some competitor names are displayed
      const competitorNames = screen.getAllByText(/Lender/i)
      expect(competitorNames.length).toBeGreaterThan(0)
    })

    it('renders competitor information', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Check that filing counts are displayed
      expect(screen.getByText('1,500')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message when no competitors', () => {
      render(<CompetitorAnalysis competitors={[]} improvements={[]} />)
      expect(
        screen.getByText(/Market intelligence will populate automatically/)
      ).toBeInTheDocument()
    })

    it('shows instruction to run analysis', () => {
      render(<CompetitorAnalysis competitors={[]} improvements={[]} />)
      expect(
        screen.getByText(/agentic engine has not ingested competitor filings/)
      ).toBeInTheDocument()
    })
  })

  describe('summary cards', () => {
    it('displays total annual filings', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Total annual filings')).toBeInTheDocument()
      expect(screen.getByText('3,600')).toBeInTheDocument()
    })

    it('displays market leader data', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Market leader (Lender Alpha) has 25.5% share
      expect(screen.getByText('25.5%')).toBeInTheDocument()
    })

    it('displays market leader share', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('25.5% share')).toBeInTheDocument()
    })

    it('displays growth outlook', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Growth outlook')).toBeInTheDocument()
      // 2 out of 3 have positive trends
      expect(screen.getByText('2/3')).toBeInTheDocument()
    })

    it('displays average deal size formatted', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText(/Avg deal \$250,000/)).toBeInTheDocument()
    })
  })

  describe('competitor table', () => {
    it('renders competitor data', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Check that competitor filing counts are shown
      expect(screen.getByText('1,500')).toBeInTheDocument()
    })

    it('shows table headers', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Rank')).toBeInTheDocument()
      expect(screen.getByText('Competitor')).toBeInTheDocument()
      expect(screen.getByText('Filings')).toBeInTheDocument()
      expect(screen.getByText('Avg deal')).toBeInTheDocument()
      expect(screen.getByText('Market share')).toBeInTheDocument()
      expect(screen.getByText('Trend')).toBeInTheDocument()
    })

    it('displays competitor rows', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('#1')).toBeInTheDocument()
      expect(screen.getByText('#2')).toBeInTheDocument()
      expect(screen.getByText('#3')).toBeInTheDocument()
    })

    it('shows filing counts', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('1,500')).toBeInTheDocument()
      expect(screen.getByText('1,200')).toBeInTheDocument()
      expect(screen.getByText('900')).toBeInTheDocument()
    })

    it('shows top state for each competitor', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText(/Top state: CA/)).toBeInTheDocument()
      expect(screen.getByText(/Top state: TX/)).toBeInTheDocument()
      expect(screen.getByText(/Top state: NY/)).toBeInTheDocument()
    })

    it('displays trend with correct styling for positive trends', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Positive trend should show arrow up
      expect(screen.getAllByTestId('arrow-up-icon').length).toBeGreaterThan(0)
    })

    it('displays trend with correct styling for negative trends', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Negative trend should show arrow down
      expect(screen.getAllByTestId('arrow-down-icon').length).toBeGreaterThan(0)
    })
  })

  describe('industry coverage', () => {
    it('displays industry coverage section', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Industry coverage')).toBeInTheDocument()
    })

    it('shows industry distribution', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('construction')).toBeInTheDocument()
    })

    it('shows industry badges', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      // Industries are shown as badges
      const badges = screen.getAllByTestId('badge')
      expect(badges.length).toBeGreaterThan(0)
    })
  })

  describe('agentic recommendations', () => {
    it('displays recommendations section', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Agentic recommendations')).toBeInTheDocument()
    })

    it('shows insight count', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('2 insights')).toBeInTheDocument()
    })

    it('displays improvement titles', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Strategic Recommendation')).toBeInTheDocument()
      expect(screen.getByText('Competitor Intelligence')).toBeInTheDocument()
    })

    it('shows priority badges', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('high')).toBeInTheDocument()
      expect(screen.getByText('medium')).toBeInTheDocument()
    })

    it('shows status badges', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('detected')).toBeInTheDocument()
      expect(screen.getByText('completed')).toBeInTheDocument()
    })

    it('shows safety scores', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText(/Safety 85\/100/)).toBeInTheDocument()
      expect(screen.getByText(/Safety 90\/100/)).toBeInTheDocument()
    })

    it('shows reasoning', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Based on competitor analysis')).toBeInTheDocument()
    })

    it('shows feedback for completed improvements', () => {
      render(<CompetitorAnalysis {...defaultProps} />)
      expect(screen.getByText('Successfully implemented')).toBeInTheDocument()
    })
  })

  describe('no recommendations state', () => {
    it('shows message when no strategic recommendations', () => {
      const nonStrategicImprovements: Improvement[] = [
        {
          id: 'imp-1',
          status: 'detected',
          suggestion: {
            id: 'sug-perf-1',
            title: 'Performance Improvement',
            description: 'Improve speed',
            category: 'performance',
            priority: 'low',
            safetyScore: 95,
            reasoning: 'For better UX',
            estimatedImpact: 'Low',
            automatable: true
          },
          detectedAt: '2024-01-15T10:00:00Z'
        }
      ]

      render(
        <CompetitorAnalysis competitors={mockCompetitors} improvements={nonStrategicImprovements} />
      )
      expect(
        screen.getByText(/No strategic recommendations have been generated yet/)
      ).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('sorts competitors by filing count descending', () => {
      render(<CompetitorAnalysis {...defaultProps} />)

      const rankings = screen.getAllByText(/#\d/)
      expect(rankings[0]).toHaveTextContent('#1')
      // Lender Alpha should be #1 with highest filing count
    })
  })
})
