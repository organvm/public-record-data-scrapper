import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProspectFilters } from '../useProspectFilters'
import type { Prospect, HealthGrade, ProspectStatus, SignalType } from '@public-records/core'

// Helper to create mock prospects
function createMockProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: crypto.randomUUID(),
    companyName: 'Test Company',
    state: 'NY',
    industry: 'technology',
    priorityScore: 75,
    status: 'new',
    timeSinceDefault: 365,
    estimatedRevenue: 1000000,
    healthScore: {
      score: 80,
      grade: 'B' as HealthGrade,
      sentimentTrend: 'stable',
      reviewCount: 15,
      avgSentiment: 0.85,
      violationCount: 0,
      lastUpdated: new Date().toISOString()
    },
    growthSignals: [],
    uccFilings: [],
    defaultDate: '2024-01-01',
    narrative: 'Test',
    ...overrides
  }
}

describe('useProspectFilters', () => {
  let mockProspects: Prospect[]

  beforeEach(() => {
    mockProspects = [
      createMockProspect({
        id: '1',
        companyName: 'Alpha Tech',
        state: 'NY',
        industry: 'technology',
        priorityScore: 90
      }),
      createMockProspect({
        id: '2',
        companyName: 'Beta Restaurant',
        state: 'CA',
        industry: 'restaurant',
        priorityScore: 70
      }),
      createMockProspect({
        id: '3',
        companyName: 'Gamma Healthcare',
        state: 'TX',
        industry: 'healthcare',
        priorityScore: 60
      })
    ]
  })

  describe('initial state', () => {
    it('should initialize with empty search query', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.searchQuery).toBe('')
    })

    it('should initialize with "all" industry filter', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.industryFilter).toBe('all')
    })

    it('should initialize with "all" state filter', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.stateFilter).toBe('all')
    })

    it('should initialize with 0 min score', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.minScore).toBe(0)
    })

    it('should return all prospects when no filters applied', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.filteredProspects).toHaveLength(3)
    })

    it('should return unique sorted states from prospects', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.states).toEqual(['CA', 'NY', 'TX'])
    })

    it('should return predefined industries list', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.industries).toContain('technology')
      expect(result.current.industries).toContain('restaurant')
      expect(result.current.industries).toContain('healthcare')
    })
  })

  describe('search query filter', () => {
    it('should filter by company name (case insensitive)', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setSearchQuery('alpha')
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].companyName).toBe('Alpha Tech')
    })

    it('should handle uppercase search query', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setSearchQuery('BETA')
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].companyName).toBe('Beta Restaurant')
    })

    it('should return empty array when no matches', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setSearchQuery('nonexistent')
      })

      expect(result.current.filteredProspects).toHaveLength(0)
    })

    it('should match partial company names', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setSearchQuery('Tech')
      })

      expect(result.current.filteredProspects).toHaveLength(1)
    })
  })

  describe('industry filter', () => {
    it('should filter by specific industry', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setIndustryFilter('technology')
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].industry).toBe('technology')
    })

    it('should return all prospects when industry is "all"', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setIndustryFilter('technology')
      })
      act(() => {
        result.current.setIndustryFilter('all')
      })

      expect(result.current.filteredProspects).toHaveLength(3)
    })

    it('should return empty when industry has no matches', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setIndustryFilter('manufacturing')
      })

      expect(result.current.filteredProspects).toHaveLength(0)
    })
  })

  describe('state filter', () => {
    it('should filter by specific state', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setStateFilter('NY')
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].state).toBe('NY')
    })

    it('should return all prospects when state is "all"', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setStateFilter('CA')
      })
      act(() => {
        result.current.setStateFilter('all')
      })

      expect(result.current.filteredProspects).toHaveLength(3)
    })
  })

  describe('min score filter', () => {
    it('should filter by minimum priority score', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setMinScore(80)
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].priorityScore).toBeGreaterThanOrEqual(80)
    })

    it('should include prospects with exact min score', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setMinScore(70)
      })

      expect(result.current.filteredProspects).toHaveLength(2)
    })

    it('should return all when min score is 0', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setMinScore(0)
      })

      expect(result.current.filteredProspects).toHaveLength(3)
    })
  })

  describe('advanced filters', () => {
    describe('health grades', () => {
      it('should filter by health grade', () => {
        const prospectsWithGrades = [
          createMockProspect({
            id: '1',
            healthScore: { ...createMockProspect().healthScore, grade: 'A' as HealthGrade }
          }),
          createMockProspect({
            id: '2',
            healthScore: { ...createMockProspect().healthScore, grade: 'B' as HealthGrade }
          }),
          createMockProspect({
            id: '3',
            healthScore: { ...createMockProspect().healthScore, grade: 'C' as HealthGrade }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithGrades))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            healthGrades: ['A']
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].healthScore.grade).toBe('A')
      })

      it('should filter by multiple health grades', () => {
        const prospectsWithGrades = [
          createMockProspect({
            id: '1',
            healthScore: { ...createMockProspect().healthScore, grade: 'A' as HealthGrade }
          }),
          createMockProspect({
            id: '2',
            healthScore: { ...createMockProspect().healthScore, grade: 'B' as HealthGrade }
          }),
          createMockProspect({
            id: '3',
            healthScore: { ...createMockProspect().healthScore, grade: 'F' as HealthGrade }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithGrades))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            healthGrades: ['A', 'B']
          })
        })

        expect(result.current.filteredProspects).toHaveLength(2)
      })
    })

    describe('statuses', () => {
      it('should filter by status', () => {
        const prospectsWithStatus = [
          createMockProspect({ id: '1', status: 'new' as ProspectStatus }),
          createMockProspect({ id: '2', status: 'claimed' as ProspectStatus }),
          createMockProspect({ id: '3', status: 'contacted' as ProspectStatus })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithStatus))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            statuses: ['claimed']
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].status).toBe('claimed')
      })
    })

    describe('signal types', () => {
      it('should filter by growth signal type', () => {
        const prospectsWithSignals = [
          createMockProspect({
            id: '1',
            growthSignals: [
              {
                id: 's1',
                type: 'hiring' as SignalType,
                description: 'Hiring signal',
                detectedDate: new Date().toISOString(),
                score: 75,
                confidence: 0.85
              }
            ]
          }),
          createMockProspect({ id: '2', growthSignals: [] }),
          createMockProspect({
            id: '3',
            growthSignals: [
              {
                id: 's2',
                type: 'expansion' as SignalType,
                description: 'Expansion signal',
                detectedDate: new Date().toISOString(),
                score: 75,
                confidence: 0.85
              }
            ]
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithSignals))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            signalTypes: ['hiring']
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
      })
    })

    describe('sentiment trends', () => {
      it('should filter by sentiment trend', () => {
        const prospectsWithSentiment = [
          createMockProspect({
            id: '1',
            healthScore: {
              ...createMockProspect().healthScore,
              sentimentTrend: 'improving'
            }
          }),
          createMockProspect({
            id: '2',
            healthScore: {
              ...createMockProspect().healthScore,
              sentimentTrend: 'declining'
            }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithSentiment))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            sentimentTrends: ['improving']
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].healthScore.sentimentTrend).toBe('improving')
      })
    })

    describe('min signal count', () => {
      it('should filter by minimum signal count', () => {
        const prospectsWithSignals = [
          createMockProspect({
            id: '1',
            growthSignals: [
              {
                id: 's1',
                type: 'hiring' as SignalType,
                description: 'test',
                detectedDate: new Date().toISOString(),
                score: 75,
                confidence: 0.85
              }
            ]
          }),
          createMockProspect({ id: '2', growthSignals: [] }),
          createMockProspect({
            id: '3',
            growthSignals: [
              {
                id: 's2',
                type: 'hiring' as SignalType,
                description: 'test',
                detectedDate: new Date().toISOString(),
                score: 75,
                confidence: 0.85
              },
              {
                id: 's3',
                type: 'expansion' as SignalType,
                description: 'test',
                detectedDate: new Date().toISOString(),
                score: 75,
                confidence: 0.85
              }
            ]
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithSignals))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            minSignalCount: 2
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].growthSignals.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('default age range', () => {
      it('should filter by default age in years', () => {
        const prospectsWithAge = [
          createMockProspect({ id: '1', timeSinceDefault: 365 }), // 1 year
          createMockProspect({ id: '2', timeSinceDefault: 730 }), // 2 years
          createMockProspect({ id: '3', timeSinceDefault: 1825 }) // 5 years
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithAge))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            defaultAgeRange: [1, 3]
          })
        })

        expect(result.current.filteredProspects).toHaveLength(2)
      })
    })

    describe('revenue range', () => {
      it('should filter by revenue range', () => {
        const prospectsWithRevenue = [
          createMockProspect({ id: '1', estimatedRevenue: 500000 }),
          createMockProspect({ id: '2', estimatedRevenue: 2000000 }),
          createMockProspect({ id: '3', estimatedRevenue: 5000000 })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithRevenue))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            revenueRange: [1000000, 3000000]
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].estimatedRevenue).toBe(2000000)
      })

      it('should handle null/undefined revenue as 0', () => {
        const prospectsWithRevenue = [
          createMockProspect({ id: '1', estimatedRevenue: undefined }),
          createMockProspect({ id: '2', estimatedRevenue: 1000000 })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithRevenue))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            revenueRange: [0, 500000]
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
      })
    })

    describe('violations filter', () => {
      it('should filter for prospects with violations', () => {
        const prospectsWithViolations = [
          createMockProspect({
            id: '1',
            healthScore: { ...createMockProspect().healthScore, violationCount: 3 }
          }),
          createMockProspect({
            id: '2',
            healthScore: { ...createMockProspect().healthScore, violationCount: 0 }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithViolations))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            hasViolations: true
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].healthScore.violationCount).toBeGreaterThan(0)
      })

      it('should filter for prospects without violations', () => {
        const prospectsWithViolations = [
          createMockProspect({
            id: '1',
            healthScore: { ...createMockProspect().healthScore, violationCount: 3 }
          }),
          createMockProspect({
            id: '2',
            healthScore: { ...createMockProspect().healthScore, violationCount: 0 }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithViolations))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            hasViolations: false
          })
        })

        expect(result.current.filteredProspects).toHaveLength(1)
        expect(result.current.filteredProspects[0].healthScore.violationCount).toBe(0)
      })

      it('should not filter when hasViolations is null', () => {
        const prospectsWithViolations = [
          createMockProspect({
            id: '1',
            healthScore: { ...createMockProspect().healthScore, violationCount: 3 }
          }),
          createMockProspect({
            id: '2',
            healthScore: { ...createMockProspect().healthScore, violationCount: 0 }
          })
        ]

        const { result } = renderHook(() => useProspectFilters(prospectsWithViolations))

        act(() => {
          result.current.setAdvancedFilters({
            ...result.current.advancedFilters,
            hasViolations: null
          })
        })

        expect(result.current.filteredProspects).toHaveLength(2)
      })
    })
  })

  describe('combined filters', () => {
    it('should apply multiple filters together', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setSearchQuery('Tech')
        result.current.setStateFilter('NY')
        result.current.setMinScore(80)
      })

      expect(result.current.filteredProspects).toHaveLength(1)
      expect(result.current.filteredProspects[0].companyName).toBe('Alpha Tech')
    })
  })

  describe('activeFilterCount', () => {
    it('should return 0 with default filters', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      expect(result.current.activeFilterCount).toBe(0)
    })

    it('should count health grades filter', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setAdvancedFilters({
          ...result.current.advancedFilters,
          healthGrades: ['A']
        })
      })

      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count multiple advanced filters', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setAdvancedFilters({
          ...result.current.advancedFilters,
          healthGrades: ['A'],
          statuses: ['claimed'],
          minSignalCount: 2,
          hasViolations: true
        })
      })

      expect(result.current.activeFilterCount).toBe(4)
    })

    it('should count modified default age range', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setAdvancedFilters({
          ...result.current.advancedFilters,
          defaultAgeRange: [1, 7] // Modified from [0, 7]
        })
      })

      expect(result.current.activeFilterCount).toBe(1)
    })

    it('should count modified revenue range', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      act(() => {
        result.current.setAdvancedFilters({
          ...result.current.advancedFilters,
          revenueRange: [100000, 10000000] // Modified from [0, 10000000]
        })
      })

      expect(result.current.activeFilterCount).toBe(1)
    })
  })

  describe('resetFilters', () => {
    it('should reset all filters to defaults', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      // Apply various filters
      act(() => {
        result.current.setSearchQuery('test')
        result.current.setIndustryFilter('technology')
        result.current.setStateFilter('NY')
        result.current.setMinScore(50)
        result.current.setAdvancedFilters({
          ...result.current.advancedFilters,
          healthGrades: ['A'],
          statuses: ['claimed']
        })
      })

      // Reset
      act(() => {
        result.current.resetFilters()
      })

      expect(result.current.searchQuery).toBe('')
      expect(result.current.industryFilter).toBe('all')
      expect(result.current.stateFilter).toBe('all')
      expect(result.current.minScore).toBe(0)
      expect(result.current.advancedFilters.healthGrades).toEqual([])
      expect(result.current.advancedFilters.statuses).toEqual([])
      expect(result.current.filteredProspects).toHaveLength(3)
    })
  })

  describe('memoization', () => {
    it('should return same filtered array reference when inputs unchanged', () => {
      const { result, rerender } = renderHook(() => useProspectFilters(mockProspects))

      const firstResult = result.current.filteredProspects

      rerender()

      expect(result.current.filteredProspects).toBe(firstResult)
    })

    it('should return new array when filters change', () => {
      const { result } = renderHook(() => useProspectFilters(mockProspects))

      const firstResult = result.current.filteredProspects

      act(() => {
        result.current.setSearchQuery('Alpha')
      })

      expect(result.current.filteredProspects).not.toBe(firstResult)
    })
  })
})
