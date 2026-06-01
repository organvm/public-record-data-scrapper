import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDealActions } from '../useDealActions'
import type {
  Deal,
  DealDocument,
  DealStage,
  DealStats,
  DealListResponse,
  PipelineView,
  DealWithDocuments,
  DocumentChecklist
} from '@/lib/api/deals'

// Mock toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

// Mock API functions
const mockFetchDeals = vi.fn()
const mockFetchDeal = vi.fn()
const mockFetchPipelineView = vi.fn()
const mockFetchDealStages = vi.fn()
const mockFetchDealStats = vi.fn()
const mockCreateDeal = vi.fn()
const mockUpdateDeal = vi.fn()
const mockMoveDealToStage = vi.fn()
const mockUploadDealDocument = vi.fn()
const mockFetchDealDocuments = vi.fn()
const mockFetchDocumentChecklist = vi.fn()
const mockVerifyDealDocument = vi.fn()
const mockDeleteDealDocument = vi.fn()

vi.mock('@/lib/api/deals', () => ({
  fetchDeals: (...args: unknown[]) => mockFetchDeals(...args),
  fetchDeal: (...args: unknown[]) => mockFetchDeal(...args),
  fetchPipelineView: (...args: unknown[]) => mockFetchPipelineView(...args),
  fetchDealStages: (...args: unknown[]) => mockFetchDealStages(...args),
  fetchDealStats: (...args: unknown[]) => mockFetchDealStats(...args),
  createDeal: (...args: unknown[]) => mockCreateDeal(...args),
  updateDeal: (...args: unknown[]) => mockUpdateDeal(...args),
  moveDealToStage: (...args: unknown[]) => mockMoveDealToStage(...args),
  uploadDealDocument: (...args: unknown[]) => mockUploadDealDocument(...args),
  fetchDealDocuments: (...args: unknown[]) => mockFetchDealDocuments(...args),
  fetchDocumentChecklist: (...args: unknown[]) => mockFetchDocumentChecklist(...args),
  verifyDealDocument: (...args: unknown[]) => mockVerifyDealDocument(...args),
  deleteDealDocument: (...args: unknown[]) => mockDeleteDealDocument(...args)
}))

import { toast } from 'sonner'

const createMockDeal = (overrides: Partial<Deal> = {}): Deal => ({
  id: 'deal-1',
  org_id: 'org-1',
  stage_id: 'lead',
  priority: 'normal',
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
  ...overrides
})

const createMockStage = (overrides: Partial<DealStage> = {}): DealStage => ({
  id: 'lead',
  org_id: 'org-1',
  name: 'Lead',
  description: undefined,
  position: 1,
  is_won: false,
  is_lost: false,
  color: undefined,
  created_at: '2024-01-01',
  ...overrides
})

const createMockDocument = (overrides: Partial<DealDocument> = {}): DealDocument => ({
  id: 'doc-1',
  deal_id: 'deal-1',
  document_type: 'application',
  file_name: 'application.pdf',
  file_path: '/docs/application.pdf',
  is_required: true,
  is_verified: false,
  metadata: {},
  created_at: '2024-01-15',
  ...overrides
})

