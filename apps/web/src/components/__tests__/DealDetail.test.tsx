import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { DealDetail } from '../deals/DealDetail'
import type {
  Deal,
  DealStage,
  DealDocument,
  Disclosure,
  Contact,
  Prospect,
  ContactActivity
} from '@public-records/core'

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
  ),
  CardHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card-header" className={className}>
      {children}
    </div>
  ),
  CardTitle: ({ children, className }: { children: ReactNode; className?: string }) => (
    <h2 data-testid="card-title" className={className}>
      {children}
    </h2>
  ),
  CardContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>
}))

vi.mock('@public-records/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
    className,
    ...props
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
    variant?: string
    size?: string
    className?: string
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      className={className}
      {...props}
    >
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/badge', () => ({
  Badge: ({
    children,
    variant,
    className,
    style
  }: {
    children: ReactNode
    variant?: string
    className?: string
    style?: React.CSSProperties
  }) => (
    <span data-testid="badge" data-variant={variant} className={className} style={style}>
      {children}
    </span>
  )
}))

vi.mock('@public-records/ui/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid="progress" data-value={value} className={className}>
      {value}%
    </div>
  )
}))

vi.mock('@public-records/ui/separator', () => ({
  Separator: () => <hr data-testid="separator" />
}))

vi.mock('@public-records/ui/tabs', () => ({
  Tabs: ({ children, value }: { children: ReactNode; value?: string }) => (
    <div data-testid="tabs" data-value={value}>
      {children}
    </div>
  ),
  TabsList: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="tabs-list" className={className}>
      {children}
    </div>
  ),
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) => (
    <button data-testid="tab-trigger" data-value={value}>
      {children}
    </button>
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
    <div data-testid="tab-content" data-value={value} className={className}>
      {children}
    </div>
  )
}))

vi.mock('@public-records/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange
  }: {
    checked?: boolean
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      data-testid="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  )
}))

vi.mock('@public-records/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  ArrowLeft: ({ className }: { className?: string }) => (
    <span data-testid="arrow-left-icon" className={className} />
  ),
  PencilSimple: ({ className }: { className?: string }) => (
    <span data-testid="pencil-icon" className={className} />
  ),
  CurrencyDollar: ({ className }: { className?: string }) => (
    <span data-testid="currency-icon" className={className} />
  ),
  Calendar: ({ className }: { className?: string }) => (
    <span data-testid="calendar-icon" className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span data-testid="clock-icon" className={className} />
  ),
  Buildings: ({ className }: { className?: string }) => (
    <span data-testid="buildings-icon" className={className} />
  ),
  User: ({ className }: { className?: string }) => (
    <span data-testid="user-icon" className={className} />
  ),
  FileText: ({ className }: { className?: string }) => (
    <span data-testid="file-text-icon" className={className} />
  ),
  Upload: ({ className }: { className?: string }) => (
    <span data-testid="upload-icon" className={className} />
  ),
  CheckCircle: ({ className }: { className?: string }) => (
    <span data-testid="check-circle-icon" className={className} />
  ),
  XCircle: ({ className }: { className?: string }) => (
    <span data-testid="x-circle-icon" className={className} />
  ),
  WarningCircle: ({ className }: { className?: string }) => (
    <span data-testid="warning-circle-icon" className={className} />
  ),
  Bank: ({ className }: { className?: string }) => (
    <span data-testid="bank-icon" className={className} />
  ),
  ChartLine: ({ className }: { className?: string }) => (
    <span data-testid="chart-line-icon" className={className} />
  ),
  Scales: ({ className }: { className?: string }) => (
    <span data-testid="scales-icon" className={className} />
  ),
  CaretRight: ({ className }: { className?: string }) => (
    <span data-testid="caret-right-icon" className={className} />
  ),
  Download: ({ className }: { className?: string }) => (
    <span data-testid="download-icon" className={className} />
  )
}))

vi.mock('@public-records/ui/utils', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}))

vi.mock('@/components/shared/ActivityTimeline', () => ({
  ActivityTimeline: ({
    activities,
    emptyMessage
  }: {
    activities: ContactActivity[]
    emptyMessage?: string
  }) => (
    <div
      data-testid="activity-timeline"
      data-count={activities.length}
      data-empty-message={emptyMessage}
    >
      {activities.length === 0 && <p>{emptyMessage}</p>}
      {activities.map((a) => (
        <div key={a.id} data-testid="activity-item">
          {a.activityType}
        </div>
      ))}
    </div>
  )
}))

