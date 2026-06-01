/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { ProspectCard } from '../ProspectCard'
import type { Prospect } from '@public-records/core'

// Mock UI components
vi.mock('@public-records/ui/card', () => ({
  Card: ({
    children,
    className,
    onClick
  }: {
    children: ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <div data-testid="card" className={className} onClick={onClick}>
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

vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    size,
    className,
    ...props
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    size?: string
    className?: string
  }) => (
    <button onClick={onClick} disabled={disabled} data-size={size} className={className} {...props}>
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

vi.mock('../HealthGradeBadge', () => ({
  HealthGradeBadge: ({ grade }: { grade: string }) => (
    <span data-testid="health-grade-badge">Grade: {grade}</span>
  )
}))

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div data-testid="motion-div" className={className}>
        {children}
      </div>
    )
  }
}))

vi.mock('@phosphor-icons/react', () => ({
  Buildings: ({ className }: { className?: string }) => (
    <span data-testid="buildings-icon" className={className} />
  ),
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up" className={className} />
  ),
  MapPin: ({ className }: { className?: string }) => (
    <span data-testid="map-pin" className={className} />
  ),
  Brain: ({ className }: { className?: string }) => (
    <span data-testid="brain-icon" className={className} />
  )
}))

vi.mock('@public-records/ui/utils', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}))

