import type { DataTier, PortfolioCompany } from '@public-records/core'
import { apiRequest } from './client'

export async function fetchPortfolio(
  signal?: AbortSignal,
  options: { dataTier?: DataTier } = {}
): Promise<PortfolioCompany[]> {
  const headers = options.dataTier ? { 'x-data-tier': options.dataTier } : undefined
  // The server wraps list results as { companies, pagination } (note the key).
  const res = await apiRequest<
    PortfolioCompany[] | { companies?: PortfolioCompany[]; portfolio?: PortfolioCompany[] }
  >('/portfolio', { signal, headers })
  return Array.isArray(res) ? res : (res?.companies ?? res?.portfolio ?? [])
}
