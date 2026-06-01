import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { EmailComposer } from '../EmailComposer'
import type { Prospect } from '@public-records/core'

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
    className,
    ...props
  }: {
    children: ReactNode
    onClick?: () => void
    variant?: string
    className?: string
  }) => (
    <button onClick={onClick} data-variant={variant} className={className} {...props}>
      {children}
    </button>
  )
}))

vi.mock('@public-records/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    disabled,
    type,
    min,
    className,
    ...props
  }: {
    id?: string
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    disabled?: boolean
    type?: string
    min?: string
    className?: string
  }) => (
    <input
      id={id}
      value={value}
      onChange={onChange}
      disabled={disabled}
      type={type}
      min={min}
      className={className}
      data-testid={id || 'input'}
      {...props}
    />
  )
}))

vi.mock('@public-records/ui/textarea', () => ({
  Textarea: ({
    id,
    value,
    onChange,
    placeholder,
    className
  }: {
    id?: string
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    placeholder?: string
    className?: string
  }) => (
    <textarea
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      data-testid={id || 'textarea'}
    />
  )
}))

vi.mock('@public-records/ui/label', () => ({
  Label: ({
    children,
    htmlFor,
    className
  }: {
    children: ReactNode
    htmlFor?: string
    className?: string
  }) => (
    <label htmlFor={htmlFor} className={className}>
      {children}
    </label>
  )
}))

vi.mock('@public-records/ui/badge', () => ({
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
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
        data-testid="template-select"
        value={value}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        <option value="">Blank Template</option>
        <option value="template-initial-1">Initial Outreach - High Priority</option>
        <option value="template-followup-1">Follow-up - No Response</option>
      </select>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>
}))

vi.mock('@public-records/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="dialog-footer" className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  )
}))

vi.mock('@public-records/ui/separator', () => ({
  Separator: () => <hr data-testid="separator" />
}))

vi.mock('@phosphor-icons/react', () => ({
  Envelope: ({ className }: { className?: string }) => (
    <span data-testid="envelope-icon" className={className} />
  ),
  PaperPlaneRight: ({ className }: { className?: string }) => (
    <span data-testid="send-icon" className={className} />
  ),
  Calendar: ({ className }: { className?: string }) => (
    <span data-testid="calendar-icon" className={className} />
  ),
  Eye: ({ className }: { className?: string }) => (
    <span data-testid="eye-icon" className={className} />
  )
}))

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: mockToast
}))

vi.mock('@/lib/emailTemplates', () => ({
  DEFAULT_EMAIL_TEMPLATES: [
    {
      id: 'template-initial-1',
      name: 'Initial Outreach - High Priority',
      subject: 'Business Growth Opportunity for {{companyName}}',
      body: 'Hi there, {{companyName}} has shown growth signals.',
      category: 'initial-outreach',
      variables: ['companyName', 'signalSummary', 'healthGrade']
    },
    {
      id: 'template-followup-1',
      name: 'Follow-up - No Response',
      subject: 'Following up: Financing for {{companyName}}',
      body: 'Following up on my previous email about {{companyName}}.',
      category: 'follow-up',
      variables: ['companyName', 'industryType']
    }
  ],
  populateTemplate: vi.fn((template, data) => ({
    subject: template.subject.replace('{{companyName}}', data.companyName),
    body: template.body.replace('{{companyName}}', data.companyName)
  }))
}))

