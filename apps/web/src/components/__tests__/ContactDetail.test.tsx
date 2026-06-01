import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { ContactDetail } from '../contacts/ContactDetail'
import type { Contact, ContactActivity, Prospect, ProspectContact } from '@public-records/core'

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
  TabsTrigger: ({
    children,
    value,
    onClick
  }: {
    children: ReactNode
    value: string
    onClick?: () => void
  }) => (
    <button data-testid="tab-trigger" data-value={value} onClick={onClick}>
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

vi.mock('@public-records/ui/avatar', () => ({
  Avatar: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="avatar" className={className}>
      {children}
    </div>
  ),
  AvatarFallback: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span data-testid="avatar-fallback" className={className}>
      {children}
    </span>
  ),
  AvatarImage: () => null
}))

vi.mock('@public-records/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div data-testid="dialog">{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <h3 data-testid="dialog-title">{children}</h3>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  )
}))

vi.mock('@phosphor-icons/react', () => ({
  Phone: ({ className }: { className?: string }) => (
    <span data-testid="phone-icon" className={className} />
  ),
  Envelope: ({ className }: { className?: string }) => (
    <span data-testid="envelope-icon" className={className} />
  ),
  ChatText: ({ className }: { className?: string }) => (
    <span data-testid="chat-text-icon" className={className} />
  ),
  MapPin: ({ className }: { className?: string }) => (
    <span data-testid="map-pin-icon" className={className} />
  ),
  Buildings: ({ className }: { className?: string }) => (
    <span data-testid="buildings-icon" className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span data-testid="clock-icon" className={className} />
  ),
  PencilSimple: ({ className }: { className?: string }) => (
    <span data-testid="pencil-icon" className={className} />
  ),
  Link: ({ className }: { className?: string }) => (
    <span data-testid="link-icon" className={className} />
  ),
  CalendarPlus: ({ className }: { className?: string }) => (
    <span data-testid="calendar-plus-icon" className={className} />
  ),
  ArrowLeft: ({ className }: { className?: string }) => (
    <span data-testid="arrow-left-icon" className={className} />
  ),
  Tag: ({ className }: { className?: string }) => (
    <span data-testid="tag-icon" className={className} />
  ),
  User: ({ className }: { className?: string }) => (
    <span data-testid="user-icon" className={className} />
  ),
  Globe: ({ className }: { className?: string }) => (
    <span data-testid="globe-icon" className={className} />
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

describe('ContactDetail', () => {
  const mockContact: Contact = {
    id: 'contact-1',
    orgId: 'org-1',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '555-1234',
    phoneExt: '100',
    mobile: '555-9999',
    title: 'Chief Executive Officer',
    role: 'ceo',
    preferredContactMethod: 'email',
    timezone: 'America/New_York',
    notes: 'Important client notes here.',
    tags: ['vip', 'priority'],
    source: 'referral',
    isActive: true,
    lastContactedAt: '2024-06-15T10:30:00Z',
    createdBy: 'user-123',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z'
  }

  const mockActivities: ContactActivity[] = [
    {
      id: 'activity-1',
      contactId: 'contact-1',
      activityType: 'call_outbound',
      subject: 'Follow-up call',
      description: 'Discussed renewal options',
      durationSeconds: 300,
      metadata: {},
      createdAt: '2024-06-15T10:30:00Z'
    },
    {
      id: 'activity-2',
      contactId: 'contact-1',
      activityType: 'email_sent',
      subject: 'Proposal sent',
      metadata: {},
      createdAt: '2024-06-14T14:00:00Z'
    }
  ]

  const mockProspect: Prospect = {
    id: 'prospect-1',
    companyName: 'Acme Corp',
    industry: 'technology',
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

  const mockLink: ProspectContact = {
    id: 'link-1',
    prospectId: 'prospect-1',
    contactId: 'contact-1',
    isPrimary: true,
    relationship: 'owner',
    createdAt: '2024-01-01'
  }

  const defaultProps = {
    contact: mockContact,
    activities: mockActivities,
    linkedProspects: [{ prospect: mockProspect, link: mockLink }],
    onEdit: vi.fn(),
    onBack: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders the contact detail component', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getAllByTestId('card').length).toBeGreaterThan(0)
    })

    it('displays contact full name', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })

    it('displays contact title', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Chief Executive Officer')).toBeInTheDocument()
    })

    it('displays contact email', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
    })

    it('displays contact phone with extension', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('555-1234 ext. 100')).toBeInTheDocument()
    })

    it('displays mobile number', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('555-9999')).toBeInTheDocument()
    })

    it('displays preferred contact method', () => {
      render(<ContactDetail {...defaultProps} />)
      // 'Email' may appear multiple times (preferred method label and value)
      expect(screen.getAllByText('Email').length).toBeGreaterThan(0)
    })

    it('displays timezone', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('America/New_York')).toBeInTheDocument()
    })

    it('displays role badge', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('CEO')).toBeInTheDocument()
    })

    it('displays active status badge', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('displays inactive status for inactive contact', () => {
      const inactiveContact = { ...mockContact, isActive: false }
      render(<ContactDetail {...defaultProps} contact={inactiveContact} />)
      expect(screen.getByText('Inactive')).toBeInTheDocument()
    })
  })

  describe('avatar', () => {
    it('displays correct initials', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('JD')).toBeInTheDocument()
    })
  })

  describe('tags', () => {
    it('displays all contact tags', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('vip')).toBeInTheDocument()
      expect(screen.getByText('priority')).toBeInTheDocument()
    })

    it('does not render tag section when no tags', () => {
      const noTagsContact = { ...mockContact, tags: [] }
      render(<ContactDetail {...defaultProps} contact={noTagsContact} />)
      expect(screen.queryByTestId('tag-icon')).not.toBeInTheDocument()
    })
  })

  describe('quick action buttons', () => {
    it('renders call button when onCall provided', () => {
      const onCall = vi.fn()
      render(<ContactDetail {...defaultProps} onCall={onCall} />)
      // Multiple phone icons may exist (contact info section + action button)
      expect(screen.getAllByTestId('phone-icon').length).toBeGreaterThan(0)
    })

    it('renders email button when onEmail provided', () => {
      const onEmail = vi.fn()
      render(<ContactDetail {...defaultProps} onEmail={onEmail} />)
      expect(screen.getAllByTestId('envelope-icon').length).toBeGreaterThan(0)
    })

    it('renders SMS button when onSms provided', () => {
      const onSms = vi.fn()
      render(<ContactDetail {...defaultProps} onSms={onSms} />)
      expect(screen.getAllByTestId('chat-text-icon').length).toBeGreaterThan(0)
    })

    it('does not render call button when onCall not provided', () => {
      render(<ContactDetail {...defaultProps} />)
      // Count phone icons - should only have one in the contact details section
      const phoneIcons = screen.getAllByTestId('phone-icon')
      expect(phoneIcons.length).toBe(1) // Only in contact info, not as action button
    })
  })

  describe('tabs', () => {
    it('renders Activity tab', () => {
      render(<ContactDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const activityTab = tabTriggers.find((t) => t.textContent?.includes('Activity'))
      expect(activityTab).toBeInTheDocument()
    })

    it('renders Linked Prospects tab with count', () => {
      render(<ContactDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const prospectsTab = tabTriggers.find((t) => t.textContent?.includes('Linked Prospects'))
      expect(prospectsTab).toBeInTheDocument()
      expect(prospectsTab?.textContent).toContain('1')
    })

    it('renders Notes tab', () => {
      render(<ContactDetail {...defaultProps} />)
      const tabTriggers = screen.getAllByTestId('tab-trigger')
      const notesTab = tabTriggers.find((t) => t.textContent?.includes('Notes'))
      expect(notesTab).toBeInTheDocument()
    })
  })

  describe('activity timeline', () => {
    it('passes activities to ActivityTimeline', () => {
      render(<ContactDetail {...defaultProps} />)
      const timeline = screen.getByTestId('activity-timeline')
      expect(timeline).toHaveAttribute('data-count', '2')
    })

    it('shows empty message when no activities', () => {
      render(<ContactDetail {...defaultProps} activities={[]} />)
      const timeline = screen.getByTestId('activity-timeline')
      expect(timeline).toHaveAttribute(
        'data-empty-message',
        'No activity recorded for this contact yet.'
      )
    })
  })

  describe('linked prospects', () => {
    it('displays linked prospect company name', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    it('displays prospect state', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('CA')).toBeInTheDocument()
    })

    it('displays prospect industry', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('technology')).toBeInTheDocument()
    })

    it('displays Primary badge for primary contact', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Primary')).toBeInTheDocument()
    })

    it('displays relationship badge', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('owner')).toBeInTheDocument()
    })

    it('displays priority score', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Score: 85')).toBeInTheDocument()
    })

    it('shows empty state when no linked prospects', () => {
      render(<ContactDetail {...defaultProps} linkedProspects={[]} />)
      expect(screen.getByText('No prospects linked to this contact yet.')).toBeInTheDocument()
    })
  })

  describe('notes section', () => {
    it('displays contact notes', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('Important client notes here.')).toBeInTheDocument()
    })

    it('shows empty state when no notes', () => {
      const noNotesContact = { ...mockContact, notes: undefined }
      render(<ContactDetail {...defaultProps} contact={noNotesContact} />)
      expect(screen.getByText('No notes added for this contact yet.')).toBeInTheDocument()
    })

    it('displays contact source', () => {
      render(<ContactDetail {...defaultProps} />)
      expect(screen.getByText('referral')).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('calls onBack when Back button clicked', async () => {
      const user = userEvent.setup()
      const onBack = vi.fn()
      render(<ContactDetail {...defaultProps} onBack={onBack} />)

      const backButton = screen.getByRole('button', { name: /back/i })
      await user.click(backButton)

      expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('calls onEdit when Edit button clicked', async () => {
      const user = userEvent.setup()
      const onEdit = vi.fn()
      render(<ContactDetail {...defaultProps} onEdit={onEdit} />)

      const editButton = screen.getByRole('button', { name: /edit/i })
      await user.click(editButton)

      expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('calls onCall with contact when call button clicked', async () => {
      const user = userEvent.setup()
      const onCall = vi.fn()
      render(<ContactDetail {...defaultProps} onCall={onCall} />)

      // Find the button containing the phone icon (quick action button)
      const buttons = screen.getAllByRole('button')
      const callButton = buttons.find((btn) => btn.querySelector('[data-testid="phone-icon"]'))
      expect(callButton).toBeTruthy()

      await user.click(callButton!)
      expect(onCall).toHaveBeenCalledWith(mockContact)
    })

    it('calls onEmail with contact when email button clicked', async () => {
      const user = userEvent.setup()
      const onEmail = vi.fn()
      render(<ContactDetail {...defaultProps} onEmail={onEmail} />)

      const buttons = screen.getAllByRole('button')
      const emailButton = buttons.find((btn) => btn.querySelector('[data-testid="envelope-icon"]'))
      expect(emailButton).toBeTruthy()

      await user.click(emailButton!)
      expect(onEmail).toHaveBeenCalledWith(mockContact)
    })

    it('calls onSms with contact when SMS button clicked', async () => {
      const user = userEvent.setup()
      const onSms = vi.fn()
      render(<ContactDetail {...defaultProps} onSms={onSms} />)

      const buttons = screen.getAllByRole('button')
      const smsButton = buttons.find((btn) => btn.querySelector('[data-testid="chat-text-icon"]'))
      expect(smsButton).toBeTruthy()

      await user.click(smsButton!)
      expect(onSms).toHaveBeenCalledWith(mockContact)
    })

    it('calls onScheduleMeeting when Schedule Meeting clicked', async () => {
      const user = userEvent.setup()
      const onScheduleMeeting = vi.fn()
      render(<ContactDetail {...defaultProps} onScheduleMeeting={onScheduleMeeting} />)

      const scheduleButton = screen.getByRole('button', { name: /schedule meeting/i })
      await user.click(scheduleButton)

      expect(onScheduleMeeting).toHaveBeenCalledWith(mockContact)
    })

    it('calls onLinkProspect when Link Prospect clicked', async () => {
      const user = userEvent.setup()
      const onLinkProspect = vi.fn()
      render(<ContactDetail {...defaultProps} onLinkProspect={onLinkProspect} />)

      const linkButton = screen.getByRole('button', { name: /link prospect/i })
      await user.click(linkButton)

      expect(onLinkProspect).toHaveBeenCalledWith(mockContact)
    })

    it('calls onProspectSelect when prospect card clicked', async () => {
      const user = userEvent.setup()
      const onProspectSelect = vi.fn()
      render(<ContactDetail {...defaultProps} onProspectSelect={onProspectSelect} />)

      // Find the card containing Acme Corp - it should have cursor-pointer for click
      const cards = screen.getAllByTestId('card')
      const prospectCard = cards.find(
        (card) =>
          card.textContent?.includes('Acme Corp') &&
          (card.className?.includes('cursor-pointer') || card.getAttribute('onClick'))
      )

      // If no specific prospect card found, just find by text
      const cardToClick =
        prospectCard || cards.find((card) => card.textContent?.includes('Acme Corp'))
      expect(cardToClick).toBeTruthy()

      await user.click(cardToClick!)
      expect(onProspectSelect).toHaveBeenCalledWith(mockProspect)
    })
  })

  describe('missing optional data', () => {
    it('displays dash for missing email', () => {
      const noEmailContact = { ...mockContact, email: undefined }
      render(<ContactDetail {...defaultProps} contact={noEmailContact} />)
      // The email field should show a dash
      expect(screen.getAllByText('-').length).toBeGreaterThan(0)
    })

    it('displays dash for missing phone', () => {
      const noPhoneContact = { ...mockContact, phone: undefined, phoneExt: undefined }
      render(<ContactDetail {...defaultProps} contact={noPhoneContact} />)
      expect(screen.getAllByText('-').length).toBeGreaterThan(0)
    })

    it('displays dash for missing mobile', () => {
      const noMobileContact = { ...mockContact, mobile: undefined }
      render(<ContactDetail {...defaultProps} contact={noMobileContact} />)
      expect(screen.getAllByText('-').length).toBeGreaterThan(0)
    })

    it('does not display title when missing', () => {
      const noTitleContact = { ...mockContact, title: undefined }
      render(<ContactDetail {...defaultProps} contact={noTitleContact} />)
      expect(screen.queryByText('Chief Executive Officer')).not.toBeInTheDocument()
    })
  })
})
