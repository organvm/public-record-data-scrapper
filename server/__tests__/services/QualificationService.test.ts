import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  QualificationService,
  createQualificationService
} from '../../services/QualificationService'
import { __resetQualificationRulesCache } from '../../services/calibration/qualificationRules'
// DatabaseError imported for potential future use in error handling tests
import type { UnderwritingFeatures } from '../../services/UnderwritingService'

// The calibrated credit box is the MOAT and never lives in tracked source —
// including this test. So the suite injects a SAMPLE (obviously-non-real) rule
// set through the calibration seam (see
// server/services/calibration/qualificationRules.ts) via SCORING_CALIBRATION_PATH
// — exactly how an operator supplies their private calibration — and asserts the
// service faithfully applies WHATEVER it was given (rate/amount/threshold logic)
// plus the tier-classification logic. The real production bands are proven by the
// same code path with the operator's own private file, not embedded here.
//
// The sample bands below use round, clearly-synthetic numbers that preserve tier
// ORDERING (A best → D worst) so every scenario test still resolves to its
// intended tier. Decline caps are Infinity in source but never read by the A..D
// evaluation loops, so a large sentinel is fine in JSON.
const SAMPLE_RULES = {
  minAdbByTier: { A: 20000, B: 10000, C: 5000, D: 2000, Decline: 0 },
  maxNsfByTier: { A: 0, B: 2, C: 5, D: 10, Decline: 999999 },
  maxNegativeDaysByTier: { A: 0, B: 5, C: 10, D: 20, Decline: 999999 },
  maxPositionsByTier: { A: 0, B: 1, C: 3, D: 5, Decline: 999999 },
  minTimeInBusinessByTier: { A: 24, B: 12, C: 6, D: 3, Decline: 0 },
  minMonthlyRevenueByTier: { A: 40000, B: 20000, C: 10000, D: 5000, Decline: 0 },
  factorRatesByTier: { A: 1.1, B: 1.2, C: 1.3, D: 1.4, Decline: 0 },
  maxFundingMultiple: { A: 1.4, B: 1.2, C: 1.0, D: 0.8, Decline: 0 }
}

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock the underwriting service
vi.mock('../../services/UnderwritingService', () => ({
  underwritingService: {
    extractFeatures: vi.fn()
  },
  UnderwritingService: class MockUnderwritingService {
    extractFeatures = vi.fn()
  }
}))

import { database } from '../../database/connection'
import { underwritingService } from '../../services/UnderwritingService'

const mockQuery = vi.mocked(database.query)
const mockExtractFeatures = vi.mocked(underwritingService.extractFeatures)