describe('EmailComposer', () => {
  const mockProspect: Prospect = {
    id: 'prospect-1',
    companyName: 'Test Company Inc',
    industry: 'construction',
    state: 'CA',
    priorityScore: 85,
    status: 'new',
    healthScore: {
      grade: 'A',
      score: 92,
      sentimentTrend: 'improving',
      reviewCount: 15,
      violationCount: 0,
      avgSentiment: 0.85,
      lastUpdated: '2026-01-15T00:00:00Z'
    },
    timeSinceDefault: 730,
    defaultDate: '2022-01-15',
    narrative: 'Strong growth indicators',
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
    uccFilings: [],
    mlScoring: {
      confidence: 88,
      recoveryLikelihood: 75,
      modelVersion: '1.0',
      factors: {},
      lastUpdated: '2024-01-15'
    }
  }

  const defaultProps = {
    prospect: mockProspect,
    open: true,
    onOpenChange: vi.fn(),
    onSendEmail: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders dialog when open', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByTestId('dialog')).toBeInTheDocument()
    })

    it('does not render dialog when closed', () => {
      render(<EmailComposer {...defaultProps} open={false} />)
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
    })

    it('displays dialog title', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Compose Email')
    })

    it('displays prospect name in description', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByTestId('dialog-description')).toHaveTextContent('Test Company Inc')
    })

    it('renders envelope icon', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByTestId('envelope-icon')).toBeInTheDocument()
    })
  })

  describe('form fields', () => {
    it('renders template selector', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Email Template')).toBeInTheDocument()
      expect(screen.getByTestId('template-select')).toBeInTheDocument()
    })

    it('renders recipient field (disabled)', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('To')).toBeInTheDocument()
      const recipientInput = screen.getByTestId('recipient')
      expect(recipientInput).toBeDisabled()
    })

    it('shows placeholder email based on company name', () => {
      render(<EmailComposer {...defaultProps} />)
      const recipientInput = screen.getByTestId('recipient')
      expect(recipientInput).toHaveValue('Test Company Inc <contact@testcompanyinc.com>')
    })

    it('renders subject input', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Subject')).toBeInTheDocument()
      expect(screen.getByTestId('subject')).toBeInTheDocument()
    })

    it('renders body textarea', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Email Body')).toBeInTheDocument()
      expect(screen.getByTestId('body')).toBeInTheDocument()
    })

    it('renders schedule input', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText(/Schedule Send/)).toBeInTheDocument()
      expect(screen.getByTestId('schedule')).toBeInTheDocument()
    })
  })

  describe('prospect context', () => {
    it('displays priority score', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Priority Score:')).toBeInTheDocument()
      expect(screen.getByText('85')).toBeInTheDocument()
    })

    it('displays health grade', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Health Grade:')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('displays ML confidence when available', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('ML Confidence:')).toBeInTheDocument()
      expect(screen.getByText('88%')).toBeInTheDocument()
    })

    it('displays recovery likelihood when available', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Recovery Likelihood:')).toBeInTheDocument()
      expect(screen.getByText('75%')).toBeInTheDocument()
    })

    it('displays growth signals count', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Growth Signals:')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('displays industry', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByText('Industry:')).toBeInTheDocument()
      expect(screen.getByText('construction')).toBeInTheDocument()
    })
  })

  describe('template selection', () => {
    it('populates subject and body when template is selected', async () => {
      render(<EmailComposer {...defaultProps} />)

      const templateSelect = screen.getByTestId('template-select')
      await userEvent.selectOptions(templateSelect, 'template-initial-1')

      // Check that subject was populated
      const subjectInput = screen.getByTestId('subject')
      expect(subjectInput).toHaveValue('Business Growth Opportunity for Test Company Inc')
    })
  })

  describe('preview mode', () => {
    it('has preview/edit toggle button', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
    })

    it('toggles preview mode on click', async () => {
      render(<EmailComposer {...defaultProps} />)

      const previewButton = screen.getByRole('button', { name: /preview/i })
      await userEvent.click(previewButton)

      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    })
  })

  describe('form validation', () => {
    it('shows error toast when sending without subject', async () => {
      render(<EmailComposer {...defaultProps} />)

      // Fill only body, not subject
      const bodyTextarea = screen.getByTestId('body')
      await userEvent.type(bodyTextarea, 'Email body content')

      const sendButton = screen.getByRole('button', { name: /send email/i })
      await userEvent.click(sendButton)

      expect(mockToast.error).toHaveBeenCalledWith('Subject and body are required')
    })

    it('shows error toast when sending without body', async () => {
      render(<EmailComposer {...defaultProps} />)

      // Fill only subject, not body
      const subjectInput = screen.getByTestId('subject')
      await userEvent.type(subjectInput, 'Email subject')

      const sendButton = screen.getByRole('button', { name: /send email/i })
      await userEvent.click(sendButton)

      expect(mockToast.error).toHaveBeenCalledWith('Subject and body are required')
    })
  })

  describe('sending email', () => {
    it('calls onSendEmail with correct data', async () => {
      const onSendEmail = vi.fn()
      render(<EmailComposer {...defaultProps} onSendEmail={onSendEmail} />)

      const subjectInput = screen.getByTestId('subject')
      await userEvent.type(subjectInput, 'Test Subject')

      const bodyTextarea = screen.getByTestId('body')
      await userEvent.type(bodyTextarea, 'Test Body')

      const sendButton = screen.getByRole('button', { name: /send email/i })
      await userEvent.click(sendButton)

      expect(onSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          prospectId: 'prospect-1',
          subject: 'Test Subject',
          body: 'Test Body',
          status: 'sent'
        })
      )
    })

    it('shows success toast on send', async () => {
      render(<EmailComposer {...defaultProps} />)

      const subjectInput = screen.getByTestId('subject')
      await userEvent.type(subjectInput, 'Test Subject')

      const bodyTextarea = screen.getByTestId('body')
      await userEvent.type(bodyTextarea, 'Test Body')

      const sendButton = screen.getByRole('button', { name: /send email/i })
      await userEvent.click(sendButton)

      expect(mockToast.success).toHaveBeenCalledWith('Email sent successfully')
    })

    it('closes dialog after sending', async () => {
      const onOpenChange = vi.fn()
      render(<EmailComposer {...defaultProps} onOpenChange={onOpenChange} />)

      const subjectInput = screen.getByTestId('subject')
      await userEvent.type(subjectInput, 'Test Subject')

      const bodyTextarea = screen.getByTestId('body')
      await userEvent.type(bodyTextarea, 'Test Body')

      const sendButton = screen.getByRole('button', { name: /send email/i })
      await userEvent.click(sendButton)

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('scheduling email', () => {
    it('schedules email when date is set', async () => {
      const onSendEmail = vi.fn()
      render(<EmailComposer {...defaultProps} onSendEmail={onSendEmail} />)

      const subjectInput = screen.getByTestId('subject')
      await userEvent.type(subjectInput, 'Test Subject')

      const bodyTextarea = screen.getByTestId('body')
      await userEvent.type(bodyTextarea, 'Test Body')

      const scheduleInput = screen.getByTestId('schedule')
      await userEvent.type(scheduleInput, '2024-02-20T10:00')

      const scheduleButton = screen.getByRole('button', { name: /schedule email/i })
      await userEvent.click(scheduleButton)

      expect(onSendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'scheduled',
          scheduledFor: '2024-02-20T10:00'
        })
      )
    })

    it('shows schedule button when date is set', async () => {
      render(<EmailComposer {...defaultProps} />)

      const scheduleInput = screen.getByTestId('schedule')
      await userEvent.type(scheduleInput, '2024-02-20T10:00')

      expect(screen.getByRole('button', { name: /schedule email/i })).toBeInTheDocument()
    })
  })

  describe('cancel functionality', () => {
    it('renders cancel button', () => {
      render(<EmailComposer {...defaultProps} />)
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    })

    it('calls onOpenChange when cancel is clicked', async () => {
      const onOpenChange = vi.fn()
      render(<EmailComposer {...defaultProps} onOpenChange={onOpenChange} />)

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
