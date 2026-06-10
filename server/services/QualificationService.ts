/**
 * QualificationService
 *
 * Pre-qualification rules engine for MCA underwriting decisions.
 * Evaluates prospects based on bank data features and returns
 * qualification tier, maximum funding amount, and suggested rates.
 *
 * Qualification Tiers:
 * - A: Premium qualification - lowest rates, highest amounts
 * - B: Good qualification - competitive rates
 * - C: Standard qualification - moderate rates
 * - D: Marginal qualification - higher rates, lower amounts
 * - Decline: Does not meet minimum criteria
 *
 * @module server/services/QualificationService
 */

import { database } from '../database/connection'
import {
  UnderwritingFeatures,
  UnderwritingService,
  underwritingService
} from './UnderwritingService'

/**
 * Qualification tiers
 */
export type QualificationTier = 'A' | 'B' | 'C' | 'D' | 'Decline'

/**
 * Qualification decision reasons
 */
export interface QualificationReason {
  factor: string
  result: 'pass' | 'warning' | 'fail'
  message: string
  value?: number | string
  threshold?: number | string
  /**
   * The best tier this individual factor qualifies for ('A'..'D'), or
   * 'Decline' if the factor fails entirely. Used by tier aggregation so a
   * factor that legitimately meets the C/D threshold is counted as satisfying
   * that tier rather than as a generic "warning" that drags the grade down.
   */
  qualifiesTier?: QualificationTier
}

/**
 * Complete qualification result
 */
export interface QualificationResult {
  /** Whether prospect qualifies for any offer */
  qualified: boolean
  /** Qualification tier (A/B/C/D or Decline) */
  tier: QualificationTier
  /** Detailed reasons for the decision */
  reasons: QualificationReason[]
  /** Maximum funding amount recommended */
  maxAmount: number
  /** Minimum funding amount (floor) */
  minAmount: number
  /** Suggested factor rate */
  suggestedRate: number
  /** Suggested term in months */
  suggestedTermMonths: number
  /** Estimated daily payment amount */
  estimatedDailyPayment: number
  /** Risk score (0-100, lower is better) */
  riskScore: number
  /** Confidence in the qualification (0-100) */
  confidence: number
  /** Warnings that don't affect qualification but should be noted */
  warnings: string[]
  /** Timestamp of qualification */
  qualifiedAt: string
}

/**
 * Qualification rules configuration
 */
export interface QualificationRules {
  /** Minimum ADB required for each tier */
  minAdbByTier: Record<QualificationTier, number>
  /** Maximum NSF count for each tier */
  maxNsfByTier: Record<QualificationTier, number>
  /** Maximum negative days percentage for each tier */
  maxNegativeDaysByTier: Record<QualificationTier, number>
  /** Maximum existing positions for each tier */
  maxPositionsByTier: Record<QualificationTier, number>
  /** Minimum time in business (months) for each tier */
  minTimeInBusinessByTier: Record<QualificationTier, number>
  /** Minimum monthly revenue for each tier */
  minMonthlyRevenueByTier: Record<QualificationTier, number>
  /** Factor rates by tier */
  factorRatesByTier: Record<QualificationTier, number>
  /** Max funding as multiple of monthly revenue */
  maxFundingMultiple: Record<QualificationTier, number>
}

/**
 * Default qualification rules
 */
const DEFAULT_RULES: QualificationRules = {
  minAdbByTier: {
    A: 25000,
    B: 15000,
    C: 7500,
    D: 3000,
    Decline: 0
  },
  maxNsfByTier: {
    A: 0,
    B: 2,
    C: 4,
    D: 8,
    Decline: Infinity
  },
  maxNegativeDaysByTier: {
    A: 0,
    B: 3,
    C: 7,
    D: 15,
    Decline: Infinity
  },
  maxPositionsByTier: {
    A: 0,
    B: 1,
    C: 2,
    D: 4,
    Decline: Infinity
  },
  minTimeInBusinessByTier: {
    A: 24, // 2 years
    B: 12, // 1 year
    C: 6, // 6 months
    D: 3, // 3 months
    Decline: 0
  },
  minMonthlyRevenueByTier: {
    A: 50000,
    B: 25000,
    C: 15000,
    D: 10000,
    Decline: 0
  },
  factorRatesByTier: {
    A: 1.15,
    B: 1.25,
    C: 1.35,
    D: 1.45,
    Decline: 0
  },
  maxFundingMultiple: {
    A: 1.5, // Up to 1.5x monthly revenue
    B: 1.25,
    C: 1.0,
    D: 0.75,
    Decline: 0
  }
}

