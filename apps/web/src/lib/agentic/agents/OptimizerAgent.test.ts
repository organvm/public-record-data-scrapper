/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OptimizerAgent Tests
 *
 * Tests for the OptimizerAgent including:
 * - Performance analysis
 * - Optimization opportunity detection
 * - Caching strategy suggestions
 * - Pagination recommendations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { OptimizerAgent } from './OptimizerAgent'
import { SystemContext } from '../types'

describe('OptimizerAgent', () => {
  let agent: OptimizerAgent
  let mockContext: SystemContext

  beforeEach(() => {
    agent = new OptimizerAgent()
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
      expect(agent.role).toBe('optimizer')
      expect(agent.name).toBe('Performance Optimizer')
      expect(agent.capabilities).toContain('Performance analysis')
      expect(agent.capabilities).toContain('Resource optimization')
      expect(agent.capabilities).toContain('Caching strategies')
    })
  })

  describe('Performance Analysis', () => {
    it('should detect slow response times', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding).toBeDefined()
      expect(perfFinding?.severity).toBe('warning')
    })

    it('should detect critical performance issues', async () => {
      mockContext.performanceMetrics.avgResponseTime = 2500
      mockContext.performanceMetrics.errorRate = 0.15

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding?.severity).toBe('critical')
    })

    it('should not flag good performance', async () => {
      mockContext.performanceMetrics.avgResponseTime = 500
      mockContext.performanceMetrics.errorRate = 0.01

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding).toBeUndefined()
    })

    it('should include performance metrics in evidence', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500
      mockContext.performanceMetrics.errorRate = 0.06

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )

      expect((perfFinding?.evidence as Record<string, any>).avgResponseTime).toBe(1500)
      expect((perfFinding?.evidence as Record<string, any>).errorRate).toBe(0.06)
    })
  })

  describe('Optimization Opportunity Detection', () => {
    it('should detect large datasets without pagination', async () => {
      mockContext.prospects = Array(600)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`,
          state: 'CA'
        }))

      const analysis = await agent.analyze(mockContext)
      const paginationFinding = analysis.findings.find((f) => f.description.includes('pagination'))
      expect(paginationFinding).toBeDefined()
      expect(paginationFinding?.severity).toBe('warning')
    })

    it('should not flag small datasets', async () => {
      mockContext.prospects = Array(100)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`
        }))

      const analysis = await agent.analyze(mockContext)
      const paginationFinding = analysis.findings.find((f) => f.description.includes('pagination'))
      expect(paginationFinding).toBeUndefined()
    })

    it('should detect high frequency filter operations', async () => {
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'filter',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const filterFinding = analysis.findings.find((f) =>
        f.description.includes('filter operations')
      )
      expect(filterFinding).toBeDefined()
      expect((filterFinding?.evidence as Record<string, any>).suggestion).toBe('memoization')
    })

    it('should not flag normal filter operations', async () => {
      mockContext.userActions = Array(50)
        .fill(null)
        .map(() => ({
          type: 'filter',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const filterFinding = analysis.findings.find((f) =>
        f.description.includes('filter operations')
      )
      expect(filterFinding).toBeUndefined()
    })
  })

  describe('Caching Strategy Suggestions', () => {
    it('should suggest caching for slow response times', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))
      expect(cachingImprovement).toBeDefined()
      expect(cachingImprovement?.category).toBe('performance')
      expect(cachingImprovement?.priority).toBe('high')
    })

    it('should mark caching as automatable', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))
      expect(cachingImprovement?.automatable).toBe(true)
    })

    it('should provide high safety score for caching', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))
      expect(cachingImprovement?.safetyScore).toBeGreaterThanOrEqual(80)
    })

    it('should include implementation plan for caching', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))

      expect(cachingImprovement?.implementation).toBeDefined()
      expect(cachingImprovement?.implementation?.steps.length).toBeGreaterThan(0)
      expect(cachingImprovement?.implementation?.risks.length).toBeGreaterThan(0)
      expect(cachingImprovement?.implementation?.rollbackPlan.length).toBeGreaterThan(0)
    })
  })

  describe('Pagination Recommendations', () => {
    it('should suggest pagination for large datasets', async () => {
      mockContext.prospects = Array(600)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`
        }))

      const analysis = await agent.analyze(mockContext)
      const paginationImprovement = analysis.improvements.find((i) =>
        i.title.includes('pagination')
      )
      expect(paginationImprovement).toBeDefined()
      expect(paginationImprovement?.category).toBe('performance')
      expect(paginationImprovement?.priority).toBe('medium')
    })

    it('should mark pagination as highly safe', async () => {
      mockContext.prospects = Array(600)
        .fill(null)
        .map(() => ({}))

      const analysis = await agent.analyze(mockContext)
      const paginationImprovement = analysis.improvements.find((i) =>
        i.title.includes('pagination')
      )
      expect(paginationImprovement?.safetyScore).toBeGreaterThanOrEqual(90)
    })

    it('should include validation criteria for pagination', async () => {
      mockContext.prospects = Array(600)
        .fill(null)
        .map(() => ({}))

      const analysis = await agent.analyze(mockContext)
      const paginationImprovement = analysis.improvements.find((i) =>
        i.title.includes('pagination')
      )

      expect(paginationImprovement?.implementation?.validationCriteria).toBeDefined()
      expect(paginationImprovement?.implementation?.validationCriteria.length).toBeGreaterThan(0)
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
      expect(analysis.agentRole).toBe('optimizer')
    })
  })

  describe('Finding Categories', () => {
    it('should categorize all findings as performance', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500
      mockContext.prospects = Array(600)
        .fill(null)
        .map(() => ({}))

      const analysis = await agent.analyze(mockContext)
      analysis.findings.forEach((finding) => {
        expect(finding.category).toBe('performance')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty context', async () => {
      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
      expect(analysis.findings).toBeDefined()
      expect(analysis.improvements).toBeDefined()
    })

    it('should handle zero response time', async () => {
      mockContext.performanceMetrics.avgResponseTime = 0

      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
    })

    it('should handle extreme response times', async () => {
      mockContext.performanceMetrics.avgResponseTime = 10000

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding?.severity).toBe('critical')
    })

    it('should handle very large datasets', async () => {
      mockContext.prospects = Array(10000)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`
        }))

      const analysis = await agent.analyze(mockContext)
      const paginationFinding = analysis.findings.find((f) => f.description.includes('pagination'))
      expect(paginationFinding).toBeDefined()
    })
  })

  describe('Scenario-based Tests', () => {
    it('should handle multiple performance issues', async () => {
      mockContext.performanceMetrics.avgResponseTime = 2000
      mockContext.performanceMetrics.errorRate = 0.08
      mockContext.prospects = Array(800)
        .fill(null)
        .map(() => ({}))
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'filter',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBeGreaterThan(1)
      expect(analysis.improvements.length).toBeGreaterThan(0)
    })

    it('should prioritize critical performance issues', async () => {
      mockContext.performanceMetrics.avgResponseTime = 3000
      mockContext.performanceMetrics.errorRate = 0.15

      const analysis = await agent.analyze(mockContext)
      const criticalFindings = analysis.findings.filter((f) => f.severity === 'critical')
      expect(criticalFindings.length).toBeGreaterThan(0)
    })

    it('should handle optimal performance scenario', async () => {
      mockContext.performanceMetrics.avgResponseTime = 400
      mockContext.performanceMetrics.errorRate = 0.005
      mockContext.prospects = Array(100)
        .fill(null)
        .map(() => ({}))
      mockContext.userActions = Array(20)
        .fill(null)
        .map(() => ({
          type: 'filter',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBe(0)
      expect(analysis.improvements.length).toBe(0)
    })
  })

  describe('Improvement Reasoning', () => {
    it('should provide clear reasoning for improvements', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.reasoning).toBeDefined()
        expect(improvement.reasoning.length).toBeGreaterThan(0)
      })
    })

    it('should estimate impact of improvements', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))
      expect(cachingImprovement?.estimatedImpact).toContain('%')
    })

    it('should identify risks in implementation plans', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500

      const analysis = await agent.analyze(mockContext)
      const cachingImprovement = analysis.improvements.find((i) => i.title.includes('caching'))
      expect(cachingImprovement?.implementation?.risks.length).toBeGreaterThan(0)
    })
  })

  describe('Performance Thresholds', () => {
    it('should use 1000ms threshold for response time warning', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1001

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding).toBeDefined()
    })

    it('should use 2000ms threshold for critical response time', async () => {
      mockContext.performanceMetrics.avgResponseTime = 2001

      const analysis = await agent.analyze(mockContext)
      const perfFinding = analysis.findings.find((f) =>
        f.description.includes('Performance issues')
      )
      expect(perfFinding?.severity).toBe('critical')
    })

    it('should use 500 items threshold for pagination', async () => {
      mockContext.prospects = Array(501)
        .fill(null)
        .map(() => ({}))

      const analysis = await agent.analyze(mockContext)
      const paginationFinding = analysis.findings.find((f) => f.description.includes('pagination'))
      expect(paginationFinding).toBeDefined()
    })

    it('should use 100 operations threshold for filter caching', async () => {
      mockContext.userActions = Array(101)
        .fill(null)
        .map(() => ({
          type: 'filter',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const filterFinding = analysis.findings.find((f) =>
        f.description.includes('filter operations')
      )
      expect(filterFinding).toBeDefined()
    })
  })
})