describe('useDealActions', () => {
  const defaultOptions = {
    orgId: 'org-1'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderUseDealActions = (options: Partial<Parameters<typeof useDealActions>[0]> = {}) => {
    return renderHook(() =>
      useDealActions({
        ...defaultOptions,
        ...options
      })
    )
  }

  describe('initial state', () => {
    it('should have isLoading as false initially', () => {
      const { result } = renderUseDealActions()
      expect(result.current.isLoading).toBe(false)
    })

    it('should have error as null initially', () => {
      const { result } = renderUseDealActions()
      expect(result.current.error).toBeNull()
    })
  })

  describe('handleFetchDeals', () => {
    it('should fetch deals successfully', async () => {
      const mockResponse: DealListResponse = {
        deals: [createMockDeal()],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 }
      }
      mockFetchDeals.mockResolvedValueOnce(mockResponse)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDeals()
      })

      expect(mockFetchDeals).toHaveBeenCalledWith({ org_id: 'org-1' })
      expect(response).toEqual(mockResponse)
      expect(result.current.isLoading).toBe(false)
    })

    it('should pass additional params', async () => {
      mockFetchDeals.mockResolvedValueOnce({
        deals: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
      })

      const { result } = renderUseDealActions()

      await act(async () => {
        await result.current.handleFetchDeals({ stage_id: 'lead', priority: 'high' })
      })

      expect(mockFetchDeals).toHaveBeenCalledWith({
        org_id: 'org-1',
        stage_id: 'lead',
        priority: 'high'
      })
    })

    it('should handle fetch error', async () => {
      const error = new Error('Network error')
      mockFetchDeals.mockRejectedValueOnce(error)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDeals()
      })

      expect(response).toBeNull()
      expect(result.current.error).toEqual(error)
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch deals', {
        description: 'Network error'
      })
    })
  })

  describe('handleFetchDeal', () => {
    it('should fetch a single deal successfully', async () => {
      const mockDealWithDocuments: DealWithDocuments = {
        ...createMockDeal(),
        documents: [createMockDocument()],
        documentChecklist: []
      }
      mockFetchDeal.mockResolvedValueOnce(mockDealWithDocuments)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDeal('deal-1')
      })

      expect(mockFetchDeal).toHaveBeenCalledWith('deal-1', 'org-1')
      expect(response).toEqual(mockDealWithDocuments)
    })

    it('should handle fetch deal error', async () => {
      mockFetchDeal.mockRejectedValueOnce(new Error('Deal not found'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDeal('unknown')
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch deal', {
        description: 'Deal not found'
      })
    })
  })

  describe('handleFetchPipelineView', () => {
    it('should fetch pipeline view successfully', async () => {
      const mockPipeline: PipelineView = {
        stages: [{ ...createMockStage(), deals: [createMockDeal()], totalValue: 50000, count: 1 }],
        totalDeals: 1,
        totalValue: 50000
      }
      mockFetchPipelineView.mockResolvedValueOnce(mockPipeline)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchPipelineView()
      })

      expect(mockFetchPipelineView).toHaveBeenCalledWith('org-1')
      expect(response).toEqual(mockPipeline)
    })

    it('should handle fetch pipeline error', async () => {
      mockFetchPipelineView.mockRejectedValueOnce(new Error('Pipeline error'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchPipelineView()
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch pipeline', {
        description: 'Pipeline error'
      })
    })
  })

  describe('handleFetchStages', () => {
    it('should fetch stages successfully', async () => {
      const mockStages = [createMockStage(), createMockStage({ id: 'contacted', position: 2 })]
      mockFetchDealStages.mockResolvedValueOnce({ stages: mockStages })

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchStages()
      })

      expect(mockFetchDealStages).toHaveBeenCalledWith('org-1')
      expect(response).toEqual(mockStages)
    })

    it('should handle fetch stages error', async () => {
      mockFetchDealStages.mockRejectedValueOnce(new Error('Stages error'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchStages()
      })

      expect(response).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch stages', {
        description: 'Stages error'
      })
    })
  })

  describe('handleFetchStats', () => {
    it('should fetch stats successfully', async () => {
      const mockStats: DealStats = {
        totalDeals: 100,
        totalValue: 5000000,
        avgDealSize: 50000,
        wonDeals: 75,
        wonValue: 3750000,
        lostDeals: 25,
        conversionRate: 0.25,
        avgDaysToClose: 30,
        byStage: [],
        byPriority: []
      }
      mockFetchDealStats.mockResolvedValueOnce(mockStats)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchStats()
      })

      expect(mockFetchDealStats).toHaveBeenCalledWith('org-1')
      expect(response).toEqual(mockStats)
    })

    it('should handle fetch stats error', async () => {
      mockFetchDealStats.mockRejectedValueOnce(new Error('Stats error'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchStats()
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch statistics', {
        description: 'Stats error'
      })
    })
  })

  describe('handleCreateDeal', () => {
    it('should create deal successfully', async () => {
      const newDeal = createMockDeal({ amount_requested: 50000 })
      mockCreateDeal.mockResolvedValueOnce(newDeal)

      const onDealCreated = vi.fn()
      const { result } = renderUseDealActions({ onDealCreated })

      let response
      await act(async () => {
        response = await result.current.handleCreateDeal({
          stage_id: 'lead',
          amount_requested: 50000
        })
      })

      expect(mockCreateDeal).toHaveBeenCalledWith({
        org_id: 'org-1',
        stage_id: 'lead',
        amount_requested: 50000
      })
      expect(response).toEqual(newDeal)
      expect(toast.success).toHaveBeenCalledWith('Deal created', expect.any(Object))
      expect(onDealCreated).toHaveBeenCalledWith(newDeal)
    })

    it('should handle create deal error', async () => {
      mockCreateDeal.mockRejectedValueOnce(new Error('Validation failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleCreateDeal({ stage_id: 'lead' })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to create deal', {
        description: 'Validation failed'
      })
    })
  })

  describe('handleUpdateDeal', () => {
    it('should update deal successfully', async () => {
      const updatedDeal = createMockDeal({ amount_approved: 45000 })
      mockUpdateDeal.mockResolvedValueOnce(updatedDeal)

      const onDealUpdated = vi.fn()
      const { result } = renderUseDealActions({ onDealUpdated })

      let response
      await act(async () => {
        response = await result.current.handleUpdateDeal('deal-1', {
          amount_approved: 45000
        })
      })

      expect(mockUpdateDeal).toHaveBeenCalledWith('deal-1', 'org-1', {
        amount_approved: 45000
      })
      expect(response).toEqual(updatedDeal)
      expect(toast.success).toHaveBeenCalledWith('Deal updated', expect.any(Object))
      expect(onDealUpdated).toHaveBeenCalledWith(updatedDeal)
    })

    it('should handle update deal error', async () => {
      mockUpdateDeal.mockRejectedValueOnce(new Error('Update failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleUpdateDeal('deal-1', { priority: 'high' })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to update deal', {
        description: 'Update failed'
      })
    })
  })

  describe('handleMoveToStage', () => {
    it('should move deal to stage successfully', async () => {
      const movedDeal = createMockDeal({ stage_id: 'contacted' })
      mockMoveDealToStage.mockResolvedValueOnce(movedDeal)

      const onStageMoved = vi.fn()
      const { result } = renderUseDealActions({ onStageMoved })

      let response
      await act(async () => {
        response = await result.current.handleMoveToStage('deal-1', {
          stage_id: 'contacted'
        })
      })

      expect(mockMoveDealToStage).toHaveBeenCalledWith('deal-1', 'org-1', {
        stage_id: 'contacted'
      })
      expect(response).toEqual(movedDeal)
      expect(toast.success).toHaveBeenCalledWith('Deal moved', expect.any(Object))
      expect(onStageMoved).toHaveBeenCalledWith(movedDeal)
    })

    it('should handle move to stage error', async () => {
      mockMoveDealToStage.mockRejectedValueOnce(new Error('Move failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleMoveToStage('deal-1', { stage_id: 'contacted' })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to move deal', {
        description: 'Move failed'
      })
    })
  })

  describe('handleUploadDocument', () => {
    it('should upload document successfully', async () => {
      const uploadedDoc = createMockDocument()
      mockUploadDealDocument.mockResolvedValueOnce(uploadedDoc)

      const onDocumentUploaded = vi.fn()
      const { result } = renderUseDealActions({ onDocumentUploaded })

      let response
      await act(async () => {
        response = await result.current.handleUploadDocument('deal-1', {
          document_type: 'application',
          file_name: 'application.pdf',
          file_path: 'base64content'
        })
      })

      expect(mockUploadDealDocument).toHaveBeenCalledWith('deal-1', {
        document_type: 'application',
        file_name: 'application.pdf',
        file_path: 'base64content'
      })
      expect(response).toEqual(uploadedDoc)
      expect(toast.success).toHaveBeenCalledWith('Document uploaded', {
        description: 'application.pdf has been uploaded.'
      })
      expect(onDocumentUploaded).toHaveBeenCalledWith(uploadedDoc)
    })

    it('should handle upload document error', async () => {
      mockUploadDealDocument.mockRejectedValueOnce(new Error('Upload failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleUploadDocument('deal-1', {
          document_type: 'application',
          file_name: 'test.pdf',
          file_path: 'content'
        })
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to upload document', {
        description: 'Upload failed'
      })
    })
  })

  describe('handleFetchDocuments', () => {
    it('should fetch documents successfully', async () => {
      const mockDocuments = [createMockDocument(), createMockDocument({ id: 'doc-2' })]
      mockFetchDealDocuments.mockResolvedValueOnce({ documents: mockDocuments })

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDocuments('deal-1')
      })

      expect(mockFetchDealDocuments).toHaveBeenCalledWith('deal-1')
      expect(response).toEqual(mockDocuments)
    })

    it('should handle fetch documents error', async () => {
      mockFetchDealDocuments.mockRejectedValueOnce(new Error('Fetch failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDocuments('deal-1')
      })

      expect(response).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch documents', {
        description: 'Fetch failed'
      })
    })
  })

  describe('handleFetchDocumentChecklist', () => {
    it('should fetch document checklist successfully', async () => {
      const mockChecklist: DocumentChecklist[] = [
        { document_type: 'application', is_required: true, is_uploaded: true, is_verified: false },
        {
          document_type: 'bank_statement',
          is_required: true,
          is_uploaded: false,
          is_verified: false
        }
      ]
      mockFetchDocumentChecklist.mockResolvedValueOnce({ checklist: mockChecklist })

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDocumentChecklist('deal-1')
      })

      expect(mockFetchDocumentChecklist).toHaveBeenCalledWith('deal-1')
      expect(response).toEqual(mockChecklist)
    })

    it('should handle fetch checklist error', async () => {
      mockFetchDocumentChecklist.mockRejectedValueOnce(new Error('Fetch failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleFetchDocumentChecklist('deal-1')
      })

      expect(response).toEqual([])
      expect(toast.error).toHaveBeenCalledWith('Failed to fetch document checklist', {
        description: 'Fetch failed'
      })
    })
  })

  describe('handleVerifyDocument', () => {
    it('should verify document successfully', async () => {
      const verifiedDoc = createMockDocument({ verified_by: 'user-1', verified_at: '2024-01-20' })
      mockVerifyDealDocument.mockResolvedValueOnce(verifiedDoc)

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleVerifyDocument('deal-1', 'doc-1', 'user-1')
      })

      expect(mockVerifyDealDocument).toHaveBeenCalledWith('deal-1', 'doc-1', 'user-1')
      expect(response).toEqual(verifiedDoc)
      expect(toast.success).toHaveBeenCalledWith('Document verified', expect.any(Object))
    })

    it('should handle verify document error', async () => {
      mockVerifyDealDocument.mockRejectedValueOnce(new Error('Verify failed'))

      const { result } = renderUseDealActions()

      let response
      await act(async () => {
        response = await result.current.handleVerifyDocument('deal-1', 'doc-1', 'user-1')
      })

      expect(response).toBeNull()
      expect(toast.error).toHaveBeenCalledWith('Failed to verify document', {
        description: 'Verify failed'
      })
    })
  })

  describe('handleDeleteDocument', () => {
    it('should delete document successfully', async () => {
      mockDeleteDealDocument.mockResolvedValueOnce(undefined)

      const onDocumentDeleted = vi.fn()
      const { result } = renderUseDealActions({ onDocumentDeleted })

      let success
      await act(async () => {
        success = await result.current.handleDeleteDocument('deal-1', 'doc-1')
      })

      expect(mockDeleteDealDocument).toHaveBeenCalledWith('deal-1', 'doc-1')
      expect(success).toBe(true)
      expect(toast.info).toHaveBeenCalledWith('Document deleted', expect.any(Object))
      expect(onDocumentDeleted).toHaveBeenCalledWith('doc-1')
    })

    it('should handle delete document error', async () => {
      mockDeleteDealDocument.mockRejectedValueOnce(new Error('Delete failed'))

      const { result } = renderUseDealActions()

      let success
      await act(async () => {
        success = await result.current.handleDeleteDocument('deal-1', 'doc-1')
      })

      expect(success).toBe(false)
      expect(toast.error).toHaveBeenCalledWith('Failed to delete document', {
        description: 'Delete failed'
      })
    })
  })

  describe('callback stability', () => {
    it('should maintain stable callback references when dependencies unchanged', () => {
      const { result, rerender } = renderUseDealActions()

      const firstHandleFetchDeals = result.current.handleFetchDeals
      const firstHandleFetchDeal = result.current.handleFetchDeal
      const firstHandleFetchPipelineView = result.current.handleFetchPipelineView
      const firstHandleFetchStages = result.current.handleFetchStages
      const firstHandleFetchStats = result.current.handleFetchStats
      const firstHandleCreateDeal = result.current.handleCreateDeal
      const firstHandleUpdateDeal = result.current.handleUpdateDeal
      const firstHandleMoveToStage = result.current.handleMoveToStage
      const firstHandleUploadDocument = result.current.handleUploadDocument
      const firstHandleFetchDocuments = result.current.handleFetchDocuments
      const firstHandleVerifyDocument = result.current.handleVerifyDocument
      const firstHandleDeleteDocument = result.current.handleDeleteDocument

      rerender()

      expect(result.current.handleFetchDeals).toBe(firstHandleFetchDeals)
      expect(result.current.handleFetchDeal).toBe(firstHandleFetchDeal)
      expect(result.current.handleFetchPipelineView).toBe(firstHandleFetchPipelineView)
      expect(result.current.handleFetchStages).toBe(firstHandleFetchStages)
      expect(result.current.handleFetchStats).toBe(firstHandleFetchStats)
      expect(result.current.handleCreateDeal).toBe(firstHandleCreateDeal)
      expect(result.current.handleUpdateDeal).toBe(firstHandleUpdateDeal)
      expect(result.current.handleMoveToStage).toBe(firstHandleMoveToStage)
      expect(result.current.handleUploadDocument).toBe(firstHandleUploadDocument)
      expect(result.current.handleFetchDocuments).toBe(firstHandleFetchDocuments)
      expect(result.current.handleVerifyDocument).toBe(firstHandleVerifyDocument)
      expect(result.current.handleDeleteDocument).toBe(firstHandleDeleteDocument)
    })
  })

  describe('loading state management', () => {
    it('should set loading state during async operations', async () => {
      let resolvePromise: (value: unknown) => void
      const promise = new Promise((resolve) => {
        resolvePromise = resolve
      })
      mockFetchDeals.mockReturnValueOnce(promise)

      const { result } = renderUseDealActions()

      act(() => {
        result.current.handleFetchDeals()
      })

      expect(result.current.isLoading).toBe(true)

      await act(async () => {
        resolvePromise!({ deals: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } })
      })

      expect(result.current.isLoading).toBe(false)
    })
  })

  describe('error handling edge cases', () => {
    it('should handle non-Error exceptions', async () => {
      mockFetchDeals.mockRejectedValueOnce('String error')

      const { result } = renderUseDealActions()

      await act(async () => {
        await result.current.handleFetchDeals()
      })

      expect(result.current.error).toEqual(new Error('Failed to fetch deals'))
    })

    it('should clear error on new request', async () => {
      mockFetchDeals.mockRejectedValueOnce(new Error('First error'))

      const { result } = renderUseDealActions()

      await act(async () => {
        await result.current.handleFetchDeals()
      })

      expect(result.current.error).not.toBeNull()

      mockFetchDeals.mockResolvedValueOnce({
        deals: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
      })

      await act(async () => {
        await result.current.handleFetchDeals()
      })

      expect(result.current.error).toBeNull()
    })
  })
})
