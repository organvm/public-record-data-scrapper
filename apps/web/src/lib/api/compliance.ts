import { apiRequest } from './client'
import type {
  Disclosure,
  DisclosureStatus,
  ConsentRecord,
  ConsentType,
  CollectionMethod,
  AuditLog
} from '@public-records/core'

// The compliance server routes (server/routes/compliance.ts) return the
// canonical camelCase types from @public-records/core — the services transform
// snake_case DB rows before responding — so no client-side row mapping is
// needed here, unlike the contacts/deals clients.

// Channel union accepted by the consent endpoints
// (CommunicationChannel 'email'|'sms'|'call' | 'mail' | 'all').
export type ConsentChannel = 'email' | 'sms' | 'call' | 'mail' | 'all'

// ---------------------------------------------------------------------------
// Disclosures
// ---------------------------------------------------------------------------

export interface DisclosureListParams {
  org_id?: string
  status?: DisclosureStatus
  state?: string
  start_date?: string
  end_date?: string
  page?: number
  limit?: number
}

export interface DisclosureListResponse {
  disclosures: Disclosure[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface GenerateDisclosureParams {
  deal_id: string
  state: string
  signature_required?: boolean
  expires_in_days?: number
  generated_by?: string
}

export interface RecordSignatureParams {
  signed_by: string
  signed_ip?: string
  signature_image_url?: string
  signature_id?: string
}

export async function fetchDisclosures(
  params: DisclosureListParams = {},
  signal?: AbortSignal
): Promise<DisclosureListResponse> {
  const search = new URLSearchParams()
  // org_id is derived server-side from the token; only send when explicitly set.
  if (params.org_id) search.set('org_id', params.org_id)
  if (params.status) search.set('status', params.status)
  if (params.state) search.set('state', params.state)
  if (params.start_date) search.set('start_date', params.start_date)
  if (params.end_date) search.set('end_date', params.end_date)
  if (params.page) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))

  const query = search.toString()
  return apiRequest<DisclosureListResponse>(`/compliance/disclosures${query ? `?${query}` : ''}`, {
    signal
  })
}

export async function fetchDisclosuresForDeal(
  dealId: string,
  signal?: AbortSignal
): Promise<{ disclosures: Disclosure[] }> {
  return apiRequest<{ disclosures: Disclosure[] }>(
    `/compliance/disclosures/by-deal/${encodeURIComponent(dealId)}`,
    { signal }
  )
}

export async function fetchDisclosure(id: string, signal?: AbortSignal): Promise<Disclosure> {
  return apiRequest<Disclosure>(`/compliance/disclosures/${encodeURIComponent(id)}`, { signal })
}

export async function generateDisclosure(
  params: GenerateDisclosureParams,
  signal?: AbortSignal
): Promise<Disclosure> {
  return apiRequest<Disclosure>('/compliance/disclosures', {
    method: 'POST',
    body: params,
    signal
  })
}

export async function markDisclosureSent(id: string, signal?: AbortSignal): Promise<Disclosure> {
  return apiRequest<Disclosure>(`/compliance/disclosures/${encodeURIComponent(id)}/sent`, {
    method: 'POST',
    body: {},
    signal
  })
}

export async function recordDisclosureSignature(
  id: string,
  params: RecordSignatureParams,
  signal?: AbortSignal
): Promise<Disclosure> {
  return apiRequest<Disclosure>(`/compliance/disclosures/${encodeURIComponent(id)}/signature`, {
    method: 'POST',
    body: params,
    signal
  })
}

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------

export interface ConsentListParams {
  // Consent is stored and retrieved per contact — the server returns 422 if
  // contact_id is omitted, so it is required here.
  contact_id: string
  include_revoked?: boolean
  org_id?: string
}

export interface ConsentStats {
  totalContacts: number
  byType: Record<string, number>
  byChannel: Record<string, number>
  recentOptOuts: number
  expiringInWeek: number
}

export interface RecordConsentParams {
  contact_id: string
  consent_type: ConsentType
  channel?: ConsentChannel
  is_granted?: boolean
  consent_text?: string
  consent_version?: string
  collection_method: CollectionMethod
  collection_url?: string
  recording_url?: string
  document_url?: string
  ip_address?: string
  user_agent?: string
  evidence?: Record<string, unknown>
  expires_in_days?: number
  collected_by?: string
}