/**
 * Prospect data for qualification
 */
interface ProspectQualificationData {
  id: string
  companyName: string
  timeInBusinessMonths?: number
  state?: string
  industry?: string
}

/**
 * QualificationService
 *
 * Evaluates prospects for MCA funding qualification based on
 * bank data features and business characteristics.
 *
 * @example
 * ```typescript
 * const qualificationService = new QualificationService()
 *
 * // Qualify a prospect with bank features
 * const result = await qualificationService.qualify('prospect-123', bankFeatures)
 *
 * if (result.qualified) {
 *   console.log(`Tier: ${result.tier}`)
 *   console.log(`Max Amount: $${result.maxAmount}`)
 *   console.log(`Rate: ${result.suggestedRate}`)
 * } else {
 *   console.log('Decline reasons:', result.reasons.filter(r => r.result === 'fail'))
 * }
 * ```
 */
export class QualificationService {
  private rules: QualificationRules
  private underwriting: UnderwritingService

  constructor(rules?: Partial<QualificationRules>, underwriting?: UnderwritingService) {
    this.rules = { ...DEFAULT_RULES, ...rules }
    this.underwriting = underwriting || underwritingService
  }

  /**
   * Qualify a prospect for MCA funding.
   *
   * Evaluates bank features against qualification rules to determine
   * tier, maximum funding amount, and suggested terms.
   *
   * @param prospectId - The prospect ID to qualify
   * @param bankFeatures - Extracted bank data features
   * @param options - Additional qualification options
   * @returns Complete qualification result
   */
  async qualify(
    prospectId: string,
    bankFeatures: UnderwritingFeatures,
    options: {
      timeInBusinessMonths?: number
      industry?: string
      state?: string
    } = {}
  ): Promise<QualificationResult> {
    // Get prospect data from database (optional - may not exist yet)
    let prospect: ProspectQualificationData | null = null
    try {
      const results = await database.query<{
        id: string
        company_name: string
        time_in_business_months?: number
        state?: string
        industry?: string
      }>('SELECT id, company_name, state, industry FROM prospects WHERE id = $1', [prospectId])

      if (results[0]) {
        prospect = {
          id: results[0].id,
          companyName: results[0].company_name,
          timeInBusinessMonths: results[0].time_in_business_months,
          state: results[0].state,
          industry: results[0].industry
        }
      }
    } catch {
      // Prospect may not exist - continue with provided options
    }

    const timeInBusinessMonths = options.timeInBusinessMonths || prospect?.timeInBusinessMonths || 6

    // Evaluate each qualification factor
    const reasons: QualificationReason[] = []
    const warnings: string[] = []

    // Evaluate ADB
    const adbResult = this.evaluateAdb(bankFeatures.averageDailyBalance)
    reasons.push(adbResult)

    // Evaluate NSF count
    const nsfResult = this.evaluateNsf(bankFeatures.nsfCount)
    reasons.push(nsfResult)

    // Evaluate negative days
    const negativeDaysResult = this.evaluateNegativeDays(bankFeatures.negativeDaysPercentage)
    reasons.push(negativeDaysResult)

    // Evaluate existing positions
    const positionsResult = this.evaluatePositions(bankFeatures.estimatedPositionCount)
    reasons.push(positionsResult)

    // Evaluate time in business
    const tibResult = this.evaluateTimeInBusiness(timeInBusinessMonths)
    reasons.push(tibResult)

    // Evaluate monthly revenue
    const revenueResult = this.evaluateMonthlyRevenue(bankFeatures.averageMonthlyDeposits)
    reasons.push(revenueResult)

    // Evaluate deposit consistency
    const consistencyResult = this.evaluateDepositConsistency(bankFeatures.depositConsistencyScore)
    reasons.push(consistencyResult)

    // Evaluate revenue trend
    const trendResult = this.evaluateRevenueTrend(bankFeatures.revenueTrend.direction)
    reasons.push(trendResult)

    // Check for warnings
    if (bankFeatures.daysSinceLastDeposit > 7) {
      warnings.push(`Last deposit was ${bankFeatures.daysSinceLastDeposit} days ago`)
    }

    if (bankFeatures.estimatedPaymentObligations > bankFeatures.averageDailyBalance * 0.5) {
      warnings.push('Existing payment obligations are high relative to daily balance')
    }

    if (bankFeatures.revenueTrend.direction === 'decreasing') {
      warnings.push('Revenue trend is declining')
    }

    if (bankFeatures.revenueTrend.seasonalityScore > 50) {
      warnings.push('Revenue shows high seasonality/volatility')
    }

    // Determine overall tier
    const tier = this.determineTier(reasons)
    const qualified = tier !== 'Decline'

    // Calculate funding terms
    const maxAmount = qualified
      ? this.calculateMaxFunding(tier, bankFeatures.averageMonthlyDeposits)
      : 0

    const minAmount = qualified ? Math.min(5000, maxAmount * 0.25) : 0
    const suggestedRate = this.rules.factorRatesByTier[tier]

    // Calculate term and payment
    const suggestedTermMonths = this.suggestTerm(tier, maxAmount)
    const totalPayback = maxAmount * suggestedRate
    const estimatedDailyPayment = totalPayback / (suggestedTermMonths * 22) // ~22 business days/month

    // Calculate risk and confidence scores
    const riskScore = this.calculateRiskScore(reasons, bankFeatures)
    const confidence = this.calculateConfidence(bankFeatures)

    return {
      qualified,
      tier,
      reasons,
      maxAmount: Math.round(maxAmount),
      minAmount: Math.round(minAmount),
      suggestedRate,
      suggestedTermMonths,
      estimatedDailyPayment: Math.round(estimatedDailyPayment * 100) / 100,
      riskScore,
      confidence,
      warnings,
      qualifiedAt: new Date().toISOString()
    }
  }

