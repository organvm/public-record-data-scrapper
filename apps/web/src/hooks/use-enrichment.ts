/**
 * Enrichment Service Hook
 *
 * React hook for using the enrichment pipeline in the UI
 */

import { useState } from 'react'
import { EnrichmentOrchestratorAgent } from '../lib/agentic'
import { EnrichmentRequest, EnrichmentResult } from '../lib/agentic/types'

export interface UseEnrichmentResult {
  enrich: (request: EnrichmentRequest) => Promise<void>
  loading: boolean
  error: string | null
  result: EnrichmentResult | null
  progress: unknown[]
}

export function useEnrichment(): UseEnrichmentResult {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<EnrichmentResult | null>(null)
  const [progress, setProgress] = useState<unknown[]>([])

  const enrich = async (request: EnrichmentRequest) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setProgress([])

    try {
      const orchestrator = new EnrichmentOrchestratorAgent()
      const taskResult = await orchestrator.executeTask({
        type: 'enrich-prospect',
        payload: request as unknown as Record<string, unknown>
      })

      if (taskResult.success) {
        setResult(taskResult.data as unknown as EnrichmentResult)
        const data = taskResult.data as Record<string, unknown> | undefined
        setProgress((data?.progress as unknown[]) || [])
      } else {
        setError(taskResult.error || 'Enrichment failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return {
    enrich,
    loading,
    error,
    result,
    progress
  }
}
