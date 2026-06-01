import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { CompetitorChart } from '../CompetitorChart'
import type { CompetitorData, IndustryType } from '@public-records/core'

// Mock UI components
vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
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

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: { children: ReactNode; className?: string }) => (
      <div data-testid="motion-div" className={className}>
        {children}
      </div>
    )
  }
}))

// Mock recharts
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Cell: () => <div data-testid="cell" />
}))

// Mock phosphor icons
vi.mock('@phosphor-icons/react', () => ({
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up" className={className} />
  ),
  TrendDown: ({ className }: { className?: string }) => (
    <span data-testid="trend-down" className={className} />
  )
}))

describe('CompetitorChart', () => {
  const mockCompetitors: CompetitorData[] = [
    {
      lenderName: 'ABC Capital',
      filingCount: 1500,
      avgDealSize: 250000,
      marketShare: 25.5,
      monthlyTrend: 5.2,
      topState: 'CA',
      industries: ['construction', 'restaurant']
    },
    {
      lenderName: 'XYZ Funding',
      filingCount: 1200,
      avgDealSize: 180000,
      marketShare: 20.3,
      monthlyTrend: -2.1,
      topState: 'TX',
      industries: ['retail', 'healthcare']
    },
    {
      lenderName: 'First Finance Corp',
      filingCount: 900,
      avgDealSize: 300000,
      marketShare: 15.2,
      monthlyTrend: 3.5,
      topState: 'NY',
      industries: ['manufacturing']
    },
    {
      lenderName: 'Growth Partners LLC',
      filingCount: 750,
      avgDealSize: 150000,
      marketShare: 12.8,
      monthlyTrend: -1.5,
      topState: 'FL',
      industries: ['services', 'technology']
    }
  ]

  describe('rendering', () => {
    it('renders the chart container', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    })

    it('renders the bar chart', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
    })

    it('renders chart title', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('Top Lenders by Filing Volume')).toBeInTheDocument()
    })
  })

  describe('competitor cards', () => {
    it('renders cards for each competitor', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const cards = screen.getAllByTestId('card')
      // One card for chart + one for each competitor
      expect(cards.length).toBeGreaterThan(mockCompetitors.length)
    })

    it('displays competitor names', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('ABC Capital')).toBeInTheDocument()
      expect(screen.getByText('XYZ Funding')).toBeInTheDocument()
      expect(screen.getByText('First Finance Corp')).toBeInTheDocument()
    })

    it('displays rank badges', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('#1')).toBeInTheDocument()
      expect(screen.getByText('#2')).toBeInTheDocument()
      expect(screen.getByText('#3')).toBeInTheDocument()
      expect(screen.getByText('#4')).toBeInTheDocument()
    })

    it('displays filing counts', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('1500')).toBeInTheDocument()
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    it('displays "Filings" label', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const filingLabels = screen.getAllByText('Filings')
      expect(filingLabels.length).toBeGreaterThan(0)
    })
  })

  describe('average deal size', () => {
    it('displays average deal size section', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const avgDealLabels = screen.getAllByText('Avg Deal Size')
      expect(avgDealLabels.length).toBeGreaterThan(0)
    })

    it('formats deal size in thousands', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('$250K')).toBeInTheDocument()
      expect(screen.getByText('$180K')).toBeInTheDocument()
    })
  })

  describe('market share', () => {
    it('displays market share section', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const marketShareLabels = screen.getAllByText('Market Share')
      expect(marketShareLabels.length).toBeGreaterThan(0)
    })

    it('displays market share percentages', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('25.5%')).toBeInTheDocument()
      expect(screen.getByText('20.3%')).toBeInTheDocument()
    })
  })

  describe('top state', () => {
    it('displays top state for each competitor', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText(/Top State: CA/)).toBeInTheDocument()
      expect(screen.getByText(/Top State: TX/)).toBeInTheDocument()
      expect(screen.getByText(/Top State: NY/)).toBeInTheDocument()
    })
  })

  describe('industries', () => {
    it('displays industry badges', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('construction')).toBeInTheDocument()
      expect(screen.getByText('restaurant')).toBeInTheDocument()
      expect(screen.getByText('retail')).toBeInTheDocument()
    })

    it('shows industries label', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const industriesLabels = screen.getAllByText('Industries')
      expect(industriesLabels.length).toBeGreaterThan(0)
    })
  })

  describe('monthly trend', () => {
    it('displays monthly trend section', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const trendLabels = screen.getAllByText('Monthly Trend')
      expect(trendLabels.length).toBeGreaterThan(0)
    })

    it('shows trend up icon for positive trends', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getAllByTestId('trend-up').length).toBeGreaterThan(0)
    })

    it('shows trend down icon for negative trends', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getAllByTestId('trend-down').length).toBeGreaterThan(0)
    })

    it('displays positive trend values', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('+5.2%')).toBeInTheDocument()
      expect(screen.getByText('+3.5%')).toBeInTheDocument()
    })

    it('displays negative trend values', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      expect(screen.getByText('-2.1%')).toBeInTheDocument()
      expect(screen.getByText('-1.5%')).toBeInTheDocument()
    })
  })

  describe('data slicing', () => {
    it('shows only top 10 competitors in chart', () => {
      // Create more than 10 competitors
      const manyCompetitors: CompetitorData[] = Array.from({ length: 15 }, (_, i) => ({
        lenderName: `Lender ${i + 1}`,
        filingCount: 1000 - i * 50,
        avgDealSize: 200000,
        marketShare: 10 - i * 0.5,
        monthlyTrend: i % 2 === 0 ? 2 : -1,
        topState: 'CA',
        industries: ['construction'] as IndustryType[]
      }))

      render(<CompetitorChart data={manyCompetitors} />)

      // Should show Lender 1 through Lender 10
      expect(screen.getByText('Lender 1')).toBeInTheDocument()
      expect(screen.getByText('Lender 10')).toBeInTheDocument()
      // Should not show Lender 11+
      expect(screen.queryByText('Lender 11')).not.toBeInTheDocument()
    })
  })

  describe('name truncation', () => {
    it('renders long lender names', () => {
      const longNameCompetitor: CompetitorData[] = [
        {
          lenderName: 'Very Long Company Name That Exceeds Twenty Characters',
          filingCount: 1000,
          avgDealSize: 200000,
          marketShare: 15,
          monthlyTrend: 2,
          topState: 'CA',
          industries: ['construction']
        }
      ]

      render(<CompetitorChart data={longNameCompetitor} />)
      // The name should be rendered (may be truncated via CSS)
      expect(screen.getByText(/Very Long Company/)).toBeInTheDocument()
    })
  })

  describe('empty data', () => {
    it('renders with empty data array', () => {
      render(<CompetitorChart data={[]} />)
      // Should still render the chart container
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument()
    })
  })

  describe('motion animations', () => {
    it('wraps competitor cards in motion divs', () => {
      render(<CompetitorChart data={mockCompetitors} />)
      const motionDivs = screen.getAllByTestId('motion-div')
      expect(motionDivs.length).toBeGreaterThan(0)
    })
  })
})
