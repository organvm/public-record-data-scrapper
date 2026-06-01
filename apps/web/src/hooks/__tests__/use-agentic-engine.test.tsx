/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, waitFor, renderHook, act } from '@testing-library/react'
import { useEffect, useMemo, useState } from 'react'

import { useAgenticEngine } from '../use-agentic-engine'
import { AgenticEngine } from '@/lib/agentic/AgenticEngine'
import type {
  SystemContext,
  PerformanceMetrics,
  Improvement,
  ImprovementStatus
} from '@/lib/agentic/types'

vi.mock('@github/spark/hooks', async () => {
  const React = await import('react')
  return {
    useKV: <T,>(
      key: string,
      initialValue: T
    ): [T, React.Dispatch<React.SetStateAction<T>>, (value?: T) => void] => {
      const [value, setValue] = React.useState<T>(initialValue)
      const deleteValue = (resetValue?: T) => {
        if (resetValue !== undefined) {
          setValue(resetValue)
        } else {
          setValue(initialValue)
        }
      }
      return [value, setValue, deleteValue]
    }
  }
})

const baseMetrics: PerformanceMetrics = {
  avgResponseTime: 500,
  errorRate: 0.02,
  userSatisfactionScore: 7,
  dataFreshnessScore: 80
}

const createMockContext = (prospects: any[] = []): SystemContext => ({
  prospects,
  competitors: [],
  portfolio: [],
  userActions: [],
  performanceMetrics: baseMetrics,
  timestamp: new Date().toISOString()
})

const mockSystemHealth = {
  totalImprovements: 0,
  implemented: 0,
  pending: 0,
  successRate: 0,
  avgSafetyScore: 0
}

const mockCycleResult = {
  review: { analyses: [], improvements: [], agents: [] },
  executedImprovements: [],
  pendingImprovements: []
}

