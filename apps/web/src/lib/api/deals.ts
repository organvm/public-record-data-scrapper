import { apiRequest } from './client'

// Deal types
export interface Deal {
  id: string
  org_id: string
  prospect_id?: string
  contact_id?: string
  lender_id?: string
  stage_id?: string
  assigned_to?: string
  amount_requested?: number
  amount_approved?: number
  term_months?: number
  factor_rate?: number
  daily_payment?: number
  weekly_payment?: number
  use_of_funds?: UseOfFunds
  use_of_funds_details?: string
  average_daily_balance?: number
  monthly_revenue?: number
  nsf_count?: number
  existing_positions?: number
  priority: DealPriority
  probability?: number
  expected_close_date?: string
  funded_date?: string
  lost_reason?: string
  lost_notes?: string
  created_at: string
  updated_at: string
}

export type DealPriority = 'low' | 'normal' | 'high' | 'urgent'
export type UseOfFunds =
  | 'working_capital'
  | 'inventory'
  | 'equipment'
  | 'expansion'
  | 'payroll'
  | 'marketing'
  | 'debt_consolidation'
  | 'real_estate'
  | 'other'

export type DocumentType =
  | 'application'
  | 'bank_statement'
  | 'tax_return'
  | 'voided_check'
  | 'drivers_license'
  | 'business_license'
  | 'landlord_letter'
  | 'contract'
  | 'signed_contract'
  | 'disclosure'
  | 'signed_disclosure'
  | 'other'

export interface DealStage {
  id: string
  org_id: string
  name: string
  description?: string
  position: number
  is_won: boolean
  is_lost: boolean
  color?: string
  created_at: string
}

