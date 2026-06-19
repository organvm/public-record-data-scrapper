import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ScoringService,
  IntentScoreInput,
  HealthScoreInput,
  PositionScoreInput
} from '../../services/ScoringService'
// DatabaseError imported for potential future use in error handling tests

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'

const mockQuery = vi.mocked(database.query)

describe('ScoringService', () => {
  let service: ScoringService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new ScoringService()
  })

  describe('calculateIntentScore', () => {
    it('should return high score for recent filing', () => {
      const input: IntentScoreInput = {
        daysSinceLastFiling: 15,
        totalFilings: 2,
        activeFilings: 1,
        lapsedFilings: 0,
        terminatedFilings: 1,
        recentFilingsTrend: 'stable'
      }

      const score = service.calculateIntentScore(input)

      expect(score).toBeGreaterThan(80)
    })

    it('should return moderate score for older filing', () => {
      const input: IntentScoreInput = {
        daysSinceLastFiling: 180,
        totalFilings: 3,
        activeFilings: 0,
        lapsedFilings: 1,
        terminatedFilings: 2,
        recentFilingsTrend: 'stable'
      }

      const score = service.calculateIntentScore(input)

      expect(score).toBeGreaterThan(50)
      expect(score).toBeLessThan(80)
    })

    it('should return low score for very old filing', () => {
      const input: IntentScoreInput = {
        daysSinceLastFiling: 1500,
        totalFilings: 1,
        activeFilings: 0,
        lapsedFilings: 1,
        terminatedFilings: 0,
        recentFilingsTrend: 'decreasing'
      }

      const score = service.calculateIntentScore(input)

      expect(score).toBeLessThan(50)
    })

    it('should boost score for increasing trend', () => {
      const baseInput: IntentScoreInput = {
        daysSinceLastFiling: 60,
        totalFilings: 2,
        activeFilings: 1,
        lapsedFilings: 0,
        terminatedFilings: 1,
        recentFilingsTrend: 'stable'
      }

      const increasingInput = { ...baseInput, recentFilingsTrend: 'increasing' as const }

      const baseScore = service.calculateIntentScore(baseInput)
      const increasingScore = service.calculateIntentScore(increasingInput)

      expect(increasingScore).toBeGreaterThan(baseScore)
    })

    it('should give neutral score for no filings', () => {
      const input: IntentScoreInput = {
        daysSinceLastFiling: 9999,
        totalFilings: 0,
        activeFilings: 0,
        lapsedFilings: 0,
        terminatedFilings: 0,
        recentFilingsTrend: 'stable'
      }

      const score = service.calculateIntentScore(input)

      expect(score).toBeGreaterThanOrEqual(10)
      expect(score).toBeLessThanOrEqual(60)
    })

    it('should penalize too many active filings', () => {
      const fewFilings: IntentScoreInput = {
        daysSinceLastFiling: 30,
        totalFilings: 2,
        activeFilings: 2,
        lapsedFilings: 0,
        terminatedFilings: 0,
        recentFilingsTrend: 'stable'
      }

      const manyFilings: IntentScoreInput = {
        daysSinceLastFiling: 30,
        totalFilings: 8,
        activeFilings: 8,
        lapsedFilings: 0,
        terminatedFilings: 0,
        recentFilingsTrend: 'stable'
      }

      const fewScore = service.calculateIntentScore(fewFilings)
      const manyScore = service.calculateIntentScore(manyFilings)

      expect(fewScore).toBeGreaterThan(manyScore)
    })
  })

  describe('calculateHealthScore', () => {
    it('should return high score for healthy business', () => {
      const input: HealthScoreInput = {
        reviewCount: 100,
        avgRating: 4.5,
        sentimentTrend: 'improving',
        violationCount: 0,
        yearsInBusiness: 10,
        hasWebsite: true,
        socialPresence: 80
      }

      const score = service.calculateHealthScore(input)

      expect(score).toBeGreaterThan(80)
    })

    it('should penalize violations', () => {
      const noViolations: HealthScoreInput = {
        reviewCount: 50,
        avgRating: 4.0,
        sentimentTrend: 'stable',
        violationCount: 0,
        yearsInBusiness: 5,
        hasWebsite: true,
        socialPresence: 50
      }

      const withViolations: HealthScoreInput = {
        ...noViolations,
        violationCount: 3
      }

      const cleanScore = service.calculateHealthScore(noViolations)
      const violationScore = service.calculateHealthScore(withViolations)

      expect(cleanScore).toBeGreaterThan(violationScore)
    })

    it('should boost score for established businesses', () => {
      const newBusiness: HealthScoreInput = {
        reviewCount: 10,
        avgRating: 4.0,
        sentimentTrend: 'stable',
        violationCount: 0,
        yearsInBusiness: 0.5,
        hasWebsite: true,
        socialPresence: 30
      }

      const establishedBusiness: HealthScoreInput = {
        ...newBusiness,
        yearsInBusiness: 10
      }

      const newScore = service.calculateHealthScore(newBusiness)
      const establishedScore = service.calculateHealthScore(establishedBusiness)

      expect(establishedScore).toBeGreaterThan(newScore)
    })

    it('should factor in sentiment trend', () => {
      const baseInput: HealthScoreInput = {
        reviewCount: 50,
        avgRating: 3.5,
        sentimentTrend: 'stable',
        violationCount: 0,
        yearsInBusiness: 5,
        hasWebsite: true,
        socialPresence: 50
      }

      const improvingInput = { ...baseInput, sentimentTrend: 'improving' as const }
      const decliningInput = { ...baseInput, sentimentTrend: 'declining' as const }

      const stableScore = service.calculateHealthScore(baseInput)
      const improvingScore = service.calculateHealthScore(improvingInput)
      const decliningScore = service.calculateHealthScore(decliningInput)

      expect(improvingScore).toBeGreaterThan(stableScore)
      expect(stableScore).toBeGreaterThan(decliningScore)
    })
  })

  describe('calculatePositionScore', () => {
    it('should return 100 for no active positions', () => {
      const input: PositionScoreInput = {
        activeUccCount: 0,
        knownMcaPositions: 0,
        estimatedMonthlyPayments: 0,
        estimatedRevenue: 50000
      }

      const score = service.calculatePositionScore(input)

      expect(score).toBe(100)
    })

    it('should penalize per active UCC', () => {
      const noUcc: PositionScoreInput = {
        activeUccCount: 0,
        knownMcaPositions: 0,
        estimatedMonthlyPayments: 0,
        estimatedRevenue: 50000
      }

      const twoUcc: PositionScoreInput = {
        ...noUcc,
        activeUccCount: 2
      }

      const noUccScore = service.calculatePositionScore(noUcc)
      const twoUccScore = service.calculatePositionScore(twoUcc)

      expect(noUccScore).toBeGreaterThan(twoUccScore)
    })

    it('should penalize known MCA positions more heavily', () => {
      const generalUcc: PositionScoreInput = {
        activeUccCount: 2,
        knownMcaPositions: 0,
        estimatedMonthlyPayments: 0,
        estimatedRevenue: 50000
      }

      const mcaPositions: PositionScoreInput = {
        activeUccCount: 2,
        knownMcaPositions: 2,
        estimatedMonthlyPayments: 0,
        estimatedRevenue: 50000
      }

      const generalScore = service.calculatePositionScore(generalUcc)
      const mcaScore = service.calculatePositionScore(mcaPositions)

      expect(generalScore).toBeGreaterThan(mcaScore)
    })

    it('should penalize high payment burden', () => {
      const lowBurden: PositionScoreInput = {
        activeUccCount: 1,
        knownMcaPositions: 1,
        estimatedMonthlyPayments: 2000,
        estimatedRevenue: 50000 // 4% burden
      }

      const highBurden: PositionScoreInput = {
        activeUccCount: 1,
        knownMcaPositions: 1,
        estimatedMonthlyPayments: 15000,
        estimatedRevenue: 50000 // 30% burden
      }

      const lowScore = service.calculatePositionScore(lowBurden)
      const highScore = service.calculatePositionScore(highBurden)

      expect(lowScore).toBeGreaterThan(highScore)
    })
  })

  describe('calculateCompositeScore', () => {
    it('should combine scores with weights', () => {
      const input = {
        intentScore: 80,
        healthScore: 70,
        positionScore: 90
      }

      const score = service.calculateCompositeScore(input)

      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThanOrEqual(100)
    })

    it('should apply industry modifier', () => {
      const baseInput = {
        intentScore: 80,
        healthScore: 70,
        positionScore: 90
      }

      const withModifier = {
        ...baseInput,
        industryRiskModifier: 0.85 // restaurant - higher risk
      }

      const baseScore = service.calculateCompositeScore(baseInput)
      const modifiedScore = service.calculateCompositeScore(withModifier)

      expect(modifiedScore).toBeLessThan(baseScore)
    })

    it('should apply state modifier', () => {
      const baseInput = {
        intentScore: 80,
        healthScore: 70,
        positionScore: 90
      }

      const nyInput = {
        ...baseInput,
        stateModifier: 1.02 // NY has higher modifier
      }

      const baseScore = service.calculateCompositeScore(baseInput)
      const nyScore = service.calculateCompositeScore(nyInput)

      expect(nyScore).toBeGreaterThan(baseScore)
    })

    it('should add the MCA-adjacency boost additively', () => {
      const baseInput = {
        intentScore: 60,
        healthScore: 60,
        positionScore: 60
      }

      const boostedInput = {
        ...baseInput,
        mcaAdjacencyBoost: 10
      }

      const baseScore = service.calculateCompositeScore(baseInput)
      const boostedScore = service.calculateCompositeScore(boostedInput)

      expect(boostedScore).toBe(baseScore + 10)
    })

    it('should clamp the boost at 100', () => {
      const score = service.calculateCompositeScore({
        intentScore: 100,
        healthScore: 100,
        positionScore: 100,
        mcaAdjacencyBoost: 10
      })

      expect(score).toBe(100)
    })
  })

  describe('getGrade', () => {
    it('should return A for score >= 80', () => {
      expect(service.getGrade(80)).toBe('A')
      expect(service.getGrade(95)).toBe('A')
    })

    it('should return B for score >= 65', () => {
      expect(service.getGrade(65)).toBe('B')
      expect(service.getGrade(79)).toBe('B')
    })

    it('should return C for score >= 50', () => {
      expect(service.getGrade(50)).toBe('C')
      expect(service.getGrade(64)).toBe('C')
    })

    it('should return D for score >= 35', () => {
      expect(service.getGrade(35)).toBe('D')
      expect(service.getGrade(49)).toBe('D')
    })

    it('should return F for score < 35', () => {
      expect(service.getGrade(34)).toBe('F')
      expect(service.getGrade(0)).toBe('F')
    })
  })

  describe('calculateConfidence', () => {
    it('should return higher confidence with more data', () => {
      const lowData = service.calculateConfidence(false, false, false, false)
      const highData = service.calculateConfidence(true, true, true, true)

      expect(highData).toBeGreaterThan(lowData)
    })

    it('should boost confidence for UCC history', () => {
      const withoutUcc = service.calculateConfidence(true, false, true, true)
      const withUcc = service.calculateConfidence(true, true, true, true)

      expect(withUcc).toBeGreaterThan(withoutUcc)
    })
  })

  describe('generateNarrative', () => {
    it('should generate positive narrative for high score', () => {
      const result = {
        intentScore: 85,
        healthScore: 80,
        positionScore: 90,
        compositeScore: 85,
        grade: 'A' as const,
        confidence: 80,
        factors: [],
        recommendation: 'high_priority' as const
      }

      const narrative = service.generateNarrative(result, 'Test Corp', 180)

      expect(narrative).toContain('strong')
    })

    it('should mention recent activity for high intent', () => {
      const result = {
        intentScore: 85,
        healthScore: 60,
        positionScore: 70,
        compositeScore: 70,
        grade: 'B' as const,
        confidence: 70,
        factors: [],
        recommendation: 'moderate_priority' as const
      }

      const narrative = service.generateNarrative(result, 'Test Corp', 30)

      expect(narrative).toContain('UCC activity')
    })
  })

  describe('scoreProspect', () => {
    it('should score prospect from database', async () => {
      const mockProspect = {
        company_name: 'Test Restaurant',
        industry: 'restaurant',
        state: 'CA',
        default_date: '2023-01-01',
        time_since_default: 365
      }
      const mockFilings = [
        { status: 'active', filing_date: '2024-01-01' },
        { status: 'terminated', filing_date: '2023-01-01' }
      ]
      const mockHealth = {
        score: 75,
        sentiment_trend: 'stable',
        review_count: 50,
        avg_sentiment: 0.7,
        violation_count: 0
      }

      mockQuery
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce(mockFilings)
        .mockResolvedValueOnce([mockHealth])

      const result = await service.scoreProspect('prospect-1')

      expect(result.compositeScore).toBeGreaterThan(0)
      expect(result.grade).toBeDefined()
      expect(result.recommendation).toBeDefined()
    })

    it('should throw error for non-existent prospect', async () => {
      mockQuery.mockResolvedValueOnce([])

      await expect(service.scoreProspect('non-existent')).rejects.toThrow()
    })

    it('should boost MCA-adjacent prospects with a recent equipment purchase', async () => {
      const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)

      const mockProspect = {
        company_name: 'Growth Mfg Co',
        industry: 'manufacturing',
        state: 'CA',
        default_date: null,
        time_since_default: null
      }

      // Filing with equipment collateral financed by a non-MCA lender.
      const equipmentFilings = [
        {
          status: 'active',
          filing_date: recentDate,
          secured_party: 'Balboa Capital',
          collateral_description: 'One 2024 CNC milling machine'
        }
      ]
      // Same filing but without the equipment signal (no secured party / desc).
      const plainFilings = [{ status: 'active', filing_date: recentDate }]

      // Score WITH the equipment signal.
      mockQuery
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce(equipmentFilings)
        .mockResolvedValueOnce([])
      const boosted = await service.scoreProspect('prospect-eq')

      // Score WITHOUT the equipment signal.
      mockQuery
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce(plainFilings)
        .mockResolvedValueOnce([])
      const plain = await service.scoreProspect('prospect-eq')

      expect(boosted.compositeScore).toBeGreaterThan(plain.compositeScore)
      expect(boosted.factors.some((f) => f.name.includes('Equipment'))).toBe(true)
    })

    it('should handle prospect without health data', async () => {
      const mockProspect = {
        company_name: 'Test Corp',
        industry: 'retail',
        state: 'NY',
        default_date: null,
        time_since_default: null
      }

      mockQuery
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const result = await service.scoreProspect('prospect-1')

      expect(result.compositeScore).toBeGreaterThan(0)
    })
  })

  describe('scoreProspects', () => {
    it('should batch score multiple prospects', async () => {
      const mockProspect = {
        company_name: 'Test Corp',
        industry: 'retail',
        state: 'CA',
        default_date: '2023-01-01',
        time_since_default: 365
      }

      mockQuery
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockProspect])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const results = await service.scoreProspects(['prospect-1', 'prospect-2'])

      expect(results.size).toBe(2)
    })

    it('should continue on individual failures', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // First fails
        .mockResolvedValueOnce([
          {
            company_name: 'Test',
            industry: 'retail',
            state: 'CA',
            default_date: null,
            time_since_default: null
          }
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const results = await service.scoreProspects(['prospect-1', 'prospect-2'])

      expect(results.size).toBe(1)
    })
  })
})