describe('ProspectCard', () => {
  const mockProspect: Prospect = {
    id: 'prospect-1',
    companyName: 'Test Restaurant LLC',
    industry: 'restaurant',
    state: 'CA',
    priorityScore: 85,
    status: 'new',
    healthScore: {
      grade: 'A',
      score: 92,
      sentimentTrend: 'improving',
      reviewCount: 25,
      violationCount: 0,
      avgSentiment: 0.85,
      lastUpdated: '2026-01-15T00:00:00Z'
    },
    timeSinceDefault: 730, // 2 years
    defaultDate: '2022-01-15',
    narrative: 'Strong growth with excellent customer reviews and expanding locations.',
    growthSignals: [
      {
        id: 's1',
        type: 'hiring',
        description: 'Hiring new staff',
        score: 75,
        confidence: 0.9,
        detectedDate: '2024-01-01'
      },
      {
        id: 's2',
        type: 'expansion',
        description: 'Opening new location',
        score: 75,
        confidence: 0.85,
        detectedDate: '2024-01-05'
      }
    ],
    uccFilings: [],
    mlScoring: {
      confidence: 88,
      recoveryLikelihood: 75,
      modelVersion: '1.0',
      factors: {
        healthTrend: 0.5,
        signalQuality: 0.7,
        industryRisk: 0.3,
        timeToRecovery: 0.6,
        financialStability: 0.8
      },
      lastUpdated: '2024-01-15'
    }
  }

  const defaultProps = {
    prospect: mockProspect,
    onSelect: vi.fn()
  }

  describe('rendering', () => {
    it('renders the card', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('card')).toBeInTheDocument()
    })

    it('displays company name', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('Test Restaurant LLC')).toBeInTheDocument()
    })

    it('displays industry with icon', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('restaurant')).toBeInTheDocument()
      expect(screen.getByText('🍽️')).toBeInTheDocument()
    })

    it('displays state', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('CA')).toBeInTheDocument()
    })

    it('displays priority score', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('85')).toBeInTheDocument()
      expect(screen.getByText('Priority')).toBeInTheDocument()
    })

    it('displays map pin icon', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('map-pin')).toBeInTheDocument()
    })
  })

  describe('health score', () => {
    it('displays health grade badge', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('health-grade-badge')).toHaveTextContent('Grade: A')
    })

    it('shows health score label', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('Health Score')).toBeInTheDocument()
    })
  })

  describe('default age', () => {
    it('displays years since default', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('2y ago')).toBeInTheDocument()
    })

    it('shows default age label', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('Default Age')).toBeInTheDocument()
    })
  })

  describe('growth signals', () => {
    it('displays growth signals count', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('2 detected')).toBeInTheDocument()
    })

    it('shows trend up icon for signals', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('trend-up')).toBeInTheDocument()
    })

    it('shows growth signals label', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('Growth Signals')).toBeInTheDocument()
    })

    it('hides growth signals section when no signals', () => {
      const noSignals = { ...mockProspect, growthSignals: [] }
      render(<ProspectCard {...defaultProps} prospect={noSignals} />)
      expect(screen.queryByText('Growth Signals')).not.toBeInTheDocument()
    })
  })

  describe('ML scoring', () => {
    it('displays ML confidence', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('88%')).toBeInTheDocument()
      expect(screen.getByText('ML Confidence')).toBeInTheDocument()
    })

    it('shows brain icon', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('brain-icon')).toBeInTheDocument()
    })

    it('displays recovery likelihood', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText('75%')).toBeInTheDocument()
      expect(screen.getByText('Recovery Likelihood')).toBeInTheDocument()
    })

    it('hides ML section when no scoring', () => {
      const noMl = { ...mockProspect, mlScoring: undefined }
      render(<ProspectCard {...defaultProps} prospect={noMl} />)
      expect(screen.queryByText('ML Confidence')).not.toBeInTheDocument()
    })
  })

  describe('narrative', () => {
    it('displays narrative text', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByText(/Strong growth with excellent customer reviews/)).toBeInTheDocument()
    })
  })

  describe('view details button', () => {
    it('renders view details button for unclaimed prospect', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByRole('button', { name: /view details/i })).toBeInTheDocument()
    })

    it('button is not disabled for unclaimed prospect', () => {
      render(<ProspectCard {...defaultProps} />)
      const button = screen.getByRole('button', { name: /view details/i })
      expect(button).not.toBeDisabled()
    })

    it('shows buildings icon', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getByTestId('buildings-icon')).toBeInTheDocument()
    })
  })

  describe('claimed status', () => {
    it('shows "Claimed" text for claimed prospect', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const, claimedBy: 'John Doe' }
      render(<ProspectCard {...defaultProps} prospect={claimed} />)
      expect(screen.getByText('Claimed')).toBeInTheDocument()
    })

    it('disables button for claimed prospect', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const }
      render(<ProspectCard {...defaultProps} prospect={claimed} />)
      const button = screen.getByRole('button', { name: /claimed/i })
      expect(button).toBeDisabled()
    })

    it('shows claimed by badge', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const, claimedBy: 'John Doe' }
      render(<ProspectCard {...defaultProps} prospect={claimed} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('applies claimed styling to card', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const }
      render(<ProspectCard {...defaultProps} prospect={claimed} />)
      const card = screen.getByTestId('card')
      expect(card.className).toContain('border-primary')
    })
  })

  describe('interactions', () => {
    it('calls onSelect when card is clicked', async () => {
      const onSelect = vi.fn()
      render(<ProspectCard {...defaultProps} onSelect={onSelect} />)

      await userEvent.click(screen.getByTestId('card'))
      expect(onSelect).toHaveBeenCalledWith(mockProspect)
    })
  })

  describe('industry icons', () => {
    it.each([
      ['restaurant', '🍽️'],
      ['retail', '🛍️'],
      ['construction', '🏗️'],
      ['healthcare', '🏥'],
      ['manufacturing', '🏭'],
      ['services', '💼'],
      ['technology', '💻']
    ])('shows correct icon for %s industry', (industry, icon) => {
      const prospect = { ...mockProspect, industry: industry as any }
      render(<ProspectCard {...defaultProps} prospect={prospect} />)
      expect(screen.getByText(icon)).toBeInTheDocument()
    })
  })

  describe('motion animations', () => {
    it('wraps card in motion div', () => {
      render(<ProspectCard {...defaultProps} />)
      expect(screen.getAllByTestId('motion-div').length).toBeGreaterThan(0)
    })
  })

  describe('accessibility', () => {
    it('button has proper aria-label', () => {
      render(<ProspectCard {...defaultProps} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'View details for Test Restaurant LLC')
    })

    it('button has title attribute', () => {
      render(<ProspectCard {...defaultProps} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('title', 'View details for Test Restaurant LLC')
    })

    it('shows claimed aria-label for claimed prospect', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const, claimedBy: 'John Doe' }
      render(<ProspectCard {...defaultProps} prospect={claimed} />)
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-label', 'Claimed by John Doe')
    })
  })
})
