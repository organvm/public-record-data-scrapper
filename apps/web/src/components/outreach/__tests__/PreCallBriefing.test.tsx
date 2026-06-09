import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { PreCallBriefing } from '../PreCallBriefing'
import { ApiError, TimeoutError } from '@/lib/api/client'
import type { PreCallBriefing as BriefingData, ProspectNarrative } from '@/lib/api/outreach'

// Mock the outreach api client — the component must render only real, returned
// data and surface server errors verbatim. No fetch hits the network.
const fetchBriefing = vi.fn()
const fetchNarrative = vi.fn()

vi.mock('@/lib/api/outreach', () => ({
  fetchBriefing: (...args: unknown[]) => fetchBriefing(...args),
  fetchNarrative: (...args: unknown[]) => fetchNarrative(...args)
}))

const briefing: BriefingData = {
  prospectId: 'p-1',
  generatedAt: '2026-06-06T00:00:00Z',
  companyName: 'Acme LLC',
  state: 'CA',
  industry: 'construction',
  priorityScore: 80,
  stackAnalysis: {
    activeFilings: 3,
    terminatedFilings: 1,
    totalFilings: 4,
    knownCompetitors: ['Kapitus', 'OnDeck']
  },
  freshCapacity: {
    score: 62,
    recentTerminations: 1,
    daysSinceLastTermination: 12
  },
  velocity: {
    trend30d: 'accelerating',
    filings30d: 2,
    trend90d: 'stable'
  },
  talkingPoints: ['Fresh capacity available — recently paid off financing', '3 active positions'],
  riskFactors: ['Potential over-stacking risk']
}

const narrative: ProspectNarrative = {
  prospectId: 'p-1',
  companyName: 'Acme LLC',
  summary: 'A strong consolidation opportunity.',
  detailedNarrative: 'Detailed narrative body.',
  talkingPoints: [{ category: 'opportunity', point: 'Consolidate three positions', priority: 1 }],
  isWhaleOpportunity: true,
  whaleScore: 87,
  whaleReasons: ['high revenue'],
  riskFactors: [{ factor: 'over-stacking', severity: 'medium' }],
  riskLevel: 'medium',
  growthAnalysis: 'Growing.',
  topGrowthSignals: [],
  stackInsight: 'Stacked.',
  suggestedPosition: '2nd',
  approachRecommendation: 'standard',
  approachReasoning: 'Balanced profile.',
  callOpeners: ['Saw you recently paid off a position.'],
  potentialObjections: [
    { objection: 'Already have funding', response: 'We refinance.', supportingData: 'rate data' }
  ],
  generatedAt: '2026-06-06T00:00:00Z'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PreCallBriefing', () => {
  it('does not auto-fetch — shows a generate button in the idle state', () => {
    render(<PreCallBriefing prospectId="p-1" />)
    expect(fetchBriefing).not.toHaveBeenCalled()
    expect(fetchNarrative).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /generate briefing/i })).toBeInTheDocument()
  })

  it('fetches and renders real briefing + narrative data on demand', async () => {
    fetchBriefing.mockResolvedValue(briefing)
    fetchNarrative.mockResolvedValue(narrative)

    render(<PreCallBriefing prospectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /generate briefing/i }))

    await waitFor(() => expect(screen.getByTestId('briefing-ready')).toBeInTheDocument())

    expect(fetchBriefing).toHaveBeenCalledWith('p-1', expect.anything())
    // Real briefing data
    expect(
      screen.getByText('Fresh capacity available — recently paid off financing')
    ).toBeInTheDocument()
    expect(screen.getByText('Potential over-stacking risk')).toBeInTheDocument()
    expect(screen.getByText('Kapitus')).toBeInTheDocument()
    expect(screen.getByText('OnDeck')).toBeInTheDocument()
    // Real narrative data
    expect(screen.getByTestId('narrative-ready')).toBeInTheDocument()
    expect(screen.getByText('A strong consolidation opportunity.')).toBeInTheDocument()
    expect(screen.getByText('Saw you recently paid off a position.')).toBeInTheDocument()
  })

  it('surfaces the server error verbatim and fails closed when the briefing fails', async () => {
    fetchBriefing.mockRejectedValue(
      new ApiError('Not Found', 404, { error: 'Prospect not found: p-1' })
    )

    render(<PreCallBriefing prospectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /generate briefing/i }))

    await waitFor(() => expect(screen.getByTestId('briefing-error')).toBeInTheDocument())
    // Verbatim reason from the server body, not invented copy.
    expect(screen.getByText('Prospect not found: p-1')).toBeInTheDocument()
    // No briefing content rendered.
    expect(screen.queryByTestId('briefing-ready')).not.toBeInTheDocument()
    // Narrative is never attempted if the briefing failed.
    expect(fetchNarrative).not.toHaveBeenCalled()
  })

  it('still renders the briefing when the narrative route is unavailable (fail closed independently)', async () => {
    fetchBriefing.mockResolvedValue(briefing)
    fetchNarrative.mockRejectedValue(
      new ApiError('Not Found', 404, { error: 'Cannot GET /api/outreach/narrative/p-1' })
    )

    render(<PreCallBriefing prospectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /generate briefing/i }))

    await waitFor(() => expect(screen.getByTestId('briefing-ready')).toBeInTheDocument())
    // Briefing still rendered
    expect(screen.getByText('Potential over-stacking risk')).toBeInTheDocument()
    // Narrative failure surfaced verbatim, not as placeholder content
    expect(screen.getByTestId('narrative-error')).toBeInTheDocument()
    expect(screen.getByText('Cannot GET /api/outreach/narrative/p-1')).toBeInTheDocument()
    expect(screen.queryByTestId('narrative-ready')).not.toBeInTheDocument()
  })

  it('surfaces a timeout error message verbatim', async () => {
    fetchBriefing.mockRejectedValue(new TimeoutError('Request timed out after 30000ms'))

    render(<PreCallBriefing prospectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /generate briefing/i }))

    await waitFor(() => expect(screen.getByTestId('briefing-error')).toBeInTheDocument())
    expect(screen.getByText('Request timed out after 30000ms')).toBeInTheDocument()
  })

  it('resets to idle when the prospect changes (remount via key)', async () => {
    fetchBriefing.mockResolvedValue(briefing)
    fetchNarrative.mockResolvedValue(narrative)

    // The caller passes key={prospect.id}, so a prospect change remounts the
    // component — mirror that here so no stale data leaks across prospects.
    const { rerender } = render(<PreCallBriefing key="p-1" prospectId="p-1" />)
    await userEvent.click(screen.getByRole('button', { name: /generate briefing/i }))
    await waitFor(() => expect(screen.getByTestId('briefing-ready')).toBeInTheDocument())

    rerender(<PreCallBriefing key="p-2" prospectId="p-2" />)
    // Back to idle: no stale data, generate button shown again.
    expect(screen.queryByTestId('briefing-ready')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /generate briefing/i })).toBeInTheDocument()
  })
})
