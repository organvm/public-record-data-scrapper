/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for UXEnhancerAgent
 * Tests user experience analysis, interaction patterns, and usability improvements
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { UXEnhancerAgent } from './agents/UXEnhancerAgent'
import { SystemContext } from './types'

describe('UXEnhancerAgent', () => {
  let agent: UXEnhancerAgent
  let mockContext: SystemContext

  beforeEach(() => {
    agent = new UXEnhancerAgent()
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
      expect(agent.role).toBe('ux-enhancer')
      expect(agent.name).toBe('UX Enhancer')
      expect(agent.capabilities).toContain('User experience analysis')
      expect(agent.capabilities).toContain('Interaction pattern detection')
      expect(agent.capabilities).toContain('Usability improvement')
    })
  })

  describe('User Interaction Analysis', () => {
    it('should detect high frequency search operations', async () => {
      mockContext.userActions = Array(120).fill({
        type: 'search',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const searchFinding = result.findings.find((f) => f.description.includes('search operations'))
      expect(searchFinding).toBeDefined()
      expect(searchFinding?.severity).toBe('info')
      expect((searchFinding?.evidence as Record<string, any>).count).toBe(120)
      expect((searchFinding?.evidence as Record<string, any>).suggestion).toBe('improve-filtering')
    })

    it('should not flag normal search activity', async () => {
      mockContext.userActions = Array(50).fill({
        type: 'search',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const searchFinding = result.findings.find((f) => f.description.includes('search operations'))
      expect(searchFinding).toBeUndefined()
    })

    it('should only flag search type actions', async () => {
      mockContext.userActions = [
        ...Array(80).fill({ type: 'filter', timestamp: new Date().toISOString(), details: {} }),
        ...Array(80).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      const searchFinding = result.findings.find((f) => f.description.includes('search operations'))
      expect(searchFinding).toBeUndefined()
    })
  })

  describe('User Satisfaction Monitoring', () => {
    it('should detect low user satisfaction', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      const satisfactionFinding = result.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeDefined()
      expect(satisfactionFinding?.severity).toBe('warning')
      expect((satisfactionFinding?.evidence as Record<string, any>).score).toBe(6)
      expect((satisfactionFinding?.evidence as Record<string, any>).threshold).toBe(7)
    })

    it('should not flag good satisfaction scores', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 8

      const result = await agent.analyze(mockContext)

      const satisfactionFinding = result.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeUndefined()
    })

    it('should handle exactly threshold satisfaction', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 7

      const result = await agent.analyze(mockContext)

      // Should not flag at exact threshold (uses <)
      const satisfactionFinding = result.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeUndefined()
    })
  })

  describe('Workflow Efficiency Analysis', () => {
    it('should detect frequent claim and export operations', async () => {
      mockContext.userActions = [
        ...Array(25).fill({ type: 'claim', timestamp: new Date().toISOString(), details: {} }),
        ...Array(25).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      const workflowSuggestion = result.improvements.find((i) => i.title.includes('bulk workflow'))
      expect(workflowSuggestion).toBeDefined()
      expect(workflowSuggestion?.category).toBe('usability')
      expect(workflowSuggestion?.priority).toBe('medium')
      expect(workflowSuggestion?.safetyScore).toBe(90)
    })

    it('should not suggest bulk workflow for low activity', async () => {
      mockContext.userActions = [
        ...Array(10).fill({ type: 'claim', timestamp: new Date().toISOString(), details: {} }),
        ...Array(10).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      const workflowSuggestion = result.improvements.find((i) => i.title.includes('bulk workflow'))
      expect(workflowSuggestion).toBeUndefined()
    })

    it('should require both claim and export for workflow suggestion', async () => {
      mockContext.userActions = Array(50).fill({
        type: 'claim',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const workflowSuggestion = result.improvements.find((i) => i.title.includes('bulk workflow'))
      expect(workflowSuggestion).toBeUndefined()
    })
  })

  describe('Improvement Suggestions', () => {
    it('should suggest UX improvements for low satisfaction', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      const uxSuggestion = result.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxSuggestion).toBeDefined()
      expect(uxSuggestion?.category).toBe('usability')
      expect(uxSuggestion?.priority).toBe('high')
      expect(uxSuggestion?.safetyScore).toBe(85)
      expect(uxSuggestion?.automatable).toBe(true)
    })

    it('should include implementation details for UX improvements', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      const uxSuggestion = result.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxSuggestion?.implementation?.steps).toContain('Add tooltips to all complex controls')
      expect(uxSuggestion?.implementation?.steps).toContain('Create interactive onboarding flow')
      expect(uxSuggestion?.implementation?.risks).toBeDefined()
      expect(uxSuggestion?.implementation?.rollbackPlan).toBeDefined()
      expect(uxSuggestion?.implementation?.validationCriteria).toContain(
        'User satisfaction score >7.5'
      )
    })

    it('should not suggest UX improvement for good satisfaction', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 8

      const result = await agent.analyze(mockContext)

      const uxSuggestion = result.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxSuggestion).toBeUndefined()
    })

    it('should include workflow shortcuts in implementation', async () => {
      mockContext.userActions = [
        ...Array(25).fill({ type: 'claim', timestamp: new Date().toISOString(), details: {} }),
        ...Array(25).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      const workflowSuggestion = result.improvements.find((i) => i.title.includes('bulk workflow'))
      expect(workflowSuggestion?.implementation?.steps).toContain(
        'Add "Claim & Export" bulk action'
      )
      expect(workflowSuggestion?.implementation?.steps).toContain(
        'Add keyboard shortcuts for power users'
      )
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
      expect(result.agentRole).toBe('ux-enhancer')
    })

    it('should handle optimal conditions', async () => {
      // Good satisfaction, low activity
      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(result.findings).toEqual([])
      expect(result.improvements).toEqual([])
    })

    it('should detect multiple UX issues', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 5
      mockContext.userActions = [
        ...Array(120).fill({ type: 'search', timestamp: new Date().toISOString(), details: {} }),
        ...Array(30).fill({ type: 'claim', timestamp: new Date().toISOString(), details: {} }),
        ...Array(30).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      expect(result.findings.length).toBeGreaterThanOrEqual(2)
      expect(result.improvements.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty user actions', async () => {
      mockContext.userActions = []

      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(result.findings.length).toBe(0)
    })

    it('should handle exactly threshold values', async () => {
      mockContext.userActions = Array(100).fill({
        type: 'search',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      // Should not trigger at exact threshold (uses >)
      const searchFinding = result.findings.find((f) => f.description.includes('search operations'))
      expect(searchFinding).toBeUndefined()
    })

    it('should count action types correctly', async () => {
      mockContext.userActions = [
        { type: 'search', timestamp: new Date().toISOString(), details: {} },
        { type: 'search', timestamp: new Date().toISOString(), details: {} },
        { type: 'filter', timestamp: new Date().toISOString(), details: {} },
        { type: 'search', timestamp: new Date().toISOString(), details: {} }
      ]

      const result = await agent.analyze(mockContext)

      // Only 3 searches, below threshold
      const searchFinding = result.findings.find((f) => f.description.includes('search operations'))
      expect(searchFinding).toBeUndefined()
    })

    it('should handle mixed action types', async () => {
      mockContext.userActions = [
        ...Array(50).fill({ type: 'search', timestamp: new Date().toISOString(), details: {} }),
        ...Array(50).fill({ type: 'filter', timestamp: new Date().toISOString(), details: {} }),
        ...Array(50).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} }),
        ...Array(50).fill({ type: 'claim', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      // Should have workflow suggestion due to claim+export, but no search finding
    })
  })

  describe('Usability Best Practices', () => {
    it('should prioritize user-facing improvements', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.category).toBe('usability')
      })
    })

    it('should provide clear validation criteria', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.implementation?.validationCriteria).toBeDefined()
        expect(improvement.implementation?.validationCriteria.length).toBeGreaterThan(0)
      })
    })

    it('should have high safety scores for UX changes', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.safetyScore).toBeGreaterThanOrEqual(85)
      })
    })

    it('should focus on measurable improvements', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.estimatedImpact).toBeTruthy()
        expect(improvement.reasoning).toBeTruthy()
      })
    })
  })
})
