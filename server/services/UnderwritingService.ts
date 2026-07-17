/**
 * UnderwritingService
 *
 * Extracts underwriting features from bank transaction data for MCA analysis.
 * Provides comprehensive financial metrics used in pre-qualification decisions.
 *
 * Features extracted:
 * - Average Daily Balance (ADB) calculation
 * - NSF/Overdraft count
 * - Negative balance days
 * - Lender payment detection (stack position analysis)
 * - Revenue trend analysis
 * - Deposit consistency scoring
 *
 * @module server/services/UnderwritingService
 */

import {
  PlaidTransaction,
  plaidTransactionsManager,
  PlaidTransactionsManager
} from '../integrations/plaid'
import { mcaLenderNames } from './calibration/funderIntel'

/**
 * Daily balance record for ADB calculation
 */
export interface DailyBalance {
  date: string
  balance: number
  deposits: number
  withdrawals: number
}

/**
 * Detected lender payment
 */
export interface DetectedLenderPayment {
  transactionId: string
  date: string
  amount: number
  lenderName: string
  frequency: 'daily' | 'weekly' | 'bi-weekly' | 'monthly' | 'irregular'
  confidence: number
}

/**
 * Monthly revenue data
 */
export interface MonthlyRevenue {
  month: string
  totalDeposits: number
  depositCount: number
  averageDeposit: number
  maxDeposit: number
  minDeposit: number
}

/**
 * Revenue trend analysis
 */
export interface RevenueTrend {
  direction: 'increasing' | 'stable' | 'decreasing' | 'volatile'
  percentageChange: number
  averageMonthlyRevenue: number
  medianMonthlyRevenue: number
  seasonalityScore: number
  monthlyData: MonthlyRevenue[]
}

/**
 * Complete underwriting features extracted from bank data
 */
export interface UnderwritingFeatures {
  /** Average daily balance over analysis period */
  averageDailyBalance: number
  /** Minimum daily balance observed */
  minimumDailyBalance: number
  /** Maximum daily balance observed */
  maximumDailyBalance: number
  /** Current balance */
  currentBalance: number

  /** Number of NSF/overdraft events */
  nsfCount: number
  /** Total NSF fees paid */
  nsfFeeTotal: number
  /** Number of days with negative balance */
  negativeDays: number
  /** Percentage of days with negative balance */
  negativeDaysPercentage: number
  /**
   * Whether daily-balance metrics (ADB, min/negative balance, negativeDays)
   * are anchored to a real account balance. When false, the balance series is
   * relative to an assumed zero opening balance, so absolute balance figures
   * (minimumDailyBalance, negativeDays) are NOT reliable and should not be
   * treated as overdraft evidence — they describe cash-flow movement only.
   */
  balanceAnchored: boolean

  /** Detected lender payments (MCA, loans, etc.) */
  lenderPayments: DetectedLenderPayment[]
  /** Estimated current position count */
  estimatedPositionCount: number
  /** Estimated total daily/weekly payment obligations */
  estimatedPaymentObligations: number

  /** Revenue trend analysis */
  revenueTrend: RevenueTrend
  /** Average monthly deposits */
  averageMonthlyDeposits: number
  /** Total deposits in analysis period */
  totalDeposits: number

  /** Deposit consistency score (0-100) */
  depositConsistencyScore: number
  /** Days since last deposit */
  daysSinceLastDeposit: number

  /** Analysis period start date */
  analysisStartDate: string
  /** Analysis period end date */
  analysisEndDate: string
  /** Total days analyzed */
  totalDaysAnalyzed: number
  /** Total transactions analyzed */
  totalTransactionsAnalyzed: number

  /** Primary account analyzed */
  primaryAccountId: string
  /** Primary account type */
  primaryAccountType: string
}

/**
 * Options for feature extraction
 */
export interface FeatureExtractionOptions {
  /** Number of months to analyze (default: 6) */
  monthsToAnalyze?: number
  /** Account IDs to analyze (default: all checking accounts) */
  accountIds?: string[]
  /** Include detailed monthly breakdown */
  includeMonthlyBreakdown?: boolean
}