describe('QualificationService', () => {
  let service: QualificationService
  let calibrationDir: string
  const originalCalibrationPath = process.env.SCORING_CALIBRATION_PATH

  const createMockFeatures = (
    overrides: Partial<UnderwritingFeatures> = {}
  ): UnderwritingFeatures => ({
    averageDailyBalance: 25000,
    minimumDailyBalance: 5000,
    maximumDailyBalance: 50000,
    currentBalance: 20000,
    nsfCount: 0,
    nsfFeeTotal: 0,
    negativeDays: 0,
    negativeDaysPercentage: 0,
    lenderPayments: [],
    estimatedPositionCount: 0,
    estimatedPaymentObligations: 0,
    revenueTrend: {
      direction: 'stable',
      percentageChange: 0,
      averageMonthlyRevenue: 50000,
      medianMonthlyRevenue: 50000,
      seasonalityScore: 20,
      monthlyData: []
    },
    averageMonthlyDeposits: 50000,
    totalDeposits: 300000,
    depositConsistencyScore: 80,
    daysSinceLastDeposit: 2,
    analysisStartDate: '2024-01-01',
    analysisEndDate: '2024-06-30',
    totalDaysAnalyzed: 180,
    totalTransactionsAnalyzed: 500,
    primaryAccountId: 'acc-1',
    primaryAccountType: 'depository/checking',
    ...overrides
  })

  beforeEach(() => {
    vi.clearAllMocks()
    // Inject the SAMPLE credit box through the calibration seam so these
    // assertions run against synthetic bands, never the real production values.
    calibrationDir = mkdtempSync(join(tmpdir(), 'qual-cal-'))
    const calibrationPath = join(calibrationDir, 'calibration.json')
    writeFileSync(calibrationPath, JSON.stringify({ qualificationRules: SAMPLE_RULES }))
    process.env.SCORING_CALIBRATION_PATH = calibrationPath
    __resetQualificationRulesCache()
    service = new QualificationService()
  })

  afterEach(() => {
    if (originalCalibrationPath === undefined) delete process.env.SCORING_CALIBRATION_PATH
    else process.env.SCORING_CALIBRATION_PATH = originalCalibrationPath
    __resetQualificationRulesCache()
    rmSync(calibrationDir, { recursive: true, force: true })
  })

  describe('qualify', () => {
    it('should qualify prospect as Tier A for excellent metrics', async () => {
      const features = createMockFeatures({
        averageDailyBalance: 30000,
        nsfCount: 0,
        negativeDaysPercentage: 0,
        estimatedPositionCount: 0,
        averageMonthlyDeposits: 60000,
        depositConsistencyScore: 85,
        revenueTrend: {
          direction: 'increasing',
          percentageChange: 10,
          averageMonthlyRevenue: 60000,
          medianMonthlyRevenue: 60000,
          seasonalityScore: 15,
          monthlyData: []
        }
      })

      mockQuery.mockResolvedValueOnce([]) // prospect lookup returns empty

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 36 })

      expect(result.qualified).toBe(true)
      expect(result.tier).toBe('A')
      expect(result.suggestedRate).toBe(SAMPLE_RULES.factorRatesByTier.A)
    })

    it('should qualify prospect as Tier B for good metrics', async () => {
      // B-tier requires <= 1 warning and >= 6 passes. Inputs sit at/just above
      // the B thresholds of the injected SAMPLE_RULES (not the real bands).
      const features = createMockFeatures({
        averageDailyBalance: 20000, // >= sample B minAdb
        nsfCount: 1, // within sample B maxNsf, creates warning
        negativeDaysPercentage: 1, // within sample B maxNegativeDays
        estimatedPositionCount: 1, // at sample B maxPositions, creates warning
        averageMonthlyDeposits: 35000, // >= sample B minMonthlyRevenue
        depositConsistencyScore: 80 // Pass
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 18 })

      expect(result.qualified).toBe(true)
      // With the tier determination logic, having 1 warning and good passes = B
      expect(['A', 'B']).toContain(result.tier)
    })

    it('should qualify prospect as Tier C for moderate metrics', async () => {
      // C-tier requires <= 3 warnings and > 1 warning (to not be B). Inputs sit
      // in the C bands of the injected SAMPLE_RULES (not the real bands).
      const features = createMockFeatures({
        averageDailyBalance: 10000, // in sample C minAdb band, creates warning
        nsfCount: 3, // within sample C maxNsf, creates warning
        negativeDaysPercentage: 5, // within sample C maxNegativeDays, warning
        estimatedPositionCount: 2, // within sample C maxPositions, warning
        averageMonthlyDeposits: 18000, // in sample C minMonthlyRevenue band, warning
        depositConsistencyScore: 60 // Warning
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 9 })

      expect(result.qualified).toBe(true)
      // With multiple warnings, should be C or D tier
      expect(['C', 'D']).toContain(result.tier)
    })

    it('should qualify prospect as Tier D for marginal metrics', async () => {
      const features = createMockFeatures({
        averageDailyBalance: 5000,
        nsfCount: 6,
        negativeDaysPercentage: 12,
        estimatedPositionCount: 3,
        averageMonthlyDeposits: 12000,
        depositConsistencyScore: 45
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 4 })

      expect(result.qualified).toBe(true)
      expect(result.tier).toBe('D')
      expect(result.suggestedRate).toBe(SAMPLE_RULES.factorRatesByTier.D)
    })

    it('should decline prospect for poor metrics', async () => {
      const features = createMockFeatures({
        averageDailyBalance: 1000,
        nsfCount: 15,
        negativeDaysPercentage: 25,
        estimatedPositionCount: 5,
        averageMonthlyDeposits: 5000,
        depositConsistencyScore: 20
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 2 })

      expect(result.qualified).toBe(false)
      expect(result.tier).toBe('Decline')
      expect(result.maxAmount).toBe(0)
    })

    it('should calculate max funding amount based on monthly revenue', async () => {
      const features = createMockFeatures({
        averageDailyBalance: 30000,
        averageMonthlyDeposits: 100000
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features, { timeInBusinessMonths: 36 })

      // Tier A: up to (sample) 1.4x monthly revenue, capped at $500k.
      expect(result.maxAmount).toBe(100000 * SAMPLE_RULES.maxFundingMultiple.A)
    })

    it('should include warnings for concerning metrics', async () => {
      const features = createMockFeatures({
        daysSinceLastDeposit: 10,
        revenueTrend: {
          direction: 'decreasing',
          percentageChange: -15,
          averageMonthlyRevenue: 50000,
          medianMonthlyRevenue: 50000,
          seasonalityScore: 60,
          monthlyData: []
        }
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.includes('deposit'))).toBe(true)
    })

    it('should calculate risk score based on factors', async () => {
      const features = createMockFeatures({
        nsfCount: 5,
        negativeDaysPercentage: 10,
        estimatedPositionCount: 2
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      expect(result.riskScore).toBeGreaterThan(0)
      expect(result.riskScore).toBeLessThanOrEqual(100)
    })

    it('should calculate confidence based on data quality', async () => {
      const features = createMockFeatures({
        totalTransactionsAnalyzed: 600,
        totalDaysAnalyzed: 180,
        depositConsistencyScore: 80
      })

      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      expect(result.confidence).toBeGreaterThan(50)
    })

    it('should use prospect data when available', async () => {
      const mockProspect = {
        id: 'prospect-1',
        company_name: 'Test Corp',
        state: 'CA',
        industry: 'retail'
      }

      mockQuery.mockResolvedValueOnce([mockProspect])

      const features = createMockFeatures()
      const result = await service.qualify('prospect-1', features)

      expect(result.qualified).toBe(true)
    })
  })

  describe('qualifyWithBankAccess', () => {
    it('should extract features and qualify', async () => {
      const mockFeatures = createMockFeatures()
      mockExtractFeatures.mockResolvedValueOnce(mockFeatures)
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualifyWithBankAccess('prospect-1', 'access-token-123')

      expect(result.qualified).toBe(true)
    })
  })

  describe('getTierRequirements', () => {
    it('should return requirements for Tier A', () => {
      const requirements = service.getTierRequirements('A')

      expect(requirements.tier).toBe('A')
      expect(requirements.requirements.minAdb).toBe(SAMPLE_RULES.minAdbByTier.A)
      expect(requirements.requirements.maxNsf).toBe(SAMPLE_RULES.maxNsfByTier.A)
      expect(requirements.terms.factorRate).toBe(SAMPLE_RULES.factorRatesByTier.A)
    })

    it('should return requirements for Tier D', () => {
      const requirements = service.getTierRequirements('D')

      expect(requirements.tier).toBe('D')
      expect(requirements.requirements.minAdb).toBe(SAMPLE_RULES.minAdbByTier.D)
      expect(requirements.terms.factorRate).toBe(SAMPLE_RULES.factorRatesByTier.D)
    })
  })

  describe('updateRules', () => {
    it('should update qualification rules', () => {
      service.updateRules({
        factorRatesByTier: {
          A: 1.1,
          B: 1.2,
          C: 1.3,
          D: 1.4,
          Decline: 0
        }
      })

      const requirements = service.getTierRequirements('A')
      expect(requirements.terms.factorRate).toBe(1.1)
    })
  })

  describe('createQualificationService', () => {
    it('should create service with custom rules', () => {
      const customService = createQualificationService({
        minAdbByTier: {
          A: 50000,
          B: 30000,
          C: 15000,
          D: 5000,
          Decline: 0
        }
      })

      const requirements = customService.getTierRequirements('A')
      expect(requirements.requirements.minAdb).toBe(50000)
    })
  })

  describe('ADB evaluation', () => {
    it('should pass for high ADB', async () => {
      const features = createMockFeatures({ averageDailyBalance: 50000 })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const adbReason = result.reasons.find((r) => r.factor === 'Average Daily Balance')
      expect(adbReason?.result).toBe('pass')
    })

    it('should fail for very low ADB', async () => {
      const features = createMockFeatures({ averageDailyBalance: 1000 })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const adbReason = result.reasons.find((r) => r.factor === 'Average Daily Balance')
      expect(adbReason?.result).toBe('fail')
    })
  })

  describe('NSF evaluation', () => {
    it('should pass for zero NSF', async () => {
      const features = createMockFeatures({ nsfCount: 0 })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const nsfReason = result.reasons.find((r) => r.factor === 'NSF/Overdraft Count')
      expect(nsfReason?.result).toBe('pass')
    })

    it('should fail for excessive NSF', async () => {
      const features = createMockFeatures({ nsfCount: 20 })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const nsfReason = result.reasons.find((r) => r.factor === 'NSF/Overdraft Count')
      expect(nsfReason?.result).toBe('fail')
    })
  })

  describe('revenue trend evaluation', () => {
    it('should pass for increasing revenue', async () => {
      const features = createMockFeatures({
        revenueTrend: {
          direction: 'increasing',
          percentageChange: 15,
          averageMonthlyRevenue: 50000,
          medianMonthlyRevenue: 50000,
          seasonalityScore: 20,
          monthlyData: []
        }
      })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const trendReason = result.reasons.find((r) => r.factor === 'Revenue Trend')
      expect(trendReason?.result).toBe('pass')
    })

    it('should warn for decreasing revenue', async () => {
      const features = createMockFeatures({
        revenueTrend: {
          direction: 'decreasing',
          percentageChange: -20,
          averageMonthlyRevenue: 50000,
          medianMonthlyRevenue: 50000,
          seasonalityScore: 20,
          monthlyData: []
        }
      })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      const trendReason = result.reasons.find((r) => r.factor === 'Revenue Trend')
      expect(trendReason?.result).toBe('warning')
    })
  })

  describe('suggested terms', () => {
    it('should suggest longer term for higher amounts', async () => {
      const features = createMockFeatures({ averageMonthlyDeposits: 200000 })
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      expect(result.suggestedTermMonths).toBeGreaterThanOrEqual(9)
    })

    it('should calculate estimated daily payment', async () => {
      const features = createMockFeatures()
      mockQuery.mockResolvedValueOnce([])

      const result = await service.qualify('prospect-1', features)

      expect(result.estimatedDailyPayment).toBeGreaterThan(0)
    })
  })
})
