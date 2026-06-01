/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for OptimizerAgent
 * Tests performance analysis, optimization opportunities, and improvement suggestions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { OptimizerAgent } from './agents/OptimizerAgent'
import { SystemContext } from './types'

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
        avgResponseTime: 100,
        errorRate: 0.01,
        userSatisfactionScore: 8,
        dataFreshnessScore: 85
      },
      timestamp: new Date().toISOString()
    }
  })

  describe('Constructor', () => {
    it('should create agent with correct properties', () => {
      expect(agent.role).toBe('optimizer')
      expect(agent.name).toBe('Performance Optimizer')
      expect(agent.capabilities).toContain('Performance analysis')
      expect(agent.capabilities).toContain('Resource optimization')
      expect(agent.capabilities).toContain('Caching strategies')
    })
  })

  describe('Performance Analysis', () => {
    it('should detect slow response times', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1500 // Slow but not critical

      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding).toBeDefined()
      expect(perfFinding?.severity).toBe('warning')
      expect((perfFinding?.evidence as Record<string, any>).avgResponseTime).toBe(1500)
    })

    it('should mark critical performance issues', async () => {
      mockContext.performanceMetrics.avgResponseTime = 2500 // Critical

      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding?.severity).toBe('critical')
    })

    it('should detect high error rates', async () => {
      mockContext.performanceMetrics.errorRate = 0.07 // Above 5% threshold

      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding).toBeDefined()
      expect((perfFinding?.evidence as Record<string, any>).errorRate).toBe(0.07)
    })

    it('should mark critical error rates', async () => {
      mockContext.performanceMetrics.errorRate = 0.15 // Above 10%

      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding?.severity).toBe('critical')
    })

    it('should not flag good performance', async () => {
      // Good metrics (defaults)
      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding).toBeUndefined()
    })
  })

  describe('Optimization Opportunities', () => {
    it('should detect large datasets without pagination', async () => {
      mockContext.prospects = Array(600).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      const paginationFinding = result.findings.find((f) => f.description.includes('Large dataset'))
      expect(paginationFinding).toBeDefined()
      expect(paginationFinding?.severity).toBe('warning')
      expect((paginationFinding?.evidence as Record<string, any>).count).toBe(600)
    })

    it('should not flag small datasets', async () => {
      mockContext.prospects = Array(100).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      const paginationFinding = result.findings.find((f) => f.description.includes('Large dataset'))
      expect(paginationFinding).toBeUndefined()
    })

    it('should detect high frequency of filter operations', async () => {
      mockContext.userActions = Array(150).fill({
        type: 'filter',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const filterFinding = result.findings.find((f) => f.description.includes('filter operations'))
      expect(filterFinding).toBeDefined()
      expect(filterFinding?.severity).toBe('info')
      expect((filterFinding?.evidence as Record<string, any>).filterOperations).toBe(150)
    })

    it('should not flag low filter operations', async () => {
      mockContext.userActions = Array(50).fill({
        type: 'filter',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const filterFinding = result.findings.find((f) => f.description.includes('filter operations'))
      expect(filterFinding).toBeUndefined()
    })
  })

  describe('Improvement Suggestions', () => {
    it('should suggest caching for slow response times', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1200

      const result = await agent.analyze(mockContext)

      const cachingSuggestion = result.improvements.find((i) => i.title.includes('caching'))
      expect(cachingSuggestion).toBeDefined()
      expect(cachingSuggestion?.category).toBe('performance')
      expect(cachingSuggestion?.priority).toBe('high')
      expect(cachingSuggestion?.safetyScore).toBe(85)
      expect(cachingSuggestion?.automatable).toBe(true)
    })

    it('should include implementation details for caching', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1200

      const result = await agent.analyze(mockContext)

      const cachingSuggestion = result.improvements.find((i) => i.title.includes('caching'))
      expect(cachingSuggestion?.implementation?.steps).toBeDefined()
      expect(cachingSuggestion?.implementation?.steps.length).toBeGreaterThan(0)
      expect(cachingSuggestion?.implementation?.risks).toBeDefined()
      expect(cachingSuggestion?.implementation?.rollbackPlan).toBeDefined()
      expect(cachingSuggestion?.implementation?.validationCriteria).toBeDefined()
    })

    it('should suggest pagination for large datasets', async () => {
      mockContext.prospects = Array(600).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      const paginationSuggestion = result.improvements.find((i) => i.title.includes('pagination'))
      expect(paginationSuggestion).toBeDefined()
      expect(paginationSuggestion?.category).toBe('performance')
      expect(paginationSuggestion?.priority).toBe('medium')
      expect(paginationSuggestion?.safetyScore).toBe(95)
      expect(paginationSuggestion?.automatable).toBe(true)
    })

    it('should include implementation details for pagination', async () => {
      mockContext.prospects = Array(600).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      const paginationSuggestion = result.improvements.find((i) => i.title.includes('pagination'))
      expect(paginationSuggestion?.implementation?.steps).toContain(
        'Implement pagination component'
      )
      expect(paginationSuggestion?.implementation?.validationCriteria).toContain(
        'Page load time <500ms'
      )
    })

    it('should suggest both caching and pagination when both issues exist', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1200
      mockContext.prospects = Array(600).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      expect(result.improvements.length).toBe(2)
      expect(result.improvements.some((i) => i.title.includes('caching'))).toBe(true)
      expect(result.improvements.some((i) => i.title.includes('pagination'))).toBe(true)
    })
  })

  describe('Analysis Structure', () => {
    it('should return complete analysis structure', async () => {
      const result = await agent.analyze(mockContext)

      expect(result).toHaveProperty('agentId')
      expect(result).toHaveProperty('agentRole')
      expect(result).toHaveProperty('findings')
      expect(result).toHaveProperty('improvements')
      expect(result).toHaveProperty('timestamp')
      expect(result.agentRole).toBe('optimizer')
    })

    it('should handle optimal conditions', async () => {
      // Optimal context with good performance and small dataset
      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(result.findings).toEqual([])
      expect(result.improvements).toEqual([])
    })

    it('should detect multiple issues simultaneously', async () => {
      mockContext.performanceMetrics.avgResponseTime = 2500
      mockContext.performanceMetrics.errorRate = 0.08
      mockContext.prospects = Array(700).fill({ id: 'test' })

      const result = await agent.analyze(mockContext)

      expect(result.findings.length).toBeGreaterThan(1)
      expect(result.improvements.length).toBeGreaterThan(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle exactly threshold values', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1000 // Exactly at threshold

      const result = await agent.analyze(mockContext)

      // Should not trigger at exact threshold (uses >)
      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding).toBeUndefined()
    })

    it('should handle just over threshold', async () => {
      mockContext.performanceMetrics.avgResponseTime = 1001 // Just over threshold

      const result = await agent.analyze(mockContext)

      const perfFinding = result.findings.find((f) => f.description.includes('Performance issues'))
      expect(perfFinding).toBeDefined()
    })

    it('should handle empty user actions', async () => {
      mockContext.userActions = []

      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(
        result.findings.filter((f) => f.description.includes('filter operations'))
      ).toHaveLength(0)
    })
  })
})
