/**
 * Bank-statement pattern analyzer (walking skeleton).
 *
 * Computes the same `UnderwritingFeatures` shape the Plaid-backed
 * `UnderwritingService` extracts — but from a normalized statement-transaction
 * list (e.g. parsed from a CSV a broker received from a merchant), so
 * underwriting can start before any bank connection exists. The feature output
 * plugs straight into the existing `QualificationService`.
 *
 * Sign convention matches Plaid (and `UnderwritingService.analyzeTransactions`):
 * POSITIVE amount = debit/withdrawal, NEGATIVE amount = credit/deposit.
 *
 * Thresholds, frequency classification, obligation divisors, trend and
 * consistency math intentionally mirror `UnderwritingService` so a statement
 * analysis and a Plaid analysis of the same account agree.
 *
 * Skeleton limits (named, honest): input is pre-parsed rows only (no PDF/OCR,
 * no OFX); recurring-debit detection is description-pattern based, so the
 * detected `lenderName` is the normalized statement description, not a
 * verified lender identity — treat positions as leads for human review.
 *
 * @module server/services/BankStatementAnalyzer
 */

import type {
  UnderwritingFeatures,
  DetectedLenderPayment,
  RevenueTrend,
  MonthlyRevenue
} from './UnderwritingService'

/** One normalized statement transaction row. */
export interface CsvTransaction {
  /** ISO date, YYYY-MM-DD */
  date: string
  /** Statement description line */
  description: string
  /** Plaid sign convention: positive = debit, negative = deposit */
  amount: number
  /** Statement running balance AFTER this transaction, when the export has it */
  running_balance?: number
}

/** Analyzer output: the full underwriting feature set + skeleton extras. */
export interface BankStatementAnalysis extends UnderwritingFeatures {
  /** True when two or more concurrent daily/weekly fixed-debit positions are detected */
  stackingDetected: boolean
  /** Simple headroom estimate: (ADB * 0.5) - estimated daily obligations */
  capacityEstimate: number
}

// Mirrors NSF_INDICATORS in server/integrations/plaid/transactions.ts (not
// exported there); keep the two lists in sync.
const NSF_DESCRIPTION_KEYWORDS = [
  'NSF',
  'OVERDRAFT',
  'OD FEE',
  'INSUFFICIENT FUNDS',
  'RETURNED ITEM',
  'RETURNED CHECK',
  'UNCOLLECTED FUNDS'
]

// A description group must recur at least this often before it can count as a
// fixed-debit position (fewer repeats cannot establish a daily/weekly cadence).
const MIN_POSITION_OCCURRENCES = 4
// Amount coefficient-of-variation ceiling for a "fixed" debit: MCA remittances
// are near-constant; payroll/supplier runs vary. Matches the "very consistent
// amounts" band of UnderwritingService.calculateLenderConfidence.
const FIXED_AMOUNT_CV_MAX = 0.1

const MS_PER_DAY = 1000 * 60 * 60 * 24

