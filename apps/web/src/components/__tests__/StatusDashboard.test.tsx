import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CompetitorData, HealthScore, PortfolioCompany, Prospect } from '@public-records/core'
import { StatusDashboard, buildStatusDashboardMetrics } from '../StatusDashboard'
import type { UserAction } from '@/lib/agentic/types'

const now = new Date('2026-06-20T12:00:00.000Z')

const healthScore: HealthScore = {
  grade: 'B',
  score: 82,
  sentimentTrend: 'stable',
  reviewCount: 30,
  avgSentiment: 0.4,
  violationCount: 0,
  lastUpdated: '2026-06-20T10:00:00.000Z'
}

function createProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: 'prospect-1',
    companyName: 'Acme Services',
    industry: 'services',
    state: 'CA',
    status: 'new',
    priorityScore: 80,
    defaultDate: '2026-05-20',
    timeSinceDefault: 31,
    uccFilings: [
      {
        id: 'filing-1',
        filingDate: '2026-05-01',
        debtorName: 'Acme Services',
        securedParty: 'Capital Group',
        state: 'CA',
        status: 'active',
        filingType: 'UCC-1'
      }
    ],
    growthSignals: [
      {
        id: 'signal-1',
        type: 'hiring',
        description: 'Hiring signal',
        detectedDate: '2026-06-20T10:00:00.000Z',
        score: 75,
        confidence: 90
      }
    ],
    healthScore,
    narrative: 'Strong recovery profile.',
    ...overrides
  }
}

function createPortfolioCompany(
  overrides: Partial<PortfolioCompany> = {}
): PortfolioCompany {
  return {
    id: 'portfolio-1',
    companyName: 'Portfolio Co',
    fundingDate: '2026-04-01',
    fundingAmount: 50000,
    currentStatus: 'performing',
    healthScore,
    ...overrides
  }
}

const competitors: CompetitorData[] = [
  {
    lenderName: 'Lender A',
    filingCount: 25,
    avgDealSize: 42000,
    marketShare: 18,
    industries: ['services'],
    topState: 'CA',
    monthlyTrend: 4
  }
]

describe('StatusDashboard metrics', () => {
  it('summarizes product status and usage from loaded data', () => {
    const prospects: Prospect[] = [
      createProspect({
        id: 'prospect-ca',
        state: 'CA',
        priorityScore: 90,
        uccFilings: [
          {
            id: 'filing-ca-active',
            filingDate: '2026-05-01',
            debtorName: 'Acme Services',
            securedParty: 'Capital Group',
            state: 'CA',
            status: 'active',
            filingType: 'UCC-1'
          },
          {
            id: 'filing-ca-terminated',
            filingDate: '2025-12-01',
            debtorName: 'Acme Services',
            securedParty: 'Old Capital',
            state: 'CA',
            status: 'terminated',
            filingType: 'UCC-3'
          }
        ]
      }),
      createProspect({
        id: 'prospect-tx',
        state: 'TX',
        priorityScore: 55,
        growthSignals: [
          {
            id: 'signal-recent',
            type: 'permit',
            description: 'Permit signal',
            detectedDate: '2026-06-20T11:00:00.000Z',
            score: 70,
            confidence: 85
          },
          {
            id: 'signal-old',
            type: 'contract',
            description: 'Older contract signal',
            detectedDate: '2026-06-18T11:00:00.000Z',
            score: 65,
            confidence: 80
          }
        ]
      })
    ]
    const portfolio = [
      createPortfolioCompany({ id: 'portfolio-at-risk', currentStatus: 'at-risk' }),
      createPortfolioCompany({ id: 'portfolio-default', currentStatus: 'default' }),
      createPortfolioCompany({ id: 'portfolio-performing', currentStatus: 'performing' })
    ]
    const userActions: UserAction[] = [
      { type: 'refresh-data', timestamp: '2026-06-20T10:00:00.000Z', details: {} },
      { type: 'refresh-data', timestamp: '2026-06-20T08:00:00.000Z', details: {} },
      { type: 'prospect-select', timestamp: '2026-06-18T08:00:00.000Z', details: {} }
    ]

    const metrics = buildStatusDashboardMetrics(
      {
        prospects,
        portfolio,
        competitors,
        userActions,
        isLoading: false,
        loadError: null,
        lastDataRefresh: '2026-06-20T11:30:00.000Z',
        usePreviewData: false,
        dataTier: 'paid'
      },
      now
    )

    expect(metrics.statusLabel).toBe('Online')
    expect(metrics.dataModeLabel).toBe('Live API')
    expect(metrics.dataTierLabel).toBe('Paid')
    expect(metrics.totalProspects).toBe(2)
    expect(metrics.totalFilings).toBe(3)
    expect(metrics.activeFilings).toBe(2)
    expect(metrics.statesCovered).toBe(2)
    expect(metrics.highValueProspects).toBe(1)
    expect(metrics.signals24h).toBe(2)
    expect(metrics.portfolioAtRisk).toBe(2)
    expect(metrics.actions24h).toBe(2)
    expect(metrics.totalActions).toBe(3)
    expect(metrics.latestActionLabel).toBe('Refresh data')
    expect(metrics.mostCommonActionLabel).toBe('Refresh data')
    expect(metrics.stateBreakdown[0]).toEqual({ state: 'CA', prospects: 1, filings: 2 })
  })
})

describe('StatusDashboard', () => {
  it('renders status and triggers refresh', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    render(
      <StatusDashboard
        prospects={[createProspect()]}
        portfolio={[createPortfolioCompany({ currentStatus: 'at-risk' })]}
        competitors={competitors}
        userActions={[
          { type: 'refresh-data', timestamp: '2026-06-20T10:00:00.000Z', details: {} }
        ]}
        isLoading={false}
        loadError={null}
        lastDataRefresh="2026-06-20T11:30:00.000Z"
        usePreviewData={true}
        dataTier="oss"
        onRefresh={onRefresh}
      />
    )

    expect(screen.getByRole('heading', { name: 'Product Status' })).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByText('Preview data')).toBeInTheDocument()
    expect(screen.getByText('Top States')).toBeInTheDocument()
    expect(screen.getByText('CA')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /refresh status/i }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
