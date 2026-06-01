/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * UXEnhancerAgent Tests
 *
 * Tests for the UXEnhancerAgent including:
 * - User experience analysis
 * - Interaction pattern detection
 * - Satisfaction monitoring
 * - Workflow efficiency analysis
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { UXEnhancerAgent } from './UXEnhancerAgent'
import { SystemContext } from '../types'

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
      expect(agent.role).toBe('ux-enhancer')
      expect(agent.name).toBe('UX Enhancer')
      expect(agent.capabilities).toContain('User experience analysis')
      expect(agent.capabilities).toContain('Interaction pattern detection')
      expect(agent.capabilities).toContain('Usability improvement')
    })
  })

  describe('User Experience Analysis', () => {
    it('should detect high frequency search operations', async () => {
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const searchFinding = analysis.findings.find((f) =>
        f.description.includes('search operations')
      )
      expect(searchFinding).toBeDefined()
      expect(searchFinding?.severity).toBe('info')
    })

    it('should suggest improving filtering for frequent searches', async () => {
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const searchFinding = analysis.findings.find((f) =>
        f.description.includes('search operations')
      )
      expect((searchFinding?.evidence as Record<string, any>).suggestion).toBe('improve-filtering')
    })

    it('should not flag normal search frequency', async () => {
      mockContext.userActions = Array(50)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const searchFinding = analysis.findings.find((f) =>
        f.description.includes('search operations')
      )
      expect(searchFinding).toBeUndefined()
    })

    it('should track action counts correctly', async () => {
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const searchFinding = analysis.findings.find((f) =>
        f.description.includes('search operations')
      )
      expect((searchFinding?.evidence as Record<string, any>).count).toBe(150)
    })
  })

  describe('User Satisfaction Monitoring', () => {
    it('should detect low satisfaction scores', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeDefined()
      expect(satisfactionFinding?.severity).toBe('warning')
    })

    it('should not flag high satisfaction scores', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 8.5

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeUndefined()
    })

    it('should suggest UX improvements for low satisfaction', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxImprovement).toBeDefined()
      expect(uxImprovement?.priority).toBe('high')
    })

    it('should include satisfaction threshold in evidence', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6.5

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect((satisfactionFinding?.evidence as Record<string, any>).threshold).toBe(7)
    })
  })

  describe('Workflow Efficiency Analysis', () => {
    it('should detect frequent claim-then-export workflows', async () => {
      mockContext.userActions = [
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement).toBeDefined()
    })

    it('should suggest workflow shortcuts for common patterns', async () => {
      mockContext.userActions = [
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement?.category).toBe('usability')
      expect(workflowImprovement?.priority).toBe('medium')
    })

    it('should mark workflow improvements as highly safe', async () => {
      mockContext.userActions = [
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement?.safetyScore).toBeGreaterThanOrEqual(85)
    })

    it('should not suggest workflows for infrequent patterns', async () => {
      mockContext.userActions = [
        ...Array(10)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(10)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement).toBeUndefined()
    })
  })

  describe('UX Improvement Suggestions', () => {
    it('should include implementation steps', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))

      expect(uxImprovement?.implementation).toBeDefined()
      expect(uxImprovement?.implementation?.steps.length).toBeGreaterThan(0)
    })

    it('should mark UX improvements as automatable', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxImprovement?.automatable).toBe(true)
    })

    it('should provide high safety scores', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxImprovement?.safetyScore).toBeGreaterThanOrEqual(80)
    })

    it('should include validation criteria', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))

      expect(uxImprovement?.implementation?.validationCriteria).toBeDefined()
      expect(uxImprovement?.implementation?.validationCriteria.length).toBeGreaterThan(0)
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
      expect(analysis.agentRole).toBe('ux-enhancer')
    })
  })

  describe('Finding Categories', () => {
    it('should categorize all findings as usability', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6
      mockContext.userActions = Array(150)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      analysis.findings.forEach((finding) => {
        expect(finding.category).toBe('usability')
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

    it('should handle zero satisfaction score', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 0

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeDefined()
      expect(satisfactionFinding?.severity).toBe('warning')
    })

    it('should handle perfect satisfaction score', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 10

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeUndefined()
    })

    it('should handle mixed action types', async () => {
      mockContext.userActions = [
        ...Array(50)
          .fill(null)
          .map(() => ({
            type: 'search',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(50)
          .fill(null)
          .map(() => ({
            type: 'filter',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(50)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
    })
  })

  describe('Scenario-based Tests', () => {
    it('should handle poor UX scenario', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 5
      mockContext.userActions = [
        ...Array(150)
          .fill(null)
          .map(() => ({
            type: 'search',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBeGreaterThan(0)
      expect(analysis.improvements.length).toBeGreaterThan(0)
    })

    it('should handle excellent UX scenario', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 9
      mockContext.userActions = Array(20)
        .fill(null)
        .map(() => ({
          type: 'view',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBe(0)
      expect(analysis.improvements.length).toBe(0)
    })

    it('should prioritize improvements based on severity', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 5
      mockContext.userActions = Array(200)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const highPriorityImprovements = analysis.improvements.filter((i) => i.priority === 'high')
      expect(highPriorityImprovements.length).toBeGreaterThan(0)
    })
  })

  describe('Improvement Reasoning', () => {
    it('should provide clear reasoning for improvements', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.reasoning).toBeDefined()
        expect(improvement.reasoning.length).toBeGreaterThan(0)
      })
    })

    it('should estimate user impact', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxImprovement?.estimatedImpact).toContain('%')
    })

    it('should identify implementation risks', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6

      const analysis = await agent.analyze(mockContext)
      const uxImprovement = analysis.improvements.find((i) => i.title.includes('contextual help'))
      expect(uxImprovement?.implementation?.risks.length).toBeGreaterThan(0)
    })
  })

  describe('Usability Thresholds', () => {
    it('should use 100 searches threshold for detection', async () => {
      mockContext.userActions = Array(101)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const searchFinding = analysis.findings.find((f) =>
        f.description.includes('search operations')
      )
      expect(searchFinding).toBeDefined()
    })

    it('should use 7.0 threshold for satisfaction score', async () => {
      mockContext.performanceMetrics.userSatisfactionScore = 6.9

      const analysis = await agent.analyze(mockContext)
      const satisfactionFinding = analysis.findings.find((f) =>
        f.description.includes('satisfaction score')
      )
      expect(satisfactionFinding).toBeDefined()
    })

    it('should use 20 operations threshold for workflow detection', async () => {
      mockContext.userActions = [
        ...Array(21)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(21)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement).toBeDefined()
    })
  })

  describe('Workflow Pattern Detection', () => {
    it('should count claim and export actions separately', async () => {
      mockContext.userActions = [
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement).toBeDefined()
    })

    it('should include workflow benefits in description', async () => {
      mockContext.userActions = [
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'claim',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(25)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const workflowImprovement = analysis.improvements.find((i) =>
        i.title.includes('bulk workflow')
      )
      expect(workflowImprovement?.estimatedImpact).toContain('clicks')
      expect(workflowImprovement?.estimatedImpact).toContain('%')
    })
  })
})