beforeEach(() => {
  // usePersistentState persists 'agentic-last-run'/'agentic-improvements' to
  // localStorage; clear it between tests so the auto-run guard (which depends
  // on lastRunTime being empty) is not affected by state leaked from prior tests.
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAgenticEngine', () => {
  describe('initial state', () => {
    beforeEach(() => {
      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)
    })

    it('should return engine instance', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(result.current.engine).toBeInstanceOf(AgenticEngine)
    })

    it('should start with isRunning false', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(result.current.isRunning).toBe(false)
    })

    it('should start with empty improvements array', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(result.current.improvements).toEqual([])
    })

    it('should provide runCycle function', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(typeof result.current.runCycle).toBe('function')
    })

    it('should provide approveImprovement function', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(typeof result.current.approveImprovement).toBe('function')
    })

    it('should provide getImprovementsByStatus function', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(typeof result.current.getImprovementsByStatus).toBe('function')
    })

    it('should include systemHealth in return value', () => {
      const context = createMockContext()

      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      expect(result.current.systemHealth).toEqual(mockSystemHealth)
    })
  })

  describe('runCycle', () => {
    beforeEach(() => {
      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getImprovements').mockReturnValue([])
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)
    })

    it('should set isRunning to true during cycle', async () => {
      let resolvePromise: () => void
      const cycleDone = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })

      vi.spyOn(AgenticEngine.prototype, 'runAutonomousCycle').mockImplementation(async () => {
        await cycleDone
        return mockCycleResult as any
      })

      const context = createMockContext([{ id: 'p-1' }])
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      // Start the cycle
      act(() => {
        result.current.runCycle()
      })

      // Wait for isRunning to be true (React may batch the update)
      await waitFor(() => {
        expect(result.current.isRunning).toBe(true)
      })

      // Complete the cycle
      await act(async () => {
        resolvePromise!()
      })

      // Verify it's back to false
      await waitFor(() => {
        expect(result.current.isRunning).toBe(false)
      })
    })

    it('should set isRunning to false after cycle completes', async () => {
      vi.spyOn(AgenticEngine.prototype, 'runAutonomousCycle').mockResolvedValue(
        mockCycleResult as any
      )

      const context = createMockContext([{ id: 'p-1' }])
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await act(async () => {
        await result.current.runCycle()
      })

      expect(result.current.isRunning).toBe(false)
    })

    it('should update improvements after cycle', async () => {
      const mockImprovements: Improvement[] = [
        {
          id: 'imp-1',
          suggestion: {
            id: 'sug-1',
            category: 'performance',
            priority: 'medium',
            title: 'Test Improvement',
            description: 'Test description',
            reasoning: 'Test reasoning',
            estimatedImpact: 'Medium',
            automatable: false,
            safetyScore: 85
          },
          status: 'detected' as ImprovementStatus,
          detectedAt: new Date().toISOString()
        }
      ]

      vi.spyOn(AgenticEngine.prototype, 'runAutonomousCycle').mockResolvedValue(
        mockCycleResult as any
      )
      vi.spyOn(AgenticEngine.prototype, 'getImprovements').mockReturnValue(mockImprovements)

      const context = createMockContext([{ id: 'p-1' }])
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await act(async () => {
        await result.current.runCycle()
      })

      expect(result.current.improvements).toEqual(mockImprovements)
    })

    it('should prevent concurrent cycles', async () => {
      let resolvePromise: () => void
      const cycleDone = new Promise<void>((resolve) => {
        resolvePromise = resolve
      })

      const runSpy = vi
        .spyOn(AgenticEngine.prototype, 'runAutonomousCycle')
        .mockImplementation(async () => {
          await cycleDone
          return mockCycleResult as any
        })

      const context = createMockContext([{ id: 'p-1' }])
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      // Start first cycle
      act(() => {
        result.current.runCycle()
      })

      // Wait for isRunning to be true
      await waitFor(() => {
        expect(result.current.isRunning).toBe(true)
      })

      // Try to start more cycles while first is running
      act(() => {
        result.current.runCycle()
        result.current.runCycle()
      })

      // Should still only have one call
      expect(runSpy).toHaveBeenCalledTimes(1)

      // Complete the cycle
      await act(async () => {
        resolvePromise!()
      })
    })

    it('should handle cycle errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(AgenticEngine.prototype, 'runAutonomousCycle').mockRejectedValue(
        new Error('Cycle failed')
      )

      const context = createMockContext([{ id: 'p-1' }])
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await act(async () => {
        await result.current.runCycle()
      })

      expect(consoleSpy).toHaveBeenCalledWith('❌ Autonomous cycle failed:', expect.any(Error))
      expect(result.current.isRunning).toBe(false)
      consoleSpy.mockRestore()
    })
  })

  describe('approveImprovement', () => {
    beforeEach(() => {
      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getImprovements').mockReturnValue([])
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)
    })

    it('should call engine approveAndExecute', async () => {
      const approveSpy = vi
        .spyOn(AgenticEngine.prototype, 'approveAndExecute')
        .mockResolvedValue(undefined as any)

      const context = createMockContext()
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await act(async () => {
        await result.current.approveImprovement('imp-123')
      })

      expect(approveSpy).toHaveBeenCalledWith('imp-123', context)
    })

    it('should update improvements after approval', async () => {
      const updatedImprovements: Improvement[] = [
        {
          id: 'imp-1',
          suggestion: {
            id: 'sug-1',
            category: 'performance',
            priority: 'high',
            title: 'Approved',
            description: 'Test',
            reasoning: 'Test reasoning',
            estimatedImpact: 'High',
            automatable: false,
            safetyScore: 90
          },
          status: 'completed' as ImprovementStatus,
          detectedAt: new Date().toISOString(),
          implementedAt: new Date().toISOString()
        }
      ]

      vi.spyOn(AgenticEngine.prototype, 'approveAndExecute').mockResolvedValue(undefined as any)
      vi.spyOn(AgenticEngine.prototype, 'getImprovements').mockReturnValue(updatedImprovements)

      const context = createMockContext()
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await act(async () => {
        await result.current.approveImprovement('imp-1')
      })

      expect(result.current.improvements).toEqual(updatedImprovements)
    })

    it('should throw error on approval failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(AgenticEngine.prototype, 'approveAndExecute').mockRejectedValue(
        new Error('Approval failed')
      )

      const context = createMockContext()
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      await expect(
        act(async () => {
          await result.current.approveImprovement('imp-1')
        })
      ).rejects.toThrow('Approval failed')

      consoleSpy.mockRestore()
    })
  })

  describe('getImprovementsByStatus', () => {
    it('should delegate to engine method', () => {
      const pendingImprovements: Improvement[] = [
        {
          id: 'imp-1',
          suggestion: {
            id: 'sug-1',
            category: 'performance',
            priority: 'low',
            title: 'Pending',
            description: 'Test',
            reasoning: 'Test reasoning',
            estimatedImpact: 'Low',
            automatable: false,
            safetyScore: 75
          },
          status: 'detected' as ImprovementStatus,
          detectedAt: new Date().toISOString()
        }
      ]

      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getImprovementsByStatus').mockReturnValue(
        pendingImprovements
      )
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)

      const context = createMockContext()
      const { result } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      const pending = result.current.getImprovementsByStatus('detected')

      expect(pending).toEqual(pendingImprovements)
    })
  })

  describe('callback client', () => {
    it('should set callback client on mount', () => {
      const setClientSpy = vi.spyOn(AgenticEngine.prototype, 'setCallbackClient')
      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)

      const mockClient = { onProgress: vi.fn() }
      const context = createMockContext()

      renderHook(() =>
        useAgenticEngine(context, { enabled: false }, { callbackClient: mockClient as any })
      )

      expect(setClientSpy).toHaveBeenCalledWith(mockClient)
    })

    it('should clear callback client on unmount', () => {
      const setClientSpy = vi.spyOn(AgenticEngine.prototype, 'setCallbackClient')
      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)

      const context = createMockContext()
      const { unmount } = renderHook(() => useAgenticEngine(context, { enabled: false }))

      unmount()

      expect(setClientSpy).toHaveBeenCalledWith(null)
    })
  })

  describe('auto-run effect', () => {
    it('triggers a single autonomous cycle after prospects are seeded', async () => {
      const runAutonomousCycleSpy = vi
        .spyOn(AgenticEngine.prototype, 'runAutonomousCycle')
        .mockResolvedValue(mockCycleResult as any)

      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getImprovements').mockReturnValue([])
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: true } as any)

      const TestComponent = () => {
        const [prospects, setProspects] = useState<any[]>([])
        const [updateCount, setUpdateCount] = useState(0)

        const context: SystemContext = useMemo(
          () => ({
            prospects,
            competitors: [],
            portfolio: [],
            userActions: [],
            performanceMetrics: baseMetrics,
            timestamp: new Date().toISOString()
          }),
          [prospects]
        )

        useAgenticEngine(context, { enabled: true })

        useEffect(() => {
          if (prospects.length === 0) {
            setProspects([{ id: 'p-1' }])
          } else if (updateCount === 0) {
            setUpdateCount(1)
            setProspects([{ id: 'p-1' }, { id: 'p-2' }])
          }
        }, [prospects, updateCount])

        return null
      }

      render(<TestComponent />)

      await waitFor(() => {
        expect(runAutonomousCycleSpy).toHaveBeenCalledTimes(1)
      })

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(runAutonomousCycleSpy).toHaveBeenCalledTimes(1)
    })

    it('should not auto-run when engine is disabled', async () => {
      const runAutonomousCycleSpy = vi
        .spyOn(AgenticEngine.prototype, 'runAutonomousCycle')
        .mockResolvedValue(mockCycleResult as any)

      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: false } as any)

      const context = createMockContext([{ id: 'p-1' }])
      renderHook(() => useAgenticEngine(context, { enabled: false }))

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(runAutonomousCycleSpy).not.toHaveBeenCalled()
    })

    it('should not auto-run when no prospects', async () => {
      const runAutonomousCycleSpy = vi
        .spyOn(AgenticEngine.prototype, 'runAutonomousCycle')
        .mockResolvedValue(mockCycleResult as any)

      vi.spyOn(AgenticEngine.prototype, 'getSystemHealth').mockReturnValue(mockSystemHealth)
      vi.spyOn(AgenticEngine.prototype, 'getConfig').mockReturnValue({ enabled: true } as any)

      const context = createMockContext([])
      renderHook(() => useAgenticEngine(context, { enabled: true }))

      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(runAutonomousCycleSpy).not.toHaveBeenCalled()
    })
  })
})