export class BankStatementAnalyzer {
  /**
   * Analyze a normalized statement-transaction list into the underwriting
   * feature set. Throws on an empty list — no data is not a zero-risk signal.
   */
  analyze(transactions: CsvTransaction[]): BankStatementAnalysis {
    if (transactions.length === 0) {
      throw new Error('Bank-statement analysis requires at least one transaction')
    }

    const rows = [...transactions].sort((a, b) => a.date.localeCompare(b.date))
    const startDate = rows[0].date
    const endDate = rows[rows.length - 1].date
    const totalDaysAnalyzed = Math.max(1, daysBetween(startDate, endDate) + 1)

    const balanceAnchored = rows.some((r) => typeof r.running_balance === 'number')
    const dailyBalances = this.buildDailyBalanceSeries(rows, balanceAnchored)

    const averageDailyBalance = round2(mean(dailyBalances))
    const minimumDailyBalance = round2(Math.min(...dailyBalances))
    const maximumDailyBalance = round2(Math.max(...dailyBalances))
    const currentBalance = round2(dailyBalances[dailyBalances.length - 1])

    // Negative-day metrics are only meaningful when the series is anchored to
    // a real statement balance (same guard as UnderwritingService).
    const negativeDays = balanceAnchored ? dailyBalances.filter((b) => b < 0).length : 0
    const negativeDaysPercentage = balanceAnchored
      ? round2((negativeDays / dailyBalances.length) * 100)
      : 0

    const { nsfCount, nsfFeeTotal } = this.detectNsfEvents(rows)
    const lenderPayments = this.detectRecurringFixedDebits(rows)
    const { positionCount, totalObligations } = this.estimateObligations(lenderPayments)

    const deposits = rows.filter((r) => r.amount < 0)
    const totalDeposits = round2(deposits.reduce((sum, r) => sum + Math.abs(r.amount), 0))
    const monthsSpanned = Math.max(1, totalDaysAnalyzed / 30)
    const averageMonthlyDeposits = round2(totalDeposits / monthsSpanned)
    const lastDepositDate = deposits.length > 0 ? deposits[deposits.length - 1].date : null
    const daysSinceLastDeposit = lastDepositDate
      ? daysBetween(lastDepositDate, endDate)
      : totalDaysAnalyzed

    const revenueTrend = this.computeRevenueTrend(deposits)
    const depositConsistencyScore = this.computeDepositConsistency(deposits)

    const estimatedPaymentObligations = round2(totalObligations)
    const capacityEstimate = round2(averageDailyBalance * 0.5 - estimatedPaymentObligations)

    return {
      averageDailyBalance,
      minimumDailyBalance,
      maximumDailyBalance,
      currentBalance,
      nsfCount,
      nsfFeeTotal: round2(nsfFeeTotal),
      negativeDays,
      negativeDaysPercentage,
      balanceAnchored,
      lenderPayments,
      estimatedPositionCount: positionCount,
      estimatedPaymentObligations,
      revenueTrend,
      averageMonthlyDeposits,
      totalDeposits,
      depositConsistencyScore,
      daysSinceLastDeposit,
      analysisStartDate: startDate,
      analysisEndDate: endDate,
      totalDaysAnalyzed,
      totalTransactionsAnalyzed: rows.length,
      primaryAccountId: 'statement-csv',
      primaryAccountType: 'checking',
      stackingDetected: positionCount >= 2,
      capacityEstimate
    }
  }

  /**
   * One balance value per calendar day across the analysis span, carrying the
   * last known balance forward over quiet days. Anchored mode trusts the
   * statement's running balance; unanchored mode accumulates flows from an
   * assumed zero opening balance (relative movement only).
   */
  private buildDailyBalanceSeries(rows: CsvTransaction[], anchored: boolean): number[] {
    const endOfDayBalance = new Map<string, number>()

    if (anchored) {
      for (const row of rows) {
        if (typeof row.running_balance === 'number') {
          endOfDayBalance.set(row.date, row.running_balance)
        }
      }
    } else {
      let running = 0
      for (const row of rows) {
        running -= row.amount // positive amount = debit = balance goes down
        endOfDayBalance.set(row.date, running)
      }
    }

    const series: number[] = []
    const start = new Date(`${rows[0].date}T00:00:00Z`)
    const end = new Date(`${rows[rows.length - 1].date}T00:00:00Z`)
    // Seed with the earliest known balance so leading quiet days (anchored
    // mode only) carry a real value instead of zero.
    let last = endOfDayBalance.get(rows[0].date) ?? 0
    for (let t = start.getTime(); t <= end.getTime(); t += MS_PER_DAY) {
      const day = new Date(t).toISOString().slice(0, 10)
      const known = endOfDayBalance.get(day)
      if (known !== undefined) last = known
      series.push(last)
    }
    return series
  }

