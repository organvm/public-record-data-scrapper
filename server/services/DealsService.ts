/**
 * DealsService
 *
 * Manages the MCA deal pipeline in Broker OS. Provides:
 * - Deal CRUD operations
 * - Stage transitions with validation
 * - Document management
 * - Pipeline analytics
 */

import { database } from '../database/connection'
import { NotFoundError, ValidationError, DatabaseError } from '../errors'
import type {
  Deal,
  DealStage,
  DealDocument,
  DealPriority,
  DocumentType
} from '@public-records/core'

// Database row types
interface DealRow {
  id: string
  org_id: string
  prospect_id?: string
  contact_id?: string
  lender_id?: string
  stage_id: string
  assigned_to?: string
  deal_number?: string
  amount_requested?: number
  amount_approved?: number
  amount_funded?: number
  term_months?: number
  factor_rate?: number
  daily_payment?: number
  weekly_payment?: number
  total_payback?: number
  commission_amount?: number
  use_of_funds?: string
  use_of_funds_details?: string
  bank_connected: boolean
  average_daily_balance?: number
  monthly_revenue?: number
  nsf_count?: number
  existing_positions?: number
  priority: string
  probability?: number
  expected_close_date?: string
  actual_close_date?: string
  lost_reason?: string
  lost_notes?: string
  submitted_at?: string
  approved_at?: string
  funded_at?: string
  created_at: string
  updated_at: string
}

interface DealStageRow {
  id: string
  org_id: string
  name: string
  slug: string
  description?: string
  stage_order: number
  is_terminal: boolean
  terminal_type?: string
  color?: string
  auto_actions: Record<string, unknown>
  created_at: string
}

interface DealDocumentRow {
  id: string
  deal_id: string
  document_type: string
  file_name: string
  file_path: string
  file_size?: number
  mime_type?: string
  is_required: boolean
  uploaded_by?: string
  uploaded_at: string
  verified_by?: string
  verified_at?: string
  metadata: Record<string, unknown>
}

// Query parameters
interface ListDealsParams {
  orgId: string
  page?: number
  limit?: number
  stageId?: string
  assignedTo?: string
  prospectId?: string
  priority?: DealPriority
  search?: string
  sortBy?: 'created_at' | 'updated_at' | 'amount_requested' | 'expected_close_date'
  sortOrder?: 'asc' | 'desc'
}

interface CreateDealInput {
  orgId: string
  prospectId?: string
  contactId?: string
  stageId?: string
  assignedTo?: string
  amountRequested?: number
  termMonths?: number
  useOfFunds?: string
  useOfFundsDetails?: string
  priority?: DealPriority
  expectedCloseDate?: string
}

interface UpdateDealInput {
  prospectId?: string
  contactId?: string
  lenderId?: string
  assignedTo?: string
  amountRequested?: number
  amountApproved?: number
  termMonths?: number
  factorRate?: number
  dailyPayment?: number
  weeklyPayment?: number
  useOfFunds?: string
  useOfFundsDetails?: string
  averageDailyBalance?: number
  monthlyRevenue?: number
  nsfCount?: number
  existingPositions?: number
  priority?: DealPriority
  probability?: number
  expectedCloseDate?: string
  lostReason?: string
  lostNotes?: string
}

interface UploadDocumentInput {
  dealId: string
  documentType: DocumentType
  fileName: string
  filePath: string
  fileSize?: number
  mimeType?: string
  isRequired?: boolean
  uploadedBy?: string
  metadata?: Record<string, unknown>
}