export interface RevokeConsentParams {
  contact_id: string
  channel?: ConsentChannel
  reason?: string
}

export async function fetchConsentsForContact(
  params: ConsentListParams,
  signal?: AbortSignal
): Promise<{ consents: ConsentRecord[] }> {
  const search = new URLSearchParams()
  search.set('contact_id', params.contact_id)
  if (params.include_revoked !== undefined) {
    search.set('include_revoked', String(params.include_revoked))
  }
  if (params.org_id) search.set('org_id', params.org_id)

  return apiRequest<{ consents: ConsentRecord[] }>(`/compliance/consents?${search.toString()}`, {
    signal
  })
}

export async function fetchConsentStats(signal?: AbortSignal): Promise<ConsentStats> {
  return apiRequest<ConsentStats>('/compliance/consents/stats', { signal })
}

export async function recordConsent(
  params: RecordConsentParams,
  signal?: AbortSignal
): Promise<ConsentRecord> {
  return apiRequest<ConsentRecord>('/compliance/consents', {
    method: 'POST',
    body: params,
    signal
  })
}

export async function revokeConsent(
  params: RevokeConsentParams,
  signal?: AbortSignal
): Promise<{ revoked: number }> {
  return apiRequest<{ revoked: number }>('/compliance/consents', {
    method: 'DELETE',
    body: params,
    signal
  })
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditSearchParams {
  org_id?: string
  user_id?: string
  entity_type?: string
  entity_id?: string
  action?: string
  start_date?: string
  end_date?: string
  ip_address?: string
  request_id?: string
  page?: number
  limit?: number
  sort_order?: 'asc' | 'desc'
}

export interface AuditSearchResponse {
  logs: AuditLog[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface AuditExportParams {
  start_date: string
  end_date: string
  format?: 'json' | 'csv'
  entity_type?: string
  user_id?: string
  action?: string
  org_id?: string
}

export async function fetchAuditLogs(
  params: AuditSearchParams = {},
  signal?: AbortSignal
): Promise<AuditSearchResponse> {
  const search = new URLSearchParams()
  if (params.org_id) search.set('org_id', params.org_id)
  if (params.user_id) search.set('user_id', params.user_id)
  if (params.entity_type) search.set('entity_type', params.entity_type)
  if (params.entity_id) search.set('entity_id', params.entity_id)
  if (params.action) search.set('action', params.action)
  if (params.start_date) search.set('start_date', params.start_date)
  if (params.end_date) search.set('end_date', params.end_date)
  if (params.ip_address) search.set('ip_address', params.ip_address)
  if (params.request_id) search.set('request_id', params.request_id)
  if (params.page) search.set('page', String(params.page))
  if (params.limit) search.set('limit', String(params.limit))
  if (params.sort_order) search.set('sort_order', params.sort_order)

  const query = search.toString()
  return apiRequest<AuditSearchResponse>(`/compliance/audit${query ? `?${query}` : ''}`, { signal })
}

export async function fetchAuditEntityHistory(
  entityType: string,
  entityId: string,
  options: { limit?: number } = {},
  signal?: AbortSignal
): Promise<{ logs: AuditLog[] }> {
  const search = new URLSearchParams()
  if (options.limit) search.set('limit', String(options.limit))
  const query = search.toString()
  return apiRequest<{ logs: AuditLog[] }>(
    `/compliance/audit/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(
      entityId
    )}${query ? `?${query}` : ''}`,
    { signal }
  )
}

/**
 * Build the URL for a CSV/JSON audit export. The export endpoint streams a
 * CSV Buffer (Content-Type: text/csv) when format=csv, so callers typically
 * trigger a browser download against this URL rather than fetching JSON.
 */
export function buildAuditExportUrl(params: AuditExportParams): string {
  const search = new URLSearchParams()
  search.set('start_date', params.start_date)
  search.set('end_date', params.end_date)
  if (params.format) search.set('format', params.format)
  if (params.entity_type) search.set('entity_type', params.entity_type)
  if (params.user_id) search.set('user_id', params.user_id)
  if (params.action) search.set('action', params.action)
  if (params.org_id) search.set('org_id', params.org_id)
  return `/compliance/audit/export?${search.toString()}`
}