  private detectNsfEvents(rows: CsvTransaction[]): { nsfCount: number; nsfFeeTotal: number } {
    let nsfCount = 0
    let nsfFeeTotal = 0
    for (const row of rows) {
      const description = row.description.toUpperCase()
      if (NSF_DESCRIPTION_KEYWORDS.some((keyword) => description.includes(keyword))) {
        nsfCount++
        nsfFeeTotal += Math.abs(row.amount)
      }
    }
    return { nsfCount, nsfFeeTotal }
  }

  /**
   * Find recurring fixed debits: description groups that repeat at a daily or
   * weekly cadence with near-constant amounts — the signature of an active
   * MCA/loan remittance. Bi-weekly/monthly/irregular groups (rent, utilities)
   * are not counted as positions.
   */
  private detectRecurringFixedDebits(rows: CsvTransaction[]): DetectedLenderPayment[] {
    const groups = new Map<string, CsvTransaction[]>()
    for (const row of rows) {
      if (row.amount <= 0) continue // debits only
      const description = row.description.toUpperCase()
      if (NSF_DESCRIPTION_KEYWORDS.some((keyword) => description.includes(keyword))) continue
      const key = description.replace(/\s+/g, ' ').trim()
      const existing = groups.get(key) ?? []
      existing.push(row)
      groups.set(key, existing)
    }

    const detected: DetectedLenderPayment[] = []
    for (const [name, payments] of groups) {
      if (payments.length < MIN_POSITION_OCCURRENCES) continue

      const amounts = payments.map((p) => p.amount)
      const avgAmount = mean(amounts)
      if (avgAmount <= 0 || coefficientOfVariation(amounts) > FIXED_AMOUNT_CV_MAX) continue

      const frequency = classifyFrequency(payments.map((p) => p.date))
      if (frequency !== 'daily' && frequency !== 'weekly') continue

      const latest = payments[payments.length - 1]
      detected.push({
        transactionId: `statement:${name}:${latest.date}`,
        date: latest.date,
        amount: round2(avgAmount),
        lenderName: name,
        frequency,
        confidence: this.confidenceFor(payments)
      })
    }
    return detected
  }

  // Same shape as UnderwritingService.calculateLenderConfidence: base 0.5,
  // bumped by repeat count and amount consistency.
  private confidenceFor(payments: CsvTransaction[]): number {
    let score = 0.5
    if (payments.length >= 20) score += 0.2
    else if (payments.length >= 10) score += 0.15
    else if (payments.length >= 5) score += 0.1

    const cv = coefficientOfVariation(payments.map((p) => p.amount))
    if (cv < 0.1) score += 0.2
    else if (cv < 0.25) score += 0.1

    return Math.min(1, round2(score))
  }

  // Daily-equivalent obligations, same divisors as
  // UnderwritingService.estimatePositions (5 / 10 / 22 business days).
  private estimateObligations(lenderPayments: DetectedLenderPayment[]): {
    positionCount: number
    totalObligations: number
  } {
    const positionCount = new Set(lenderPayments.map((p) => p.lenderName)).size
    let totalObligations = 0
    for (const payment of lenderPayments) {
      switch (payment.frequency) {
        case 'daily':
          totalObligations += payment.amount
          break
        case 'weekly':
          totalObligations += payment.amount / 5
          break
        case 'bi-weekly':
          totalObligations += payment.amount / 10
          break
        default:
          totalObligations += payment.amount / 22
      }
    }
    return { positionCount, totalObligations }
  }

