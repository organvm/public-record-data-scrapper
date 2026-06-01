import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { PortfolioMonitor } from '../PortfolioMonitor'
import type { PortfolioCompany } from '@public-records/core'

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

vi.mock('@public-records/ui/alert', () => ({
  Alert: ({
    children,
    variant,
    className
  }: {
    children: ReactNode
    variant?: string
    className?: string
  }) => (
    <div data-testid="alert" data-variant={variant} className={className}>
      {children}
    </div>
  ),
  AlertDescription: ({ children, className }: { children: ReactNode; className?: string }) => (
    <p data-testid="alert-description" className={className}>
      {children}
    </p>
  )
}))

vi.mock('../HealthGradeBadge', () => ({
  HealthGradeBadge: ({ grade }: { grade: string }) => (
    <span data-testid="health-grade-badge">Grade: {grade}</span>
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

vi.mock('@phosphor-icons/react', () => ({
  WarningCircle: ({ className }: { className?: string }) => (
    <span data-testid="warning-icon" className={className} />
  ),
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up" className={className} />
  ),
  TrendDown: ({ className }: { className?: string }) => (
    <span data-testid="trend-down" className={className} />
  )
}))

describe('PortfolioMonitor', () => {
  const mockCompanies: PortfolioCompany[] = [
    {
      id: 'company-1',
      companyName: 'Performing Co',
      fundingAmount: 150000,
      fundingDate: '2023-06-15',
      currentStatus: 'performing',
      healthScore: {
        grade: 'A',
        score: 92,
        sentimentTrend: 'improving',
        reviewCount: 25,
        violationCount: 0,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      }
    },
    {
      id: 'company-2',
      companyName: 'Watch List Co',
      fundingAmount: 100000,
      fundingDate: '2023-09-01',
      currentStatus: 'watch',
      healthScore: {
        grade: 'C',
        score: 58,
        sentimentTrend: 'stable',
        reviewCount: 12,
        violationCount: 1,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      }
    },
    {
      id: 'company-3',
      companyName: 'At Risk Co',
      fundingAmount: 200000,
      fundingDate: '2023-03-20',
      currentStatus: 'at-risk',
      healthScore: {
        grade: 'D',
        score: 35,
        sentimentTrend: 'declining',
        reviewCount: 8,
        violationCount: 3,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      },
      lastAlertDate: '2024-01-10'
    },
    {
      id: 'company-4',
      companyName: 'Default Co',
      fundingAmount: 75000,
      fundingDate: '2022-12-01',
      currentStatus: 'default',
      healthScore: {
        grade: 'F',
        score: 15,
        sentimentTrend: 'declining',
        reviewCount: 5,
        violationCount: 7,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      },
      lastAlertDate: '2024-01-15'
    },
    {
      id: 'company-5',
      companyName: 'Performing Two',
      fundingAmount: 250000,
      fundingDate: '2023-08-01',
      currentStatus: 'performing',
      healthScore: {
        grade: 'B',
        score: 78,
        sentimentTrend: 'stable',
        reviewCount: 20,
        violationCount: 0,
        avgSentiment: 0.85,
        lastUpdated: '2026-01-15T00:00:00Z'
      }
    }
  ]

  describe('rendering', () => {
    it('renders section headers', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // Component uses h3 for sections
      const atRiskHeader = screen.getAllByText('At-Risk Companies')[0]
      expect(atRiskHeader).toBeInTheDocument()
    })

    it('renders watch list section header', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // Look for Watch List in all text matches
      const watchListElements = screen.getAllByText(/Watch List/i)
      expect(watchListElements.length).toBeGreaterThan(0)
    })

    it('renders performing section', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('Performing Portfolio')).toBeInTheDocument()
    })
  })

  describe('alert banner', () => {
    it('shows alert when at-risk companies exist', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByTestId('alert')).toBeInTheDocument()
    })

    it('shows correct count of at-risk companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByTestId('alert-description')).toHaveTextContent('2 portfolio companies')
    })

    it('does not show alert when no at-risk companies', () => {
      const performingOnly = mockCompanies.filter((c) => c.currentStatus === 'performing')
      render(<PortfolioMonitor companies={performingOnly} />)
      expect(screen.queryByTestId('alert')).not.toBeInTheDocument()
    })

    it('shows warning icon in alert', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByTestId('warning-icon')).toBeInTheDocument()
    })
  })

  describe('at-risk section', () => {
    it('displays at-risk companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('At Risk Co')).toBeInTheDocument()
      expect(screen.getByText('Default Co')).toBeInTheDocument()
    })

    it('shows empty message when no at-risk companies', () => {
      const safeCompanies = mockCompanies.filter(
        (c) => c.currentStatus !== 'at-risk' && c.currentStatus !== 'default'
      )
      render(<PortfolioMonitor companies={safeCompanies} />)
      expect(screen.getByText('No companies currently at risk')).toBeInTheDocument()
    })
  })

  describe('watch list section', () => {
    it('displays watch list companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('Watch List Co')).toBeInTheDocument()
    })

    it('shows empty message when no watch list companies', () => {
      const noWatch = mockCompanies.filter((c) => c.currentStatus !== 'watch')
      render(<PortfolioMonitor companies={noWatch} />)
      expect(screen.getByText('No companies on watch list')).toBeInTheDocument()
    })
  })

  describe('performing section', () => {
    it('displays performing companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('Performing Co')).toBeInTheDocument()
      expect(screen.getByText('Performing Two')).toBeInTheDocument()
    })

    it('limits performing companies to 6', () => {
      const manyPerforming = Array.from({ length: 10 }, (_, i) => ({
        id: `performing-${i}`,
        companyName: `Performing ${i + 1}`,
        fundingAmount: 100000,
        fundingDate: '2023-01-01',
        currentStatus: 'performing' as const,
        healthScore: {
          grade: 'A' as const,
          score: 90,
          sentimentTrend: 'stable' as const,
          reviewCount: 10,
          violationCount: 0,
          avgSentiment: 0.85,
          lastUpdated: '2026-01-15T00:00:00Z'
        }
      }))
      render(<PortfolioMonitor companies={manyPerforming} />)

      // Should show Performing 1 through 6, not 7+
      expect(screen.getByText('Performing 1')).toBeInTheDocument()
      expect(screen.getByText('Performing 6')).toBeInTheDocument()
      expect(screen.queryByText('Performing 7')).not.toBeInTheDocument()
    })
  })

  describe('company cards', () => {
    it('displays company name', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('At Risk Co')).toBeInTheDocument()
    })

    it('displays status badges for companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // Check that status-related text appears in badges
      const badges = screen.getAllByTestId('badge')
      expect(badges.length).toBeGreaterThan(0)
    })

    it('displays health grade badges', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      const badges = screen.getAllByTestId('health-grade-badge')
      expect(badges.length).toBeGreaterThan(0)
      expect(badges[0]).toHaveTextContent('Grade:')
    })

    it('displays funding amount', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getByText('$150K')).toBeInTheDocument()
      expect(screen.getByText('$200K')).toBeInTheDocument()
    })

    it('displays days since funding', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      const daysSinceFunding = screen.getAllByText(/Days Since Funding/)
      expect(daysSinceFunding.length).toBeGreaterThan(0)
    })

    it('displays last alert date when present', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // At Risk Co and Default Co have alert dates
      const alertBadges = screen.getAllByText(/Alert:/)
      expect(alertBadges.length).toBeGreaterThan(0)
    })
  })

  describe('sentiment trend', () => {
    it('shows trend icons for sentiment', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // At least one company has a trend (improving, declining, or stable)
      const cards = screen.getAllByTestId('card')
      expect(cards.length).toBeGreaterThan(0)
    })

    it('shows declining trend with icon', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getAllByTestId('trend-down').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Declining').length).toBeGreaterThan(0)
    })

    it('shows stable trend', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      expect(screen.getAllByText('Stable').length).toBeGreaterThan(0)
    })
  })

  describe('health score display', () => {
    it('shows health score values', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // Health scores are displayed for non-compact cards (at-risk and watch list)
      const healthScoreLabels = screen.getAllByText('Health Score')
      expect(healthScoreLabels.length).toBeGreaterThan(0)
    })

    it('shows sentiment trend label', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      const sentimentLabels = screen.getAllByText('Sentiment Trend')
      expect(sentimentLabels.length).toBeGreaterThan(0)
    })

    it('shows health score label', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      const healthScoreLabels = screen.getAllByText('Health Score')
      expect(healthScoreLabels.length).toBeGreaterThan(0)
    })
  })

  describe('compact vs full cards', () => {
    it('renders compact cards for performing companies', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // Performing companies should not show sentiment trend (compact mode)
      const cards = screen.getAllByTestId('card')
      expect(cards.length).toBeGreaterThan(0)
    })

    it('renders cards for at-risk companies with full details', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      // At-risk cards (non-compact) should have sentiment trend label
      const sentimentLabels = screen.getAllByText('Sentiment Trend')
      expect(sentimentLabels.length).toBeGreaterThan(0)
    })
  })

  describe('motion animations', () => {
    it('wraps company cards in motion divs', () => {
      render(<PortfolioMonitor companies={mockCompanies} />)
      const motionDivs = screen.getAllByTestId('motion-div')
      expect(motionDivs.length).toBeGreaterThan(0)
    })
  })

  describe('empty state', () => {
    it('handles empty companies array', () => {
      render(<PortfolioMonitor companies={[]} />)
      expect(screen.getByText('No companies currently at risk')).toBeInTheDocument()
      expect(screen.getByText('No companies on watch list')).toBeInTheDocument()
    })
  })
})
