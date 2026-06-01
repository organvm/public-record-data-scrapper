import { describe, it, expect } from 'vitest'
import { calculateMLScoring, addMLConfidenceToSignal } from '../mlScoring'
import type { Prospect, IndustryType, UCCFiling } from '@public-records/core'

describe('mlScoring', () => {
  const createMockUCCFiling = (overrides: Partial<UCCFiling> = {}): UCCFiling => ({
    id: 'filing-1',
    filingDate: '2024-01-01',
    debtorName: 'Test Company',
    securedParty: 'Test Bank',
    state: 'CA',
    status: 'active',
    filingType: 'UCC-1',
    ...overrides
  })

  const createMockProspect = (overrides: Partial<Prospect> = {}): Prospect => ({
    id: 'test-id',
    companyName: 'Test Company',
    state: 'CA',
    industry: 'technology' as IndustryType,
    priorityScore: 85,
    healthScore: {
      grade: 'B',
      score: 75,
      sentimentTrend: 'stable',
      reviewCount: 15,
      avgSentiment: 0.85,
      violationCount: 0,
      lastUpdated: '2024-01-15'
    },
    status: 'new',
    uccFilings: [createMockUCCFiling()],
    growthSignals: [
      {
        id: 'sig-1',
        type: 'expansion',
        description: 'New office',
        detectedDate: '2026-01-15',
        confidence: 85,
        score: 80
      },
      {
        id: 'sig-2',
        type: 'hiring',
        description: 'Hiring 10 people',
        detectedDate: '2026-01-15',
        confidence: 75,
        score: 70
      }
    ],
    narrative: 'Test narrative',
    defaultDate: '2024-01-01',
    timeSinceDefault: 365, // 1 year
    estimatedRevenue: 5000000,
    ...overrides
  })

  describe('calculateMLScoring', () => {
    describe('confidence calculation', () => {
      it('should return a confidence score between 0 and 100', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result.confidence).toBeGreaterThanOrEqual(0)
        expect(result.confidence).toBeLessThanOrEqual(100)
      })

      it('should return higher confidence for healthy prospects', () => {
        const healthyProspect = createMockProspect({
          healthScore: {
            grade: 'A',
            score: 95,
            sentimentTrend: 'improving',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })
        const unhealthyProspect = createMockProspect({
          healthScore: {
            grade: 'F',
            score: 20,
            sentimentTrend: 'declining',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 5,
            lastUpdated: '2024-01-15'
          }
        })

        const healthyResult = calculateMLScoring(healthyProspect)
        const unhealthyResult = calculateMLScoring(unhealthyProspect)

        expect(healthyResult.confidence).toBeGreaterThan(unhealthyResult.confidence)
      })

      it('should return higher confidence for prospects with high-value signals', () => {
        const highValueProspect = createMockProspect({
          growthSignals: [
            {
              id: 'sig-3',
              type: 'contract',
              description: 'Major contract',
              detectedDate: '2026-01-15',
              confidence: 90,
              score: 95
            },
            {
              id: 'sig-4',
              type: 'expansion',
              description: 'Market expansion',
              detectedDate: '2026-01-15',
              confidence: 85,
              score: 90
            }
          ]
        })
        const lowValueProspect = createMockProspect({
          growthSignals: []
        })

        const highValueResult = calculateMLScoring(highValueProspect)
        const lowValueResult = calculateMLScoring(lowValueProspect)

        expect(highValueResult.confidence).toBeGreaterThan(lowValueResult.confidence)
      })
    })

    describe('recovery likelihood calculation', () => {
      it('should return recovery likelihood between 0 and 95', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result.recoveryLikelihood).toBeGreaterThanOrEqual(0)
        expect(result.recoveryLikelihood).toBeLessThanOrEqual(95)
      })

      it('should cap recovery likelihood at 95%', () => {
        const perfectProspect = createMockProspect({
          healthScore: {
            grade: 'A',
            score: 100,
            sentimentTrend: 'improving',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          },
          growthSignals: [
            {
              id: 'sig-5',
              type: 'contract',
              description: 'Major contract',
              detectedDate: '2026-01-15',
              confidence: 100,
              score: 100
            }
          ],
          timeSinceDefault: 730, // 2 years - optimal range
          uccFilings: [createMockUCCFiling({ status: 'terminated' })]
        })

        const result = calculateMLScoring(perfectProspect)

        expect(result.recoveryLikelihood).toBeLessThanOrEqual(95)
      })
    })

    describe('industry risk factors', () => {
      it('should score technology industry higher', () => {
        const techProspect = createMockProspect({ industry: 'technology' as IndustryType })
        const result = calculateMLScoring(techProspect)

        expect(result.factors.industryRisk).toBe(75)
      })

      it('should score restaurant industry lower', () => {
        const restaurantProspect = createMockProspect({ industry: 'restaurant' as IndustryType })
        const result = calculateMLScoring(restaurantProspect)

        expect(result.factors.industryRisk).toBe(40)
      })

      it('should handle all industry types', () => {
        const industries: IndustryType[] = [
          'technology',
          'healthcare',
          'manufacturing',
          'services',
          'construction',
          'retail',
          'restaurant'
        ]

        industries.forEach((industry) => {
          const prospect = createMockProspect({ industry })
          const result = calculateMLScoring(prospect)

          expect(result.factors.industryRisk).toBeGreaterThanOrEqual(40)
          expect(result.factors.industryRisk).toBeLessThanOrEqual(75)
        })
      })

      it('should use default score for unknown industry', () => {
        const prospect = createMockProspect({ industry: 'unknown' as IndustryType })
        const result = calculateMLScoring(prospect)

        expect(result.factors.industryRisk).toBe(50)
      })
    })

    describe('health trend calculation', () => {
      it('should boost score for improving sentiment', () => {
        const improvingProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'improving',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })
        const stableProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'stable',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })

        const improvingResult = calculateMLScoring(improvingProspect)
        const stableResult = calculateMLScoring(stableProspect)

        expect(improvingResult.factors.healthTrend).toBeGreaterThan(
          stableResult.factors.healthTrend
        )
      })

      it('should penalize declining sentiment', () => {
        const decliningProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'declining',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })
        const stableProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'stable',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })

        const decliningResult = calculateMLScoring(decliningProspect)
        const stableResult = calculateMLScoring(stableProspect)

        expect(decliningResult.factors.healthTrend).toBeLessThan(stableResult.factors.healthTrend)
      })

      it('should penalize violations', () => {
        const noViolationsProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'stable',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 0,
            lastUpdated: '2024-01-15'
          }
        })
        const manyViolationsProspect = createMockProspect({
          healthScore: {
            grade: 'B',
            score: 75,
            sentimentTrend: 'stable',
            reviewCount: 15,
            avgSentiment: 0.85,
            violationCount: 5,
            lastUpdated: '2024-01-15'
          }
        })

        const noViolationsResult = calculateMLScoring(noViolationsProspect)
        const manyViolationsResult = calculateMLScoring(manyViolationsProspect)

        expect(noViolationsResult.factors.healthTrend).toBeGreaterThan(
          manyViolationsResult.factors.healthTrend
        )
      })

      it('should map health grades correctly', () => {
        const grades: Array<'A' | 'B' | 'C' | 'D' | 'F'> = ['A', 'B', 'C', 'D', 'F']
        const results: number[] = []

        grades.forEach((grade) => {
          const prospect = createMockProspect({
            healthScore: {
              grade,
              score: 50,
              sentimentTrend: 'stable',
              reviewCount: 15,
              avgSentiment: 0.85,
              violationCount: 0,
              lastUpdated: '2024-01-15'
            }
          })
          const result = calculateMLScoring(prospect)
          results.push(result.factors.healthTrend)
        })

        // Each grade should have decreasing health trend scores
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i]).toBeGreaterThan(results[i + 1])
        }
      })
    })

    describe('signal quality calculation', () => {
      it('should return low score for no signals', () => {
        const prospect = createMockProspect({ growthSignals: [] })
        const result = calculateMLScoring(prospect)

        expect(result.factors.signalQuality).toBe(20)
      })

      it('should calculate average confidence and score', () => {
        const prospect = createMockProspect({
          growthSignals: [
            {
              id: 'sig-6',
              type: 'hiring',
              description: 'Test',
              detectedDate: '2026-01-15',
              confidence: 80,
              score: 80
            },
            {
              id: 'sig-7',
              type: 'hiring',
              description: 'Test',
              detectedDate: '2026-01-15',
              confidence: 60,
              score: 60
            }
          ]
        })
        const result = calculateMLScoring(prospect)

        // Average would be 70, but there may be bonuses
        expect(result.factors.signalQuality).toBeGreaterThan(20)
      })

      it('should boost score for high-value signal types', () => {
        const contractProspect = createMockProspect({
          growthSignals: [
            {
              id: 'sig-8',
              type: 'contract',
              description: 'Contract',
              detectedDate: '2026-01-15',
              confidence: 70,
              score: 70
            }
          ]
        })
        const hiringProspect = createMockProspect({
          growthSignals: [
            {
              id: 'sig-9',
              type: 'hiring',
              description: 'Hiring',
              detectedDate: '2026-01-15',
              confidence: 70,
              score: 70
            }
          ]
        })

        const contractResult = calculateMLScoring(contractProspect)
        const hiringResult = calculateMLScoring(hiringProspect)

        expect(contractResult.factors.signalQuality).toBeGreaterThan(
          hiringResult.factors.signalQuality
        )
      })
    })

    describe('financial stability', () => {
      it('should factor in UCC filings', () => {
        const terminatedFilingsProspect = createMockProspect({
          uccFilings: [
            createMockUCCFiling({ status: 'terminated' }),
            createMockUCCFiling({ status: 'terminated' })
          ]
        })
        const activeFilingsProspect = createMockProspect({
          uccFilings: [
            createMockUCCFiling({ status: 'active' }),
            createMockUCCFiling({ status: 'active' }),
            createMockUCCFiling({ status: 'active' }),
            createMockUCCFiling({ status: 'active' })
          ]
        })

        const terminatedResult = calculateMLScoring(terminatedFilingsProspect)
        const activeResult = calculateMLScoring(activeFilingsProspect)

        // Terminated filings are positive, too many active filings is negative
        expect(terminatedResult.factors.financialStability).toBeGreaterThan(
          activeResult.factors.financialStability
        )
      })
    })

    describe('MLScoring structure', () => {
      it('should include all required fields', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result).toHaveProperty('confidence')
        expect(result).toHaveProperty('recoveryLikelihood')
        expect(result).toHaveProperty('modelVersion')
        expect(result).toHaveProperty('lastUpdated')
        expect(result).toHaveProperty('factors')
      })

      it('should include all factor fields', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result.factors).toHaveProperty('healthTrend')
        expect(result.factors).toHaveProperty('signalQuality')
        expect(result.factors).toHaveProperty('industryRisk')
        expect(result.factors).toHaveProperty('timeToRecovery')
        expect(result.factors).toHaveProperty('financialStability')
      })

      it('should return model version', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result.modelVersion).toMatch(/v\d+\.\d+\.\d+/)
      })

      it('should return valid date for lastUpdated', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(result.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(() => new Date(result.lastUpdated)).not.toThrow()
      })

      it('should return integer values for all scores', () => {
        const prospect = createMockProspect()
        const result = calculateMLScoring(prospect)

        expect(Number.isInteger(result.confidence)).toBe(true)
        expect(Number.isInteger(result.recoveryLikelihood)).toBe(true)
        expect(Number.isInteger(result.factors.healthTrend)).toBe(true)
        expect(Number.isInteger(result.factors.signalQuality)).toBe(true)
        expect(Number.isInteger(result.factors.industryRisk)).toBe(true)
        expect(Number.isInteger(result.factors.timeToRecovery)).toBe(true)
        expect(Number.isInteger(result.factors.financialStability)).toBe(true)
      })
    })
  })

  describe('addMLConfidenceToSignal', () => {
    it('should return a number', () => {
      const signal = {
        type: 'expansion',
        confidence: 80,
        score: 75,
        detectedDate: new Date().toISOString()
      }

      const result = addMLConfidenceToSignal(signal)

      expect(typeof result).toBe('number')
    })

    it('should return value between 0 and 100', () => {
      const signal = {
        type: 'hiring',
        confidence: 70,
        score: 65,
        detectedDate: new Date().toISOString()
      }

      const result = addMLConfidenceToSignal(signal)

      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(100)
    })

    it('should boost confidence for recent signals', () => {
      const recentDate = new Date()
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 200) // 200 days ago

      const recentSignal = {
        type: 'hiring',
        confidence: 70,
        score: 70,
        detectedDate: recentDate.toISOString()
      }
      const oldSignal = {
        type: 'hiring',
        confidence: 70,
        score: 70,
        detectedDate: oldDate.toISOString()
      }

      const recentResult = addMLConfidenceToSignal(recentSignal)
      const oldResult = addMLConfidenceToSignal(oldSignal)

      expect(recentResult).toBeGreaterThan(oldResult)
    })

    it('should boost confidence for high-value signal types', () => {
      const contractSignal = {
        type: 'contract',
        confidence: 70,
        score: 70,
        detectedDate: new Date().toISOString()
      }
      const hiringSignal = {
        type: 'hiring',
        confidence: 70,
        score: 70,
        detectedDate: new Date().toISOString()
      }

      const contractResult = addMLConfidenceToSignal(contractSignal)
      const hiringResult = addMLConfidenceToSignal(hiringSignal)

      expect(contractResult).toBeGreaterThan(hiringResult)
    })

    it('should boost when confidence and score align', () => {
      const alignedSignal = {
        type: 'hiring',
        confidence: 75,
        score: 75, // Within 10 points
        detectedDate: new Date().toISOString()
      }
      const misalignedSignal = {
        type: 'hiring',
        confidence: 75,
        score: 50, // More than 10 points difference
        detectedDate: new Date().toISOString()
      }

      const alignedResult = addMLConfidenceToSignal(alignedSignal)
      const misalignedResult = addMLConfidenceToSignal(misalignedSignal)

      expect(alignedResult).toBeGreaterThan(misalignedResult)
    })

    it('should cap result at 100', () => {
      const highConfidenceSignal = {
        type: 'contract', // +10 boost
        confidence: 95,
        score: 95, // +5 alignment boost
        detectedDate: new Date().toISOString() // +5 recent boost
      }

      const result = addMLConfidenceToSignal(highConfidenceSignal)

      expect(result).toBeLessThanOrEqual(100)
    })

    it('should floor result at 0', () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 200)

      const lowConfidenceSignal = {
        type: 'hiring',
        confidence: 5,
        score: 50,
        detectedDate: oldDate.toISOString() // -10 for old signal
      }

      const result = addMLConfidenceToSignal(lowConfidenceSignal)

      expect(result).toBeGreaterThanOrEqual(0)
    })
  })
})