  /**
   * Qualify a prospect using their Plaid access token.
   *
   * Convenience method that extracts features and qualifies in one call.
   *
   * @param prospectId - The prospect ID
   * @param accessToken - Plaid access token
   * @param options - Additional options
   * @returns Qualification result
   */
  async qualifyWithBankAccess(
    prospectId: string,
    accessToken: string,
    options: {
      timeInBusinessMonths?: number
      monthsToAnalyze?: number
    } = {}
  ): Promise<QualificationResult> {
    // Extract features from bank data
    const bankFeatures = await this.underwriting.extractFeatures(accessToken, {
      monthsToAnalyze: options.monthsToAnalyze || 6
    })

    // Run qualification
    return this.qualify(prospectId, bankFeatures, {
      timeInBusinessMonths: options.timeInBusinessMonths
    })
  }

  /**
   * Get qualification rules summary for a specific tier.
   */
  getTierRequirements(tier: QualificationTier): {
    tier: QualificationTier
    requirements: {
      minAdb: number
      maxNsf: number
      maxNegativeDays: number
      maxPositions: number
      minTimeInBusiness: number
      minMonthlyRevenue: number
    }
    terms: {
      factorRate: number
      maxFundingMultiple: number
    }
  } {
    return {
      tier,
      requirements: {
        minAdb: this.rules.minAdbByTier[tier],
        maxNsf: this.rules.maxNsfByTier[tier],
        maxNegativeDays: this.rules.maxNegativeDaysByTier[tier],
        maxPositions: this.rules.maxPositionsByTier[tier],
        minTimeInBusiness: this.rules.minTimeInBusinessByTier[tier],
        minMonthlyRevenue: this.rules.minMonthlyRevenueByTier[tier]
      },
      terms: {
        factorRate: this.rules.factorRatesByTier[tier],
        maxFundingMultiple: this.rules.maxFundingMultiple[tier]
      }
    }
  }

  /**
   * Update qualification rules.
   */
  updateRules(newRules: Partial<QualificationRules>): void {
    this.rules = { ...this.rules, ...newRules }
  }

  // Private evaluation methods