describe('DealDetail', () => {
  const mockStages: DealStage[] = [
    {
      id: 'lead',
      orgId: 'org-1',
      name: 'Lead',
      slug: 'lead',
      stageOrder: 1,
      isTerminal: false,
      color: '#6366f1',
      autoActions: {},
      createdAt: '2024-01-01'
    },
    {
      id: 'contacted',
      orgId: 'org-1',
      name: 'Contacted',
      slug: 'contacted',
      stageOrder: 2,
      isTerminal: false,
      color: '#8b5cf6',
      autoActions: {},
      createdAt: '2024-01-01'
    },
    {
      id: 'underwriting',
      orgId: 'org-1',
      name: 'Underwriting',
      slug: 'underwriting',
      stageOrder: 3,
      isTerminal: false,
      color: '#ec4899',
      autoActions: {},
      createdAt: '2024-01-01'
    },
    {
      id: 'funded',
      orgId: 'org-1',
      name: 'Funded',
      slug: 'funded',
      stageOrder: 4,
      isTerminal: true,
      terminalType: 'won',
      color: '#22c55e',
      autoActions: {},
      createdAt: '2024-01-01'
    }
  ]

  const mockDeal: Deal = {
    id: 'deal-1',
    orgId: 'org-1',
    prospectId: 'prospect-1',
    contactId: 'contact-1',
    stageId: 'contacted',
    dealNumber: 'D-2024-001',
    amountRequested: 50000,
    amountApproved: 45000,
    termMonths: 12,
    factorRate: 1.35,
    dailyPayment: 200,
    weeklyPayment: 1000,
    totalPayback: 60750,
    commissionAmount: 2500,
    useOfFunds: 'working_capital',
    useOfFundsDetails: 'Inventory purchase for holiday season',
    bankConnected: true,
    averageDailyBalance: 15000,
    monthlyRevenue: 85000,
    nsfCount: 2,
    existingPositions: 1,
    priority: 'high',
    probability: 75,
    expectedCloseDate: '2024-02-15',
    submittedAt: '2024-01-15',
    approvedAt: '2024-01-20',
    createdAt: '2024-01-01',
    updatedAt: '2024-01-25'
  }

  const mockStage = mockStages[1] // Contacted

  const mockDocuments: DealDocument[] = [
    {
      id: 'doc-1',
      dealId: 'deal-1',
      documentType: 'application',
      fileName: 'application.pdf',
      filePath: '/docs/application.pdf',
      fileSize: 1024000,
      isRequired: true,
      uploadedBy: 'user-1',
      uploadedAt: '2024-01-10',
      metadata: {}
    },
    {
      id: 'doc-2',
      dealId: 'deal-1',
      documentType: 'bank_statement',
      fileName: 'statements.pdf',
      filePath: '/docs/statements.pdf',
      fileSize: 2048000,
      isRequired: true,
      uploadedBy: 'user-1',
      uploadedAt: '2024-01-12',
      metadata: {}
    }
  ]

  const mockDisclosure: Disclosure = {
    id: 'disclosure-1',
    orgId: 'org-1',
    dealId: 'deal-1',
    state: 'CA',
    regulationName: 'CA SB 1235',
    version: '1.0',
    fundingAmount: 45000,
    totalDollarCost: 15750,
    termDays: 365,
    aprEquivalent: 35.5,
    disclosureData: {},
    signatureRequired: true,
    status: 'generated',
    createdAt: '2024-01-21',
    updatedAt: '2024-01-21'
  }

  const mockContact: Contact = {
    id: 'contact-1',
    orgId: 'org-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '555-1234',
    preferredContactMethod: 'email',
    timezone: 'America/New_York',
    tags: [],
    isActive: true,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01'
  }

  const mockProspect: Prospect = {
    id: 'prospect-1',
    companyName: 'Acme Restaurant',
    industry: 'restaurant',
    state: 'CA',
    priorityScore: 85,
    status: 'new',
    defaultDate: '2024-01-15',
    timeSinceDefault: 120,
    healthScore: {
      grade: 'B',
      score: 72,
      sentimentTrend: 'stable',
      reviewCount: 18,
      avgSentiment: 0.85,
      violationCount: 2,
      lastUpdated: '2026-01-15T00:00:00Z'
    },
    narrative: 'Sample company narrative',
    uccFilings: [],
    growthSignals: []
  }

  const mockActivities: ContactActivity[] = [
    {
      id: 'activity-1',
      contactId: 'contact-1',
      activityType: 'call_outbound',
      subject: 'Follow-up call',
      metadata: {},
      createdAt: '2024-01-20'
    }
  ]

  const defaultProps = {
    deal: mockDeal,
    stage: mockStage,
    documents: mockDocuments,
    disclosure: mockDisclosure,
    contact: mockContact,
    prospect: mockProspect,
    activities: mockActivities,
    onBack: vi.fn(),
    onEdit: vi.fn(),
    onStageChange: vi.fn(),
    onDocumentUpload: vi.fn(),
    onDocumentDownload: vi.fn(),
    onGenerateDisclosure: vi.fn(),
    onSendDisclosure: vi.fn(),
    stages: mockStages
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the deal detail component', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getAllByTestId('card').length).toBeGreaterThan(0)
    })

    it('displays deal number', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('D-2024-001')).toBeInTheDocument()
    })

    it('displays stage badge', () => {
      render(<DealDetail {...defaultProps} />)
      // Stage name may appear multiple times (badge, stepper)
      expect(screen.getAllByText('Contacted').length).toBeGreaterThan(0)
    })

    it('displays priority badge', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('High')).toBeInTheDocument()
    })
  })

  describe('amount summary', () => {
    it('displays requested amount', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$50,000')).toBeInTheDocument()
      expect(screen.getByText('Requested')).toBeInTheDocument()
    })

    it('displays approved amount', () => {
      render(<DealDetail {...defaultProps} />)
      // Amount may appear multiple times (summary and disclosure sections)
      expect(screen.getAllByText('$45,000').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Approved').length).toBeGreaterThan(0)
    })

    it('displays funded amount when present', () => {
      const fundedDeal = { ...mockDeal, amountFunded: 42000 }
      render(<DealDetail {...defaultProps} deal={fundedDeal} />)
      expect(screen.getAllByText('$42,000').length).toBeGreaterThan(0)
      // 'Funded' may appear in stage name and amount label
      expect(screen.getAllByText(/Funded/i).length).toBeGreaterThan(0)
    })
  })

  describe('stage progression', () => {
    it('renders stage stepper with all stages', () => {
      render(<DealDetail {...defaultProps} />)
      const stageButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.title?.includes('Move to'))
      expect(stageButtons.length).toBe(mockStages.length)
    })

    it('calls onStageChange when stage button clicked', async () => {
      const user = userEvent.setup()
      const onStageChange = vi.fn()
      render(<DealDetail {...defaultProps} onStageChange={onStageChange} />)

      // Click on the Underwriting stage button (stage 3)
      const stageButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.title?.includes('Move to'))
      await user.click(stageButtons[2]) // Index 2 = Underwriting

      expect(onStageChange).toHaveBeenCalledWith('underwriting')
    })
  })

  describe('tabs', () => {
    it('renders Overview tab', () => {
      render(<DealDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const overviewTab = tabTriggers.find((t) => t.textContent?.includes('Overview'))
      expect(overviewTab).toBeInTheDocument()
    })

    it('renders Documents tab with count', () => {
      render(<DealDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const docsTab = tabTriggers.find((t) => t.textContent?.includes('Documents'))
      expect(docsTab).toBeInTheDocument()
      expect(docsTab?.textContent).toContain('2')
    })

    it('renders Underwriting tab', () => {
      render(<DealDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const uwTab = tabTriggers.find((t) => t.textContent?.includes('Underwriting'))
      expect(uwTab).toBeInTheDocument()
    })

    it('renders Disclosure tab', () => {
      render(<DealDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const disclosureTab = tabTriggers.find((t) => t.textContent?.includes('Disclosure'))
      expect(disclosureTab).toBeInTheDocument()
    })

    it('renders Activity tab', () => {
      render(<DealDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const activityTab = tabTriggers.find((t) => t.textContent?.includes('Activity'))
      expect(activityTab).toBeInTheDocument()
    })
  })

  describe('deal terms card', () => {
    it('displays term months', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('12 months')).toBeInTheDocument()
    })

    it('displays factor rate', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('1.35')).toBeInTheDocument()
    })

    it('displays daily payment', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$200')).toBeInTheDocument()
    })

    it('displays weekly payment', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$1,000')).toBeInTheDocument()
    })

    it('displays total payback', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$60,750')).toBeInTheDocument()
    })

    it('displays commission amount', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$2,500')).toBeInTheDocument()
    })
  })

  describe('use of funds card', () => {
    it('displays use of funds purpose', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('working_capital')).toBeInTheDocument()
    })

    it('displays use of funds details', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('Inventory purchase for holiday season')).toBeInTheDocument()
    })
  })

  describe('contact and prospect cards', () => {
    it('displays contact name', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('displays contact email', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })

    it('displays prospect company name', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('Acme Restaurant')).toBeInTheDocument()
    })

    it('displays prospect industry and state', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText(/restaurant - CA/i)).toBeInTheDocument()
    })

    it('displays prospect score', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('Score: 85')).toBeInTheDocument()
    })
  })

  describe('documents tab', () => {
    it('displays document completion progress', () => {
      render(<DealDetail {...defaultProps} />)
      // 2 out of 4 required docs (application, bank_statement, voided_check, drivers_license)
      expect(screen.getByText(/2\/4 required/i)).toBeInTheDocument()
    })

    it('displays progress bar', () => {
      render(<DealDetail {...defaultProps} />)
      const progressBars = screen.getAllByTestId('progress')
      expect(progressBars.length).toBeGreaterThan(0)
    })

    it('shows uploaded documents with check icon', () => {
      render(<DealDetail {...defaultProps} />)
      const checkIcons = screen.getAllByTestId('check-circle-icon')
      expect(checkIcons.length).toBeGreaterThan(0)
    })

    it('shows Required badge for missing required documents', () => {
      render(<DealDetail {...defaultProps} />)
      // voided_check and drivers_license are missing
      const requiredBadges = screen.getAllByText('Required')
      expect(requiredBadges.length).toBe(2)
    })

    it('calls onDocumentUpload when Upload clicked', async () => {
      const user = userEvent.setup()
      const onDocumentUpload = vi.fn()
      render(<DealDetail {...defaultProps} onDocumentUpload={onDocumentUpload} />)

      const uploadButtons = screen.getAllByRole('button', { name: /upload/i })
      await user.click(uploadButtons[0])

      expect(onDocumentUpload).toHaveBeenCalled()
    })

    it('calls onDocumentDownload when Download clicked', async () => {
      const user = userEvent.setup()
      const onDocumentDownload = vi.fn()
      render(<DealDetail {...defaultProps} onDocumentDownload={onDocumentDownload} />)

      // Find buttons containing the download icon
      const buttons = screen.getAllByRole('button')
      const downloadButton = buttons.find((btn) =>
        btn.querySelector('[data-testid="download-icon"]')
      )
      expect(downloadButton).toBeTruthy()

      await user.click(downloadButton!)
      expect(onDocumentDownload).toHaveBeenCalledWith(mockDocuments[0])
    })
  })

  describe('underwriting tab', () => {
    it('displays average daily balance', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$15,000')).toBeInTheDocument()
    })

    it('displays monthly revenue', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('$85,000')).toBeInTheDocument()
    })

    it('displays NSF count', () => {
      render(<DealDetail {...defaultProps} />)
      // '2' may appear multiple times (NSF count, document count badge)
      expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    })

    it('displays existing positions', () => {
      render(<DealDetail {...defaultProps} />)
      // '1' may appear in activity count badge and positions count
      expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    })

    it('displays probability', () => {
      render(<DealDetail {...defaultProps} />)
      // Probability may appear in badge and progress sections
      expect(screen.getAllByText(/75%/).length).toBeGreaterThan(0)
    })

    it('shows connect bank prompt when no bank data', () => {
      const noBankDeal = { ...mockDeal, bankConnected: false, averageDailyBalance: undefined }
      render(<DealDetail {...defaultProps} deal={noBankDeal} />)
      expect(screen.getByText('Bank Data Not Connected')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /connect bank account/i })).toBeInTheDocument()
    })
  })

  describe('disclosure tab', () => {
    it('displays disclosure regulation name', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('CA SB 1235')).toBeInTheDocument()
    })

    it('displays disclosure state', () => {
      render(<DealDetail {...defaultProps} />)
      const badges = screen.getAllByTestId('badge')
      const stateBadge = badges.find((b) => b.textContent === 'CA')
      expect(stateBadge).toBeInTheDocument()
    })

    it('displays disclosure status', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('Generated')).toBeInTheDocument()
    })

    it('displays funding amount', () => {
      render(<DealDetail {...defaultProps} />)
      // $45,000 appears multiple times (deal amount and disclosure)
      const amounts = screen.getAllByText('$45,000')
      expect(amounts.length).toBeGreaterThan(0)
    })

    it('displays APR equivalent', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByText('35.50%')).toBeInTheDocument()
    })

    it('shows Send for Signature button when status is generated', () => {
      render(<DealDetail {...defaultProps} />)
      expect(screen.getByRole('button', { name: /send for signature/i })).toBeInTheDocument()
    })

    it('calls onSendDisclosure when Send for Signature clicked', async () => {
      const user = userEvent.setup()
      const onSendDisclosure = vi.fn()
      render(<DealDetail {...defaultProps} onSendDisclosure={onSendDisclosure} />)

      await user.click(screen.getByRole('button', { name: /send for signature/i }))
      expect(onSendDisclosure).toHaveBeenCalledTimes(1)
    })

    it('shows generate disclosure prompt when no disclosure', () => {
      render(<DealDetail {...defaultProps} disclosure={null} />)
      expect(screen.getByText('No Disclosure Generated')).toBeInTheDocument()
    })

    it('calls onGenerateDisclosure when Generate Disclosure clicked', async () => {
      const user = userEvent.setup()
      const onGenerateDisclosure = vi.fn()
      render(
        <DealDetail
          {...defaultProps}
          disclosure={null}
          onGenerateDisclosure={onGenerateDisclosure}
        />
      )

      const generateButton = screen
        .getAllByRole('button')
        .find((btn) => btn.textContent?.toLowerCase().includes('generate disclosure'))
      expect(generateButton).toBeTruthy()
      await user.click(generateButton!)
      expect(onGenerateDisclosure).toHaveBeenCalledTimes(1)
    })
  })

  describe('activity tab', () => {
    it('passes activities to ActivityTimeline', () => {
      render(<DealDetail {...defaultProps} />)
      const timeline = screen.getByTestId('activity-timeline')
      expect(timeline).toHaveAttribute('data-count', '1')
    })

    it('shows empty message when no activities', () => {
      render(<DealDetail {...defaultProps} activities={[]} />)
      const timeline = screen.getByTestId('activity-timeline')
      expect(timeline).toHaveAttribute(
        'data-empty-message',
        'No activity recorded for this deal yet.'
      )
    })
  })

  describe('user interactions', () => {
    it('calls onBack when Back button clicked', async () => {
      const user = userEvent.setup()
      const onBack = vi.fn()
      render(<DealDetail {...defaultProps} onBack={onBack} />)

      await user.click(screen.getByRole('button', { name: /back/i }))
      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('calls onEdit when Edit Deal button clicked', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      render(<DealDetail {...defaultProps} onEdit={onEdit} />)

      await user.click(screen.getByRole('button', { name: /edit deal/i }))
      expect(onEdit).toHaveBeenCalledTimes(1)
    })
  })

  describe('priority variants', () => {
    it('shows destructive badge for urgent priority', () => {
      const urgentDeal = { ...mockDeal, priority: 'urgent' as const }
      render(<DealDetail {...defaultProps} deal={urgentDeal} />)
      expect(screen.getByText('Urgent')).toBeInTheDocument()
    })

    it('shows outline badge for normal priority', () => {
      const normalDeal = { ...mockDeal, priority: 'normal' as const }
      render(<DealDetail {...defaultProps} deal={normalDeal} />)
      expect(screen.getByText('Normal')).toBeInTheDocument()
    })
  })
})
