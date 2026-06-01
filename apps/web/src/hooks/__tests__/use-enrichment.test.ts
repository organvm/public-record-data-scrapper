/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEnrichment } from '../use-enrichment'
import type { EnrichmentRequest, EnrichmentResult } from '@/lib/agentic/types'

// Mock the EnrichmentOrchestratorAgent
const mockExecuteTask = vi.fn()

vi.mock('@/lib/agentic', () => ({
  EnrichmentOrchestratorAgent: class {
    executeTask = mockExecuteTask
  }
}))

describe('useEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTask.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should have loading set to false', () => {
      const { result } = renderHook(() => useEnrichment())

      expect(result.current.loading).toBe(false)
    })

    it('should have error set to null', () => {
      const { result } = renderHook(() => useEnrichment())

      expect(result.current.error).toBeNull()
    })

    it('should have result set to null', () => {
      const { result } = renderHook(() => useEnrichment())

      expect(result.current.result).toBeNull()
    })

    it('should have empty progress array', () => {
      const { result } = renderHook(() => useEnrichment())

      expect(result.current.progress).toEqual([])
    })

    it('should provide enrich function', () => {
      const { result } = renderHook(() => useEnrichment())

      expect(typeof result.current.enrich).toBe('function')
    })
  })

  describe('successful enrichment', () => {
    it('should set loading to true during enrichment', async () => {
      let resolveTask: (value: any) => void
      const taskPromise = new Promise((resolve) => {
        resolveTask = resolve
      })
      mockExecuteTask.mockReturnValue(taskPromise)

      const { result } = renderHook(() => useEnrichment())

      const request: EnrichmentRequest = {
        companyName: 'Test Corp',
        state: 'CA',
        tier: 'free'
      }

      act(() => {
        result.current.enrich(request)
      })

      expect(result.current.loading).toBe(true)

      await act(async () => {
        resolveTask!({
          success: true,
          data: { enriched: true }
        })
      })

      expect(result.current.loading).toBe(false)
    })

    it('should call executeTask with correct payload', async () => {
      mockExecuteTask.mockResolvedValue({
        success: true,
        data: {}
      })

      const { result } = renderHook(() => useEnrichment())

      const request: EnrichmentRequest = {
        companyName: 'prospect-123',
        state: 'NY',
        tier: 'professional'
      }

      await act(async () => {
        await result.current.enrich(request)
      })

      expect(mockExecuteTask).toHaveBeenCalledWith({
        type: 'enrich-prospect',
        payload: request
      })
    })

    it('should set result on successful enrichment', async () => {
      const enrichmentData: EnrichmentResult = {
        success: true,
        data: {
          firmographics: { employees: 100, revenue: 1000000 }
        },
        sources: ['api-source'],
        cost: 0,
        timestamp: '2024-01-01'
      }

      mockExecuteTask.mockResolvedValue({
        success: true,
        data: enrichmentData
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.result).toEqual(enrichmentData)
    })

    it('should set progress from result data', async () => {
      const progressData = [
        { step: 'firmographics', complete: true },
        { step: 'financials', complete: true }
      ]

      mockExecuteTask.mockResolvedValue({
        success: true,
        data: {
          progress: progressData
        }
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.progress).toEqual(progressData)
    })

    it('should reset error and result before new enrichment', async () => {
      // First call fails
      mockExecuteTask.mockResolvedValueOnce({
        success: false,
        error: 'First error'
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.error).toBe('First error')

      // Second call succeeds
      mockExecuteTask.mockResolvedValueOnce({
        success: true,
        data: { enriched: true }
      })

      await act(async () => {
        await result.current.enrich({ companyName: 'Other Corp', state: 'TX', tier: 'free' })
      })

      expect(result.current.error).toBeNull()
    })

    it('should use empty array when progress is undefined', async () => {
      mockExecuteTask.mockResolvedValue({
        success: true,
        data: {}
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.progress).toEqual([])
    })
  })

  describe('failed enrichment', () => {
    it('should set error on task failure', async () => {
      mockExecuteTask.mockResolvedValue({
        success: false,
        error: 'API rate limit exceeded'
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.error).toBe('API rate limit exceeded')
    })

    it('should use default error message when error is undefined', async () => {
      mockExecuteTask.mockResolvedValue({
        success: false
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.error).toBe('Enrichment failed')
    })

    it('should set loading to false after failure', async () => {
      mockExecuteTask.mockResolvedValue({
        success: false,
        error: 'Error'
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.loading).toBe(false)
    })

    it('should not set result on failure', async () => {
      mockExecuteTask.mockResolvedValue({
        success: false,
        error: 'Error'
      })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.result).toBeNull()
    })
  })

  describe('exception handling', () => {
    it('should handle Error exception', async () => {
      mockExecuteTask.mockRejectedValue(new Error('Network error'))

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.error).toBe('Network error')
    })

    it('should handle non-Error exception', async () => {
      mockExecuteTask.mockRejectedValue('String error')

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.error).toBe('Unknown error')
    })

    it('should set loading to false after exception', async () => {
      mockExecuteTask.mockRejectedValue(new Error('Error'))

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'Test Corp', state: 'CA', tier: 'free' })
      })

      expect(result.current.loading).toBe(false)
    })
  })

  describe('multiple enrichments', () => {
    it('should handle sequential enrichments', async () => {
      mockExecuteTask
        .mockResolvedValueOnce({
          success: true,
          data: { id: 1 }
        })
        .mockResolvedValueOnce({
          success: true,
          data: { id: 2 }
        })

      const { result } = renderHook(() => useEnrichment())

      await act(async () => {
        await result.current.enrich({ companyName: 'id-1', state: 'CA', tier: 'free' })
      })

      expect(result.current.result?.data).toMatchObject({ id: 1 })

      await act(async () => {
        await result.current.enrich({ companyName: 'id-2', state: 'NY', tier: 'free' })
      })

      expect(result.current.result?.data).toMatchObject({ id: 2 })
    })
  })
})
