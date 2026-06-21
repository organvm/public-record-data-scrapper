/**
 * Unified Scoring Service
 *
 * Provides MCA prospect scoring based on:
 * - Intent Score: UCC filing recency and patterns
 * - Health Score: Business health indicators
 * - Position Score: Stack position estimation
 * - Composite Score: Weighted combination
 *
 * Formula based on MCA industry research and best practices.
 */

import { database } from '../database/connection'
import { EquipmentLifecycleDetector } from './EquipmentLifecycleDetector'

export interface IntentScoreInput {
  daysSinceLastFiling: number
  totalFilings: number
  activeFilings: number
  lapsedFilings: number
  terminatedFilings: number
  recentFilingsTrend: 'increasing' | 'stable' | 'decreasing'
}

export interface HealthScoreInput {
  reviewCount: number
  avgRating: number // 1-5
  sentimentTrend: 'improving' | 'stable' | 'declining'
  violationCount: number
  yearsInBusiness: number
  hasWebsite: boolean
  socialPresence: number // 0-100
}

export interface PositionScoreInput {
  activeUccCount: number
  knownMcaPositions: number
  estimatedMonthlyPayments: number
  estimatedRevenue: number
}

export interface CompositeScoreInput {
  intentScore: number
  healthScore: number
  positionScore: number
  industryRiskModifier?: number
  stateModifier?: number
  /**
   * Additive boost (points) for MCA-adjacent signals such as a recent
   * equipment purchase financed outside the MCA channel. Applied after
   * multiplicative modifiers and before the 0-100 clamp.
   */
  mcaAdjacencyBoost?: number
}

export interface ScoringResult {
  intentScore: number
  healthScore: number
  positionScore: number
  compositeScore: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
  confidence: number
  factors: {
    name: string
    value: number
    impact: 'positive' | 'negative' | 'neutral'
    weight: number
  }[]
  recommendation: 'high_priority' | 'moderate_priority' | 'low_priority' | 'pass'
  narrative: string
}

export interface ScoringConfig {
  // Intent score weights
  intentRecencyWeight: number
  intentVolumeWeight: number
  intentPatternWeight: number

  // Health score weights
  healthReviewWeight: number
  healthViolationPenalty: number
  healthBaseScore: number

  // Position score weights
  positionPerFilingPenalty: number
  positionMaxPenalty: number

  // Composite weights
  compositeIntentWeight: number
  compositeHealthWeight: number
  compositePositionWeight: number
}

const DEFAULT_CONFIG: ScoringConfig = {
  intentRecencyWeight: 0.5,
  intentVolumeWeight: 0.3,
  intentPatternWeight: 0.2,

  healthReviewWeight: 0.4,
  healthViolationPenalty: 5,
  healthBaseScore: 70,

  positionPerFilingPenalty: 15,
  positionMaxPenalty: 60,

  compositeIntentWeight: 0.4,
  compositeHealthWeight: 0.35,
  compositePositionWeight: 0.25
}

// Industry risk modifiers (lower = higher risk)
const INDUSTRY_RISK_MODIFIERS: Record<string, number> = {
  restaurant: 0.85,
  retail: 0.90,
  construction: 0.80,
  healthcare: 0.95,
  manufacturing: 0.88,
  services: 0.92,
  technology: 0.95
}

// State modifiers (regulatory environment, market size)
const STATE_MODIFIERS: Record<string, number> = {
  CA: 1.0,
  TX: 0.98,
  FL: 0.95,
  NY: 1.02,
  IL: 0.97,
  PA: 0.96,
  OH: 0.94,
  GA: 0.96,
  NC: 0.95,
  MI: 0.93
}

export class ScoringService {
  private config: ScoringConfig
  private equipmentDetector: EquipmentLifecycleDetector

  constructor(config: Partial<ScoringConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.equipmentDetector = new EquipmentLifecycleDetector()
  }

