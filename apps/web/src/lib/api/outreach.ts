import { apiRequest } from './client'

// ---------------------------------------------------------------------------
// Pre-call briefing — mirrors server PreCallBriefingService.PreCallBriefing
// Endpoint: GET /api/outreach/briefing/:prospectId
// ---------------------------------------------------------------------------

export interface PreCallBriefing {
  prospectId: string
  generatedAt: string
  companyName: string
  state: string
  industry: string | null
  priorityScore: number | null
  stackAnalysis: {
    activeFilings: number
    terminatedFilings: number
    totalFilings: number
    knownCompetitors: string[]
  }
  freshCapacity: {
    score: number
    recentTerminations: number
    daysSinceLastTermination: number | null
  }
  velocity: {
    trend30d: string | null
    filings30d: number
    trend90d: string | null
  }
  talkingPoints: string[]
  riskFactors: string[]
}

// ---------------------------------------------------------------------------
// Prospect narrative — mirrors server NarrativeService.ProspectNarrative
// Endpoint: GET /api/outreach/narrative/:prospectId
// (Mounted server-side in server/routes/outreach.ts. An unknown prospect
// returns 404 and generation failures return 500; fetchNarrative surfaces the
// server error verbatim — no placeholder narrative is invented client-side.)
// ---------------------------------------------------------------------------

export interface NarrativeTalkingPoint {
  category: 'strength' | 'opportunity' | 'caution' | 'question'
  point: string
  priority: number
}

export interface NarrativeRiskFactor {
  factor: string
  severity: 'low' | 'medium' | 'high'
  mitigation?: string
}

export interface NarrativeObjectionHandler {
  objection: string
  response: string
  supportingData?: string
}

export interface NarrativeGrowthSignal {
  type: string
  description: string
  detectedDate: string
  score: number
  confidence: number
}

export interface ProspectNarrative {
  prospectId: string
  companyName: string
  summary: string
  detailedNarrative: string
  talkingPoints: NarrativeTalkingPoint[]
  isWhaleOpportunity: boolean
  whaleScore?: number
  whaleReasons?: string[]
  riskFactors: NarrativeRiskFactor[]
  riskLevel: 'low' | 'medium' | 'high'
  growthAnalysis: string
  topGrowthSignals: NarrativeGrowthSignal[]
  stackInsight: string
  suggestedPosition: string
  approachRecommendation: 'aggressive' | 'standard' | 'cautious' | 'pass'
  approachReasoning: string
  callOpeners: string[]
  potentialObjections: NarrativeObjectionHandler[]
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Active sequences — mirrors server OutreachSequenceService.getActiveSequences
// Endpoint: GET /api/outreach/sequences/:prospectId
// ---------------------------------------------------------------------------

export interface ActiveSequence {
  id: string
  triggerType: string
  status: string
  currentStep: number
  totalSteps: number
  createdAt: string
}

export interface SequencesResponse {
  sequences: ActiveSequence[]
  count: number
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * Fetch (or generate) the pre-call briefing for a prospect.
 * Server tries its 24h cache first, then generates fresh.
 * Throws ApiError (404 "Prospect not found", 500 "Failed to generate briefing")
 * which callers surface verbatim — no placeholder data is invented client-side.
 */
export async function fetchBriefing(
  prospectId: string,
  signal?: AbortSignal
): Promise<PreCallBriefing> {
  return apiRequest<PreCallBriefing>(`/outreach/briefing/${encodeURIComponent(prospectId)}`, {
    signal
  })
}

/**
 * Fetch the full sales narrative for a prospect.
 * Calls GET /api/outreach/narrative/:prospectId (mounted server-side, backed by
 * NarrativeService). Throws ApiError (404 "Prospect not found", 500 "Failed to
 * generate narrative") which callers surface verbatim — fail-closed, no
 * placeholder narrative is invented client-side.
 */
export async function fetchNarrative(
  prospectId: string,
  signal?: AbortSignal
): Promise<ProspectNarrative> {
  return apiRequest<ProspectNarrative>(`/outreach/narrative/${encodeURIComponent(prospectId)}`, {
    signal
  })
}

/**
 * List active/pending outreach sequences for a prospect.
 */
export async function fetchSequences(
  prospectId: string,
  signal?: AbortSignal
): Promise<SequencesResponse> {
  return apiRequest<SequencesResponse>(`/outreach/sequences/${encodeURIComponent(prospectId)}`, {
    signal
  })
}
