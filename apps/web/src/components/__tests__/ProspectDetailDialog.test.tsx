import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { ProspectDetailDialog } from '../ProspectDetailDialog'
import type { Prospect, ProspectNote, FollowUpReminder } from '@public-records/core'

// Mock all nested components
vi.mock('../HealthGradeBadge', () => ({
  HealthGradeBadge: ({ grade }: { grade: string }) => (
    <span data-testid="health-grade-badge">{grade}</span>
  )
}))

vi.mock('../SignalTimeline', () => ({
  SignalTimeline: ({ signals }: { signals: unknown[] }) => (
    <div data-testid="signal-timeline">Signals: {signals.length}</div>
  )
}))

vi.mock('../NotesAndReminders', () => ({
  NotesAndReminders: () => <div data-testid="notes-reminders">Notes & Reminders</div>
}))

vi.mock('../EmailComposer', () => ({
  EmailComposer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="email-composer">Email Composer</div> : null
}))

// Mock UI components
vi.mock('@public-records/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogDescription: ({ children, className }: { children: ReactNode; className?: string }) => (
    <p data-testid="dialog-description" className={className}>
      {children}
    </p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 data-testid="dialog-title" className={className}>
      {children}
    </h2>
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
    variant,
    className
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    size?: string
    variant?: string
    className?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-size={size}
      data-variant={variant}
      className={className}
    >
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/separator', () => ({
  Separator: ({ className }: { className?: string }) => (
    <hr data-testid="separator" className={className} />
  )
}))

vi.mock('@public-records/ui/card', () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@public-records/ui/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid="progress" data-value={value} className={className} />
  )
}))