/**
 * UnderwritingService
 *
 * Extracts financial features from bank transaction data for MCA underwriting.
 *
 * @example
 * ```typescript
 * const underwritingService = new UnderwritingService()
 *
 * // Extract features from Plaid data
 * const features = await underwritingService.extractFeatures(
 *   accessToken,
 *   { monthsToAnalyze: 6 }
 * )
 *
 * console.log(`ADB: $${features.averageDailyBalance}`)
 * console.log(`NSF Count: ${features.nsfCount}`)
 * console.log(`Positions: ${features.estimatedPositionCount}`)
 * ```
 */
export class UnderwritingService {
  private transactionsManager: PlaidTransactionsManager

  constructor(transactionsManager?: PlaidTransactionsManager) {
    this.transactionsManager = transactionsManager || plaidTransactionsManager
  }

  /**
   * Extract all underwriting features from bank data.
   *
   * Fetches transaction history and computes comprehensive
   * financial metrics for MCA underwriting decisions.
   *
   * @param accessToken - Plaid access token for the bank connection
   * @param options - Extraction options
   * @returns Complete underwriting features
   */
  async extractFeatures(
    accessToken: string,
    options: FeatureExtractionOptions = {}
  ): Promise<UnderwritingFeatures> {
    const { monthsToAnalyze = 6, accountIds } = options

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMonth(startDate.getMonth() - monthsToAnalyze)

    // Fetch transactions
    const { accounts, transactions } = await this.transactionsManager.fetchAllTransactions(
      accessToken,
      startDate.toISOString().split('T')[0],
      endDate.toISOString().split('T')[0],
      accountIds
    )

    // Select primary account (first checking account)
    const checkingAccounts = accounts.filter(
      (a) => a.type === 'depository' && (a.subtype === 'checking' || a.subtype === 'savings')
    )
    const primaryAccount = checkingAccounts[0] || accounts[0]

    if (!primaryAccount) {
      throw new Error('No suitable account found for underwriting analysis')
    }

    // Filter transactions to primary account
    const accountTransactions = transactions.filter((t) => t.accountId === primaryAccount.accountId)

    // Analyze transactions — anchor balance series to the known current balance
    const analysis = this.analyzeTransactions(
      accountTransactions,
      startDate,
      endDate,
      primaryAccount.balances.current
    )

    // Detect lender payments
    const lenderPayments = this.detectLenderPayments(accountTransactions)

    // Calculate revenue trends
    const revenueTrend = this.analyzeRevenueTrend(accountTransactions)

    // Calculate deposit consistency
    const depositConsistencyScore = this.calculateDepositConsistency(accountTransactions)

    // Calculate days since last deposit. Sort by date and use the most recent
    // deposit; the source array order is not guaranteed to be chronological.
    const deposits = accountTransactions
      .filter((t) => t.amount < 0 && !this.isTransfer(t))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const lastDepositDate =
      deposits.length > 0 ? new Date(deposits[deposits.length - 1].date) : new Date()
    const daysSinceLastDeposit = Math.max(
      0,
      Math.floor((new Date().getTime() - lastDepositDate.getTime()) / (1000 * 60 * 60 * 24))
    )

    // Estimate position count and payment obligations
    const { positionCount, totalObligations } = this.estimatePositions(lenderPayments)

    return {
      averageDailyBalance: analysis.averageDailyBalance,
      minimumDailyBalance: analysis.minimumDailyBalance,
      maximumDailyBalance: analysis.maximumDailyBalance,
      currentBalance: primaryAccount.balances.current || 0,

      nsfCount: analysis.nsfCount,
      nsfFeeTotal: analysis.nsfFeeTotal,
      negativeDays: analysis.negativeDays,
      negativeDaysPercentage:
        analysis.totalDays > 0 ? (analysis.negativeDays / analysis.totalDays) * 100 : 0,
      balanceAnchored: analysis.balanceAnchored,

      lenderPayments,
      estimatedPositionCount: positionCount,
      estimatedPaymentObligations: totalObligations,

      revenueTrend,
      averageMonthlyDeposits: revenueTrend.averageMonthlyRevenue,
      totalDeposits: analysis.totalDeposits,

      depositConsistencyScore,
      daysSinceLastDeposit,

      analysisStartDate: startDate.toISOString().split('T')[0],
      analysisEndDate: endDate.toISOString().split('T')[0],
      totalDaysAnalyzed: analysis.totalDays,
      totalTransactionsAnalyzed: accountTransactions.length,

      primaryAccountId: primaryAccount.accountId,
      primaryAccountType: `${primaryAccount.type}/${primaryAccount.subtype || 'unknown'}`
    }
  }

