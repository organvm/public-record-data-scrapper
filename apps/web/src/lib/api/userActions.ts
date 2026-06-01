import type { UserAction } from '@/lib/agentic/types'
import type { DataTier } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchUserActions(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<UserAction[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  return apiRequest<UserAction[]>('/user-actions', { signal, headers })
}

export async function logUserAction(action: UserAction, signal?: AbortSignal): Promise<UserAction> {
  return apiRequest<UserAction>('/user-actions', {
    method: 'POST',
    body: action as unknown as Record<string, unknown>,
    signal
  })
}
