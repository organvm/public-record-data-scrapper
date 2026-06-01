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

  const fetchData = useCallback(
    async ({ signal, silent }: { signal?: AbortSignal; silent?: boolean } = {}) => {
      if (!silent) {
        setIsLoading(true)
      }
      setLoadError(null)

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

        const message = error instanceof Error ? error.message : 'Failed to load data'
        setLoadError(message)
        console.error('Failed to load datasets', error)
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    lastDataRefresh: lastDataRefresh || new Date().toISOString(),
    setProspects: setProspects as UseDataFetchingResult['setProspects'],
    setCompetitors: setCompetitors as UseDataFetchingResult['setCompetitors'],
    setPortfolio: setPortfolio as UseDataFetchingResult['setPortfolio'],
    setUserActions: setUserActions as UseDataFetchingResult['setUserActions'],
    fetchData
  }
}