vi.mock('@public-records/ui/tabs', () => ({
  Tabs: ({ children, defaultValue }: { children: ReactNode; defaultValue?: string }) => (
    <div data-testid="tabs" data-default-value={defaultValue}>
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
  Buildings: ({ className }: { className?: string }) => (
    <span data-testid="buildings-icon" className={className} />
  ),
  Export: ({ className }: { className?: string }) => (
    <span data-testid="export-icon" className={className} />
  ),
  MapPin: ({ className }: { className?: string }) => (
    <span data-testid="map-pin" className={className} />
  ),
  Calendar: ({ className }: { className?: string }) => (
    <span data-testid="calendar-icon" className={className} />
  ),
  CurrencyDollar: ({ className }: { className?: string }) => (
    <span data-testid="dollar-icon" className={className} />
  ),
  TrendUp: ({ className }: { className?: string }) => (
    <span data-testid="trend-up" className={className} />
  ),
  TrendDown: ({ className }: { className?: string }) => (
    <span data-testid="trend-down" className={className} />
  ),
  ArrowRight: ({ className }: { className?: string }) => (
    <span data-testid="arrow-right" className={className} />
  ),
  Brain: ({ className }: { className?: string }) => (
    <span data-testid="brain-icon" className={className} />
  ),
  Envelope: ({ className }: { className?: string }) => (
    <span data-testid="envelope-icon" className={className} />
  )
}))

describe('ProspectDetailDialog', () => {
  const mockProspect: Prospect = {
    id: 'prospect-1',
    companyName: 'Test Company LLC',
    industry: 'construction',
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
    timeSinceDefault: 730,
    defaultDate: '2022-01-15',
    lastFilingDate: '2023-06-15',
    estimatedRevenue: 5000000,
    narrative: 'Strong growth indicators with positive customer reviews.',
    growthSignals: [
      {
        id: 's1',
        type: 'hiring',
        description: 'Hiring new staff',
        score: 75,
        confidence: 0.9,
        detectedDate: '2024-01-01'
      }
    ],
    uccFilings: [
      {
        id: 'ucc-1',
        filingDate: '2023-06-15',
        debtorName: 'Test Company LLC',
        filingType: 'UCC-1',
        securedParty: 'Bank of America',
        state: 'CA',
        status: 'active',
        lienAmount: 150000
      }
    ],
    mlScoring: {
      confidence: 88,
      recoveryLikelihood: 75,
      modelVersion: '2.1',
      factors: {
        healthTrend: 85,
        signalQuality: 72,
        industryRisk: 40,
        timeToRecovery: 55,
        financialStability: 90
      },
      lastUpdated: '2024-01-15T10:00:00Z'
    }
  }

  const mockNotes: ProspectNote[] = [
    {
      id: 'note-1',
      prospectId: 'prospect-1',
      content: 'Test note',
      createdAt: '2024-01-15',
      createdBy: 'John'
    }
  ]

  const mockReminders: FollowUpReminder[] = [
    {
      id: 'rem-1',
      prospectId: 'prospect-1',
      description: 'Follow up',
      dueDate: '2024-02-15',
      priority: 'high',
      completed: false,
      createdAt: '2024-01-15',
      createdBy: 'John'
    }
  ]

  const defaultProps = {
    prospect: mockProspect,
    open: true,
    onOpenChange: vi.fn(),
    onClaim: vi.fn(),
    onUnclaim: vi.fn(),
    onExport: vi.fn(),
    notes: mockNotes,
    reminders: mockReminders,
    onAddNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onAddReminder: vi.fn(),
    onCompleteReminder: vi.fn(),
    onDeleteReminder: vi.fn(),
    onSendEmail: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders dialog when open with prospect', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    })

    it('does not render when closed', () => {
      render(<ProspectDetailDialog {...defaultProps} open={false} />)
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    })

    it('returns null when prospect is null', () => {
      render(<ProspectDetailDialog {...defaultProps} prospect={null} />)
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    })

    it('displays company name as title', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Test Company LLC')
    })
  })

  describe('header information', () => {
    it('displays state info', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      // State appears in the filing information
      const stateElements = screen.getAllByText(/CA/)
      expect(stateElements.length).toBeGreaterThan(0)
    })

    it('displays industry', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('construction')).toBeInTheDocument()
    })

    it('displays estimated revenue', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText(/\$5.0M est\. revenue/)).toBeInTheDocument()
    })

    it('displays priority score', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('85')).toBeInTheDocument()
      expect(screen.getByText('Priority Score')).toBeInTheDocument()
    })
  })

  describe('opportunity summary', () => {
    it('displays narrative', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('Opportunity Summary')).toBeInTheDocument()
      expect(
        screen.getByText(/Strong growth indicators with positive customer reviews/)
      ).toBeInTheDocument()
    })
  })

  describe('health score section', () => {
    it('displays health grade badge', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('health-grade-badge')).toHaveTextContent('A')
    })

    it('displays sentiment trend', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('Improving')).toBeInTheDocument()
    })

    it('shows trend up icon for improving', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('trend-up')).toBeInTheDocument()
    })

    it('displays review count', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('25')).toBeInTheDocument()
    })

    it('displays violation count', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('0')).toBeInTheDocument()
    })
  })

  describe('default history section', () => {
    it('displays years since default', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('2 years ago')).toBeInTheDocument()
    })

    it('displays default date', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('2022-01-15')).toBeInTheDocument()
    })

    it('displays filing dates', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      // Filing date appears in the UCC filings section
      const dateElements = screen.getAllByText(/2023/)
      expect(dateElements.length).toBeGreaterThan(0)
    })

    it('displays UCC filings count', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })

  describe('ML predictive analysis', () => {
    it('displays ML section header', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('ML Predictive Analysis')).toBeInTheDocument()
    })

    it('displays ML confidence', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('88%')).toBeInTheDocument()
    })

    it('displays recovery likelihood', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('75%')).toBeInTheDocument()
    })

    it('displays model version', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText(/Model 2.1/)).toBeInTheDocument()
    })

    it('shows brain icon', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('brain-icon')).toBeInTheDocument()
    })

    it('displays model factors', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText(/financial Health/i)).toBeInTheDocument()
      expect(screen.getByText(/market Conditions/i)).toBeInTheDocument()
    })

    it('does not show ML section when mlScoring is undefined', () => {
      const noMl = { ...mockProspect, mlScoring: undefined }
      render(<ProspectDetailDialog {...defaultProps} prospect={noMl} />)
      expect(screen.queryByText('ML Predictive Analysis')).not.toBeInTheDocument()
    })
  })

  describe('tabs', () => {
    it('renders tabs container', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('tabs')).toBeInTheDocument()
    })

    it('renders signals tab trigger', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-signals')).toHaveTextContent(/Growth Signals \(1\)/)
    })

    it('renders filings tab trigger', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-filings')).toHaveTextContent(/UCC Filings \(1\)/)
    })

    it('renders notes tab trigger', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('tab-trigger-notes')).toHaveTextContent('Notes & Reminders')
    })
  })

  describe('signals tab content', () => {
    it('renders signal timeline', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('signal-timeline')).toBeInTheDocument()
    })
  })

  describe('filings tab content', () => {
    it('displays filing information', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('UCC-1')).toBeInTheDocument()
      expect(screen.getByText('Bank of America')).toBeInTheDocument()
    })

    it('displays lien amount', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByText('$150K')).toBeInTheDocument()
    })
  })

  describe('notes tab content', () => {
    it('renders notes and reminders component', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByTestId('notes-reminders')).toBeInTheDocument()
    })
  })

  describe('action buttons', () => {
    it('renders claim button for unclaimed prospect', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /claim lead/i })).toBeInTheDocument()
    })

    it('calls onClaim when claim button clicked', async () => {
      const onClaim = vi.fn()
      render(<ProspectDetailDialog {...defaultProps} onClaim={onClaim} />)

      await userEvent.click(screen.getByRole('button', { name: /claim lead/i }))
      expect(onClaim).toHaveBeenCalledWith(mockProspect)
    })

    it('shows claimed text and unclaim button for claimed prospect', () => {
      const claimed = { ...mockProspect, status: 'claimed' as const, claimedBy: 'John Doe' }
      render(<ProspectDetailDialog {...defaultProps} prospect={claimed} />)

      expect(screen.getByRole('button', { name: /claimed by john doe/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /unclaim/i })).toBeInTheDocument()
    })

    it('calls onUnclaim when unclaim button clicked', async () => {
      const onUnclaim = vi.fn()
      const claimed = { ...mockProspect, status: 'claimed' as const, claimedBy: 'John' }
      render(<ProspectDetailDialog {...defaultProps} prospect={claimed} onUnclaim={onUnclaim} />)

      await userEvent.click(screen.getByRole('button', { name: /unclaim/i }))
      expect(onUnclaim).toHaveBeenCalledWith(claimed)
    })

    it('renders send email button', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /send email/i })).toBeInTheDocument()
    })

    it('renders export button', () => {
      render(<ProspectDetailDialog {...defaultProps} />)
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
    })

    it('calls onExport when export button clicked', async () => {
      const onExport = vi.fn()
      render(<ProspectDetailDialog {...defaultProps} onExport={onExport} />)

      await userEvent.click(screen.getByRole('button', { name: /export/i }))
      expect(onExport).toHaveBeenCalledWith(mockProspect)
    })
  })

  describe('email composer', () => {
    it('opens email composer when send email clicked', async () => {
      render(<ProspectDetailDialog {...defaultProps} />)

      await userEvent.click(screen.getByRole('button', { name: /send email/i }))
      expect(screen.getByTestId('email-composer')).toBeInTheDocument()
    })
  })

  describe('declining trend', () => {
    it('shows trend down icon for declining sentiment', () => {
      const declining = {
        ...mockProspect,
        healthScore: { ...mockProspect.healthScore, sentimentTrend: 'declining' as const }
      }
      render(<ProspectDetailDialog {...defaultProps} prospect={declining} />)
      expect(screen.getByTestId('trend-down')).toBeInTheDocument()
    })
  })
})
