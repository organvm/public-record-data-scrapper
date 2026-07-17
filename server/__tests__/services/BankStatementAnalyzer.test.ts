import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BankStatementAnalyzer,
  type CsvTransaction
} from '../../services/BankStatementAnalyzer'

const analyzer = new BankStatementAnalyzer()

/** Build a run of weekday debits with a fixed amount and description. */
function weekdayDebits(
  description: string,
  amount: number,
  startIso: string,
  count: number
): CsvTransaction[] {
  const rows: CsvTransaction[] = []
  const cursor = new Date(`${startIso}T00:00:00Z`)
  while (rows.length < count) {
    const day = cursor.getUTCDay()
    if (day >= 1 && day <= 5) {
      rows.push({ date: cursor.toISOString().slice(0, 10), description, amount })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return rows
}

/** Weekly (every-7-days) debits. */
function weeklyDebits(
  description: string,
  amount: number,
  startIso: string,
  count: number
): CsvTransaction[] {
  const rows: CsvTransaction[] = []
  const cursor = new Date(`${startIso}T00:00:00Z`)
  for (let i = 0; i < count; i++) {
    rows.push({ date: cursor.toISOString().slice(0, 10), description, amount })
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return rows
}

describe('BankStatementAnalyzer', () => {
  it('throws on an empty transaction list', () => {
    expect(() => analyzer.analyze([])).toThrow(/at least one transaction/)
  })

  it('computes ADB from an anchored running-balance series', () => {
    // Three consecutive days, balances 100 / 200 / 300 → ADB 200.
    const result = analyzer.analyze([
      { date: '2026-06-01', description: 'DEPOSIT A', amount: -100, running_balance: 100 },
      { date: '2026-06-02', description: 'DEPOSIT B', amount: -100, running_balance: 200 },
      { date: '2026-06-03', description: 'DEPOSIT C', amount: -100, running_balance: 300 }
    ])

    expect(result.balanceAnchored).toBe(true)
    expect(result.averageDailyBalance).toBe(200)
    expect(result.minimumDailyBalance).toBe(100)
    expect(result.maximumDailyBalance).toBe(300)
    expect(result.currentBalance).toBe(300)
    expect(result.totalDaysAnalyzed).toBe(3)
  })

  it('counts anchored negative days; reports zero when unanchored', () => {
    const anchored = analyzer.analyze([
      { date: '2026-06-01', description: 'VENDOR', amount: 50, running_balance: -25 },
      { date: '2026-06-02', description: 'DEPOSIT', amount: -100, running_balance: 75 }
    ])
    expect(anchored.negativeDays).toBe(1)
    expect(anchored.negativeDaysPercentage).toBe(50)

    const unanchored = analyzer.analyze([
      { date: '2026-06-01', description: 'VENDOR', amount: 50 },
      { date: '2026-06-02', description: 'DEPOSIT', amount: -100 }
    ])
    expect(unanchored.balanceAnchored).toBe(false)
    expect(unanchored.negativeDays).toBe(0)
    expect(unanchored.negativeDaysPercentage).toBe(0)
  })

  it('detects NSF events by description keyword', () => {
    const result = analyzer.analyze([
      { date: '2026-06-01', description: 'NSF FEE INSUFFICIENT FUNDS', amount: 35 },
      { date: '2026-06-05', description: 'OVERDRAFT ITEM FEE', amount: 35 },
      { date: '2026-06-09', description: 'CUSTOMER PAYMENT', amount: -500 }
    ])
    expect(result.nsfCount).toBe(2)
    expect(result.nsfFeeTotal).toBe(70)
  })

  it('detects a daily fixed debit as one position', () => {
    const result = analyzer.analyze(weekdayDebits('LENDER A ACH DEBIT', 450, '2026-06-01', 15))
    expect(result.estimatedPositionCount).toBe(1)
    expect(result.stackingDetected).toBe(false)
    expect(result.lenderPayments[0].frequency).toBe('daily')
    expect(result.lenderPayments[0].lenderName).toBe('LENDER A ACH DEBIT')
    expect(result.estimatedPaymentObligations).toBe(450)
  })

  it('detects a concurrent weekly fixed debit as a second position and flags stacking', () => {
    const rows = [
      ...weekdayDebits('LENDER A ACH DEBIT', 450, '2026-06-01', 15),
      ...weeklyDebits('LENDER B FUNDING PMT', 1000, '2026-06-01', 4)
    ]
    const result = analyzer.analyze(rows)
    expect(result.estimatedPositionCount).toBe(2)
    expect(result.stackingDetected).toBe(true)
    // Daily 450 + weekly 1000/5 business days = 650/day.
    expect(result.estimatedPaymentObligations).toBe(650)
  })

  it('ignores variable-amount recurring debits (payroll is not a position)', () => {
    const amounts = [5200, 6850, 7400, 5900]
    const rows = weeklyDebits('GUSTO PAYROLL RUN', 0, '2026-06-01', 4).map((row, i) => ({
      ...row,
      amount: amounts[i]
    }))
    const result = analyzer.analyze(rows)
    expect(result.estimatedPositionCount).toBe(0)
    expect(result.stackingDetected).toBe(false)
  })

  it('computes capacity as (ADB * 0.5) - daily obligations', () => {
    const rows = weekdayDebits('LENDER A ACH DEBIT', 450, '2026-06-01', 15).map((row) => ({
      ...row,
      running_balance: 10000
    }))
    const result = analyzer.analyze(rows)
    expect(result.averageDailyBalance).toBe(10000)
    expect(result.capacityEstimate).toBe(10000 * 0.5 - 450)
  })

  it('reports a stable revenue trend for flat monthly deposits', () => {
    const rows: CsvTransaction[] = []
    for (const month of ['04', '05', '06']) {
      for (const day of ['05', '15', '25']) {
        rows.push({ date: `2026-${month}-${day}`, description: 'CUSTOMER PAYMENT', amount: -10000 })
      }
    }
    const result = analyzer.analyze(rows)
    expect(result.revenueTrend.direction).toBe('stable')
    expect(result.revenueTrend.averageMonthlyRevenue).toBe(30000)
    expect(result.revenueTrend.monthlyData).toHaveLength(3)
    expect(result.depositConsistencyScore).toBeGreaterThan(80)
  })

  it('analyzes the shipped sample statement into the demo narrative', () => {
    // The committed sample is the demo artifact — bind it to the analyzer so
    // a drift in either shows up here, not in the room.
    const sample = JSON.parse(
      readFileSync(join(__dirname, '../../../samples/bank-statement-sample.json'), 'utf8')
    ) as { transactions: CsvTransaction[] }

    const result = analyzer.analyze(sample.transactions)

    expect(result.balanceAnchored).toBe(true)
    expect(result.estimatedPositionCount).toBe(2)
    expect(result.stackingDetected).toBe(true)
    const lenders = result.lenderPayments.map((p) => p.lenderName).sort()
    expect(lenders).toEqual(['FORWARD FINANCING ACH DEBIT', 'KAPITUS FUNDING PMT'])
    expect(result.lenderPayments.find((p) => p.lenderName.includes('FORWARD'))?.frequency).toBe(
      'daily'
    )
    expect(result.lenderPayments.find((p) => p.lenderName.includes('KAPITUS'))?.frequency).toBe(
      'weekly'
    )
    expect(result.nsfCount).toBe(4)
    expect(result.averageDailyBalance).toBeGreaterThan(0)
    expect(result.revenueTrend.monthlyData.length).toBeGreaterThanOrEqual(3)
  })
})
