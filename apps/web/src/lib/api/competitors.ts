import type { CompetitorData, DataTier } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchCompetitors(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<CompetitorData[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  // The server wraps list results as { competitors, pagination }.
  const res = await apiRequest<CompetitorData[] | { competitors?: CompetitorData[] }>(
    '/competitors',
    { signal, headers }
  )
  return Array.isArray(res) ? res : (res?.competitors ?? [])
}