  /**
   * Analyze transactions for basic metrics.
   *
   * Calculates ADB, NSF counts, and balance statistics.
   */
  analyzeTransactions(
    transactions: PlaidTransaction[],
    startDate: Date,
    endDate: Date,
    /**
     * Known current (closing) balance for the account, used to anchor the
     * running-balance series to reality. When provided, the opening balance is
     * back-derived so the final modeled balance equals this value. When
     * undefined, balances are computed relative to a zero opening balance and
     * absolute balance metrics are flagged as non-anchored.
     */
    currentBalance?: number
  ): {
    averageDailyBalance: number
    minimumDailyBalance: number
    maximumDailyBalance: number
    nsfCount: number
    nsfFeeTotal: number
    negativeDays: number
    totalDays: number
    totalDeposits: number
    dailyBalances: DailyBalance[]
    balanceAnchored: boolean
  } {
    // Sort transactions by date (oldest first)
    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    // Determine the opening balance. In Plaid, positive amounts are debits
    // (withdrawals) and negative amounts are credits (deposits), so each tx
    // changes the balance by `-tx.amount`. If we know the closing balance, the
    // opening balance is closing minus the net effect of all transactions.
    const balanceAnchored = typeof currentBalance === 'number' && Number.isFinite(currentBalance)
    let openingBalance = 0
    if (balanceAnchored) {
      const netEffect = sortedTransactions.reduce((sum, tx) => sum - tx.amount, 0)
      openingBalance = (currentBalance as number) - netEffect
    }

    // Build daily balance map
    const dailyBalances: Map<string, DailyBalance> = new Map()

    // Initialize days in range
    const currentDate = new Date(startDate)
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0]
      dailyBalances.set(dateStr, {
        date: dateStr,
        balance: 0,
        deposits: 0,
        withdrawals: 0
      })
      currentDate.setDate(currentDate.getDate() + 1)
    }

    // Process transactions
    let nsfCount = 0
    let nsfFeeTotal = 0
    let totalDeposits = 0
    let runningBalance = openingBalance

    for (const tx of sortedTransactions) {
      const dateStr = tx.date
      const daily = dailyBalances.get(dateStr)

      if (daily) {
        // In Plaid, positive amounts are debits (withdrawals)
        // Negative amounts are credits (deposits)
        if (tx.amount < 0) {
          daily.deposits += Math.abs(tx.amount)
          totalDeposits += Math.abs(tx.amount)
        } else {
          daily.withdrawals += tx.amount
        }

        // Check for NSF/overdraft
        const parsed = this.transactionsManager.parseTransactionCategory(tx)
        if (parsed.isNsfFee) {
          nsfCount++
          nsfFeeTotal += tx.amount
        }

        // Update running balance
        runningBalance -= tx.amount // Subtract because Plaid uses opposite sign
        daily.balance = runningBalance
      }
    }

    // Carry the running balance forward across days with no transactions so the
    // daily series reflects the actual balance held each day, not a reset to 0.
    let carried = openingBalance
    for (const day of dailyBalances.values()) {
      if (day.deposits === 0 && day.withdrawals === 0) {
        day.balance = carried
      } else {
        carried = day.balance
      }
    }

    // Calculate statistics
    const balanceValues = Array.from(dailyBalances.values())
    let minBalance = Infinity
    let maxBalance = -Infinity
    let totalBalance = 0
    let negativeDays = 0

    for (const day of balanceValues) {
      if (day.balance < minBalance) minBalance = day.balance
      if (day.balance > maxBalance) maxBalance = day.balance
      totalBalance += day.balance
      if (day.balance < 0) negativeDays++
    }

    const totalDays = balanceValues.length || 1
    const averageDailyBalance = totalBalance / totalDays

    return {
      averageDailyBalance,
      minimumDailyBalance: minBalance === Infinity ? 0 : minBalance,
      maximumDailyBalance: maxBalance === -Infinity ? 0 : maxBalance,
      nsfCount,
      nsfFeeTotal,
      // When not balance-anchored, negativeDays is not meaningful as an
      // overdraft count (the series is relative to a zero opening balance);
      // report 0 to avoid feeding fictitious overdraft signals downstream.
      negativeDays: balanceAnchored ? negativeDays : 0,
      totalDays,
      totalDeposits,
      dailyBalances: balanceValues,
      balanceAnchored
    }
  }

  /**
   * Detect lender/MCA payments in transaction history.
   *
   * Identifies recurring payments to known MCA lenders and
   * estimates payment frequency.
   */
  detectLenderPayments(transactions: PlaidTransaction[]): DetectedLenderPayment[] {
    const lenderPayments: DetectedLenderPayment[] = []
    const paymentsByLender: Map<string, PlaidTransaction[]> = new Map()

    // Group transactions that look like lender payments
    for (const tx of transactions) {
      const parsed = this.transactionsManager.parseTransactionCategory(tx)

      if (parsed.isLenderPayment && tx.amount > 0) {
        // Positive amount = withdrawal = payment to lender
        const lenderName = this.extractLenderName(tx)
        const existing = paymentsByLender.get(lenderName) || []
        existing.push(tx)
        paymentsByLender.set(lenderName, existing)
      }
    }

    // Analyze each lender's payment pattern
    for (const [lenderName, payments] of paymentsByLender) {
      if (payments.length === 0) continue

      // Sort by date
      payments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      // Determine frequency
      const frequency = this.determinePaymentFrequency(payments)

      // Get most recent payment
      const latestPayment = payments[payments.length - 1]

      // Calculate average payment amount
      const avgAmount = payments.reduce((sum, p) => sum + p.amount, 0) / payments.length

      lenderPayments.push({
        transactionId: latestPayment.transactionId,
        date: latestPayment.date,
        amount: avgAmount,
        lenderName,
        frequency,
        confidence: this.calculateLenderConfidence(payments)
      })
    }

    return lenderPayments
  }

  /**
   * Analyze revenue trends from deposit patterns.
   */
  analyzeRevenueTrend(transactions: PlaidTransaction[]): RevenueTrend {
    // Filter to deposits only (negative amounts in Plaid)
    const deposits = transactions.filter((t) => t.amount < 0 && !this.isTransfer(t))

    // Group by month
    const monthlyData: Map<string, MonthlyRevenue> = new Map()

    for (const tx of deposits) {
      const month = tx.date.substring(0, 7) // YYYY-MM
      const existing = monthlyData.get(month) || {
        month,
        totalDeposits: 0,
        depositCount: 0,
        averageDeposit: 0,
        maxDeposit: 0,
        minDeposit: Infinity
      }

      const amount = Math.abs(tx.amount)
      existing.totalDeposits += amount
      existing.depositCount++
      if (amount > existing.maxDeposit) existing.maxDeposit = amount
      if (amount < existing.minDeposit) existing.minDeposit = amount

      monthlyData.set(month, existing)
    }

    // Calculate averages and convert to array
    const monthlyArray: MonthlyRevenue[] = []
    for (const data of monthlyData.values()) {
      data.averageDeposit = data.depositCount > 0 ? data.totalDeposits / data.depositCount : 0
      if (data.minDeposit === Infinity) data.minDeposit = 0
      monthlyArray.push(data)
    }

    // Sort by month
    monthlyArray.sort((a, b) => a.month.localeCompare(b.month))

    // Calculate trend
    const { direction, percentageChange } = this.calculateTrendDirection(
      monthlyArray.map((m) => m.totalDeposits)
    )

    // Calculate averages
    const revenues = monthlyArray.map((m) => m.totalDeposits)
    const averageMonthlyRevenue =
      revenues.length > 0 ? revenues.reduce((a, b) => a + b, 0) / revenues.length : 0

    const sortedRevenues = [...revenues].sort((a, b) => a - b)
    const medianMonthlyRevenue =
      sortedRevenues.length > 0 ? sortedRevenues[Math.floor(sortedRevenues.length / 2)] : 0

    // Calculate seasonality score (variance coefficient)
    const variance =
      revenues.length > 1
        ? revenues.reduce((sum, r) => sum + Math.pow(r - averageMonthlyRevenue, 2), 0) /
          revenues.length
        : 0
    const stdDev = Math.sqrt(variance)
    const seasonalityScore =
      averageMonthlyRevenue > 0 ? Math.min(100, (stdDev / averageMonthlyRevenue) * 100) : 0

    return {
      direction,
      percentageChange,
      averageMonthlyRevenue,
      medianMonthlyRevenue,
      seasonalityScore,
      monthlyData: monthlyArray
    }
  }

  /**
   * Calculate deposit consistency score.
   *
   * Higher score indicates more regular deposit patterns,
   * which is favorable for MCA underwriting.
   */
  calculateDepositConsistency(transactions: PlaidTransaction[]): number {
    const deposits = transactions.filter((t) => t.amount < 0 && !this.isTransfer(t))

    if (deposits.length < 2) {
      return 0
    }

    // Sort by date
    const sortedDeposits = [...deposits].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    )

    // Calculate intervals between deposits
    const intervals: number[] = []
    for (let i = 1; i < sortedDeposits.length; i++) {
      const daysDiff =
        (new Date(sortedDeposits[i].date).getTime() -
          new Date(sortedDeposits[i - 1].date).getTime()) /
        (1000 * 60 * 60 * 24)
      intervals.push(daysDiff)
    }

    if (intervals.length === 0) {
      return 0
    }

    // Calculate coefficient of variation for intervals
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance =
      intervals.reduce((sum, i) => sum + Math.pow(i - avgInterval, 2), 0) / intervals.length
    const stdDev = Math.sqrt(variance)
    const cv = avgInterval > 0 ? stdDev / avgInterval : 1

    // Calculate amount consistency
    const amounts = deposits.map((d) => Math.abs(d.amount))
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const amountVariance =
      amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length
    const amountStdDev = Math.sqrt(amountVariance)
    const amountCv = avgAmount > 0 ? amountStdDev / avgAmount : 1

    // Combined score (lower CV = more consistent = higher score)
    // CV of 0 = 100, CV of 1 = 50, CV of 2 = 0
    const intervalScore = Math.max(0, Math.min(100, 100 - cv * 50))
    const amountScore = Math.max(0, Math.min(100, 100 - amountCv * 50))

    // Weighted average (timing consistency is slightly more important)
    return Math.round(intervalScore * 0.6 + amountScore * 0.4)
  }

  /**
   * Extract lender name from transaction
   */
  private extractLenderName(tx: PlaidTransaction): string {
    const name = (tx.merchantName || tx.name || '').toUpperCase()

    // Match against the curated funder dictionary (injected from private
    // calibration; a bare public clone sees only the illustrative default).
    for (const lender of mcaLenderNames()) {
      if (name.includes(lender)) {
        return lender
      }
    }

    // Return cleaned name for unknown lenders
    return name.substring(0, 50)
  }

  /**
   * Determine payment frequency from transaction pattern
   */
  private determinePaymentFrequency(
    payments: PlaidTransaction[]
  ): 'daily' | 'weekly' | 'bi-weekly' | 'monthly' | 'irregular' {
    if (payments.length < 2) {
      return 'irregular'
    }

    // Calculate average interval
    const intervals: number[] = []
    for (let i = 1; i < payments.length; i++) {
      const daysDiff =
        (new Date(payments[i].date).getTime() - new Date(payments[i - 1].date).getTime()) /
        (1000 * 60 * 60 * 24)
      intervals.push(daysDiff)
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length

    // Classify by average interval
    if (avgInterval <= 2) return 'daily'
    if (avgInterval <= 8) return 'weekly'
    if (avgInterval <= 16) return 'bi-weekly'
    if (avgInterval <= 35) return 'monthly'
    return 'irregular'
  }

  /**
   * Calculate confidence score for lender detection
   */
  private calculateLenderConfidence(payments: PlaidTransaction[]): number {
    let score = 0.5 // Base confidence

    // More payments = higher confidence
    if (payments.length >= 20) score += 0.2
    else if (payments.length >= 10) score += 0.15
    else if (payments.length >= 5) score += 0.1

    // Consistent amounts = higher confidence
    const amounts = payments.map((p) => p.amount)
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length
    const variance =
      amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length
    const cv = avgAmount > 0 ? Math.sqrt(variance) / avgAmount : 1

    if (cv < 0.1)
      score += 0.2 // Very consistent amounts
    else if (cv < 0.25) score += 0.1

    return Math.min(1, score)
  }

  /**
   * Calculate trend direction from monthly values
   */
  private calculateTrendDirection(values: number[]): {
    direction: 'increasing' | 'stable' | 'decreasing' | 'volatile'
    percentageChange: number
  } {
    if (values.length < 2) {
      return { direction: 'stable', percentageChange: 0 }
    }

    // Calculate linear regression slope
    const n = values.length
    const sumX = (n * (n - 1)) / 2
    const sumY = values.reduce((a, b) => a + b, 0)
    const sumXY = values.reduce((sum, y, i) => sum + i * y, 0)
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
    void slope

    // Calculate percentage change
    const firstAvg = (values[0] + values[1] + (values[2] || values[1])) / 3
    const lastIdx = values.length - 1
    const lastAvg =
      (values[lastIdx] + values[lastIdx - 1] + (values[lastIdx - 2] || values[lastIdx - 1])) / 3
    const percentageChange = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0

    // Check volatility
    const avgValue = sumY / n
    const variance = values.reduce((sum, v) => sum + Math.pow(v - avgValue, 2), 0) / n
    const cv = avgValue > 0 ? Math.sqrt(variance) / avgValue : 0

    // Determine direction
    let direction: 'increasing' | 'stable' | 'decreasing' | 'volatile'

    if (cv > 0.5) {
      direction = 'volatile'
    } else if (percentageChange > 10) {
      direction = 'increasing'
    } else if (percentageChange < -10) {
      direction = 'decreasing'
    } else {
      direction = 'stable'
    }

    return { direction, percentageChange }
  }

  /**
   * Check if transaction is a transfer
   */
  private isTransfer(tx: PlaidTransaction): boolean {
    const parsed = this.transactionsManager.parseTransactionCategory(tx)
    return parsed.isTransfer
  }

  /**
   * Estimate number of positions and total obligations
   */
  private estimatePositions(lenderPayments: DetectedLenderPayment[]): {
    positionCount: number
    totalObligations: number
  } {
    // Count unique lenders with recent activity
    const uniqueLenders = new Set(lenderPayments.map((p) => p.lenderName))
    const positionCount = uniqueLenders.size

    // Calculate total daily obligations
    let totalObligations = 0
    for (const payment of lenderPayments) {
      switch (payment.frequency) {
        case 'daily':
          totalObligations += payment.amount
          break
        case 'weekly':
          totalObligations += payment.amount / 5 // 5 business days
          break
        case 'bi-weekly':
          totalObligations += payment.amount / 10
          break
        case 'monthly':
          totalObligations += payment.amount / 22 // ~22 business days
          break
        default:
          totalObligations += payment.amount / 22
      }
    }

    return { positionCount, totalObligations }
  }
}

/**
 * Default UnderwritingService instance
 */
export const underwritingService = new UnderwritingService()

/**
 * Create a new UnderwritingService with custom transactions manager
 */
export function createUnderwritingService(
  transactionsManager: PlaidTransactionsManager
): UnderwritingService {
  return new UnderwritingService(transactionsManager)
}