export class DealsService {
  /**
   * Transform database row to Deal type
   */
  private transformDeal(row: DealRow): Deal {
    return {
      id: row.id,
      orgId: row.org_id,
      prospectId: row.prospect_id,
      contactId: row.contact_id,
      lenderId: row.lender_id,
      stageId: row.stage_id,
      assignedTo: row.assigned_to,
      dealNumber: row.deal_number,
      // Use == null (not falsy) so a legitimately stored 0 is preserved rather
      // than coerced to undefined.
      amountRequested: row.amount_requested == null ? undefined : Number(row.amount_requested),
      amountApproved: row.amount_approved == null ? undefined : Number(row.amount_approved),
      amountFunded: row.amount_funded == null ? undefined : Number(row.amount_funded),
      termMonths: row.term_months,
      factorRate: row.factor_rate == null ? undefined : Number(row.factor_rate),
      dailyPayment: row.daily_payment == null ? undefined : Number(row.daily_payment),
      weeklyPayment: row.weekly_payment == null ? undefined : Number(row.weekly_payment),
      totalPayback: row.total_payback == null ? undefined : Number(row.total_payback),
      commissionAmount: row.commission_amount == null ? undefined : Number(row.commission_amount),
      useOfFunds: row.use_of_funds,
      useOfFundsDetails: row.use_of_funds_details,
      bankConnected: row.bank_connected,
      averageDailyBalance:
        row.average_daily_balance == null ? undefined : Number(row.average_daily_balance),
      monthlyRevenue: row.monthly_revenue == null ? undefined : Number(row.monthly_revenue),
      nsfCount: row.nsf_count,
      existingPositions: row.existing_positions,
      priority: row.priority as DealPriority,
      probability: row.probability,
      expectedCloseDate: row.expected_close_date,
      actualCloseDate: row.actual_close_date,
      lostReason: row.lost_reason,
      lostNotes: row.lost_notes,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      fundedAt: row.funded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  /**
   * Transform database row to DealStage type
   */
  private transformStage(row: DealStageRow): DealStage {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      stageOrder: row.stage_order,
      isTerminal: row.is_terminal,
      terminalType: row.terminal_type as DealStage['terminalType'],
      color: row.color,
      autoActions: row.auto_actions || {},
      createdAt: row.created_at
    }
  }

  /**
   * Transform database row to DealDocument type
   */
  private transformDocument(row: DealDocumentRow): DealDocument {
    return {
      id: row.id,
      dealId: row.deal_id,
      documentType: row.document_type as DocumentType,
      fileName: row.file_name,
      filePath: row.file_path,
      fileSize: row.file_size,
      mimeType: row.mime_type,
      isRequired: row.is_required,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      verifiedBy: row.verified_by,
      verifiedAt: row.verified_at,
      metadata: row.metadata || {}
    }
  }

  // ============================================
  // Stage Management
  // ============================================

  /**
   * Get all stages for an organization
   */
  async getStages(orgId: string): Promise<DealStage[]> {
    try {
      const results = await database.query<DealStageRow>(
        'SELECT * FROM deal_stages WHERE org_id = $1 ORDER BY stage_order',
        [orgId]
      )
      return results.map(this.transformStage)
    } catch (error) {
      throw new DatabaseError('Failed to get stages', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Get default (first) stage for new deals
   */
  async getDefaultStage(orgId: string): Promise<DealStage> {
    try {
      const results = await database.query<DealStageRow>(
        'SELECT * FROM deal_stages WHERE org_id = $1 ORDER BY stage_order LIMIT 1',
        [orgId]
      )
      if (!results[0]) {
        throw new NotFoundError('DealStage', 'default')
      }
      return this.transformStage(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to get default stage',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Deal CRUD
  // ============================================

  /**
   * List deals with filtering and pagination
   */
  async list(params: ListDealsParams): Promise<{
    deals: Deal[]
    total: number
    page: number
    limit: number
  }> {
    const {
      orgId,
      page = 1,
      limit = 20,
      stageId,
      assignedTo,
      prospectId,
      priority,
      search,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = params

    const conditions: string[] = ['org_id = $1']
    const values: unknown[] = [orgId]
    let paramCount = 2

    if (stageId) {
      conditions.push(`stage_id = $${paramCount++}`)
      values.push(stageId)
    }

    if (assignedTo) {
      conditions.push(`assigned_to = $${paramCount++}`)
      values.push(assignedTo)
    }

    if (prospectId) {
      conditions.push(`prospect_id = $${paramCount++}`)
      values.push(prospectId)
    }

    if (priority) {
      conditions.push(`priority = $${paramCount++}`)
      values.push(priority)
    }

    if (search) {
      conditions.push(`deal_number ILIKE $${paramCount++}`)
      values.push(`%${search}%`)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`
    const offset = (page - 1) * limit

    const allowedSortColumns = [
      'created_at',
      'updated_at',
      'amount_requested',
      'expected_close_date'
    ]
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at'
    const safeSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC'

    try {
      const deals = await database.query<DealRow>(
        `SELECT * FROM deals
         ${whereClause}
         ORDER BY ${safeSortBy} ${safeSortOrder}
         LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset]
      )

      const countResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deals ${whereClause}`,
        values
      )
      const total = parseInt(countResult[0]?.count || '0')

      return {
        deals: deals.map(this.transformDeal),
        total,
        page,
        limit
      }
    } catch (error) {
      throw new DatabaseError('Failed to list deals', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Get pipeline view (deals grouped by stage)
   */
  async getPipelineView(orgId: string): Promise<{
    stages: (DealStage & { deals: Deal[]; totalValue: number })[]
    summary: {
      totalDeals: number
      totalValue: number
      avgDealSize: number
    }
  }> {
    try {
      const stages = await this.getStages(orgId)

      const dealsResult = await database.query<DealRow>(
        `SELECT d.* FROM deals d
         JOIN deal_stages ds ON d.stage_id = ds.id
         WHERE d.org_id = $1 AND ds.is_terminal = false
         ORDER BY ds.stage_order, d.created_at DESC`,
        [orgId]
      )

      const dealsByStage = new Map<string, Deal[]>()
      for (const row of dealsResult) {
        const deal = this.transformDeal(row)
        const existing = dealsByStage.get(row.stage_id) || []
        existing.push(deal)
        dealsByStage.set(row.stage_id, existing)
      }

      const pipelineStages = stages
        .filter((s) => !s.isTerminal)
        .map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) || []
          return {
            ...stage,
            deals: stageDeals,
            totalValue: stageDeals.reduce((sum, d) => sum + (d.amountRequested || 0), 0)
          }
        })

      const allDeals = dealsResult.map(this.transformDeal)
      const totalValue = allDeals.reduce((sum, d) => sum + (d.amountRequested || 0), 0)

      return {
        stages: pipelineStages,
        summary: {
          totalDeals: allDeals.length,
          totalValue,
          avgDealSize: allDeals.length > 0 ? totalValue / allDeals.length : 0
        }
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get pipeline view',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get a deal by ID
   */
  async getById(id: string, orgId: string): Promise<Deal | null> {
    try {
      const results = await database.query<DealRow>(
        'SELECT * FROM deals WHERE id = $1 AND org_id = $2',
        [id, orgId]
      )
      return results[0] ? this.transformDeal(results[0]) : null
    } catch (error) {
      throw new DatabaseError('Failed to get deal', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Get deal by ID, throwing if not found
   */
  async getByIdOrThrow(id: string, orgId: string): Promise<Deal> {
    const deal = await this.getById(id, orgId)
    if (!deal) {
      throw new NotFoundError('Deal', id)
    }
    return deal
  }

  /**
   * Create a new deal
   */
  async create(input: CreateDealInput): Promise<Deal> {
    try {
      // Get default stage if not provided
      let stageId = input.stageId
      if (!stageId) {
        const defaultStage = await this.getDefaultStage(input.orgId)
        stageId = defaultStage.id
      }

      const results = await database.query<DealRow>(
        `INSERT INTO deals (
          org_id, prospect_id, contact_id, stage_id, assigned_to,
          amount_requested, term_months, use_of_funds, use_of_funds_details,
          priority, expected_close_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          input.orgId,
          input.prospectId,
          input.contactId,
          stageId,
          input.assignedTo,
          input.amountRequested,
          input.termMonths,
          input.useOfFunds,
          input.useOfFundsDetails,
          input.priority || 'normal',
          input.expectedCloseDate
        ]
      )

      return this.transformDeal(results[0])
    } catch (error) {
      throw new DatabaseError('Failed to create deal', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Update a deal
   */
  async update(id: string, orgId: string, input: UpdateDealInput): Promise<Deal> {
    const updates: string[] = []
    const values: unknown[] = [id, orgId]
    let paramCount = 3

    const fieldMap: Record<keyof UpdateDealInput, string> = {
      prospectId: 'prospect_id',
      contactId: 'contact_id',
      lenderId: 'lender_id',
      assignedTo: 'assigned_to',
      amountRequested: 'amount_requested',
      amountApproved: 'amount_approved',
      termMonths: 'term_months',
      factorRate: 'factor_rate',
      dailyPayment: 'daily_payment',
      weeklyPayment: 'weekly_payment',
      useOfFunds: 'use_of_funds',
      useOfFundsDetails: 'use_of_funds_details',
      averageDailyBalance: 'average_daily_balance',
      monthlyRevenue: 'monthly_revenue',
      nsfCount: 'nsf_count',
      existingPositions: 'existing_positions',
      priority: 'priority',
      probability: 'probability',
      expectedCloseDate: 'expected_close_date',
      lostReason: 'lost_reason',
      lostNotes: 'lost_notes'
    }

    for (const [key, column] of Object.entries(fieldMap)) {
      const value = input[key as keyof UpdateDealInput]
      if (value !== undefined) {
        updates.push(`${column} = $${paramCount++}`)
        values.push(value)
      }
    }

    if (updates.length === 0) {
      return this.getByIdOrThrow(id, orgId)
    }

    try {
      const results = await database.query<DealRow>(
        `UPDATE deals
         SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND org_id = $2
         RETURNING *`,
        values
      )

      if (!results[0]) {
        throw new NotFoundError('Deal', id)
      }

      return this.transformDeal(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError('Failed to update deal', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Move deal to a new stage
   */
  async moveToStage(
    id: string,
    orgId: string,
    newStageId: string,
    _options: { notes?: string; changedBy?: string } = {}
  ): Promise<Deal> {
    try {
      // Validate stage exists
      const stageResult = await database.query<DealStageRow>(
        'SELECT * FROM deal_stages WHERE id = $1 AND org_id = $2',
        [newStageId, orgId]
      )
      if (!stageResult[0]) {
        throw new ValidationError(`Invalid stage: ${newStageId}`)
      }
      const newStage = this.transformStage(stageResult[0])

      // Get current deal
      const deal = await this.getByIdOrThrow(id, orgId)

      // Update timestamps based on stage
      const additionalUpdates: string[] = []
      const additionalValues: unknown[] = []

      if (newStage.slug === 'pack-submitted' && !deal.submittedAt) {
        additionalUpdates.push(`submitted_at = CURRENT_TIMESTAMP`)
      }
      if (newStage.slug === 'approved' && !deal.approvedAt) {
        additionalUpdates.push(`approved_at = CURRENT_TIMESTAMP`)
      }
      if (newStage.slug === 'funded' && !deal.fundedAt) {
        additionalUpdates.push(`funded_at = CURRENT_TIMESTAMP`)
        additionalUpdates.push(`actual_close_date = CURRENT_DATE`)
      } else if (newStage.slug !== 'funded' && deal.fundedAt) {
        // Moving backward out of the funded stage: clear the funded markers so a
        // deal isn't reported as funded/closed while sitting in an earlier stage.
        additionalUpdates.push(`funded_at = NULL`)
        additionalUpdates.push(`actual_close_date = NULL`)
      }

      const setClause = [
        `stage_id = $3`,
        ...additionalUpdates,
        `updated_at = CURRENT_TIMESTAMP`
      ].join(', ')

      const results = await database.query<DealRow>(
        `UPDATE deals
         SET ${setClause}
         WHERE id = $1 AND org_id = $2
         RETURNING *`,
        [id, orgId, newStageId, ...additionalValues]
      )

      if (!results[0]) {
        throw new NotFoundError('Deal', id)
      }

      return this.transformDeal(results[0])
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) throw error
      throw new DatabaseError(
        'Failed to move deal to stage',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Document Management
  // ============================================

  /**
   * Upload a document to a deal
   */
  async uploadDocument(input: UploadDocumentInput): Promise<DealDocument> {
    try {
      const results = await database.query<DealDocumentRow>(
        `INSERT INTO deal_documents (
          deal_id, document_type, file_name, file_path,
          file_size, mime_type, is_required, uploaded_by, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          input.dealId,
          input.documentType,
          input.fileName,
          input.filePath,
          input.fileSize,
          input.mimeType,
          input.isRequired ?? false,
          input.uploadedBy,
          input.metadata || {}
        ]
      )

      return this.transformDocument(results[0])
    } catch (error) {
      throw new DatabaseError(
        'Failed to upload document',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get documents for a deal
   */
  async getDocuments(dealId: string): Promise<DealDocument[]> {
    try {
      const results = await database.query<DealDocumentRow>(
        'SELECT * FROM deal_documents WHERE deal_id = $1 ORDER BY uploaded_at DESC',
        [dealId]
      )
      return results.map(this.transformDocument)
    } catch (error) {
      throw new DatabaseError('Failed to get documents', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Verify a document
   */
  async verifyDocument(documentId: string, verifiedBy: string): Promise<DealDocument> {
    try {
      const results = await database.query<DealDocumentRow>(
        `UPDATE deal_documents
         SET verified_by = $2, verified_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [documentId, verifiedBy]
      )

      if (!results[0]) {
        throw new NotFoundError('DealDocument', documentId)
      }

      return this.transformDocument(results[0])
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new DatabaseError(
        'Failed to verify document',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<boolean> {
    try {
      const results = await database.query('DELETE FROM deal_documents WHERE id = $1', [documentId])
      return (results as { rowCount: number }).rowCount > 0
    } catch (error) {
      throw new DatabaseError(
        'Failed to delete document',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get document checklist status for a deal
   */
  async getDocumentChecklist(dealId: string): Promise<
    {
      documentType: DocumentType
      isRequired: boolean
      isUploaded: boolean
      isVerified: boolean
      document?: DealDocument
    }[]
  > {
    const requiredDocs: DocumentType[] = [
      'application',
      'bank_statement',
      'voided_check',
      'drivers_license'
    ]

    const documents = await this.getDocuments(dealId)
    const docMap = new Map(documents.map((d) => [d.documentType, d]))

    return requiredDocs.map((docType) => {
      const doc = docMap.get(docType)
      return {
        documentType: docType,
        isRequired: true,
        isUploaded: !!doc,
        isVerified: !!doc?.verifiedAt,
        document: doc
      }
    })
  }

  // ============================================
  // Analytics
  // ============================================

  /**
   * Get deal statistics for an organization
   */
  async getStats(orgId: string): Promise<{
    totalDeals: number
    totalPipelineValue: number
    avgDealSize: number
    conversionRate: number
    avgTimeToClose: number
    dealsByStage: { stageId: string; stageName: string; count: number; value: number }[]
  }> {
    try {
      // Total pipeline stats
      const pipelineStats = await database.query<{
        total: string
        total_value: string
        avg_size: string
      }>(
        `SELECT
           COUNT(*) as total,
           COALESCE(SUM(amount_requested), 0) as total_value,
           COALESCE(AVG(amount_requested), 0) as avg_size
         FROM deals d
         JOIN deal_stages ds ON d.stage_id = ds.id
         WHERE d.org_id = $1 AND ds.is_terminal = false`,
        [orgId]
      )

      // Deals by stage
      const byStage = await database.query<{
        stage_id: string
        stage_name: string
        count: string
        value: string
      }>(
        `SELECT
           ds.id as stage_id,
           ds.name as stage_name,
           COUNT(d.id) as count,
           COALESCE(SUM(d.amount_requested), 0) as value
         FROM deal_stages ds
         LEFT JOIN deals d ON ds.id = d.stage_id
         WHERE ds.org_id = $1
         GROUP BY ds.id, ds.name, ds.stage_order
         ORDER BY ds.stage_order`,
        [orgId]
      )

      // Conversion rate (funded / total created in last 90 days)
      const conversionResult = await database.query<{
        total: string
        funded: string
      }>(
        `SELECT
           COUNT(*) as total,
           COUNT(CASE WHEN ds.slug = 'funded' THEN 1 END) as funded
         FROM deals d
         JOIN deal_stages ds ON d.stage_id = ds.id
         WHERE d.org_id = $1 AND d.created_at > NOW() - INTERVAL '90 days'`,
        [orgId]
      )
      const convTotal = parseInt(conversionResult[0]?.total || '0')
      const convFunded = parseInt(conversionResult[0]?.funded || '0')
      const conversionRate = convTotal > 0 ? (convFunded / convTotal) * 100 : 0

      // Avg time to close. Use EPOCH/86400 (full elapsed days incl. fractional)
      // rather than EXTRACT(DAY FROM interval), which only returns the integer
      // "days" component of the interval (e.g. 36h -> 1, and a '1 month 5 days'
      // interval -> 5), badly understating the true time to close.
      const timeToClose = await database.query<{ avg_days: string }>(
        `SELECT AVG(EXTRACT(EPOCH FROM (funded_at - created_at)) / 86400.0) as avg_days
         FROM deals
         WHERE org_id = $1 AND funded_at IS NOT NULL`,
        [orgId]
      )

      return {
        totalDeals: parseInt(pipelineStats[0]?.total || '0'),
        totalPipelineValue: parseFloat(pipelineStats[0]?.total_value || '0'),
        avgDealSize: parseFloat(pipelineStats[0]?.avg_size || '0'),
        conversionRate,
        avgTimeToClose: parseFloat(timeToClose[0]?.avg_days || '0'),
        dealsByStage: byStage.map((s) => ({
          stageId: s.stage_id,
          stageName: s.stage_name,
          count: parseInt(s.count),
          value: parseFloat(s.value)
        }))
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get deal stats',
        error instanceof Error ? error : undefined
      )
    }
  }
}

// Export singleton instance
export const dealsService = new DealsService()
