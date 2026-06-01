/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProspectActions } from '../useProspectActions'
import type { Prospect } from '@public-records/core'

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

// Mock exportUtils
vi.mock('@/lib/exportUtils', () => ({
  exportProspects: vi.fn()
}))

// Mock API functions
const mockClaimProspect = vi.fn()
const mockUnclaimProspect = vi.fn()
const mockBatchClaimProspects = vi.fn()
const mockDeleteProspects = vi.fn()

vi.mock('@/lib/api/prospects', () => ({
  claimProspect: (...args: unknown[]) => mockClaimProspect(...args),
  unclaimProspect: (...args: unknown[]) => mockUnclaimProspect(...args),
  batchClaimProspects: (...args: unknown[]) => mockBatchClaimProspects(...args),
  deleteProspects: (...args: unknown[]) => mockDeleteProspects(...args)
}))

import { toast } from 'sonner'
import { exportProspects } from '@/lib/exportUtils'

const createMockProspect = (overrides: Partial<Prospect> = {}): Prospect =>
  ({
    id: 'test-id',
    companyName: 'Test Company',
    state: 'CA',
    industry: 'technology' as const,
    priorityScore: 85,
    healthScore: {
      grade: 'B',
      score: 75,
      sentimentTrend: 'stable',
      reviewCount: 15,
      avgSentiment: 0.85,
      violationCount: 0,
      lastUpdated: '2024-01-15'
    },
    status: 'new' as const,
    defaultDate: '2024-01-01',
    timeSinceDefault: 365,
    narrative: 'Test narrative',
    uccFilings: [],
    growthSignals: [],
    ...overrides
  }) as Prospect

