import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { SignalTimeline } from '../SignalTimeline'
import type { GrowthSignal, SignalType } from '@public-records/core'

vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@public-records/ui/badge', () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-testid="badge" data-variant={variant}>
      {children}
    </span>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  Briefcase: () => <span data-testid="icon-hiring">Briefcase</span>,
  Certificate: () => <span data-testid="icon-permit">Certificate</span>,
  Handshake: () => <span data-testid="icon-contract">Handshake</span>,
  TrendUp: () => <span data-testid="icon-expansion">TrendUp</span>,
  Toolbox: () => <span data-testid="icon-equipment">Toolbox</span>,
  Pulse: () => <span data-testid="icon-default">Pulse</span>
}))

describe('SignalTimeline', () => {
  const createSignal = (overrides: Partial<GrowthSignal>): GrowthSignal => ({
    id: `signal-${Math.random()}`,
    type: 'hiring',
    description: 'Test signal description',
    score: 75,
    confidence: 0.85,
    detectedDate: new Date().toISOString(),
    ...overrides
  })

  describe('empty state', () => {
    it('renders empty message when no signals', () => {
      render(<SignalTimeline signals={[]} />)

      expect(screen.getByText('No growth signals detected')).toBeInTheDocument()
    })

    it('renders a card for empty state', () => {
      render(<SignalTimeline signals={[]} />)

      expect(screen.getByTestId('card')).toBeInTheDocument()
    })
  })

  describe('with signals', () => {
    it('renders a card for each signal', () => {
      const signals = [
        createSignal({ type: 'hiring', id: '1' }),
        createSignal({ type: 'contract', id: '2' }),
        createSignal({ type: 'expansion', id: '3' })
      ]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getAllByTestId('card')).toHaveLength(3)
    })

    it('renders signal description', () => {
      const signals = [createSignal({ type: 'hiring', description: 'Hired 10 new engineers' })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('Hired 10 new engineers')).toBeInTheDocument()
    })

    it('renders signal score', () => {
      const signals = [createSignal({ type: 'hiring', score: 85 })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('Score: 85')).toBeInTheDocument()
    })
  })

  describe('signal types', () => {
    const signalTypes: { type: SignalType; label: string; iconTestId: string }[] = [
      { type: 'hiring', label: 'Hiring', iconTestId: 'icon-hiring' },
      { type: 'permit', label: 'Permit', iconTestId: 'icon-permit' },
      { type: 'contract', label: 'Contract', iconTestId: 'icon-contract' },
      { type: 'expansion', label: 'Expansion', iconTestId: 'icon-expansion' },
      { type: 'equipment', label: 'Equipment', iconTestId: 'icon-equipment' }
    ]

    signalTypes.forEach(({ type, label, iconTestId }) => {
      it(`renders ${type} signal with correct label`, () => {
        render(<SignalTimeline signals={[createSignal({ type })]} />)

        expect(screen.getByText(label)).toBeInTheDocument()
      })

      it(`renders ${type} signal with correct icon`, () => {
        render(<SignalTimeline signals={[createSignal({ type })]} />)

        expect(screen.getByTestId(iconTestId)).toBeInTheDocument()
      })
    })
  })

  describe('time display', () => {
    it('shows "Today" for signals detected today', () => {
      const signals = [createSignal({ type: 'hiring', detectedDate: new Date().toISOString() })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('shows days ago for older signals', () => {
      const fiveDaysAgo = new Date()
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5)
      const signals = [createSignal({ type: 'hiring', detectedDate: fiveDaysAgo.toISOString() })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('5d ago')).toBeInTheDocument()
    })
  })

  describe('confidence display', () => {
    it('renders confidence bar when confidence is provided', () => {
      const signals = [createSignal({ type: 'hiring', confidence: 0.85 })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('Confidence')).toBeInTheDocument()
      expect(screen.getByText('85%')).toBeInTheDocument()
    })

    it('does not render confidence section when confidence is undefined', () => {
      const signals = [
        {
          id: 'test',
          type: 'hiring' as SignalType,
          description: 'Test',
          score: 75,
          confidence: 0,
          detectedDate: new Date().toISOString()
        }
      ]

      render(<SignalTimeline signals={signals} />)

      expect(screen.queryByText('Confidence')).not.toBeInTheDocument()
    })

    it('renders confidence percentage correctly', () => {
      const signals = [createSignal({ type: 'hiring', confidence: 0.923 })]

      render(<SignalTimeline signals={signals} />)

      expect(screen.getByText('92%')).toBeInTheDocument()
    })
  })

  describe('badges', () => {
    it('renders type badge with outline variant', () => {
      const signals = [createSignal({ type: 'contract' })]

      render(<SignalTimeline signals={signals} />)

      const badges = screen.getAllByTestId('badge')
      const typeBadge = badges.find((b) => b.textContent === 'Contract')
      expect(typeBadge).toHaveAttribute('data-variant', 'outline')
    })

    it('renders score badge with secondary variant', () => {
      const signals = [createSignal({ type: 'hiring', score: 90 })]

      render(<SignalTimeline signals={signals} />)

      const badges = screen.getAllByTestId('badge')
      const scoreBadge = badges.find((b) => b.textContent?.includes('Score:'))
      expect(scoreBadge).toHaveAttribute('data-variant', 'secondary')
    })
  })
})
