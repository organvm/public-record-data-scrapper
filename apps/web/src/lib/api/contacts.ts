import { apiRequest } from './client'

// Contact types
export interface Contact {
  id: string
  org_id: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  phone_ext?: string
  mobile?: string
  title?: string
  role?: ContactRole
  preferred_contact_method: ContactMethod
  timezone: string
  notes?: string
  tags: string[]
  source?: string
  is_active: boolean
  total_activities: number
  last_contacted_at?: string
  created_at: string
  updated_at: string
  created_by?: string
}

export type ContactRole =
  | 'owner'
  | 'ceo'
  | 'cfo'
  | 'controller'
  | 'manager'
  | 'bookkeeper'
  | 'other'
export type ContactMethod = 'email' | 'phone' | 'mobile' | 'sms'
export type ContactRelationship =
  | 'owner'
  | 'decision_maker'
  | 'influencer'
  | 'employee'
  | 'advisor'
  | 'other'

export interface ContactActivity {
  id: string
  contact_id: string
  prospect_id?: string
  user_id?: string
  activity_type: string
  subject?: string
  description?: string
  outcome?: string
  duration_seconds?: number
  metadata: Record<string, unknown>
  scheduled_at?: string
  completed_at?: string
  created_at: string
}

export interface ContactListParams {
  org_id: string
  page?: number
  limit?: number
  search?: string
  role?: ContactRole
  tags?: string[]
  is_active?: boolean
  sort_by?: 'first_name' | 'last_name' | 'created_at' | 'last_contacted_at'
  sort_order?: 'asc' | 'desc'
}

export interface ContactListResponse {
  contacts: Contact[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface CreateContactParams {
  org_id: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  phone_ext?: string
  mobile?: string
  title?: string
  role?: ContactRole
  preferred_contact_method?: ContactMethod
  timezone?: string
  notes?: string
  tags?: string[]
  source?: string
  created_by?: string
}

export interface UpdateContactParams {
  first_name?: string
  last_name?: string
  email?: string | null
  phone?: string | null
  phone_ext?: string | null
  mobile?: string | null
  title?: string | null
  role?: ContactRole | null
  preferred_contact_method?: ContactMethod
  timezone?: string
  notes?: string | null
  tags?: string[]
  is_active?: boolean
}

export interface LinkContactParams {
  is_primary?: boolean
  relationship?: ContactRelationship
}

export interface LogActivityParams {
  prospect_id?: string
  user_id?: string
  activity_type: string
  subject?: string
  description?: string
  outcome?: string
  duration_seconds?: number
  metadata?: Record<string, unknown>
  scheduled_at?: string
  completed_at?: string
}

export interface ContactWithActivities extends Contact {
  activities: ContactActivity[]
}

// API Functions

export async function fetchContacts(
  params: ContactListParams,
  signal?: AbortSignal
): Promise<ContactListResponse> {
  const searchParams = new URLSearchParams()
  searchParams.set('org_id', params.org_id)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.limit) searchParams.set('limit', String(params.limit))
  if (params.search) searchParams.set('search', params.search)
  if (params.role) searchParams.set('role', params.role)
  if (params.tags?.length) searchParams.set('tags', params.tags.join(','))
  if (params.is_active !== undefined) searchParams.set('is_active', String(params.is_active))
  if (params.sort_by) searchParams.set('sort_by', params.sort_by)
  if (params.sort_order) searchParams.set('sort_order', params.sort_order)

  return apiRequest<ContactListResponse>(`/contacts?${searchParams.toString()}`, { signal })
}

export async function fetchContact(
  id: string,
  orgId: string,
  signal?: AbortSignal
): Promise<ContactWithActivities> {
  return apiRequest<ContactWithActivities>(
    `/contacts/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgId)}`,
    { signal }
  )
}

export async function createContact(
  params: CreateContactParams,
  signal?: AbortSignal
): Promise<Contact> {
  return apiRequest<Contact>('/contacts', {
    method: 'POST',
    body: params as unknown as Record<string, unknown>,
    signal
  })
}

export async function updateContact(
  id: string,
  orgId: string,
  params: UpdateContactParams,
  signal?: AbortSignal
): Promise<Contact> {
  return apiRequest<Contact>(
    `/contacts/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgId)}`,
    {
      method: 'PUT',
      body: params as unknown as Record<string, unknown>,
      signal
    }
  )
}

export async function linkContactToProspect(
  contactId: string,
  prospectId: string,
  params: LinkContactParams = {},
  signal?: AbortSignal
): Promise<unknown> {
  return apiRequest(
    `/contacts/${encodeURIComponent(contactId)}/link/${encodeURIComponent(prospectId)}`,
    {
      method: 'POST',
      body: params as unknown as Record<string, unknown>,
      signal
    }
  )
}

export async function unlinkContactFromProspect(
  contactId: string,
  prospectId: string,
  signal?: AbortSignal
): Promise<void> {
  await apiRequest(
    `/contacts/${encodeURIComponent(contactId)}/link/${encodeURIComponent(prospectId)}`,
    {
      method: 'DELETE',
      signal
    }
  )
}

export async function logContactActivity(
  contactId: string,
  params: LogActivityParams,
  signal?: AbortSignal
): Promise<ContactActivity> {
  return apiRequest<ContactActivity>(`/contacts/${encodeURIComponent(contactId)}/activities`, {
    method: 'POST',
    body: params as unknown as Record<string, unknown>,
    signal
  })
}

export async function fetchContactActivities(
  contactId: string,
  options: { limit?: number; before?: string } = {},
  signal?: AbortSignal
): Promise<{ activities: ContactActivity[] }> {
  const searchParams = new URLSearchParams()
  if (options.limit) searchParams.set('limit', String(options.limit))
  if (options.before) searchParams.set('before', options.before)

  const query = searchParams.toString()
  const path = `/contacts/${encodeURIComponent(contactId)}/activities${query ? `?${query}` : ''}`
  return apiRequest<{ activities: ContactActivity[] }>(path, { signal })
}

export async function fetchContactsForProspect(
  prospectId: string,
  signal?: AbortSignal
): Promise<{ contacts: Contact[] }> {
  return apiRequest<{ contacts: Contact[] }>(
    `/contacts/by-prospect/${encodeURIComponent(prospectId)}`,
    { signal }
  )
}