describe('useProspectActions', () => {
  let mockProspects: Prospect[]
  let mockSetProspects: ReturnType<typeof vi.fn>
  let mockTrackAction: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockProspects = [createMockProspect({ id: '1' }), createMockProspect({ id: '2' })]
    mockSetProspects = vi.fn((updater) => {
      if (typeof updater === 'function') {
        mockProspects = updater(mockProspects)
      } else {
        mockProspects = updater
      }
    })
    mockTrackAction = vi.fn().mockResolvedValue(undefined)
  })

  const renderUseProspectActions = (
    options: Partial<Parameters<typeof useProspectActions>[0]> = {}
  ) => {
    return renderHook(() =>
      useProspectActions({
        useMockData: true,
        prospects: mockProspects,
        setProspects: mockSetProspects as any,
        trackAction: mockTrackAction as any,
        exportFormat: 'json',
        hasFilters: false,
        ...options
      })
    )
  }

  describe('handleExportProspects', () => {
    it('should export prospects in JSON format', () => {
      const { result } = renderUseProspectActions()
      const prospectsToExport = [createMockProspect()]

      act(() => {
        result.current.handleExportProspects(prospectsToExport)
      })

      expect(exportProspects).toHaveBeenCalledWith(prospectsToExport, 'json', undefined)
      expect(toast.success).toHaveBeenCalledWith('Prospect(s) exported as JSON', expect.any(Object))
      expect(mockTrackAction).toHaveBeenCalledWith('export-prospects', {
        format: 'json',
        count: 1,
        filtered: false
      })
    })

    it('should export prospects in CSV format', () => {
      const { result } = renderUseProspectActions({ exportFormat: 'csv' })
      const prospectsToExport = [createMockProspect(), createMockProspect()]

      act(() => {
        result.current.handleExportProspects(prospectsToExport)
      })

      expect(exportProspects).toHaveBeenCalledWith(prospectsToExport, 'csv', undefined)
      expect(toast.success).toHaveBeenCalledWith('Prospect(s) exported as CSV', expect.any(Object))
    })

    it('should include filter info when hasFilters is true', () => {
      const { result } = renderUseProspectActions({ hasFilters: true })
      const prospectsToExport = [createMockProspect()]

      act(() => {
        result.current.handleExportProspects(prospectsToExport)
      })

      expect(exportProspects).toHaveBeenCalledWith(prospectsToExport, 'json', 'filtered')
      expect(mockTrackAction).toHaveBeenCalledWith('export-prospects', {
        format: 'json',
        count: 1,
        filtered: true
      })
    })

    it('should handle export errors', () => {
      vi.mocked(exportProspects).mockImplementationOnce(() => {
        throw new Error('Export failed')
      })

      const { result } = renderUseProspectActions()

      act(() => {
        result.current.handleExportProspects([createMockProspect()])
      })

      expect(toast.error).toHaveBeenCalledWith('Export failed', {
        description: 'Export failed'
      })
    })
  })

  describe('handleExportProspect', () => {
    it('should export a single prospect', () => {
      const { result } = renderUseProspectActions()
      const prospect = createMockProspect()

      act(() => {
        result.current.handleExportProspect(prospect)
      })

      expect(exportProspects).toHaveBeenCalledWith([prospect], 'json', undefined)
    })
  })

  describe('handleClaimLead', () => {
    it('should claim lead in mock mode', async () => {
      const { result } = renderUseProspectActions({ useMockData: true })
      const prospect = createMockProspect({ id: '1', status: 'new' })

      await act(async () => {
        await result.current.handleClaimLead(prospect)
      })

      expect(mockSetProspects).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('Lead claimed successfully', expect.any(Object))
      expect(mockTrackAction).toHaveBeenCalledWith('claim', { prospectId: '1' })
    })

    it('should claim lead via API in live mode', async () => {
      const claimedProspect = createMockProspect({
        id: '1',
        status: 'claimed',
        claimedBy: 'Current User'
      })
      mockClaimProspect.mockResolvedValueOnce(claimedProspect)

      const { result } = renderUseProspectActions({ useMockData: false })
      const prospect = createMockProspect({ id: '1', status: 'new' })

      await act(async () => {
        await result.current.handleClaimLead(prospect)
      })

      expect(mockClaimProspect).toHaveBeenCalledWith('1', 'Current User')
      expect(mockSetProspects).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalled()
    })

    it('should handle claim API error', async () => {
      mockClaimProspect.mockRejectedValueOnce(new Error('API Error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseProspectActions({ useMockData: false })
      const prospect = createMockProspect({ id: '1' })

      await act(async () => {
        await result.current.handleClaimLead(prospect)
      })

      expect(toast.error).toHaveBeenCalledWith('Unable to claim lead', {
        description: 'API Error'
      })

      consoleSpy.mockRestore()
    })
  })

  describe('handleUnclaimLead', () => {
    it('should unclaim lead in mock mode', async () => {
      const { result } = renderUseProspectActions({ useMockData: true })
      const prospect = createMockProspect({
        id: '1',
        status: 'claimed',
        claimedBy: 'Current User',
        claimedDate: '2024-01-01'
      })

      await act(async () => {
        await result.current.handleUnclaimLead(prospect)
      })

      expect(mockSetProspects).toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith('Lead unclaimed', expect.any(Object))
      expect(mockTrackAction).toHaveBeenCalledWith('unclaim', { prospectId: '1' })
    })

    it('should unclaim lead via API in live mode', async () => {
      const unclaimedProspect = createMockProspect({ id: '1', status: 'new' })
      mockUnclaimProspect.mockResolvedValueOnce(unclaimedProspect)

      const { result } = renderUseProspectActions({ useMockData: false })
      const prospect = createMockProspect({ id: '1', status: 'claimed' })

      await act(async () => {
        await result.current.handleUnclaimLead(prospect)
      })

      expect(mockUnclaimProspect).toHaveBeenCalledWith('1')
      expect(mockSetProspects).toHaveBeenCalled()
    })

    it('should handle unclaim API error', async () => {
      mockUnclaimProspect.mockRejectedValueOnce(new Error('API Error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseProspectActions({ useMockData: false })
      const prospect = createMockProspect({ id: '1' })

      await act(async () => {
        await result.current.handleUnclaimLead(prospect)
      })

      expect(toast.error).toHaveBeenCalledWith('Unable to unclaim lead', expect.any(Object))

      consoleSpy.mockRestore()
    })
  })

  describe('handleBatchClaim', () => {
    it('should do nothing for empty array', async () => {
      const { result } = renderUseProspectActions()

      await act(async () => {
        await result.current.handleBatchClaim([])
      })

      expect(mockSetProspects).not.toHaveBeenCalled()
    })

    it('should batch claim in mock mode', async () => {
      const { result } = renderUseProspectActions({ useMockData: true })

      await act(async () => {
        await result.current.handleBatchClaim(['1', '2'])
      })

      expect(mockSetProspects).toHaveBeenCalled()
      expect(toast.success).toHaveBeenCalledWith('2 leads claimed', expect.any(Object))
      expect(mockTrackAction).toHaveBeenCalledWith('batch-claim', { prospectIds: ['1', '2'] })
    })

    it('should batch claim via API in live mode', async () => {
      const claimedProspects = [
        createMockProspect({ id: '1', status: 'claimed' }),
        createMockProspect({ id: '2', status: 'claimed' })
      ]
      mockBatchClaimProspects.mockResolvedValueOnce(claimedProspects)

      const { result } = renderUseProspectActions({ useMockData: false })

      await act(async () => {
        await result.current.handleBatchClaim(['1', '2'])
      })

      expect(mockBatchClaimProspects).toHaveBeenCalledWith(['1', '2'], 'Current User')
      expect(mockSetProspects).toHaveBeenCalled()
    })

    it('should handle batch claim API error', async () => {
      mockBatchClaimProspects.mockRejectedValueOnce(new Error('Batch error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseProspectActions({ useMockData: false })

      await act(async () => {
        await result.current.handleBatchClaim(['1', '2'])
      })

      expect(toast.error).toHaveBeenCalledWith('Unable to claim selected leads', expect.any(Object))

      consoleSpy.mockRestore()
    })
  })

  describe('handleBatchExport', () => {
    it('should export selected prospects', () => {
      const prospects = [createMockProspect({ id: '1' }), createMockProspect({ id: '2' })]
      const { result } = renderUseProspectActions({ prospects })

      act(() => {
        result.current.handleBatchExport(['1'])
      })

      expect(exportProspects).toHaveBeenCalledWith([prospects[0]], 'json', undefined)
    })

    it('should export multiple selected prospects', () => {
      const prospects = [
        createMockProspect({ id: '1' }),
        createMockProspect({ id: '2' }),
        createMockProspect({ id: '3' })
      ]
      const { result } = renderUseProspectActions({ prospects })

      act(() => {
        result.current.handleBatchExport(['1', '3'])
      })

      expect(exportProspects).toHaveBeenCalledWith([prospects[0], prospects[2]], 'json', undefined)
    })
  })

  describe('handleBatchDelete', () => {
    it('should do nothing for empty array', async () => {
      const { result } = renderUseProspectActions()

      await act(async () => {
        await result.current.handleBatchDelete([])
      })

      expect(mockSetProspects).not.toHaveBeenCalled()
    })

    it('should batch delete in mock mode', async () => {
      const { result } = renderUseProspectActions({ useMockData: true })

      await act(async () => {
        await result.current.handleBatchDelete(['1', '2'])
      })

      expect(mockSetProspects).toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith('2 prospects removed', expect.any(Object))
      expect(mockTrackAction).toHaveBeenCalledWith('batch-delete', { prospectIds: ['1', '2'] })
    })

    it('should batch delete via API in live mode', async () => {
      mockDeleteProspects.mockResolvedValueOnce(undefined)

      const { result } = renderUseProspectActions({ useMockData: false })

      await act(async () => {
        await result.current.handleBatchDelete(['1', '2'])
      })

      expect(mockDeleteProspects).toHaveBeenCalledWith(['1', '2'])
      expect(mockSetProspects).toHaveBeenCalled()
    })

    it('should handle batch delete API error', async () => {
      mockDeleteProspects.mockRejectedValueOnce(new Error('Delete error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { result } = renderUseProspectActions({ useMockData: false })

      await act(async () => {
        await result.current.handleBatchDelete(['1', '2'])
      })

      expect(toast.error).toHaveBeenCalledWith(
        'Unable to delete selected prospects',
        expect.any(Object)
      )

      consoleSpy.mockRestore()
    })
  })

  describe('callback stability', () => {
    it('should maintain stable callback references when dependencies unchanged', () => {
      const { result, rerender } = renderUseProspectActions()

      const firstHandleClaimLead = result.current.handleClaimLead
      const firstHandleUnclaimLead = result.current.handleUnclaimLead
      const firstHandleExportProspect = result.current.handleExportProspect
      const firstHandleBatchClaim = result.current.handleBatchClaim
      const firstHandleBatchDelete = result.current.handleBatchDelete

      rerender()

      expect(result.current.handleClaimLead).toBe(firstHandleClaimLead)
      expect(result.current.handleUnclaimLead).toBe(firstHandleUnclaimLead)
      expect(result.current.handleExportProspect).toBe(firstHandleExportProspect)
      expect(result.current.handleBatchClaim).toBe(firstHandleBatchClaim)
      expect(result.current.handleBatchDelete).toBe(firstHandleBatchDelete)
    })
  })
})
