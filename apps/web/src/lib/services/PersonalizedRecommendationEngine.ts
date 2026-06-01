/* eslint-disable @typescript-eslint/no-unused-vars */
// Experimental recommendation features - disabled strict linting
import type {
  Prospect,
  UserProfile,
  PersonalizedRecommendation,
  RecommendationReason,
  CompanyGraph,
  ClaimPattern,
  IndustryType,
  SignalType
} from '@public-records/core'

/**
 * PersonalizedRecommendationEngine - ML-powered personalized prospect recommendations
 * Learns from user behavior to suggest optimal prospects
 */
export class PersonalizedRecommendationEngine {
  private userProfile: UserProfile
  private prospects: Prospect[]
  private relationshipGraphs?: Map<string, CompanyGraph>

  constructor(
    userProfile: UserProfile,
    prospects: Prospect[],
    relationshipGraphs?: Map<string, CompanyGraph>
  ) {
    this.userProfile = userProfile
    this.prospects = prospects
    this.relationshipGraphs = relationshipGraphs
  }

  /**
   * Generate personalized recommendations for the user
   */
  async generateRecommendations(
    limit: number = 20,
    filters?: {
      excludeClaimed?: boolean
      minScore?: number
      industries?: IndustryType[]
    }
  ): Promise<PersonalizedRecommendation[]> {
    let candidates = this.prospects

    // Apply filters
    if (filters?.excludeClaimed) {
      candidates = candidates.filter((p) => !p.claimedBy)
    }

    if (filters?.minScore !== undefined) {
      candidates = candidates.filter((p) => p.priorityScore >= filters.minScore!)
    }

    if (filters?.industries && filters.industries.length > 0) {
      candidates = candidates.filter((p) => filters.industries!.includes(p.industry))
    }

    // Score each prospect
    const scoredProspects = await Promise.all(
      candidates.map(async (prospect) => {
        const score = await this.calculatePersonalizedScore(prospect)
        const reasons = this.generateReasons(prospect, score.matchFactors)
        const matchFactors = score.matchFactors

        const recommendation: PersonalizedRecommendation = {
          id: `rec-${this.userProfile.userId}-${prospect.id}-${Date.now()}`,
          userId: this.userProfile.userId,
          prospectId: prospect.id,
          prospect,
          score: score.totalScore,
          reasons,
          matchFactors,
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
          status: 'new'
        }

        return recommendation
      })
    )

    // Sort by score and return top N
    return scoredProspects.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  /**
   * Calculate personalized score for a prospect
   */
  private async calculatePersonalizedScore(prospect: Prospect): Promise<{
    totalScore: number
    matchFactors: PersonalizedRecommendation['matchFactors']
  }> {
    const weights = {
      industryMatch: 0.25,
      scoreMatch: 0.2,
      signalMatch: 0.2,
      behaviorMatch: 0.2,
      networkMatch: 0.15
    }

    // Calculate individual match factors
    const industryMatch = this.calculateIndustryMatch(prospect)
    const scoreMatch = this.calculateScoreMatch(prospect)
    const signalMatch = this.calculateSignalMatch(prospect)
    const behaviorMatch = this.calculateBehaviorMatch(prospect)
    const networkMatch = this.calculateNetworkMatch(prospect)

    const matchFactors = {
      industryMatch,
      scoreMatch,
      signalMatch,
      behaviorMatch,
      networkMatch
    }

    // Calculate weighted total score
    const totalScore =
      industryMatch * weights.industryMatch +
      scoreMatch * weights.scoreMatch +
      signalMatch * weights.signalMatch +
      behaviorMatch * weights.behaviorMatch +
      networkMatch * weights.networkMatch

    return {
      totalScore: totalScore * 100, // Scale to 0-100
      matchFactors
    }
  }

  /**
   * Calculate industry match score
   */
  private calculateIndustryMatch(prospect: Prospect): number {
    const preferredIndustries = this.userProfile.preferences.industries
    const successfulIndustries = this.userProfile.behavior.successfulIndustries

    // Check if in preferred industries
    if (preferredIndustries.includes(prospect.industry)) {
      return 1.0
    }

    // Check if in successful industries (historical performance)
    if (successfulIndustries.includes(prospect.industry)) {
      return 0.9
    }

    // Check claim patterns
    const industryPatterns = this.userProfile.behavior.claimPatterns.filter((p) =>
      p.industries.includes(prospect.industry)
    )

    if (industryPatterns.length > 0) {
      const avgOutcome =
        industryPatterns.reduce((sum, p) => sum + p.outcomeRate, 0) / industryPatterns.length
      return avgOutcome
    }

    return 0.5 // Neutral for unknown industries
  }

  /**
   * Calculate score match (how close to user's typical claims)
   */
  private calculateScoreMatch(prospect: Prospect): number {
    const claimPatterns = this.userProfile.behavior.claimPatterns

    if (claimPatterns.length === 0) {
      // No history, use preferences
      const minScore = this.userProfile.preferences.minPriorityScore
      if (prospect.priorityScore >= minScore) {
        return (prospect.priorityScore - minScore) / (100 - minScore)
      }
      return 0
    }

    // Calculate average score of user's claims
    const avgClaimScore =
      claimPatterns.reduce((sum, p) => sum + p.avgScore, 0) / claimPatterns.length

    // Score based on proximity to user's typical claims
    const scoreDiff = Math.abs(prospect.priorityScore - avgClaimScore)
    const maxDiff = 50 // Maximum meaningful difference

    return Math.max(0, 1 - scoreDiff / maxDiff)
  }

  /**
   * Calculate signal match (preferred signal types)
   */
  private calculateSignalMatch(prospect: Prospect): number {
    const preferredSignals = this.userProfile.preferences.preferredSignalTypes

    if (preferredSignals.length === 0 || prospect.growthSignals.length === 0) {
      return 0.5 // Neutral
    }

    const prospectSignalTypes = new Set(prospect.growthSignals.map((s) => s.type))
    const matchCount = preferredSignals.filter((s) => prospectSignalTypes.has(s)).length

    const matchRatio = matchCount / preferredSignals.length

    // Bonus for multiple signals
    const signalBonus = Math.min(prospect.growthSignals.length / 5, 0.2)

    return Math.min(matchRatio + signalBonus, 1.0)
  }

  /**
   * Calculate behavior match (patterns from historical claims)
   */
  private calculateBehaviorMatch(prospect: Prospect): number {
    const { claimPatterns, preferredDealSize } = this.userProfile.behavior

    if (claimPatterns.length === 0) {
      return 0.5 // No history
    }

    let score = 0
    let weightSum = 0

    // Match against historical patterns
    for (const pattern of claimPatterns) {
      const weight = pattern.frequency // More frequent patterns weighted higher

      let patternScore = 0

      // Industry match in pattern
      if (pattern.industries.includes(prospect.industry)) {
        patternScore += 0.4
      }

      // Score range match
      const scoreDiff = Math.abs(prospect.priorityScore - pattern.avgScore)
      patternScore += Math.max(0, 0.3 - scoreDiff / 100) // 0.3 max for score match

      // Signal type overlap
      const prospectSignalTypes = new Set(prospect.growthSignals.map((s) => s.type))
      const signalOverlap = pattern.signalTypes.filter((s) => prospectSignalTypes.has(s)).length
      if (pattern.signalTypes.length > 0) {
        patternScore += (signalOverlap / pattern.signalTypes.length) * 0.3
      }

      score += patternScore * weight
      weightSum += weight
    }

    const behaviorScore = weightSum > 0 ? score / weightSum : 0.5

    // Deal size match
    let dealSizeScore = 0.5
    if (prospect.estimatedRevenue) {
      const { min, max } = preferredDealSize
      if (prospect.estimatedRevenue >= min && prospect.estimatedRevenue <= max) {
        dealSizeScore = 1.0
      } else if (prospect.estimatedRevenue < min) {
        dealSizeScore = prospect.estimatedRevenue / min
      } else {
        dealSizeScore = max / prospect.estimatedRevenue
      }
    }

    return behaviorScore * 0.7 + dealSizeScore * 0.3
  }

  /**
   * Calculate network match (relationships to other claimed prospects)
   */
  private calculateNetworkMatch(prospect: Prospect): number {
    if (!this.relationshipGraphs) {
      return 0.5 // No relationship data
    }

    const graph = this.relationshipGraphs.get(prospect.id)
    if (!graph) {
      return 0.5 // No graph for this prospect
    }

    // Check if related to any claimed prospects
    const claimedProspects = this.prospects.filter((p) => p.claimedBy === this.userProfile.userId)

    let relationshipScore = 0
    let relationshipCount = 0

    for (const claimed of claimedProspects) {
      const isRelated = graph.edges.some(
        (e) => e.fromCompanyId === claimed.id || e.toCompanyId === claimed.id
      )

      if (isRelated) {
        relationshipCount++
        // Higher score for successful claimed prospects
        if (claimed.status === 'qualified') {
          relationshipScore += 1.0
        } else if (claimed.status === 'contacted') {
          relationshipScore += 0.7
        } else {
          relationshipScore += 0.5
        }
      }
    }

    if (relationshipCount === 0) {
      return 0.5 // No relationships
    }

    // Average relationship score with bonus for multiple relationships
    const avgRelationshipScore = relationshipScore / relationshipCount
    const countBonus = Math.min(relationshipCount / 5, 0.2)

    return Math.min(avgRelationshipScore + countBonus, 1.0)
  }

  /**
   * Generate human-readable reasons for recommendation
   */
  private generateReasons(
    prospect: Prospect,
    matchFactors: PersonalizedRecommendation['matchFactors']
  ): RecommendationReason[] {
    const reasons: RecommendationReason[] = []

    // Industry match reason
    if (matchFactors.industryMatch >= 0.8) {
      const isPreferred = this.userProfile.preferences.industries.includes(prospect.industry)
      const isSuccessful = this.userProfile.behavior.successfulIndustries.includes(
        prospect.industry
      )

      reasons.push({
        factor: 'Industry Alignment',
        description: isPreferred
          ? `Matches your preferred industry: ${prospect.industry}`
          : isSuccessful
            ? `Strong historical performance in ${prospect.industry}`
            : `Aligns with your claim patterns in ${prospect.industry}`,
        weight: matchFactors.industryMatch,
        evidence: [
          isPreferred ? 'Preferred industry' : 'Historical success',
          `Match score: ${(matchFactors.industryMatch * 100).toFixed(0)}%`
        ]
      })
    }

    // Score match reason
    if (matchFactors.scoreMatch >= 0.7) {
      const avgClaimScore =
        this.userProfile.behavior.claimPatterns.length > 0
          ? this.userProfile.behavior.claimPatterns.reduce((sum, p) => sum + p.avgScore, 0) /
            this.userProfile.behavior.claimPatterns.length
          : this.userProfile.preferences.minPriorityScore

      reasons.push({
        factor: 'Priority Score Match',
        description: `Score of ${prospect.priorityScore} aligns with your typical claims (avg: ${avgClaimScore.toFixed(0)})`,
        weight: matchFactors.scoreMatch,
        evidence: [
          `Prospect score: ${prospect.priorityScore}`,
          `Your average: ${avgClaimScore.toFixed(0)}`
        ]
      })
    }

    // Signal match reason
    if (matchFactors.signalMatch >= 0.6) {
      const matchingSignals = prospect.growthSignals.filter((s) =>
        this.userProfile.preferences.preferredSignalTypes.includes(s.type)
      )

      reasons.push({
        factor: 'Growth Signal Match',
        description: `Has ${matchingSignals.length} of your preferred signal types`,
        weight: matchFactors.signalMatch,
        evidence: [
          `Total signals: ${prospect.growthSignals.length}`,
          `Matching signals: ${matchingSignals.map((s) => s.type).join(', ')}`
        ]
      })
    }

    // Behavior match reason
    if (matchFactors.behaviorMatch >= 0.7) {
      reasons.push({
        factor: 'Historical Pattern Match',
        description: `Closely matches your successful claim patterns`,
        weight: matchFactors.behaviorMatch,
        evidence: [
          `Match score: ${(matchFactors.behaviorMatch * 100).toFixed(0)}%`,
          `Based on ${this.userProfile.behavior.claimPatterns.length} historical patterns`
        ]
      })
    }

    // Network match reason
    if (matchFactors.networkMatch >= 0.7) {
      const graph = this.relationshipGraphs?.get(prospect.id)
      const relatedClaimed = graph
        ? graph.edges.filter((e) =>
            this.prospects.some(
              (p) =>
                p.claimedBy === this.userProfile.userId &&
                (p.id === e.fromCompanyId || p.id === e.toCompanyId)
            )
          )
        : []

      reasons.push({
        factor: 'Network Connection',
        description: `Related to ${relatedClaimed.length} of your claimed prospects`,
        weight: matchFactors.networkMatch,
        evidence: [
          `Related prospects: ${relatedClaimed.length}`,
          `Network score: ${(matchFactors.networkMatch * 100).toFixed(0)}%`
        ]
      })
    }

    // Sort reasons by weight
    return reasons.sort((a, b) => b.weight - a.weight)
  }

  /**
   * Learn from user actions to update profile
   */
  async learnFromAction(action: {
    type: 'claim' | 'dismiss' | 'view'
    prospectId: string
    outcome?: 'qualified' | 'contacted' | 'dead'
  }): Promise<UserProfile> {
    const prospect = this.prospects.find((p) => p.id === action.prospectId)
    if (!prospect) return this.userProfile

    if (action.type === 'claim') {
      // Update claim patterns
      this.updateClaimPatterns(prospect, action.outcome)

      // Update preferred industries if successful
      if (action.outcome === 'qualified') {
        if (!this.userProfile.behavior.successfulIndustries.includes(prospect.industry)) {
          this.userProfile.behavior.successfulIndustries.push(prospect.industry)
        }
      }

      // Update conversion rate
      this.updateConversionRate(action.outcome)
    }

    if (action.type === 'dismiss') {
      // Learn negative patterns (could implement negative filtering)
    }

    this.userProfile.lastActive = new Date().toISOString()
    return this.userProfile
  }

  /**
   * Update claim patterns based on new claim
   */
  private updateClaimPatterns(prospect: Prospect, outcome?: string): void {
    const signalTypes = prospect.growthSignals.map((s) => s.type)

    // Find matching pattern or create new one
    const matchingPattern = this.userProfile.behavior.claimPatterns.find((p) =>
      p.industries.includes(prospect.industry)
    )

    if (matchingPattern) {
      // Update existing pattern
      matchingPattern.frequency++
      matchingPattern.avgScore =
        (matchingPattern.avgScore * (matchingPattern.frequency - 1) + prospect.priorityScore) /
        matchingPattern.frequency

      // Merge signal types
      matchingPattern.signalTypes = [...new Set([...matchingPattern.signalTypes, ...signalTypes])]

      // Update outcome rate if outcome provided
      if (outcome === 'qualified') {
        matchingPattern.outcomeRate =
          (matchingPattern.outcomeRate * (matchingPattern.frequency - 1) + 1) /
          matchingPattern.frequency
      } else if (outcome === 'dead') {
        matchingPattern.outcomeRate =
          (matchingPattern.outcomeRate * (matchingPattern.frequency - 1)) /
          matchingPattern.frequency
      }
    } else {
      // Create new pattern
      const newPattern: ClaimPattern = {
        industries: [prospect.industry],
        avgScore: prospect.priorityScore,
        signalTypes: signalTypes,
        outcomeRate: outcome === 'qualified' ? 1 : outcome === 'dead' ? 0 : 0.5,
        frequency: 1
      }
      this.userProfile.behavior.claimPatterns.push(newPattern)
    }
  }

  /**
   * Update overall conversion rate
   */
  private updateConversionRate(outcome?: string): void {
    const currentRate = this.userProfile.behavior.conversionRate
    const totalClaims = this.userProfile.behavior.claimPatterns.reduce(
      (sum, p) => sum + p.frequency,
      0
    )

    if (outcome === 'qualified') {
      this.userProfile.behavior.conversionRate = (currentRate * (totalClaims - 1) + 1) / totalClaims
    } else if (outcome === 'dead') {
      this.userProfile.behavior.conversionRate = (currentRate * (totalClaims - 1)) / totalClaims
    }
  }

  /**
   * Get similar prospects based on a reference prospect
   */
  async getSimilarProspects(referenceProspectId: string, limit: number = 10): Promise<Prospect[]> {
    const reference = this.prospects.find((p) => p.id === referenceProspectId)
    if (!reference) return []

    // Calculate similarity for each prospect
    const similarities = this.prospects
      .filter((p) => p.id !== referenceProspectId)
      .map((prospect) => ({
        prospect,
        similarity: this.calculateSimilarity(reference, prospect)
      }))

    // Sort by similarity and return top N
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map((s) => s.prospect)
  }

  /**
   * Calculate similarity between two prospects
   */
  private calculateSimilarity(p1: Prospect, p2: Prospect): number {
    let similarity = 0

    // Industry match (30%)
    if (p1.industry === p2.industry) similarity += 0.3

    // Score proximity (20%)
    const scoreDiff = Math.abs(p1.priorityScore - p2.priorityScore)
    similarity += Math.max(0, 0.2 * (1 - scoreDiff / 100))

    // Health grade match (15%)
    if (p1.healthScore.grade === p2.healthScore.grade) similarity += 0.15

    // Signal overlap (20%)
    const p1Signals = new Set(p1.growthSignals.map((s) => s.type))
    const p2Signals = new Set(p2.growthSignals.map((s) => s.type))
    const signalOverlap = [...p1Signals].filter((s) => p2Signals.has(s)).length
    const totalUniqueSignals = new Set([...p1Signals, ...p2Signals]).size
    if (totalUniqueSignals > 0) {
      similarity += 0.2 * (signalOverlap / totalUniqueSignals)
    }

    // State match (10%)
    if (p1.state === p2.state) similarity += 0.1

    // Revenue proximity (5%)
    if (p1.estimatedRevenue && p2.estimatedRevenue) {
      const revenueDiff = Math.abs(p1.estimatedRevenue - p2.estimatedRevenue)
      const avgRevenue = (p1.estimatedRevenue + p2.estimatedRevenue) / 2
      similarity += Math.max(0, 0.05 * (1 - revenueDiff / avgRevenue))
    }

    return similarity
  }
}
