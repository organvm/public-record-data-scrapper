import { useState, useEffect, useCallback, useMemo } from 'react'
import type {
  Prospect,
  CompanyGraph,
  CompetitorData,
  IndustryType,
  GrowthSignal,
  IndustryTrend,
  PersonalizedRecommendation,
  GenerativeNarrative,
  SignalChain,
  GenerativeReport,
  RecursiveEnrichmentResult,
  NetworkRequalification,
  UserProfile,
  RecursiveTraversalConfig,
  RecursiveSignalConfig
} from '@public-records/core'
import { RecursiveRelationshipMapper } from '../services/RecursiveRelationshipMapper'
import { GenerativeNarrativeEngine } from '../services/GenerativeNarrativeEngine'
import { PersonalizedRecommendationEngine } from '../services/PersonalizedRecommendationEngine'
import { RecursiveSignalDetector } from '../services/RecursiveSignalDetector'
import { GenerativeReportBuilder } from '../services/GenerativeReportBuilder'
import { RecursiveEnrichmentEngine } from '../services/RecursiveEnrichmentEngine'
import { RecursiveLeadRequalifier } from '../services/RecursiveLeadRequalifier'
import { UserProfileManager } from '../services/UserProfileManager'

/**
 * Hook for recursive relationship mapping
 */