  /**
   * Calculate Intent Score (0-100)
   * Measures how likely a business is to seek MCA financing
   */
  calculateIntentScore(input: IntentScoreInput): number {
    // Recency factor: more recent = higher intent
    // Days since last filing, with decay
    let recencyScore: number
    if (input.daysSinceLastFiling <= 30) {
      recencyScore = 100
    } else if (input.daysSinceLastFiling <= 90) {
      recencyScore = 90 - (input.daysSinceLastFiling - 30) * 0.3
    } else if (input.daysSinceLastFiling <= 365) {
      recencyScore = 72 - (input.daysSinceLastFiling - 90) * 0.1
    } else if (input.daysSinceLastFiling <= 1095) { // 3 years
      recencyScore = 44.5 - (input.daysSinceLastFiling - 365) * 0.02
    } else {
      recencyScore = Math.max(10, 30 - (input.daysSinceLastFiling - 1095) * 0.01)
    }

    // Volume factor: moderate filings = good sign
    let volumeScore: number
    if (input.totalFilings === 0) {
      volumeScore = 50 // Never had financing, neutral
    } else if (input.totalFilings <= 3) {
      volumeScore = 70 + input.totalFilings * 5 // 1-3 filings is ideal
    } else if (input.totalFilings <= 6) {
      volumeScore = 80 - (input.totalFilings - 3) * 5 // Starting to get risky
    } else {
      volumeScore = Math.max(30, 65 - input.totalFilings * 3) // Many filings = caution
    }

    // Pattern factor: lapsed/terminated ratio
    let patternScore: number
    if (input.totalFilings === 0) {
      patternScore = 50
    } else {
      const lapsedRatio = input.lapsedFilings / input.totalFilings
      const terminatedRatio = input.terminatedFilings / input.totalFilings

      // Terminated is better (paid off), lapsed is neutral, active is concerning
      patternScore = 50 + terminatedRatio * 30 + lapsedRatio * 10 - (input.activeFilings / input.totalFilings) * 20
    }

    // Trend adjustment
    let trendAdjustment = 0
    if (input.recentFilingsTrend === 'increasing') {
      trendAdjustment = 10 // More filings recently = higher intent
    } else if (input.recentFilingsTrend === 'decreasing') {
      trendAdjustment = -5
    }

    const weightedScore =
      recencyScore * this.config.intentRecencyWeight +
      volumeScore * this.config.intentVolumeWeight +
      patternScore * this.config.intentPatternWeight +
      trendAdjustment

    return Math.min(100, Math.max(0, Math.round(weightedScore)))
  }

  /**
   * Calculate Health Score (0-100)
   * Measures business viability and stability
   */
  calculateHealthScore(input: HealthScoreInput): number {
    let score = this.config.healthBaseScore

    // Review impact
    if (input.reviewCount > 0) {
      // Normalize rating to 0-30 points
      const ratingBonus = (input.avgRating - 3) * 10 // -20 to +20
      // Review count provides confidence
      const reviewConfidence = Math.min(1, input.reviewCount / 50)
      score += ratingBonus * reviewConfidence * this.config.healthReviewWeight
    }

    // Sentiment trend
    if (input.sentimentTrend === 'improving') {
      score += 5
    } else if (input.sentimentTrend === 'declining') {
      score -= 10
    }

    // Violations penalty
    score -= input.violationCount * this.config.healthViolationPenalty

    // Years in business bonus
    if (input.yearsInBusiness >= 5) {
      score += 10
    } else if (input.yearsInBusiness >= 2) {
      score += 5
    } else if (input.yearsInBusiness < 1) {
      score -= 10
    }

    // Digital presence
    if (input.hasWebsite) {
      score += 5
    }
    score += input.socialPresence * 0.05 // Up to 5 points

    return Math.min(100, Math.max(0, Math.round(score)))
  }

  /**
   * Calculate Position Score (0-100)
   * Estimates available stack position and capacity
   */
  calculatePositionScore(input: PositionScoreInput): number {
    let score = 100

    // Penalty per active UCC
    const uccPenalty = Math.min(
      input.activeUccCount * this.config.positionPerFilingPenalty,
      this.config.positionMaxPenalty
    )
    score -= uccPenalty

    // Known MCA positions are worse than general UCCs
    if (input.knownMcaPositions > 0) {
      score -= input.knownMcaPositions * 10
    }

    // Payment burden ratio
    if (input.estimatedRevenue > 0 && input.estimatedMonthlyPayments > 0) {
      const paymentBurden = input.estimatedMonthlyPayments / input.estimatedRevenue
      if (paymentBurden > 0.25) {
        score -= 30 // Too leveraged
      } else if (paymentBurden > 0.15) {
        score -= 15
      } else if (paymentBurden > 0.10) {
        score -= 5
      }
      // Low burden is good - no penalty
    }

    return Math.min(100, Math.max(0, Math.round(score)))
  }

