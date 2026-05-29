import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DealsService } from '../../services/DealsService'
import { NotFoundError, ValidationError, DatabaseError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('DealsService', () => {
  let service: DealsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new DealsService()
  })

  describe('getStages', () => {
    it('should return all stages for organization', async () => {
      const mockStages = [
        {
          id: 'stage-1',
          org_id: 'org-1',
          name: 'New Lead',
          slug: 'new-lead',
          stage_order: 1,
          is_terminal: false,
          auto_actions: {},
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'stage-2',
          org_id: 'org-1',
          name: 'In Progress',
          slug: 'in-progress',
          stage_order: 2,
          is_terminal: false,
          auto_actions: {},
          created_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockStages)

      const result = await service.getStages('org-1')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('New Lead')
      expect(result[1].name).toBe('In Progress')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getStages('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('getDefaultStage', () => {
    it('should return first stage', async () => {
      const mockStage = {
        id: 'stage-1',
        org_id: 'org-1',
        name: 'New Lead',
        slug: 'new-lead',
        stage_order: 1,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockStage])

      const result = await service.getDefaultStage('org-1')

      expect(result.name).toBe('New Lead')
      expect(result.stageOrder).toBe(1)
    })

    it('should throw NotFoundError when no stages exist', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.getDefaultStage('org-1')).rejects.toThrow(NotFoundError)
    })
  })

  describe('list', () => {
    it('should return paginated list of deals', async () => {
      const mockDeals = [
        {
          id: 'deal-1',
          org_id: 'org-1',
          stage_id: 'stage-1',
          priority: 'normal',
          bank_connected: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'deal-2',
          org_id: 'org-1',
          stage_id: 'stage-1',
          priority: 'high',
          bank_connected: true,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockDeals).mockResolvedValueOnce([{ count: '2' }])

      const result = await service.list({ orgId: 'org-1' })

      expect(result.deals).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
    })

    it('should filter by stage', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({ orgId: 'org-1', stageId: 'stage-1' })

      expect(mockQuery.mock.calls[0][0]).toContain('stage_id = $')
    })

    it('should filter by assignedTo', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({ orgId: 'org-1', assignedTo: 'user-1' })

      expect(mockQuery.mock.calls[0][0]).toContain('assigned_to = $')
    })

    it('should filter by priority', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({ orgId: 'org-1', priority: 'high' })

      expect(mockQuery.mock.calls[0][0]).toContain('priority = $')
    })

    it('should handle sorting', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({ orgId: 'org-1', sortBy: 'amount_requested', sortOrder: 'desc' })

      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY amount_requested DESC')
    })

    it('should use safe default for invalid sort column', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }])

      await service.list({
        orgId: 'org-1',
        sortBy: 'malicious; DROP TABLE deals;--' as unknown as 'created_at'
      })

      expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY created_at')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.list({ orgId: 'org-1' })).rejects.toThrow(DatabaseError)
    })
  })

  describe('getPipelineView', () => {
    it('should return deals grouped by stage', async () => {
      const mockStages = [
        {
          id: 'stage-1',
          org_id: 'org-1',
          name: 'New',
          slug: 'new',
          stage_order: 1,
          is_terminal: false,
          auto_actions: {},
          created_at: '2024-01-01T00:00:00Z'
        },
        {
          id: 'stage-2',
          org_id: 'org-1',
          name: 'Funded',
          slug: 'funded',
          stage_order: 2,
          is_terminal: true,
          terminal_type: 'won',
          auto_actions: {},
          created_at: '2024-01-01T00:00:00Z'
        }
      ]
      const mockDeals = [
        {
          id: 'deal-1',
          org_id: 'org-1',
          stage_id: 'stage-1',
          amount_requested: 50000,
          priority: 'normal',
          bank_connected: false,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockStages).mockResolvedValueOnce(mockDeals)

      const result = await service.getPipelineView('org-1')

      expect(result.stages).toHaveLength(1) // Only non-terminal stages
      expect(result.stages[0].deals).toHaveLength(1)
      expect(result.summary.totalDeals).toBe(1)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getPipelineView('org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('getById', () => {
    it('should return deal by id', async () => {
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDeal])

      const result = await service.getById('deal-1', 'org-1')

      expect(result).not.toBeNull()
      expect(result?.id).toBe('deal-1')
    })

    it('should return null for non-existent deal', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.getById('non-existent', 'org-1')

      expect(result).toBeNull()
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getById('deal-1', 'org-1')).rejects.toThrow(DatabaseError)
    })
  })

  describe('getByIdOrThrow', () => {
    it('should return deal when found', async () => {
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDeal])

      const result = await service.getByIdOrThrow('deal-1', 'org-1')

      expect(result.id).toBe('deal-1')
    })

    it('should throw NotFoundError when deal does not exist', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.getByIdOrThrow('non-existent', 'org-1')).rejects.toThrow(NotFoundError)
    })
  })

  describe('create', () => {
    it('should create a new deal with default stage', async () => {
      const mockStage = {
        id: 'stage-1',
        org_id: 'org-1',
        name: 'New',
        slug: 'new',
        stage_order: 1,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        amount_requested: 50000,
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery
        .mockResolvedValueOnce([mockStage]) // getDefaultStage
        .mockResolvedValueOnce([mockDeal]) // insert

      const result = await service.create({
        orgId: 'org-1',
        amountRequested: 50000
      })

      expect(result.id).toBe('deal-1')
      expect(result.amountRequested).toBe(50000)
    })

    it('should create deal with provided stage', async () => {
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'custom-stage',
        priority: 'high',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDeal])

      const result = await service.create({
        orgId: 'org-1',
        stageId: 'custom-stage',
        priority: 'high'
      })

      expect(result.stageId).toBe('custom-stage')
      expect(result.priority).toBe('high')
    })

    it('should throw DatabaseError on failure', async () => {
      const mockStage = {
        id: 'stage-1',
        org_id: 'org-1',
        name: 'New',
        slug: 'new',
        stage_order: 1,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }
      mockQuery.mockResolvedValueOnce([mockStage])
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(service.create({ orgId: 'org-1' })).rejects.toThrow(DatabaseError)
    })
  })

  describe('update', () => {
    it('should update deal fields', async () => {
      const mockUpdated = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        amount_requested: 75000,
        priority: 'high',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockUpdated])

      const result = await service.update('deal-1', 'org-1', {
        amountRequested: 75000,
        priority: 'high'
      })

      expect(result.amountRequested).toBe(75000)
      expect(result.priority).toBe('high')
    })

    it('should return current deal when no fields to update', async () => {
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDeal])

      const result = await service.update('deal-1', 'org-1', {})

      expect(result.id).toBe('deal-1')
    })

    it('should throw NotFoundError for non-existent deal', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(
        service.update('non-existent', 'org-1', { amountRequested: 50000 })
      ).rejects.toThrow(NotFoundError)
    })
  })

  describe('moveToStage', () => {
    it('should move deal to new stage', async () => {
      const mockStage = {
        id: 'stage-2',
        org_id: 'org-1',
        name: 'In Progress',
        slug: 'in-progress',
        stage_order: 2,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
      const mockUpdated = { ...mockDeal, stage_id: 'stage-2' }

      mockQuery
        .mockResolvedValueOnce([mockStage]) // validate stage
        .mockResolvedValueOnce([mockDeal]) // getByIdOrThrow
        .mockResolvedValueOnce([mockUpdated]) // update

      const result = await service.moveToStage('deal-1', 'org-1', 'stage-2')

      expect(result.stageId).toBe('stage-2')
    })

    it('records the stage transition with notes/changedBy in deal_stage_history', async () => {
      const mockStage = {
        id: 'stage-2',
        org_id: 'org-1',
        name: 'In Progress',
        slug: 'in-progress',
        stage_order: 2,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
      const mockUpdated = { ...mockDeal, stage_id: 'stage-2' }

      mockQuery
        .mockResolvedValueOnce([mockStage]) // validate stage
        .mockResolvedValueOnce([mockDeal]) // getByIdOrThrow
        .mockResolvedValueOnce([mockUpdated]) // update
        .mockResolvedValueOnce([]) // deal_stage_history insert

      await service.moveToStage('deal-1', 'org-1', 'stage-2', {
        notes: 'moved after underwriting review',
        changedBy: '11111111-1111-1111-1111-111111111111'
      })

      const historyCall = mockQuery.mock.calls.find((call) =>
        String(call[0]).includes('INSERT INTO deal_stage_history')
      )
      expect(historyCall).toBeDefined()
      expect(historyCall?.[1]).toEqual([
        'deal-1',
        'stage-1',
        'stage-2',
        '11111111-1111-1111-1111-111111111111',
        'moved after underwriting review'
      ])
    })

    it('should set submitted_at when moving to pack-submitted', async () => {
      const mockStage = {
        id: 'stage-2',
        org_id: 'org-1',
        name: 'Pack Submitted',
        slug: 'pack-submitted',
        stage_order: 2,
        is_terminal: false,
        auto_actions: {},
        created_at: '2024-01-01T00:00:00Z'
      }
      const mockDeal = {
        id: 'deal-1',
        org_id: 'org-1',
        stage_id: 'stage-1',
        priority: 'normal',
        bank_connected: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
      const mockUpdated = { ...mockDeal, stage_id: 'stage-2', submitted_at: '2024-01-02T00:00:00Z' }

      mockQuery
        .mockResolvedValueOnce([mockStage])
        .mockResolvedValueOnce([mockDeal])
        .mockResolvedValueOnce([mockUpdated])

      const result = await service.moveToStage('deal-1', 'org-1', 'stage-2')

      expect(result.submittedAt).toBeDefined()
    })

    it('should throw ValidationError for invalid stage', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.moveToStage('deal-1', 'org-1', 'invalid-stage')).rejects.toThrow(
        ValidationError
      )
    })
  })

  describe('uploadDocument', () => {
    it('should upload document to deal', async () => {
      const mockDocument = {
        id: 'doc-1',
        deal_id: 'deal-1',
        document_type: 'bank_statement',
        file_name: 'statement.pdf',
        file_path: '/uploads/statement.pdf',
        is_required: true,
        metadata: {},
        uploaded_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDocument])

      const result = await service.uploadDocument({
        dealId: 'deal-1',
        documentType: 'bank_statement',
        fileName: 'statement.pdf',
        filePath: '/uploads/statement.pdf',
        isRequired: true
      })

      expect(result.id).toBe('doc-1')
      expect(result.documentType).toBe('bank_statement')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Insert failed'))

      await expect(
        service.uploadDocument({
          dealId: 'deal-1',
          documentType: 'bank_statement',
          fileName: 'statement.pdf',
          filePath: '/uploads/statement.pdf'
        })
      ).rejects.toThrow(DatabaseError)
    })
  })

  describe('getDocuments', () => {
    it('should return documents for deal', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          deal_id: 'deal-1',
          document_type: 'bank_statement',
          file_name: 'statement.pdf',
          file_path: '/uploads/statement.pdf',
          is_required: true,
          metadata: {},
          uploaded_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockDocuments)

      const result = await service.getDocuments('deal-1')

      expect(result).toHaveLength(1)
      expect(result[0].documentType).toBe('bank_statement')
    })
  })

  describe('verifyDocument', () => {
    it('should verify a document', async () => {
      const mockDocument = {
        id: 'doc-1',
        deal_id: 'deal-1',
        document_type: 'bank_statement',
        file_name: 'statement.pdf',
        file_path: '/uploads/statement.pdf',
        is_required: true,
        verified_by: 'user-1',
        verified_at: '2024-01-02T00:00:00Z',
        metadata: {},
        uploaded_at: '2024-01-01T00:00:00Z'
      }

      mockQuery.mockResolvedValueOnce([mockDocument])

      const result = await service.verifyDocument('doc-1', 'user-1')

      expect(result.verifiedBy).toBe('user-1')
      expect(result.verifiedAt).toBeDefined()
    })

    it('should throw NotFoundError for non-existent document', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.verifyDocument('non-existent', 'user-1')).rejects.toThrow(NotFoundError)
    })
  })

  describe('deleteDocument', () => {
    it('should delete a document', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 1 } as unknown as [])

      const result = await service.deleteDocument('doc-1')

      expect(result).toBe(true)
    })

    it('should return false when document not found', async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0 } as unknown as [])

      const result = await service.deleteDocument('non-existent')

      expect(result).toBe(false)
    })
  })

  describe('getDocumentChecklist', () => {
    it('should return document checklist status', async () => {
      const mockDocuments = [
        {
          id: 'doc-1',
          deal_id: 'deal-1',
          document_type: 'application',
          file_name: 'app.pdf',
          file_path: '/uploads/app.pdf',
          is_required: true,
          verified_at: '2024-01-01T00:00:00Z',
          metadata: {},
          uploaded_at: '2024-01-01T00:00:00Z'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockDocuments)

      const result = await service.getDocumentChecklist('deal-1')

      expect(result).toHaveLength(4) // application, bank_statement, voided_check, drivers_license
      expect(result.find((r) => r.documentType === 'application')?.isUploaded).toBe(true)
      expect(result.find((r) => r.documentType === 'application')?.isVerified).toBe(true)
      expect(result.find((r) => r.documentType === 'bank_statement')?.isUploaded).toBe(false)
    })
  })

  describe('getStats', () => {
    it('should return deal statistics', async () => {
      mockQuery
        .mockResolvedValueOnce([{ total: '10', total_value: '500000', avg_size: '50000' }])
        .mockResolvedValueOnce([
          { stage_id: 'stage-1', stage_name: 'New', count: '5', value: '250000' },
          { stage_id: 'stage-2', stage_name: 'In Progress', count: '5', value: '250000' }
        ])
        .mockResolvedValueOnce([{ total: '20', funded: '5' }])
        .mockResolvedValueOnce([{ avg_days: '15' }])

      const result = await service.getStats('org-1')

      expect(result.totalDeals).toBe(10)
      expect(result.totalPipelineValue).toBe(500000)
      expect(result.avgDealSize).toBe(50000)
      expect(result.conversionRate).toBe(25) // 5/20 * 100
      expect(result.dealsByStage).toHaveLength(2)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.getStats('org-1')).rejects.toThrow(DatabaseError)
    })
  })
})
