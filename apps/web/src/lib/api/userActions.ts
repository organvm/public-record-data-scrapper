import type { UserAction } from '@/lib/agentic/types'
import type { DataTier } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchUserActions(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<UserAction[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  try {
    const res = await apiRequest<
      UserAction[] | { userActions?: UserAction[]; actions?: UserAction[] }
    >('/user-actions', { signal, headers })
    return Array.isArray(res) ? res : (res?.userActions ?? res?.actions ?? [])
  } catch (error) {
    if (signal?.aborted) throw error
    // The /user-actions route may not be mounted yet. User actions are
    // non-critical telemetry — never let a 404 here sink the dashboard load.
    return []
  }
}

export async function logUserAction(action: UserAction, signal?: AbortSignal): Promise<UserAction> {
  return apiRequest<UserAction>('/user-actions', {
    method: 'POST',
    body: action as unknown as Record<string, unknown>,
    signal
  })
}
