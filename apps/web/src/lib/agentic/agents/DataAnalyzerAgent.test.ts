/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DataAnalyzerAgent Tests
 *
 * Tests for the DataAnalyzerAgent including:
 * - Data freshness detection
 * - Data quality assessment
 * - Completeness checking
 * - Improvement suggestions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DataAnalyzerAgent } from './DataAnalyzerAgent'
import { SystemContext } from '../types'

describe('DataAnalyzerAgent', () => {
  let agent: DataAnalyzerAgent
  let mockContext: SystemContext

  beforeEach(() => {
    agent = new DataAnalyzerAgent()
    mockContext = {
      prospects: [],
      competitors: [],
      portfolio: [],
      userActions: [],
      performanceMetrics: {
        avgResponseTime: 500,
        errorRate: 0.01,
        userSatisfactionScore: 8,
        dataFreshnessScore: 90
      },
      timestamp: new Date().toISOString()
    }
  })

  describe('Agent Initialization', () => {
    it('should initialize with correct role and capabilities', () => {
      expect(agent.role).toBe('data-analyzer')
      expect(agent.name).toBe('Data Analyzer')
      expect(agent.capabilities).toContain('Data quality assessment')
      expect(agent.capabilities).toContain('Pattern detection')
      expect(agent.capabilities).toContain('Data freshness monitoring')
    })
  })

  describe('Data Freshness Detection', () => {
    it('should detect stale health scores', async () => {
      mockContext.prospects = [
        {
          companyName: 'Test Co',
          healthScore: {
            lastUpdated: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days old
          }
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const staleFinding = analysis.findings.find((f) => f.description.includes('stale'))
      expect(staleFinding).toBeDefined()
    })

    it('should not flag fresh data', async () => {
      mockContext.prospects = [
        {
          companyName: 'Test Co',
          healthScore: {
            lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days old
          }
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const staleFinding = analysis.findings.find((f) => f.description.includes('stale'))
      expect(staleFinding).toBeUndefined()
    })

    it('should calculate stale data percentage', async () => {
      mockContext.prospects = [
        {
          companyName: 'Fresh Co',
          healthScore: { lastUpdated: new Date().toISOString() }
        },
        {
          companyName: 'Stale Co',
          healthScore: {
            lastUpdated: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const staleFinding = analysis.findings.find((f) => f.description.includes('stale'))

      if (staleFinding) {
        expect((staleFinding.evidence as Record<string, any>).percentage).toBeDefined()
        expect(parseFloat((staleFinding.evidence as Record<string, any>).percentage)).toBe(50.0)
      }
    })

    it('should set appropriate severity for stale data', async () => {
      // Test critical severity (>30% stale)
      mockContext.prospects = Array(10)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`,
          healthScore: {
            lastUpdated: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
          }
        }))

      const analysis = await agent.analyze(mockContext)
      const staleFinding = analysis.findings.find((f) => f.description.includes('stale'))
      expect(staleFinding?.severity).toBe('critical')
    })
  })

  describe('Data Quality Assessment', () => {
    it('should detect missing revenue estimates', async () => {
      mockContext.prospects = [
        { companyName: 'Test Co', state: 'CA' },
        { companyName: 'Test Co 2', state: 'NY' }
      ]

      const analysis = await agent.analyze(mockContext)
      const revenueFinding = analysis.findings.find((f) =>
        f.description.includes('revenue estimates')
      )
      expect(revenueFinding).toBeDefined()
      expect((revenueFinding?.evidence as Record<string, any>).incompleteCount).toBe(2)
    })

    it('should detect missing growth signals', async () => {
      mockContext.prospects = [
        { companyName: 'Test Co', state: 'CA', growthSignals: [] },
        { companyName: 'Test Co 2', state: 'NY' }
      ]

      const analysis = await agent.analyze(mockContext)
      const signalsFinding = analysis.findings.find((f) => f.description.includes('growth signals'))
      expect(signalsFinding).toBeDefined()
      expect(signalsFinding?.severity).toBe('warning')
    })

    it('should not report issues for complete data', async () => {
      mockContext.prospects = [
        {
          companyName: 'Complete Co',
          state: 'CA',
          estimatedRevenue: 1000000,
          growthSignals: ['signal1']
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const qualityFindings = analysis.findings.filter(
        (f) => f.description.includes('revenue') || f.description.includes('signals')
      )
      expect(qualityFindings.length).toBe(0)
    })
  })

  describe('Data Completeness Checking', () => {
    it('should calculate data completeness score', async () => {
      mockContext.prospects = [
        {
          companyName: 'Partial Co',
          industry: 'Tech',
          state: 'CA'
          // Missing many fields
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const completenessFinding = analysis.findings.find((f) =>
        f.description.includes('completeness')
      )
      expect(completenessFinding).toBeDefined()
      expect((completenessFinding?.evidence as Record<string, any>).avgCompleteness).toBeLessThan(
        80
      )
    })

    it('should set critical severity for very low completeness', async () => {
      mockContext.prospects = [
        { companyName: 'Minimal Co' } // Only 1 field out of 10
      ]

      const analysis = await agent.analyze(mockContext)
      const completenessFinding = analysis.findings.find((f) =>
        f.description.includes('completeness')
      )
      expect(completenessFinding?.severity).toBe('critical')
    })

    it('should not flag high completeness data', async () => {
      mockContext.prospects = [
        {
          companyName: 'Complete Co',
          industry: 'Tech',
          state: 'CA',
          priorityScore: 85,
          defaultDate: '2023-01-01',
          estimatedRevenue: 1000000,
          narrative: 'Test narrative',
          healthScore: { score: 90, lastUpdated: new Date().toISOString() },
          uccFilings: [{ id: '1' }],
          growthSignals: ['signal1']
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const completenessFinding = analysis.findings.find((f) =>
        f.description.includes('completeness')
      )
      expect(completenessFinding).toBeUndefined()
    })
  })

  describe('Improvement Suggestions', () => {
    it('should suggest data quality improvement when issues detected', async () => {
      mockContext.prospects = [{ companyName: 'Incomplete Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      const qualityImprovement = analysis.improvements.find((i) =>
        i.title.includes('data enrichment')
      )
      expect(qualityImprovement).toBeDefined()
      expect(qualityImprovement?.category).toBe('data-quality')
      expect(qualityImprovement?.priority).toBe('high')
    })

    it('should suggest automated refresh for stale data', async () => {
      mockContext.prospects = [
        {
          companyName: 'Stale Co',
          healthScore: {
            lastUpdated: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const refreshImprovement = analysis.improvements.find((i) => i.title.includes('refresh'))
      expect(refreshImprovement).toBeDefined()
      expect(refreshImprovement?.automatable).toBe(true)
      expect(refreshImprovement?.safetyScore).toBeGreaterThanOrEqual(80)
    })

    it('should include implementation plan in improvements', async () => {
      mockContext.prospects = [{ companyName: 'Test Co' }]

      const analysis = await agent.analyze(mockContext)
      const improvement = analysis.improvements[0]

      if (improvement?.implementation) {
        expect(improvement.implementation).toHaveProperty('steps')
        expect(improvement.implementation).toHaveProperty('risks')
        expect(improvement.implementation).toHaveProperty('rollbackPlan')
        expect(improvement.implementation).toHaveProperty('validationCriteria')
        expect(improvement.implementation.steps.length).toBeGreaterThan(0)
      }
    })

    it('should provide reasoning for improvements', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.reasoning).toBeDefined()
        expect(improvement.reasoning.length).toBeGreaterThan(0)
      })
    })

    it('should estimate impact of improvements', async () => {
      mockContext.prospects = [{ companyName: 'Test Co' }]

      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.estimatedImpact).toBeDefined()
        expect(improvement.estimatedImpact.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Analysis Structure', () => {
    it('should return complete analysis structure', async () => {
      const analysis = await agent.analyze(mockContext)

      expect(analysis).toHaveProperty('agentId')
      expect(analysis).toHaveProperty('agentRole')
      expect(analysis).toHaveProperty('findings')
      expect(analysis).toHaveProperty('improvements')
      expect(analysis).toHaveProperty('timestamp')
      expect(analysis.agentRole).toBe('data-analyzer')
    })

    it('should include timestamp in analysis', async () => {
      const analysis = await agent.analyze(mockContext)
      expect(() => new Date(analysis.timestamp)).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty prospect list', async () => {
      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings).toBeDefined()
      expect(analysis.improvements).toBeDefined()
    })

    it('should handle prospects with missing healthScore', async () => {
      mockContext.prospects = [{ companyName: 'No Health Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
    })

    it('should handle prospects with null values', async () => {
      mockContext.prospects = [
        {
          companyName: null,
          industry: null,
          state: null,
          estimatedRevenue: null
        }
      ]

      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
    })

    it('should handle large number of prospects', async () => {
      mockContext.prospects = Array(1000)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`,
          state: 'CA'
        }))

      const startTime = Date.now()
      const analysis = await agent.analyze(mockContext)
      const endTime = Date.now()

      expect(analysis).toBeDefined()
      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(1000)
    })
  })

  describe('Finding Categories', () => {
    it('should categorize all findings as data-quality', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      analysis.findings.forEach((finding) => {
        expect(finding.category).toBe('data-quality')
      })
    })

    it('should assign unique IDs to findings', async () => {
      mockContext.prospects = [{ companyName: 'Test Co 1' }, { companyName: 'Test Co 2' }]

      const analysis = await agent.analyze(mockContext)
      const ids = analysis.findings.map((f) => f.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('Scenario-based Tests', () => {
    it('should handle mixed data quality scenario', async () => {
      mockContext.prospects = [
        {
          companyName: 'Good Co',
          industry: 'Tech',
          state: 'CA',
          estimatedRevenue: 1000000,
          healthScore: { lastUpdated: new Date().toISOString() },
          growthSignals: ['signal1']
        },
        {
          companyName: 'Poor Co',
          state: 'NY'
          // Missing many fields
        },
        {
          companyName: 'Stale Co',
          state: 'TX',
          healthScore: {
            lastUpdated: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      ]

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBeGreaterThan(0)
      expect(analysis.improvements.length).toBeGreaterThan(0)
    })

    it('should prioritize critical issues', async () => {
      mockContext.prospects = Array(100)
        .fill(null)
        .map(() => ({
          companyName: 'Test Co',
          healthScore: {
            lastUpdated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          }
        }))

      const analysis = await agent.analyze(mockContext)
      const criticalFindings = analysis.findings.filter((f) => f.severity === 'critical')
      expect(criticalFindings.length).toBeGreaterThan(0)
    })
  })
})
