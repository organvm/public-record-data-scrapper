import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProspectSorting } from '../useProspectSorting'
import type { Prospect, HealthGrade, SignalType } from '@public-records/core'

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

describe('useProspectSorting', () => {
  let mockProspects: Prospect[]

  beforeEach(() => {
    mockProspects = [
      createMockProspect({
        id: '1',
        companyName: 'Zebra Corp',
        priorityScore: 50,
        healthScore: { ...createMockProspect().healthScore, score: 70 },
        growthSignals: [],
        timeSinceDefault: 730 // 2 years
      }),
      createMockProspect({
        id: '2',
        companyName: 'Alpha Inc',
        priorityScore: 90,
        healthScore: { ...createMockProspect().healthScore, score: 85 },
        growthSignals: [
          {
            id: 's1',
            type: 'hiring' as SignalType,
            description: 'Hiring',
            detectedDate: new Date().toISOString(),
            score: 75,
            confidence: 0.85
          },
          {
            id: 's2',
            type: 'expansion' as SignalType,
            description: 'Expanding',
            detectedDate: new Date().toISOString(),
            score: 75,
            confidence: 0.85
          }
        ],
        timeSinceDefault: 365 // 1 year
      }),
      createMockProspect({
        id: '3',
        companyName: 'Mega LLC',
        priorityScore: 70,
        healthScore: { ...createMockProspect().healthScore, score: 60 },
        growthSignals: [
          {
            id: 's3',
            type: 'hiring' as SignalType,
            description: 'Hiring',
            detectedDate: new Date().toISOString(),
            score: 75,
            confidence: 0.85
          }
        ],
        timeSinceDefault: 1095 // 3 years
      })
    ]
  })

  describe('initial state', () => {
    it('should default to priorityScore sort field', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      expect(result.current.sortField).toBe('priorityScore')
    })

    it('should default to desc sort direction', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      expect(result.current.sortDirection).toBe('desc')
    })

    it('should sort by priority score descending initially', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      expect(result.current.sortedProspects[0].priorityScore).toBe(90)
      expect(result.current.sortedProspects[1].priorityScore).toBe(70)
      expect(result.current.sortedProspects[2].priorityScore).toBe(50)
    })
  })

  describe('sort by priorityScore', () => {
    it('should sort by priority score descending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('priorityScore')
        result.current.setSortDirection('desc')
      })

      expect(result.current.sortedProspects[0].priorityScore).toBe(90)
      expect(result.current.sortedProspects[2].priorityScore).toBe(50)
    })

    it('should sort by priority score ascending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('priorityScore')
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects[0].priorityScore).toBe(50)
      expect(result.current.sortedProspects[2].priorityScore).toBe(90)
    })
  })

  describe('sort by healthScore', () => {
    it('should sort by health score descending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('healthScore')
        result.current.setSortDirection('desc')
      })

      expect(result.current.sortedProspects[0].healthScore.score).toBe(85)
      expect(result.current.sortedProspects[1].healthScore.score).toBe(70)
      expect(result.current.sortedProspects[2].healthScore.score).toBe(60)
    })

    it('should sort by health score ascending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('healthScore')
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects[0].healthScore.score).toBe(60)
      expect(result.current.sortedProspects[2].healthScore.score).toBe(85)
    })
  })

  describe('sort by signalCount', () => {
    it('should sort by signal count descending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('signalCount')
        result.current.setSortDirection('desc')
      })

      expect(result.current.sortedProspects[0].growthSignals.length).toBe(2)
      expect(result.current.sortedProspects[1].growthSignals.length).toBe(1)
      expect(result.current.sortedProspects[2].growthSignals.length).toBe(0)
    })

    it('should sort by signal count ascending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('signalCount')
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects[0].growthSignals.length).toBe(0)
      expect(result.current.sortedProspects[2].growthSignals.length).toBe(2)
    })
  })

  describe('sort by defaultAge', () => {
    it('should sort by time since default descending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('defaultAge')
        result.current.setSortDirection('desc')
      })

      expect(result.current.sortedProspects[0].timeSinceDefault).toBe(1095)
      expect(result.current.sortedProspects[1].timeSinceDefault).toBe(730)
      expect(result.current.sortedProspects[2].timeSinceDefault).toBe(365)
    })

    it('should sort by time since default ascending', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('defaultAge')
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects[0].timeSinceDefault).toBe(365)
      expect(result.current.sortedProspects[2].timeSinceDefault).toBe(1095)
    })
  })

  describe('sort by companyName', () => {
    it('should sort by company name descending (Z-A)', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('companyName')
        result.current.setSortDirection('desc')
      })

      expect(result.current.sortedProspects[0].companyName).toBe('Zebra Corp')
      expect(result.current.sortedProspects[1].companyName).toBe('Mega LLC')
      expect(result.current.sortedProspects[2].companyName).toBe('Alpha Inc')
    })

    it('should sort by company name ascending (A-Z)', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('companyName')
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects[0].companyName).toBe('Alpha Inc')
      expect(result.current.sortedProspects[1].companyName).toBe('Mega LLC')
      expect(result.current.sortedProspects[2].companyName).toBe('Zebra Corp')
    })

    it('should handle locale-aware comparison', () => {
      const prospectsWithSpecialChars = [
        createMockProspect({ id: '1', companyName: 'Éclair Bakery' }),
        createMockProspect({ id: '2', companyName: 'Alpha Corp' }),
        createMockProspect({ id: '3', companyName: 'Zebra Inc' })
      ]

      const { result } = renderHook(() => useProspectSorting(prospectsWithSpecialChars))

      act(() => {
        result.current.setSortField('companyName')
        result.current.setSortDirection('asc')
      })

      // localeCompare should handle accented characters
      expect(result.current.sortedProspects[0].companyName).toBe('Alpha Corp')
    })
  })

  describe('setSortField', () => {
    it('should change sort field', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('healthScore')
      })

      expect(result.current.sortField).toBe('healthScore')
    })
  })

  describe('setSortDirection', () => {
    it('should change sort direction', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortDirection).toBe('asc')
    })
  })

  describe('handleSortChange', () => {
    it('should change both field and direction atomically', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.handleSortChange('healthScore', 'asc')
      })

      expect(result.current.sortField).toBe('healthScore')
      expect(result.current.sortDirection).toBe('asc')
    })

    it('should resort array after handleSortChange', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.handleSortChange('companyName', 'asc')
      })

      expect(result.current.sortedProspects[0].companyName).toBe('Alpha Inc')
    })
  })

  describe('memoization', () => {
    it('should return same sorted array reference when inputs unchanged', () => {
      const { result, rerender } = renderHook(() => useProspectSorting(mockProspects))

      const firstResult = result.current.sortedProspects

      rerender()

      expect(result.current.sortedProspects).toBe(firstResult)
    })

    it('should return new sorted array when sort field changes', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      const firstResult = result.current.sortedProspects

      act(() => {
        result.current.setSortField('healthScore')
      })

      expect(result.current.sortedProspects).not.toBe(firstResult)
    })

    it('should return new sorted array when sort direction changes', () => {
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      const firstResult = result.current.sortedProspects

      act(() => {
        result.current.setSortDirection('asc')
      })

      expect(result.current.sortedProspects).not.toBe(firstResult)
    })
  })

  describe('original array immutability', () => {
    it('should not modify the original array', () => {
      const originalOrder = [...mockProspects.map((p) => p.id)]
      const { result } = renderHook(() => useProspectSorting(mockProspects))

      act(() => {
        result.current.setSortField('companyName')
        result.current.setSortDirection('asc')
      })

      expect(mockProspects.map((p) => p.id)).toEqual(originalOrder)
    })
  })

  describe('empty array handling', () => {
    it('should handle empty prospects array', () => {
      const { result } = renderHook(() => useProspectSorting([]))

      expect(result.current.sortedProspects).toEqual([])
    })

    it('should handle single prospect', () => {
      const singleProspect = [createMockProspect({ id: '1', companyName: 'Solo Corp' })]
      const { result } = renderHook(() => useProspectSorting(singleProspect))

      expect(result.current.sortedProspects).toHaveLength(1)
      expect(result.current.sortedProspects[0].companyName).toBe('Solo Corp')
    })
  })

  describe('equal values', () => {
    it('should maintain stable order for equal values', () => {
      const equalScoreProspects = [
        createMockProspect({ id: '1', priorityScore: 80 }),
        createMockProspect({ id: '2', priorityScore: 80 }),
        createMockProspect({ id: '3', priorityScore: 80 })
      ]

      const { result } = renderHook(() => useProspectSorting(equalScoreProspects))

      // With equal scores, order should be consistent
      const sortedIds = result.current.sortedProspects.map((p) => p.id)

      // Sort again and verify same order
      act(() => {
        result.current.setSortField('priorityScore')
      })

      expect(result.current.sortedProspects.map((p) => p.id)).toEqual(sortedIds)
    })
  })
})
