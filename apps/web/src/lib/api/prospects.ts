import type { DataTier, Prospect } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchProspects(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<Prospect[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  // The server wraps list results as { prospects, pagination }; tolerate both
  // a bare array and the wrapped object so the UI always receives an array.
  const res = await apiRequest<Prospect[] | { prospects?: Prospect[] }>('/prospects', {
    signal,
    headers
  })
  return Array.isArray(res) ? res : (res?.prospects ?? [])
}

export async function claimProspect(
  prospectId: string,
  user: string,
  signal?: AbortSignal
): Promise<Prospect> {
  return apiRequest<Prospect>(`/prospects/${encodeURIComponent(prospectId)}/claim`, {
    method: 'POST',
    body: { user },
    signal
  })
}

export async function unclaimProspect(prospectId: string, signal?: AbortSignal): Promise<Prospect> {
  return apiRequest<Prospect>(`/prospects/${encodeURIComponent(prospectId)}/unclaim`, {
    method: 'POST',
    signal
  })
}

export async function batchClaimProspects(
  ids: string[],
  user: string,
  signal?: AbortSignal
): Promise<Prospect[]> {
  return apiRequest<Prospect[]>('/prospects/batch/claim', {
    method: 'POST',
    body: { ids, user },
    signal
  })
}

export async function deleteProspects(ids: string[], signal?: AbortSignal): Promise<void> {
  await apiRequest<unknown>('/prospects/batch', {
    method: 'DELETE',
    body: { ids },
    signal
  })
}
