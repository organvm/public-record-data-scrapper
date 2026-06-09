import { apiRequest } from './client'

// ============================================================================
// Communications API client
//
// Casing note: unlike the contacts client (which mirrors snake_case SQL rows),
// the communications ROUTE serializes the service's already-camelCase
// `Communication` / `CommunicationTemplate` output verbatim. So these row types
// are camelCase and align 1:1 with the canonical `@public-records/core` types —
// no snake→camel mapper is needed in the wiring layer for communications.
//
// REQUEST params, however, follow the house snake_case convention (matching the
// route's zod schemas and the contacts client), so the server can cross-check a
// supplied org_id against the token.
// ============================================================================

export type CommunicationChannel = 'email' | 'sms' | 'call'
export type CommunicationDirection = 'inbound' | 'outbound'
export type CommunicationStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'failed'
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'busy'
  | 'received'

export type TemplateCategory =
  | 'initial_outreach'
  | 'follow_up'
  | 'application_request'
  | 'document_request'
  | 'approval_notification'
  | 'funding_notification'
  | 'check_in'
  | 'renewal'
  | 'other'

export interface CommunicationAttachment {
  name: string
  url: string
  size: number
  mimeType: string
}

// camelCase — matches the service's transformCommunication output exactly.
export interface Communication {
  id: string
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  templateId?: string
  sentBy?: string
  channel: CommunicationChannel
  direction: CommunicationDirection
  fromAddress?: string
  toAddress?: string
  ccAddresses?: string[]
  bccAddresses?: string[]
  subject?: string
  fromPhone?: string
  toPhone?: string
  body?: string
  bodyHtml?: string
  attachments: CommunicationAttachment[]
  status: CommunicationStatus
  statusReason?: string
  callDurationSeconds?: number
  callRecordingUrl?: string
  externalId?: string
  openedAt?: string
  clickedAt?: string
  deliveredAt?: string
  failedAt?: string
  failureReason?: string
  receivedAt?: string
  scheduledFor?: string
  sentAt?: string
  metadata: Record<string, unknown>
  createdAt: string
}

// camelCase — matches the service's transformTemplate output exactly.
export interface CommunicationTemplate {
  id: string
  orgId: string
  name: string
  description?: string
  channel: CommunicationChannel | 'call_script'
  category?: TemplateCategory
  subject?: string
  body: string
  variables: string[]
  isActive: boolean
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface ScheduledFollowUp {
  id: string
  scheduledFor: string
  channel: CommunicationChannel
  templateId?: string
}

export interface CommunicationListParams {
  org_id?: string
  page?: number
  limit?: number
  contact_id?: string
  prospect_id?: string
  deal_id?: string
  channel?: CommunicationChannel
  direction?: CommunicationDirection
  status?: CommunicationStatus
}

export interface CommunicationListResponse {
  communications: Communication[]
  total: number
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface SendEmailParams {
  org_id?: string
  contact_id?: string
  prospect_id?: string
  deal_id?: string
  template_id?: string
  sent_by?: string
  to_address: string
  cc_addresses?: string[]
  bcc_addresses?: string[]
  subject: string
  body: string
  body_html?: string
  attachments?: CommunicationAttachment[]
  scheduled_for?: string
  metadata?: Record<string, unknown>
}

export interface SendSmsParams {
  org_id?: string
  contact_id?: string
  prospect_id?: string
  deal_id?: string
  template_id?: string
  sent_by?: string
  to_phone: string
  body: string
  scheduled_for?: string
  metadata?: Record<string, unknown>
}

export interface CreateFollowUpParams {
  org_id?: string
  contact_id: string
  deal_id?: string
  channel: CommunicationChannel
  template_id?: string
  scheduled_for: string
  created_by?: string
}

// ============================================================================
// API functions
// ============================================================================

export async function fetchCommunications(
  params: CommunicationListParams = {},
  signal?: AbortSignal
): Promise<CommunicationListResponse> {
  const searchParams = new URLSearchParams()
  // org_id is optional client-side: the server derives the tenant from the
  // authenticated token and only validates a supplied org_id for a match.
  // Sending an empty value would fail that match check, so omit when blank.
  if (params.org_id) searchParams.set('org_id', params.org_id)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.contact_id) searchParams.set('contact_id', params.contact_id)
  if (params.prospect_id) searchParams.set('prospect_id', params.prospect_id)
  if (params.deal_id) searchParams.set('deal_id', params.deal_id)
  if (params.channel) searchParams.set('channel', params.channel)
  if (params.direction) searchParams.set('direction', params.direction)
  if (params.status) searchParams.set('status', params.status)

  const query = searchParams.toString()
  return apiRequest<CommunicationListResponse>(`/communications${query ? `?${query}` : ''}`, {
    signal
  })
}

export async function fetchCommunication(
  id: string,
  orgId?: string,
  signal?: AbortSignal
): Promise<Communication> {
  const query = orgId ? `?org_id=${encodeURIComponent(orgId)}` : ''
  return apiRequest<Communication>(`/communications/${encodeURIComponent(id)}${query}`, { signal })
}

export async function fetchCommunicationTemplates(
  params: { org_id?: string; channel?: CommunicationChannel } = {},
  signal?: AbortSignal
): Promise<{ templates: CommunicationTemplate[] }> {
  const searchParams = new URLSearchParams()
  if (params.org_id) searchParams.set('org_id', params.org_id)
  if (params.channel) searchParams.set('channel', params.channel)

  const query = searchParams.toString()
  return apiRequest<{ templates: CommunicationTemplate[] }>(
    `/communications/templates${query ? `?${query}` : ''}`,
    { signal }
  )
}

export async function sendEmail(
  params: SendEmailParams,
  signal?: AbortSignal
): Promise<Communication> {
  return apiRequest<Communication>('/communications/send-email', {
    method: 'POST',
    body: params,
    signal
  })
}

export async function sendSms(params: SendSmsParams, signal?: AbortSignal): Promise<Communication> {
  return apiRequest<Communication>('/communications/send-sms', {
    method: 'POST',
    body: params,
    signal
  })
}

export async function fetchPendingFollowUps(
  contactId: string,
  orgId?: string,
  signal?: AbortSignal
): Promise<{ followUps: ScheduledFollowUp[] }> {
  const searchParams = new URLSearchParams()
  searchParams.set('contact_id', contactId)
  if (orgId) searchParams.set('org_id', orgId)
  return apiRequest<{ followUps: ScheduledFollowUp[] }>(
    `/communications/follow-ups?${searchParams.toString()}`,
    { signal }
  )
}

export async function scheduleFollowUp(
  params: CreateFollowUpParams,
  signal?: AbortSignal
): Promise<ScheduledFollowUp> {
  return apiRequest<ScheduledFollowUp>('/communications/follow-ups', {
    method: 'POST',
    body: params,
    signal
  })
}

export async function cancelFollowUp(id: string, signal?: AbortSignal): Promise<void> {
  await apiRequest(`/communications/follow-ups/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    signal
  })
}