  /**
   * Calculate Composite Score with modifiers
   */
  calculateCompositeScore(input: CompositeScoreInput): number {
    const base =
      input.intentScore * this.config.compositeIntentWeight +
      input.healthScore * this.config.compositeHealthWeight +
      input.positionScore * this.config.compositePositionWeight

    // Apply modifiers
    let modified = base
    if (input.industryRiskModifier) {
      modified *= input.industryRiskModifier
    }
    if (input.stateModifier) {
      modified *= input.stateModifier
    }

    // MCA-adjacency boost is additive (points), applied after the
    // multiplicative modifiers so a fixed +10 stays a fixed +10 regardless of
    // industry/state scaling.
    if (input.mcaAdjacencyBoost) {
      modified += input.mcaAdjacencyBoost
    }

    return Math.min(100, Math.max(0, Math.round(modified)))
  }

  /**
   * Get letter grade from score
   */
  getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 80) return 'A'
    if (score >= 65) return 'B'
    if (score >= 50) return 'C'
    if (score >= 35) return 'D'
    return 'F'
  }

  /**
   * Calculate confidence level based on data completeness
   */
  calculateConfidence(
    hasReviews: boolean,
    hasUccHistory: boolean,
    hasRevenueEstimate: boolean,
    hasYearsInBusiness: boolean
  ): number {
    let confidence = 50 // Base confidence

    if (hasReviews) confidence += 15
    if (hasUccHistory) confidence += 20
    if (hasRevenueEstimate) confidence += 10
    if (hasYearsInBusiness) confidence += 5

    return Math.min(100, confidence)
  }

  /**
   * Generate narrative explanation
   */
  generateNarrative(
    result: Omit<ScoringResult, 'narrative'>,
    companyName: string,
    daysSinceDefault: number
  ): string {
    const parts: string[] = []

    // Opening
    if (result.compositeScore >= 75) {
      parts.push(`${companyName} shows strong MCA potential.`)
    } else if (result.compositeScore >= 50) {
      parts.push(`${companyName} is a moderate MCA prospect.`)
    } else {
      parts.push(`${companyName} requires careful consideration.`)
    }

    // Intent insight
    if (result.intentScore >= 70) {
      parts.push(`Recent UCC activity suggests active financing interest.`)
    } else if (Number.isFinite(daysSinceDefault) && daysSinceDefault > 1095) { // 3+ years
      // Guard against missing/NULL time_since_default so we never render
      // "NaN years ago".
      parts.push(`Last default was ${Math.round(daysSinceDefault / 365)} years ago, indicating potential recovery.`)
    }

    // Health insight
    if (result.healthScore >= 75) {
      parts.push(`Business health indicators are positive.`)
    } else if (result.healthScore < 50) {
      const healthFactors = result.factors.filter(f => f.impact === 'negative' && f.name.includes('health'))
      if (healthFactors.length > 0) {
        parts.push(`Health concerns include: ${healthFactors.map(f => f.name).join(', ')}.`)
      }
    }

    // Position insight
    if (result.positionScore >= 80) {
      parts.push(`Favorable stack position with room for additional financing.`)
    } else if (result.positionScore < 50) {
      parts.push(`Multiple existing positions may limit funding options.`)
    }

    // Recommendation
    if (result.recommendation === 'high_priority') {
      parts.push(`Recommended for immediate outreach.`)
    } else if (result.recommendation === 'moderate_priority') {
      parts.push(`Worth pursuing with standard due diligence.`)
    }

    return parts.join(' ')
  }

  /**
   * Full scoring calculation with all factors
   */
  async scoreProspect(
    prospectId: string,
    options: {
      industry?: string
      state?: string
    } = {}
  ): Promise<ScoringResult> {
    // Fetch prospect data
    const [prospect] = await database.query<{
      company_name: string
      industry: string
      state: string
      default_date: string
      time_since_default: number
    }>(
      'SELECT company_name, industry, state, default_date, time_since_default FROM prospects WHERE id = $1',
      [prospectId]
    )

    if (!prospect) {
      throw new Error(`Prospect not found: ${prospectId}`)
    }

    // Fetch UCC filings. We also pull secured_party and the collateral
    // description (stored in raw_data JSONB) so the equipment-lifecycle
    // detector can run off this single query — no extra round-trip.
    const filings = await database.query<{
      status: string
      filing_date: string
      secured_party?: string
      collateral_description?: string | null
    }>(
      `SELECT uf.status, uf.filing_date, uf.secured_party,
              COALESCE(
                uf.raw_data->>'collateral_description',
                uf.raw_data->>'collateral',
                uf.raw_data->>'description'
              ) AS collateral_description
       FROM ucc_filings uf
       JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
       WHERE puf.prospect_id = $1
       ORDER BY uf.filing_date DESC`,
      [prospectId]
    )

    // Fetch health scores
    const [healthData] = await database.query<{
      score: number
      sentiment_trend: string
      review_count: number
      avg_sentiment: number
      violation_count: number
    }>(
      `SELECT score, sentiment_trend, review_count, avg_sentiment, violation_count
       FROM health_scores
       WHERE prospect_id = $1
       ORDER BY recorded_date DESC
       LIMIT 1`,
      [prospectId]
    )

    // Calculate days since last filing
    const lastFilingDate = filings[0]?.filing_date
    const daysSinceLastFiling = lastFilingDate
      ? Math.floor((Date.now() - new Date(lastFilingDate).getTime()) / (1000 * 60 * 60 * 24))
      : 9999

    // Count filing statuses
    const activeFilings = filings.filter(f => f.status === 'active').length
    const lapsedFilings = filings.filter(f => f.status === 'lapsed').length
    const terminatedFilings = filings.filter(f => f.status === 'terminated').length

    // Determine trend
    const recentFilings = filings.filter(f => {
      const daysAgo = (Date.now() - new Date(f.filing_date).getTime()) / (1000 * 60 * 60 * 24)
      return daysAgo <= 365
    }).length
    const olderFilings = filings.length - recentFilings
    let recentFilingsTrend: 'increasing' | 'stable' | 'decreasing' = 'stable'
    if (recentFilings > olderFilings) {
      recentFilingsTrend = 'increasing'
    } else if (recentFilings < olderFilings / 2) {
      recentFilingsTrend = 'decreasing'
    }

    // Calculate scores
    const intentScore = this.calculateIntentScore({
      daysSinceLastFiling,
      totalFilings: filings.length,
      activeFilings,
      lapsedFilings,
      terminatedFilings,
      recentFilingsTrend
    })

    const healthScore = this.calculateHealthScore({
      reviewCount: healthData?.review_count || 0,
      // avg_sentiment is stored on a 0..1 scale (see schema CHECK), but
      // calculateHealthScore expects avgRating on a 1..5 star scale. Map
      // linearly: 0 -> 1 star, 1 -> 5 stars (rating = 1 + sentiment*4). The old
      // `sentiment * 5` produced 0..5, wrongly pushing a neutral 0.5 sentiment
      // to 2.5 stars (a penalty). Use == null so a legitimate 0 sentiment is
      // honored rather than defaulting to a neutral 3.
      avgRating: healthData?.avg_sentiment == null ? 3 : 1 + healthData.avg_sentiment * 4,
      sentimentTrend: (healthData?.sentiment_trend as 'improving' | 'stable' | 'declining') || 'stable',
      violationCount: healthData?.violation_count || 0,
      yearsInBusiness: 3, // Default, would need enrichment
      hasWebsite: true, // Would need enrichment
      socialPresence: 50 // Would need enrichment
    })

    const positionScore = this.calculatePositionScore({
      activeUccCount: activeFilings,
      knownMcaPositions: 0, // Would need competitor detection
      estimatedMonthlyPayments: 0,
      estimatedRevenue: 0
    })

    // Get modifiers
    const industry = options.industry || prospect.industry
    const state = options.state || prospect.state
    const industryModifier = INDUSTRY_RISK_MODIFIERS[industry] || 1
    const stateModifier = STATE_MODIFIERS[state] || 1

    // Detect equipment-lifecycle signals from the filings already fetched.
    // A recent equipment purchase financed outside the MCA channel marks an
    // MCA-adjacent prospect that warrants a score boost.
    const equipmentSignal = this.equipmentDetector.analyzeFilings(
      filings.map((f) => ({
        filingDate: f.filing_date,
        collateralDescription: f.collateral_description,
        securedParty: f.secured_party,
        status: f.status
      }))
    )

    const compositeScore = this.calculateCompositeScore({
      intentScore,
      healthScore,
      positionScore,
      industryRiskModifier: industryModifier,
      stateModifier: stateModifier,
      mcaAdjacencyBoost: equipmentSignal.scoreBoost
    })

    const grade = this.getGrade(compositeScore)
    const confidence = this.calculateConfidence(
      (healthData?.review_count || 0) > 0,
      filings.length > 0,
      false, // No revenue estimate
      true // Assume we have years in business
    )

    // Build factors list
    const factors: ScoringResult['factors'] = [
      {
        name: 'UCC Recency',
        value: daysSinceLastFiling,
        impact: daysSinceLastFiling < 365 ? 'positive' : daysSinceLastFiling > 1095 ? 'negative' : 'neutral',
        weight: this.config.intentRecencyWeight
      },
      {
        name: 'Filing History',
        value: filings.length,
        impact: filings.length > 0 && filings.length < 5 ? 'positive' : filings.length > 6 ? 'negative' : 'neutral',
        weight: this.config.intentVolumeWeight
      },
      {
        name: 'Active Positions',
        value: activeFilings,
        impact: activeFilings === 0 ? 'positive' : activeFilings > 3 ? 'negative' : 'neutral',
        weight: this.config.compositePositionWeight
      }
    ]

    if (equipmentSignal.isMcaAdjacent) {
      factors.push({
        name: 'Recent Equipment Purchase (MCA-adjacent)',
        value: equipmentSignal.recentEquipmentFilingCount,
        impact: 'positive',
        weight: equipmentSignal.scoreBoost
      })
    }

    if (healthData) {
      factors.push({
        name: 'Review Sentiment',
        value: healthData.avg_sentiment,
        impact: healthData.avg_sentiment > 0.6 ? 'positive' : healthData.avg_sentiment < 0.4 ? 'negative' : 'neutral',
        weight: this.config.healthReviewWeight
      })

      if (healthData.violation_count > 0) {
        factors.push({
          name: 'Violations',
          value: healthData.violation_count,
          impact: 'negative',
          weight: 0.1
        })
      }
    }

    // Determine recommendation
    let recommendation: ScoringResult['recommendation']
    if (compositeScore >= 75 && confidence >= 60) {
      recommendation = 'high_priority'
    } else if (compositeScore >= 55) {
      recommendation = 'moderate_priority'
    } else if (compositeScore >= 40) {
      recommendation = 'low_priority'
    } else {
      recommendation = 'pass'
    }

    const result: Omit<ScoringResult, 'narrative'> = {
      intentScore,
      healthScore,
      positionScore,
      compositeScore,
      grade,
      confidence,
      factors,
      recommendation
    }

    const narrative = this.generateNarrative(
      result,
      prospect.company_name,
      // time_since_default may be missing/NULL; coerce to a finite number so
      // narrative generation never produces "NaN years ago".
      Number.isFinite(prospect.time_since_default) ? prospect.time_since_default : 0
    )

    return { ...result, narrative }
  }

  /**
   * Batch score multiple prospects
   */
  async scoreProspects(
    prospectIds: string[]
  ): Promise<Map<string, ScoringResult>> {
    const results = new Map<string, ScoringResult>()

    for (const id of prospectIds) {
      try {
        const result = await this.scoreProspect(id)
        results.set(id, result)
      } catch (error) {
        console.error(`Failed to score prospect ${id}:`, error)
      }
    }

    return results
  }
}

// Export singleton instance
export const scoringService = new ScoringService()