  private evaluateAdb(adb: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (adb >= this.rules.minAdbByTier[tier]) {
        return {
          factor: 'Average Daily Balance',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message: `ADB of $${Math.round(adb).toLocaleString()} meets ${tier}-tier threshold`,
          value: adb,
          threshold: this.rules.minAdbByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'Average Daily Balance',
      result: 'fail',
      message: `ADB of $${Math.round(adb).toLocaleString()} is below minimum threshold`,
      value: adb,
      threshold: this.rules.minAdbByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateNsf(nsfCount: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (nsfCount <= this.rules.maxNsfByTier[tier]) {
        return {
          factor: 'NSF/Overdraft Count',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message:
            nsfCount === 0
              ? 'No NSF/overdraft events'
              : `${nsfCount} NSF/overdraft events is within ${tier}-tier threshold`,
          value: nsfCount,
          threshold: this.rules.maxNsfByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'NSF/Overdraft Count',
      result: 'fail',
      message: `${nsfCount} NSF/overdraft events exceeds maximum threshold`,
      value: nsfCount,
      threshold: this.rules.maxNsfByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateNegativeDays(percentage: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (percentage <= this.rules.maxNegativeDaysByTier[tier]) {
        return {
          factor: 'Negative Balance Days',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message:
            percentage === 0
              ? 'No negative balance days'
              : `${percentage.toFixed(1)}% negative days meets ${tier}-tier threshold`,
          value: percentage,
          threshold: this.rules.maxNegativeDaysByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'Negative Balance Days',
      result: 'fail',
      message: `${percentage.toFixed(1)}% negative balance days exceeds maximum threshold`,
      value: percentage,
      threshold: this.rules.maxNegativeDaysByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluatePositions(positionCount: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (positionCount <= this.rules.maxPositionsByTier[tier]) {
        return {
          factor: 'Existing Positions',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message:
            positionCount === 0
              ? 'No existing MCA/loan positions detected'
              : `${positionCount} existing position(s) meets ${tier}-tier threshold`,
          value: positionCount,
          threshold: this.rules.maxPositionsByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'Existing Positions',
      result: 'fail',
      message: `${positionCount} existing positions exceeds maximum threshold`,
      value: positionCount,
      threshold: this.rules.maxPositionsByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateTimeInBusiness(months: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (months >= this.rules.minTimeInBusinessByTier[tier]) {
        return {
          factor: 'Time in Business',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message: `${months} months in business meets ${tier}-tier threshold`,
          value: months,
          threshold: this.rules.minTimeInBusinessByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'Time in Business',
      result: 'fail',
      message: `${months} months in business is below minimum threshold`,
      value: months,
      threshold: this.rules.minTimeInBusinessByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateMonthlyRevenue(revenue: number): QualificationReason {
    for (const tier of ['A', 'B', 'C', 'D'] as QualificationTier[]) {
      if (revenue >= this.rules.minMonthlyRevenueByTier[tier]) {
        return {
          factor: 'Monthly Revenue',
          result: tier === 'A' || tier === 'B' ? 'pass' : 'warning',
          message: `$${Math.round(revenue).toLocaleString()}/month meets ${tier}-tier threshold`,
          value: revenue,
          threshold: this.rules.minMonthlyRevenueByTier[tier],
          qualifiesTier: tier
        }
      }
    }

    return {
      factor: 'Monthly Revenue',
      result: 'fail',
      message: `$${Math.round(revenue).toLocaleString()}/month is below minimum threshold`,
      value: revenue,
      threshold: this.rules.minMonthlyRevenueByTier.D,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateDepositConsistency(score: number): QualificationReason {
    if (score >= 75) {
      return {
        factor: 'Deposit Consistency',
        result: 'pass',
        message: `Strong deposit consistency (${score}/100)`,
        value: score,
        threshold: 75,
        qualifiesTier: 'A'
      }
    } else if (score >= 50) {
      return {
        factor: 'Deposit Consistency',
        result: 'warning',
        message: `Moderate deposit consistency (${score}/100)`,
        value: score,
        threshold: 50,
        qualifiesTier: 'C'
      }
    }

    return {
      factor: 'Deposit Consistency',
      result: 'fail',
      message: `Low deposit consistency (${score}/100) indicates irregular revenue`,
      value: score,
      threshold: 50,
      qualifiesTier: 'Decline'
    }
  }

  private evaluateRevenueTrend(
    direction: 'increasing' | 'stable' | 'decreasing' | 'volatile'
  ): QualificationReason {
    switch (direction) {
      case 'increasing':
        return {
          factor: 'Revenue Trend',
          result: 'pass',
          message: 'Revenue is increasing',
          value: direction,
          qualifiesTier: 'A'
        }
      case 'stable':
        return {
          factor: 'Revenue Trend',
          result: 'pass',
          message: 'Revenue is stable',
          value: direction,
          qualifiesTier: 'A'
        }
      case 'decreasing':
        return {
          factor: 'Revenue Trend',
          result: 'warning',
          message: 'Revenue is declining',
          value: direction,
          qualifiesTier: 'C'
        }
      case 'volatile':
        return {
          factor: 'Revenue Trend',
          result: 'warning',
          message: 'Revenue shows high volatility',
          value: direction,
          qualifiesTier: 'C'
        }
    }
  }

  private determineTier(reasons: QualificationReason[]): QualificationTier {
    // Check for any hard fails
    const fails = reasons.filter((r) => r.result === 'fail')
    if (fails.length > 0) {
      // Check if any single critical factor is a hard decline
      const criticalFactors = ['Average Daily Balance', 'Monthly Revenue', 'NSF/Overdraft Count']
      const criticalFails = fails.filter((f) => criticalFactors.includes(f.factor))

      if (criticalFails.length > 0) {
        return 'Decline'
      }

      // Multiple non-critical fails also decline
      if (fails.length >= 2) {
        return 'Decline'
      }

      // Single non-critical fail = D tier
      return 'D'
    }

    // No hard fails. The overall tier is the WORST tier that any single factor
    // qualifies for: a borrower is only as strong as their weakest factor. This
    // correctly keeps a borrower whose factors all meet C/D thresholds at C/D
    // instead of penalizing each C/D-satisfied factor as a "warning" and
    // cascading them down to D. (Previously, factors that legitimately met the
    // C threshold were counted as warnings, so a solid C-tier candidate with
    // 4+ such factors was wrongly demoted to D.)
    const tierRank: Record<QualificationTier, number> = {
      A: 4,
      B: 3,
      C: 2,
      D: 1,
      Decline: 0
    }

    let worstRank = tierRank.A
    for (const reason of reasons) {
      // Default an un-tagged factor to A so legacy reasons don't drag the grade.
      const factorTier = reason.qualifiesTier ?? 'A'
      worstRank = Math.min(worstRank, tierRank[factorTier])
    }

    if (worstRank >= tierRank.A) return 'A'
    if (worstRank >= tierRank.B) return 'B'
    if (worstRank >= tierRank.C) return 'C'
    return 'D'
  }

  private calculateMaxFunding(tier: QualificationTier, monthlyRevenue: number): number {
    const multiple = this.rules.maxFundingMultiple[tier]
    const maxFromRevenue = monthlyRevenue * multiple

    // Apply tier-specific caps
    const tierCaps: Record<QualificationTier, number> = {
      A: 500000,
      B: 250000,
      C: 150000,
      D: 75000,
      Decline: 0
    }

    return Math.min(maxFromRevenue, tierCaps[tier])
  }

  private suggestTerm(tier: QualificationTier, amount: number): number {
    // Suggest term based on tier and amount
    const baseTerm: Record<QualificationTier, number> = {
      A: 12,
      B: 9,
      C: 6,
      D: 4,
      Decline: 0
    }

    // Maximum allowable term per tier. Longer terms increase total exposure, so
    // riskier tiers must be capped — the amount-based bump below must never
    // extend a D/C borrower's term beyond what its risk tier permits.
    const maxTermByTier: Record<QualificationTier, number> = {
      A: 18,
      B: 12,
      C: 9,
      D: 6,
      Decline: 0
    }

    let term = baseTerm[tier]

    // Adjust for amount, but never beyond the tier's risk-based maximum.
    if (amount > 200000) term = Math.max(term, 12)
    else if (amount > 100000) term = Math.max(term, 9)
    else if (amount > 50000) term = Math.max(term, 6)

    return Math.min(term, maxTermByTier[tier])
  }

  private calculateRiskScore(
    reasons: QualificationReason[],
    features: UnderwritingFeatures
  ): number {
    let score = 0

    // Add points for each risk factor
    for (const reason of reasons) {
      if (reason.result === 'fail') score += 25
      else if (reason.result === 'warning') score += 10
    }

    // Adjust for specific features
    if (features.nsfCount > 0) score += features.nsfCount * 3
    if (features.negativeDaysPercentage > 0) score += features.negativeDaysPercentage * 0.5
    if (features.estimatedPositionCount > 0) score += features.estimatedPositionCount * 5
    if (features.revenueTrend.direction === 'decreasing') score += 10
    if (features.revenueTrend.direction === 'volatile') score += 5

    return Math.min(100, Math.round(score))
  }

  private calculateConfidence(features: UnderwritingFeatures): number {
    let confidence = 50 // Base confidence

    // More data = higher confidence
    if (features.totalTransactionsAnalyzed >= 500) confidence += 20
    else if (features.totalTransactionsAnalyzed >= 200) confidence += 15
    else if (features.totalTransactionsAnalyzed >= 100) confidence += 10

    // Longer analysis period = higher confidence
    if (features.totalDaysAnalyzed >= 180) confidence += 15
    else if (features.totalDaysAnalyzed >= 90) confidence += 10
    else if (features.totalDaysAnalyzed >= 30) confidence += 5

    // Good deposit consistency = higher confidence
    if (features.depositConsistencyScore >= 75) confidence += 10
    else if (features.depositConsistencyScore >= 50) confidence += 5

    return Math.min(100, confidence)
  }
}

/**
 * Default QualificationService instance
 */
export const qualificationService = new QualificationService()

/**
 * Create a new QualificationService with custom rules
 */
export function createQualificationService(
  rules?: Partial<QualificationRules>,
  underwriting?: UnderwritingService
): QualificationService {
  return new QualificationService(rules, underwriting)
}
