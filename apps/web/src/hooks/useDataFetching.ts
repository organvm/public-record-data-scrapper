import { useState, useCallback, useEffect } from 'react'
import { useSafeKV as useKV } from '@/hooks/useSparkKV'
import {
  generateProspects,
  generateCompetitorData,
  generatePortfolioCompanies
} from '@/lib/mockData'
import { Prospect, CompetitorData, PortfolioCompany, DataTier } from '@public-records/core'
import { UserAction } from '@/lib/agentic/types'
import { fetchProspects } from '@/lib/api/prospects'
import { fetchCompetitors } from '@/lib/api/competitors'
import { fetchPortfolio } from '@/lib/api/portfolio'
import { fetchUserActions } from '@/lib/api/userActions'

export interface UseDataFetchingOptions {
  useMockData: boolean
  dataTier?: DataTier
}

export interface UseDataFetchingResult {
  prospects: Prospect[]
  competitors: CompetitorData[]
  portfolio: PortfolioCompany[]
  userActions: UserAction[]
  isLoading: boolean
  loadError: string | null
  /** True when the live API was unreachable and demo data is being shown instead. */
  isDemoFallback: boolean
  lastDataRefresh: string
  setProspects: (updater: Prospect[] | ((prev: Prospect[]) => Prospect[])) => void
  setCompetitors: (
    updater: CompetitorData[] | ((prev: CompetitorData[]) => CompetitorData[])
  ) => void
  setPortfolio: (
    updater: PortfolioCompany[] | ((prev: PortfolioCompany[]) => PortfolioCompany[])
  ) => void
  setUserActions: (updater: UserAction[] | ((prev: UserAction[]) => UserAction[])) => void
  fetchData: (options?: { signal?: AbortSignal; silent?: boolean }) => Promise<boolean>
}

export function useDataFetching({
  useMockData,
  dataTier = 'oss'
}: UseDataFetchingOptions): UseDataFetchingResult {
  const [prospects, setProspects] = useKV<Prospect[]>('ucc-prospects', [])
  const [competitors, setCompetitors] = useKV<CompetitorData[]>('competitor-data', [])
  const [portfolio, setPortfolio] = useKV<PortfolioCompany[]>('portfolio-companies', [])
  const [userActions, setUserActions] = useKV<UserAction[]>('user-actions', [])
  const [lastDataRefresh, setLastDataRefresh] = useKV<string>(
    'last-data-refresh',
    new Date().toISOString()
  )

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDemoFallback, setIsDemoFallback] = useState(false)

  const fetchData = useCallback(
    async ({ signal, silent }: { signal?: AbortSignal; silent?: boolean } = {}) => {
      if (!silent) {
        setIsLoading(true)
      }
      setLoadError(null)
      setIsDemoFallback(false)

      try {
        if (useMockData) {
          const [mockProspects, mockCompetitors, mockPortfolio] = [
            generateProspects(24, { dataTier }),
            generateCompetitorData({ dataTier }),
            generatePortfolioCompanies(15, { dataTier })
          ]

          if (signal?.aborted) {
            return false
          }

          setProspects(mockProspects)
          setCompetitors(mockCompetitors)
          setPortfolio(mockPortfolio)
          setLastDataRefresh(new Date().toISOString())
          return true
        }

        // Guard: on a static production deploy (GitHub Pages, Cloudflare Pages, etc.)
        // there is no backend reachable at the default `/api` path.  Firing the
        // request would produce a 404 + an ApiError in the console even though the
        // catch block recovers gracefully.  Skip straight to demo data when we are
        // in a production build AND no explicit API base URL was configured — those
        // two facts together mean the call is guaranteed to fail.
        const hasApiBase = Boolean(import.meta.env.VITE_API_BASE_URL)
        if (import.meta.env.PROD && !hasApiBase) {
          if (!signal?.aborted) {
            const [demoProspects, demoCompetitors, demoPortfolio] = [
              generateProspects(12, { dataTier }),
              generateCompetitorData({ dataTier }),
              generatePortfolioCompanies(8, { dataTier })
            ]
            setProspects(demoProspects)
            setCompetitors(demoCompetitors)
            setPortfolio(demoPortfolio)
            setLastDataRefresh(new Date().toISOString())
            setIsDemoFallback(true)
          }
          return !signal?.aborted
        }

        const [liveProspects, liveCompetitors, livePortfolio, liveUserActions] = await Promise.all([
          fetchProspects(signal, { dataTier }),
          fetchCompetitors(signal, { dataTier }),
          fetchPortfolio(signal, { dataTier }),
          fetchUserActions(signal, { dataTier })
        ])

        if (signal?.aborted) {
          return false
        }

        setProspects(liveProspects)
        setCompetitors(liveCompetitors)
        setPortfolio(livePortfolio)
        setUserActions(liveUserActions)
        setLastDataRefresh(new Date().toISOString())
        return true
      } catch (error) {
        if (signal?.aborted) {
          return false
        }

        // Live API unreachable — load demo data so the product looks functional
        // to first-time visitors instead of showing a scary red error banner.
        console.error('Failed to load datasets — falling back to demo data', error)
        try {
          const [demoProspects, demoCompetitors, demoPortfolio] = [
            generateProspects(12, { dataTier }),
            generateCompetitorData({ dataTier }),
            generatePortfolioCompanies(8, { dataTier })
          ]
          if (!signal?.aborted) {
            setProspects(demoProspects)
            setCompetitors(demoCompetitors)
            setPortfolio(demoPortfolio)
            setLastDataRefresh(new Date().toISOString())
            setIsDemoFallback(true)
          }
        } catch (fallbackError) {
          // If even demo generation fails, surface the original error.
          console.error('Demo fallback also failed', fallbackError)
          const message = error instanceof Error ? error.message : 'Failed to load data'
          setLoadError(message)
        }
        return false
      } finally {
        if (!silent && !signal?.aborted) {
          setIsLoading(false)
        }
      }
    },
    [
      useMockData,
      dataTier,
      setProspects,
      setCompetitors,
      setPortfolio,
      setUserActions,
      setLastDataRefresh
    ]
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchData({ signal: controller.signal })
    return () => controller.abort()
  }, [fetchData])

  return {
    prospects: prospects || [],
    competitors: competitors || [],
    portfolio: portfolio || [],
    userActions: userActions || [],
    isLoading,
    loadError,
    isDemoFallback,
    lastDataRefresh: lastDataRefresh || new Date().toISOString(),
    setProspects: setProspects as UseDataFetchingResult['setProspects'],
    setCompetitors: setCompetitors as UseDataFetchingResult['setCompetitors'],
    setPortfolio: setPortfolio as UseDataFetchingResult['setPortfolio'],
    setUserActions: setUserActions as UseDataFetchingResult['setUserActions'],
    fetchData
  }
}
