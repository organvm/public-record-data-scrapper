import type { DataTier, Prospect } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchProspects(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<Prospect[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  return apiRequest<Prospect[]>('/prospects', { signal, headers })
}

/**
 * Fetch a single prospect by id. Mirrors GET /api/prospects/:id, which returns
 * the canonical camelCase Prospect (including `state`). Throws ApiError (404
 * "Prospect not found") which callers surface verbatim — no placeholder is
 * invented client-side.
 */
export async function fetchProspect(prospectId: string, signal?: AbortSignal): Promise<Prospect> {
  return apiRequest<Prospect>(`/prospects/${encodeURIComponent(prospectId)}`, { signal })
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