  private computeRevenueTrend(deposits: CsvTransaction[]): RevenueTrend {
    const byMonth = new Map<string, MonthlyRevenue>()
    for (const deposit of deposits) {
      const month = deposit.date.substring(0, 7)
      const entry = byMonth.get(month) ?? {
        month,
        totalDeposits: 0,
        depositCount: 0,
        averageDeposit: 0,
        maxDeposit: 0,
        minDeposit: Infinity
      }
      const amount = Math.abs(deposit.amount)
      entry.totalDeposits += amount
      entry.depositCount++
      if (amount > entry.maxDeposit) entry.maxDeposit = amount
      if (amount < entry.minDeposit) entry.minDeposit = amount
      byMonth.set(month, entry)
    }

    const monthlyData = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
    for (const entry of monthlyData) {
      entry.averageDeposit = entry.depositCount > 0 ? entry.totalDeposits / entry.depositCount : 0
      if (entry.minDeposit === Infinity) entry.minDeposit = 0
    }

    const revenues = monthlyData.map((m) => m.totalDeposits)
    const averageMonthlyRevenue = revenues.length > 0 ? mean(revenues) : 0
    const sorted = [...revenues].sort((a, b) => a - b)
    const medianMonthlyRevenue = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0

    const stdDev = Math.sqrt(
      revenues.length > 1
        ? revenues.reduce((sum, r) => sum + Math.pow(r - averageMonthlyRevenue, 2), 0) /
            revenues.length
        : 0
    )
    const seasonalityScore =
      averageMonthlyRevenue > 0 ? Math.min(100, (stdDev / averageMonthlyRevenue) * 100) : 0

    return {
      ...this.trendDirection(revenues),
      averageMonthlyRevenue: round2(averageMonthlyRevenue),
      medianMonthlyRevenue: round2(medianMonthlyRevenue),
      seasonalityScore: round2(seasonalityScore),
      monthlyData
    }
  }

  // Same classification bands as UnderwritingService.calculateTrendDirection:
  // CV > 0.5 volatile, |first→last smoothed change| beyond ±10% directional.
  private trendDirection(values: number[]): {
    direction: RevenueTrend['direction']
    percentageChange: number
  } {
    if (values.length < 2) {
      return { direction: 'stable', percentageChange: 0 }
    }

    const firstAvg = (values[0] + values[1] + (values[2] ?? values[1])) / 3
    const lastIdx = values.length - 1
    const lastAvg =
      (values[lastIdx] + values[lastIdx - 1] + (values[lastIdx - 2] ?? values[lastIdx - 1])) / 3
    const percentageChange = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0

    const cv = coefficientOfVariation(values)
    let direction: RevenueTrend['direction']
    if (cv > 0.5) direction = 'volatile'
    else if (percentageChange > 10) direction = 'increasing'
    else if (percentageChange < -10) direction = 'decreasing'
    else direction = 'stable'

    return { direction, percentageChange: round2(percentageChange) }
  }

  // Interval + amount CV scoring, 60/40 weighted — mirrors
  // UnderwritingService.calculateDepositConsistency.
  private computeDepositConsistency(deposits: CsvTransaction[]): number {
    if (deposits.length < 2) return 0

    const intervals: number[] = []
    for (let i = 1; i < deposits.length; i++) {
      intervals.push(daysBetween(deposits[i - 1].date, deposits[i].date))
    }
    const intervalCv = intervals.length > 0 ? coefficientOfVariation(intervals) : 1
    const amountCv = coefficientOfVariation(deposits.map((d) => Math.abs(d.amount)))

    const intervalScore = Math.max(0, Math.min(100, 100 - intervalCv * 50))
    const amountScore = Math.max(0, Math.min(100, 100 - amountCv * 50))
    return Math.round(intervalScore * 0.6 + amountScore * 0.4)
  }
}

function classifyFrequency(sortedDates: string[]): DetectedLenderPayment['frequency'] {
  if (sortedDates.length < 2) return 'irregular'
  const intervals: number[] = []
  for (let i = 1; i < sortedDates.length; i++) {
    intervals.push(daysBetween(sortedDates[i - 1], sortedDates[i]))
  }
  const avg = mean(intervals)
  if (avg <= 2) return 'daily'
  if (avg <= 8) return 'weekly'
  if (avg <= 16) return 'bi-weekly'
  if (avg <= 35) return 'monthly'
  return 'irregular'
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) /
      MS_PER_DAY
  )
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return 1
  const avg = mean(values)
  if (avg === 0) return 1
  const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length
  return Math.sqrt(variance) / Math.abs(avg)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
