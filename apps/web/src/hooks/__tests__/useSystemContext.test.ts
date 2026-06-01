import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSystemContext } from '../useSystemContext'
import type { Prospect, PortfolioCompany } from '@public-records/core'

// Helper function to create mock prospect
function createMockProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: crypto.randomUUID(),
    companyName: 'Test Company',
    state: 'CA',
    priorityScore: 75,
    industry: 'technology' as const,
    status: 'new' as const,
    defaultDate: '2024-01-15',
    timeSinceDefault: 365,
    narrative: 'Test narrative',
    uccFilings: [],
    growthSignals: [],
    healthScore: {
      score: 80,
      grade: 'B',
      sentimentTrend: 'stable',
      reviewCount: 15,
      avgSentiment: 0.85,
      violationCount: 0,
      lastUpdated: '2024-01-15'
    },
    ...overrides
  } as Prospect
}

// Helper function to create mock competitor
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockCompetitor(overrides: Record<string, any> = {}): any {
  return {
    id: crypto.randomUUID(),
    name: 'Competitor Inc',
    industry: 'Technology',
    marketShare: 15,
    fundingActivity: 'active',
    growthRate: 12,
    threatLevel: 'medium',
    recentActivity: 'Expanded to new markets',
    ...overrides
  }
}

// Helper function to create mock portfolio company
function createMockPortfolioCompany(overrides: Partial<PortfolioCompany> = {}): PortfolioCompany {
  return {
    id: crypto.randomUUID(),
    companyName: 'Portfolio Corp',
    fundingAmount: 500000,
    fundingDate: '2023-06-15',
    currentStatus: 'performing' as const,
    healthScore: {
      score: 85,
      grade: 'B',
      sentimentTrend: 'stable',
      reviewCount: 5,
      avgSentiment: 0.7,
      violationCount: 0,
      lastUpdated: '2024-01-15'
    },
    ...overrides
  }
}

// Helper function to create mock user action
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockUserAction(overrides: Record<string, any> = {}): any {
  return {
    id: crypto.randomUUID(),
    action: 'view',
    timestamp: new Date().toISOString(),
    prospectId: crypto.randomUUID(),
    metadata: {},
    ...overrides
  }
}

describe('useSystemContext', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('should return context with prospects', () => {
      const prospects = [createMockProspect(), createMockProspect()]

      const { result } = renderHook(() =>
        useSystemContext({
          prospects,
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.prospects).toEqual(prospects)
      expect(result.current.prospects).toHaveLength(2)
    })

    it('should return context with competitors', () => {
      const competitors = [createMockCompetitor()]

      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors,
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.competitors).toEqual(competitors)
    })

    it('should return context with portfolio companies', () => {
      const portfolio = [createMockPortfolioCompany(), createMockPortfolioCompany()]

      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio,
          userActions: []
        })
      )

      expect(result.current.portfolio).toEqual(portfolio)
    })

    it('should return context with user actions', () => {
      const userActions = [createMockUserAction()]

      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions
        })
      )

      expect(result.current.userActions).toEqual(userActions)
    })

    it('should include timestamp', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.timestamp).toBe('2024-01-15T12:00:00.000Z')
    })
  })

  describe('performance metrics', () => {
    it('should include default avgResponseTime of 450', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.performanceMetrics.avgResponseTime).toBe(450)
    })

    it('should include default errorRate of 0.02', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.performanceMetrics.errorRate).toBe(0.02)
    })

    it('should include default userSatisfactionScore of 7.5', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.performanceMetrics.userSatisfactionScore).toBe(7.5)
    })

    it('should include default dataFreshnessScore of 85', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.performanceMetrics.dataFreshnessScore).toBe(85)
    })
  })

  describe('memoization', () => {
    it('should return same reference when inputs are unchanged', () => {
      const prospects = [createMockProspect()]
      const competitors = [createMockCompetitor()]
      const portfolio = [createMockPortfolioCompany()]
      const userActions = [createMockUserAction()]

      const { result, rerender } = renderHook(() =>
        useSystemContext({
          prospects,
          competitors,
          portfolio,
          userActions
        })
      )

      const firstResult = result.current

      rerender()

      expect(result.current).toBe(firstResult)
    })

    it('should return new reference when prospects change', () => {
      const initialProspects = [createMockProspect()]
      const newProspects = [createMockProspect(), createMockProspect()]

      let prospects = initialProspects

      const { result, rerender } = renderHook(() =>
        useSystemContext({
          prospects,
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      const firstResult = result.current

      prospects = newProspects
      rerender()

      expect(result.current).not.toBe(firstResult)
    })

    it('should return new reference when competitors change', () => {
      const initialCompetitors = [createMockCompetitor()]
      const newCompetitors = [createMockCompetitor()]

      let competitors = initialCompetitors

      const { result, rerender } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors,
          portfolio: [],
          userActions: []
        })
      )

      const firstResult = result.current

      competitors = newCompetitors
      rerender()

      expect(result.current).not.toBe(firstResult)
    })

    it('should return new reference when portfolio changes', () => {
      const initialPortfolio = [createMockPortfolioCompany()]
      const newPortfolio = [createMockPortfolioCompany()]

      let portfolio = initialPortfolio

      const { result, rerender } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio,
          userActions: []
        })
      )

      const firstResult = result.current

      portfolio = newPortfolio
      rerender()

      expect(result.current).not.toBe(firstResult)
    })

    it('should return new reference when userActions change', () => {
      const initialActions = [createMockUserAction()]
      const newActions = [createMockUserAction()]

      let userActions = initialActions

      const { result, rerender } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions
        })
      )

      const firstResult = result.current

      userActions = newActions
      rerender()

      expect(result.current).not.toBe(firstResult)
    })
  })

  describe('empty arrays', () => {
    it('should handle all empty arrays', () => {
      const { result } = renderHook(() =>
        useSystemContext({
          prospects: [],
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.prospects).toHaveLength(0)
      expect(result.current.competitors).toHaveLength(0)
      expect(result.current.portfolio).toHaveLength(0)
      expect(result.current.userActions).toHaveLength(0)
    })
  })

  describe('large datasets', () => {
    it('should handle large number of prospects', () => {
      const prospects = Array.from({ length: 1000 }, () => createMockProspect())

      const { result } = renderHook(() =>
        useSystemContext({
          prospects,
          competitors: [],
          portfolio: [],
          userActions: []
        })
      )

      expect(result.current.prospects).toHaveLength(1000)
    })
  })
})