export interface DealDocument {
  id: string
  deal_id: string
  document_type: DocumentType
  file_name: string
  file_path: string
  file_size?: number
  mime_type?: string
  is_required: boolean
  is_verified: boolean
  verified_at?: string
  verified_by?: string
  uploaded_by?: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface DocumentChecklist {
  document_type: DocumentType
  is_required: boolean
  is_uploaded: boolean
  is_verified: boolean
  document_id?: string
  uploaded_at?: string
}

export interface DealListParams {
  org_id: string
  page?: number
  limit?: number
  stage_id?: string
  assigned_to?: string
  prospect_id?: string
  priority?: DealPriority
  search?: string
  sort_by?: 'created_at' | 'updated_at' | 'amount_requested' | 'expected_close_date'
  sort_order?: 'asc' | 'desc'
}

export interface DealListResponse {
  deals: Deal[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface PipelineStage extends DealStage {
  deals: Deal[]
  totalValue: number
  count: number
}

export interface PipelineView {
  stages: PipelineStage[]
  totalDeals: number
  totalValue: number
}

export interface DealStats {
  totalDeals: number
  totalValue: number
  avgDealSize: number
  wonDeals: number
  wonValue: number
  lostDeals: number
  conversionRate: number
  avgDaysToClose: number
  byStage: {
    stage_id: string
    stage_name: string
    count: number
    value: number
  }[]
  byPriority: {
    priority: DealPriority
    count: number
    value: number
  }[]
}

export interface CreateDealParams {
  org_id: string
  prospect_id?: string
  contact_id?: string
  stage_id?: string
  assigned_to?: string
  amount_requested?: number
  term_months?: number
  use_of_funds?: UseOfFunds
  use_of_funds_details?: string
  priority?: DealPriority
  expected_close_date?: string
}

export interface UpdateDealParams {
  prospect_id?: string | null
  contact_id?: string | null
  lender_id?: string | null
  assigned_to?: string | null
  amount_requested?: number
  amount_approved?: number | null
  term_months?: number
  factor_rate?: number | null
  daily_payment?: number | null
  weekly_payment?: number | null
  use_of_funds?: UseOfFunds
  use_of_funds_details?: string | null
  average_daily_balance?: number | null
  monthly_revenue?: number | null
  nsf_count?: number
  existing_positions?: number
  priority?: DealPriority
  probability?: number
  expected_close_date?: string | null
  lost_reason?: string | null
  lost_notes?: string | null
}

export interface MoveStageParams {
  stage_id: string
  notes?: string
  changed_by?: string
}

export interface UploadDocumentParams {
  document_type: DocumentType
  file_name: string
  file_path: string
  file_size?: number
  mime_type?: string
  is_required?: boolean
  uploaded_by?: string
  metadata?: Record<string, unknown>
}

export interface DealWithDocuments extends Deal {
  documents: DealDocument[]
  documentChecklist: DocumentChecklist[]
}

// API Functions

export async function fetchDeals(
  params: DealListParams,
  signal?: AbortSignal
): Promise<DealListResponse> {
  const searchParams = new URLSearchParams()
  searchParams.set('org_id', params.org_id)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.stage_id) searchParams.set('stage_id', params.stage_id)
  if (params.assigned_to) searchParams.set('assigned_to', params.assigned_to)
  if (params.prospect_id) searchParams.set('prospect_id', params.prospect_id)
  if (params.priority) searchParams.set('priority', params.priority)
  if (params.search) searchParams.set('search', params.search)
  if (params.sort_by) searchParams.set('sort_by', params.sort_by)
  if (params.sort_order) searchParams.set('sort_order', params.sort_order)

  return apiRequest<DealListResponse>(`/deals?${searchParams.toString()}`, { signal })
}

export async function fetchDeal(
  id: string,
  orgId: string,
  signal?: AbortSignal
): Promise<DealWithDocuments> {
  return apiRequest<DealWithDocuments>(
    `/deals/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgId)}`,
    { signal }
  )
}

export async function fetchPipelineView(
  orgId: string,
  signal?: AbortSignal
): Promise<PipelineView> {
  return apiRequest<PipelineView>(`/deals/pipeline?org_id=${encodeURIComponent(orgId)}`, { signal })
}

export async function fetchDealStages(
  orgId: string,
  signal?: AbortSignal
): Promise<{ stages: DealStage[] }> {
  return apiRequest<{ stages: DealStage[] }>(`/deals/stages?org_id=${encodeURIComponent(orgId)}`, {
    signal
  })
}

export async function fetchDealStats(orgId: string, signal?: AbortSignal): Promise<DealStats> {
  return apiRequest<DealStats>(`/deals/stats?org_id=${encodeURIComponent(orgId)}`, { signal })
}

export async function createDeal(params: CreateDealParams, signal?: AbortSignal): Promise<Deal> {
  return apiRequest<Deal>('/deals', {
    method: 'POST',
    body: params as unknown as Record<string, unknown>,
    signal
  })
}

export async function updateDeal(
  id: string,
  orgId: string,
  params: UpdateDealParams,
  signal?: AbortSignal
): Promise<Deal> {
  return apiRequest<Deal>(`/deals/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgId)}`, {
    method: 'PUT',
    body: params as unknown as Record<string, unknown>,
    signal
  })
}

export async function moveDealToStage(
  id: string,
  orgId: string,
  params: MoveStageParams,
  signal?: AbortSignal
): Promise<Deal> {
  return apiRequest<Deal>(
    `/deals/${encodeURIComponent(id)}/stage?org_id=${encodeURIComponent(orgId)}`,
    {
      method: 'PATCH',
      body: params as unknown as Record<string, unknown>,
      signal
    }
  )
}

export async function uploadDealDocument(
  dealId: string,
  params: UploadDocumentParams,
  signal?: AbortSignal
): Promise<DealDocument> {
  return apiRequest<DealDocument>(`/deals/${encodeURIComponent(dealId)}/documents`, {
    method: 'POST',
    body: params as unknown as Record<string, unknown>,
    signal
  })
}

export async function fetchDealDocuments(
  dealId: string,
  signal?: AbortSignal
): Promise<{ documents: DealDocument[] }> {
  return apiRequest<{ documents: DealDocument[] }>(
    `/deals/${encodeURIComponent(dealId)}/documents`,
    { signal }
  )
}

export async function fetchDocumentChecklist(
  dealId: string,
  signal?: AbortSignal
): Promise<{ checklist: DocumentChecklist[] }> {
  return apiRequest<{ checklist: DocumentChecklist[] }>(
    `/deals/${encodeURIComponent(dealId)}/documents/checklist`,
    { signal }
  )
}

export async function verifyDealDocument(
  dealId: string,
  documentId: string,
  verifiedBy: string,
  signal?: AbortSignal
): Promise<DealDocument> {
  return apiRequest<DealDocument>(
    `/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(documentId)}/verify`,
    {
      method: 'PATCH',
      body: { verified_by: verifiedBy },
      signal
    }
  )
}

export async function deleteDealDocument(
  dealId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<void> {
  await apiRequest(
    `/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(documentId)}`,
    {
      method: 'DELETE',
      signal
    }
  )
}