export function useRelationshipGraph(prospects: Prospect[]) {
  const [graphs, setGraphs] = useState<Map<string, CompanyGraph>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildGraph = useCallback(
    async (prospectId: string, config?: Partial<RecursiveTraversalConfig>) => {
      setLoading(true)
      setError(null)

      try {
        const mapper = new RecursiveRelationshipMapper(prospects)
        const graph = await mapper.buildRelationshipGraph(prospectId, {
          maxDepth: config?.maxDepth || 3,
          relationshipTypes: config?.relationshipTypes || [
            'parent',
            'subsidiary',
            'affiliate',
            'common_secured_party'
          ],
          includeProspectData: config?.includeProspectData !== false,
          stopConditions: config?.stopConditions
        })

        setGraphs((prev) => new Map(prev).set(prospectId, graph))
        return graph
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to build relationship graph'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects]
  )

  const getGraph = useCallback(
    (prospectId: string) => {
      return graphs.get(prospectId)
    },
    [graphs]
  )

  return {
    graphs,
    buildGraph,
    getGraph,
    loading,
    error
  }
}

/**
 * Hook for personalized recommendations
 */
export function usePersonalizedRecommendations(
  prospects: Prospect[],
  userProfile: UserProfile,
  relationshipGraphs?: Map<string, CompanyGraph>
) {
  const [recommendations, setRecommendations] = useState<PersonalizedRecommendation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateRecommendations = useCallback(
    async (limit: number = 20) => {
      setLoading(true)
      setError(null)

      try {
        const engine = new PersonalizedRecommendationEngine(
          userProfile,
          prospects,
          relationshipGraphs
        )
        const recs = await engine.generateRecommendations(limit, {
          excludeClaimed: true,
          minScore: 60
        })

        setRecommendations(recs)
        return recs
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate recommendations'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects, userProfile, relationshipGraphs]
  )

  useEffect(() => {
    if (prospects.length > 0 && userProfile) {
      void generateRecommendations()
    }
  }, [prospects, userProfile, generateRecommendations])

  return {
    recommendations,
    generateRecommendations,
    loading,
    error
  }
}

/**
 * Hook for generative narratives
 */
export function useGenerativeNarrative() {
  const [narratives, setNarratives] = useState<Map<string, GenerativeNarrative>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateNarrative = useCallback(
    async (
      prospect: Prospect,
      context?: {
        marketData?: CompetitorData[]
        relationships?: CompanyGraph
        historicalSignals?: GrowthSignal[]
        industryTrends?: IndustryTrend[]
      }
    ) => {
      setLoading(true)
      setError(null)

      try {
        const engine = new GenerativeNarrativeEngine()
        const narrative = await engine.generateNarrative({
          prospect,
          ...context
        })

        setNarratives((prev) => new Map(prev).set(prospect.id, narrative))
        return narrative
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate narrative'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    []
  )

  const getNarrative = useCallback(
    (prospectId: string) => {
      return narratives.get(prospectId)
    },
    [narratives]
  )

  return {
    narratives,
    generateNarrative,
    getNarrative,
    loading,
    error
  }
}

/**
 * Hook for recursive signal detection
 */
export function useSignalChains(prospects: Prospect[]) {
  const [chains, setChains] = useState<Map<string, SignalChain[]>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const detectChains = useCallback(
    async (prospectId: string, config?: Partial<RecursiveSignalConfig>) => {
      setLoading(true)
      setError(null)

      try {
        const detector = new RecursiveSignalDetector(prospects)
        const signalChains = await detector.detectSignalChains(prospectId, {
          maxDepth: config?.maxDepth || 3,
          minConfidence: config?.minConfidence || 0.5,
          signalTriggers: config?.signalTriggers || {
            hiring: ['expansion', 'equipment'],
            expansion: ['equipment', 'permit', 'hiring'],
            equipment: ['hiring'],
            permit: ['equipment', 'expansion'],
            contract: ['hiring', 'expansion']
          },
          correlationThreshold: config?.correlationThreshold || 0.6
        })

        setChains((prev) => new Map(prev).set(prospectId, signalChains))
        return signalChains
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to detect signal chains'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects]
  )

  const getChains = useCallback(
    (prospectId: string) => {
      return chains.get(prospectId) || []
    },
    [chains]
  )

  return {
    chains,
    detectChains,
    getChains,
    loading,
    error
  }
}

/**
 * Hook for generative reports
 */
export function useGenerativeReports(
  prospects: Prospect[],
  competitorData?: CompetitorData[],
  relationshipGraphs?: Map<string, CompanyGraph>
) {
  const [reports, setReports] = useState<GenerativeReport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generateReport = useCallback(
    async (
      type: 'portfolio' | 'market' | 'prospect' | 'competitive',
      options: {
        prospectId?: string
        industry?: string
        userId?: string
      } = {}
    ) => {
      setLoading(true)
      setError(null)

      try {
        const narrativeEngine = new GenerativeNarrativeEngine()
        const builder = new GenerativeReportBuilder(
          prospects,
          narrativeEngine,
          competitorData,
          relationshipGraphs
        )

        let report: GenerativeReport

        switch (type) {
          case 'portfolio':
            report = await builder.generatePortfolioReport(
              { start: '', end: '' },
              options.userId || 'default'
            )
            break
          case 'market':
            report = await builder.generateMarketReport(
              options.industry as IndustryType | undefined,
              options.userId
            )
            break
          case 'prospect':
            if (!options.prospectId) throw new Error('Prospect ID required')
            report = await builder.generateProspectReport(
              options.prospectId,
              options.userId || 'default'
            )
            break
          case 'competitive':
            report = await builder.generateCompetitiveReport(options.userId || 'default')
            break
        }

        setReports((prev) => [...prev, report])
        return report
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate report'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects, competitorData, relationshipGraphs]
  )

  return {
    reports,
    generateReport,
    loading,
    error
  }
}

/**
 * Hook for recursive enrichment
 */
export function useRecursiveEnrichment(prospects: Prospect[]) {
  const [results, setResults] = useState<Map<string, RecursiveEnrichmentResult>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enrichProspect = useCallback(
    async (prospectId: string, maxDepth: number = 3) => {
      setLoading(true)
      setError(null)

      try {
        const engine = new RecursiveEnrichmentEngine(prospects)
        const result = await engine.enrichProspectRecursively(prospectId, maxDepth)

        setResults((prev) => new Map(prev).set(prospectId, result))
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to enrich prospect'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects]
  )

  const getResult = useCallback(
    (prospectId: string) => {
      return results.get(prospectId)
    },
    [results]
  )

  return {
    results,
    enrichProspect,
    getResult,
    loading,
    error
  }
}

/**
 * Hook for network requalification
 */
export function useNetworkRequalification(prospects: Prospect[]) {
  const [results, setResults] = useState<Map<string, NetworkRequalification>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requalifyLead = useCallback(
    async (leadId: string, maxDepth: number = 2) => {
      setLoading(true)
      setError(null)

      try {
        const mapper = new RecursiveRelationshipMapper(prospects)
        const requalifier = new RecursiveLeadRequalifier(prospects, mapper)
        const result = await requalifier.requalifyWithNetwork(leadId, maxDepth)

        setResults((prev) => new Map(prev).set(leadId, result))
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to requalify lead'
        setError(message)
        throw err
      } finally {
        setLoading(false)
      }
    },
    [prospects]
  )

  const getResult = useCallback(
    (leadId: string) => {
      return results.get(leadId)
    },
    [results]
  )

  return {
    results,
    requalifyLead,
    getResult,
    loading,
    error
  }
}

/**
 * Hook for user profile management
 */
export function useUserProfile(userId: string) {
  const [manager] = useState(() => new UserProfileManager())
  const [version, setVersion] = useState(0)

  const profile = useMemo(() => {
    void version
    return manager.getUserProfile(userId)
  }, [manager, userId, version])

  const updatePreferences = (preferences: Partial<UserProfile['preferences']>) => {
    const updated = manager.updatePreferences(userId, preferences)
    setVersion((current) => current + 1)
    return updated
  }

  const recordAction = (action: Parameters<typeof manager.recordAction>[1]) => {
    const updated = manager.recordAction(userId, action)
    setVersion((current) => current + 1)
    return updated
  }

  const saveFilter = (filter: Parameters<typeof manager.saveFilter>[1]) => {
    const updated = manager.saveFilter(userId, filter)
    setVersion((current) => current + 1)
    return updated
  }

  const updateDashboardLayout = (layout: UserProfile['dashboardLayout']) => {
    const updated = manager.updateDashboardLayout(userId, layout)
    setVersion((current) => current + 1)
    return updated
  }

  const updateNotificationSettings = (settings: Partial<UserProfile['notificationSettings']>) => {
    const updated = manager.updateNotificationSettings(userId, settings)
    setVersion((current) => current + 1)
    return updated
  }

  const learnPreferences = () => {
    const updated = manager.learnPreferences(userId)
    setVersion((current) => current + 1)
    return updated
  }

  return {
    profile,
    updatePreferences,
    recordAction,
    saveFilter,
    updateDashboardLayout,
    updateNotificationSettings,
    learnPreferences,
    manager
  }
}

/**
 * Comprehensive hook that integrates all recursive features
 */
export function useRecursiveIntelligence(prospects: Prospect[], userId: string) {
  const { profile, ...profileMethods } = useUserProfile(userId)
  const relationshipGraphs = useRelationshipGraph(prospects)
  const recommendations = usePersonalizedRecommendations(
    prospects,
    profile!,
    relationshipGraphs.graphs
  )
  const narratives = useGenerativeNarrative()
  const signalChains = useSignalChains(prospects)
  const reports = useGenerativeReports(prospects, undefined, relationshipGraphs.graphs)
  const enrichment = useRecursiveEnrichment(prospects)
  const requalification = useNetworkRequalification(prospects)

  return {
    // User profile
    profile,
    ...profileMethods,

    // Relationship graphs
    relationshipGraphs,

    // Recommendations
    recommendations,

    // Narratives
    narratives,

    // Signal chains
    signalChains,

    // Reports
    reports,

    // Enrichment
    enrichment,

    // Requalification
    requalification
  }
}
