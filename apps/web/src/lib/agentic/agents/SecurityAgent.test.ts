/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SecurityAgent Tests
 *
 * Tests for the SecurityAgent including:
 * - Security vulnerability detection
 * - Sensitive data handling
 * - Access pattern analysis
 * - Security improvement suggestions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SecurityAgent } from './SecurityAgent'
import { SystemContext } from '../types'

describe('SecurityAgent', () => {
  let agent: SecurityAgent
  let mockContext: SystemContext

  beforeEach(() => {
    agent = new SecurityAgent()
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
      expect(agent.role).toBe('security')
      expect(agent.name).toBe('Security Guardian')
      expect(agent.capabilities).toContain('Security vulnerability detection')
      expect(agent.capabilities).toContain('Data protection assessment')
      expect(agent.capabilities).toContain('Access control review')
    })
  })

  describe('Sensitive Data Detection', () => {
    it('should detect prospects with financial data', async () => {
      mockContext.prospects = [
        {
          companyName: 'Test Co',
          estimatedRevenue: 1000000
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect(sensitiveDataFinding).toBeDefined()
      expect(sensitiveDataFinding?.severity).toBe('warning')
    })

    it('should detect lien amounts in UCC filings', async () => {
      mockContext.prospects = [
        {
          companyName: 'Test Co',
          uccFilings: [{ id: '1', lienAmount: 50000 }]
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect(sensitiveDataFinding).toBeDefined()
    })

    it('should count all prospects with sensitive data', async () => {
      mockContext.prospects = [
        { companyName: 'Co1', estimatedRevenue: 1000000 },
        { companyName: 'Co2', uccFilings: [{ id: '1', lienAmount: 50000 }] },
        { companyName: 'Co3', estimatedRevenue: 2000000 }
      ]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect((sensitiveDataFinding?.evidence as Record<string, any>).count).toBe(3)
    })

    it('should not flag prospects without sensitive data', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect(sensitiveDataFinding).toBeUndefined()
    })
  })

  describe('Access Pattern Analysis', () => {
    it('should detect unusual export operations', async () => {
      mockContext.userActions = Array(60)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      expect(accessPatternFinding).toBeDefined()
      expect(accessPatternFinding?.severity).toBe('warning')
    })

    it('should only consider recent actions (last 24h)', async () => {
      mockContext.userActions = [
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(), // 12 hours ago
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48 hours ago (should be ignored)
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      // Should not trigger as only 30 recent exports
      expect(accessPatternFinding).toBeUndefined()
    })

    it('should not flag normal export patterns', async () => {
      mockContext.userActions = Array(20)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      expect(accessPatternFinding).toBeUndefined()
    })

    it('should include export count in evidence', async () => {
      mockContext.userActions = Array(60)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      expect((accessPatternFinding?.evidence as Record<string, any>).exportCount).toBe(60)
      expect((accessPatternFinding?.evidence as Record<string, any>).threshold).toBe(50)
    })
  })

  describe('Security Hardening Suggestions', () => {
    it('should suggest hardening when critical findings exist', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', estimatedRevenue: 1000000 }]
      mockContext.userActions = Array(60)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      // Test that security improvements are suggested
      const testAgent = new SecurityAgent()
      const testAnalysis = await testAgent.analyze(mockContext)

      // Check that security improvements are suggested
      expect(testAnalysis.improvements.length).toBeGreaterThan(0)
    })

    it('should mark security hardening as high priority', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', estimatedRevenue: 1000000 }]

      const analysis = await agent.analyze(mockContext)
      const hardeningImprovement = analysis.improvements.find((i) => i.category === 'security')

      if (hardeningImprovement) {
        expect(['critical', 'high']).toContain(hardeningImprovement.priority)
      }
    })

    it('should include implementation steps for hardening', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', estimatedRevenue: 1000000 }]

      const analysis = await agent.analyze(mockContext)
      const securityImprovement = analysis.improvements.find((i) => i.category === 'security')

      if (securityImprovement?.implementation) {
        expect(securityImprovement.implementation.steps.length).toBeGreaterThan(0)
        expect(securityImprovement.implementation.risks.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Data Encryption Suggestions', () => {
    it('should always suggest data encryption', async () => {
      const analysis = await agent.analyze(mockContext)
      const encryptionImprovement = analysis.improvements.find((i) =>
        i.title.includes('encryption')
      )
      expect(encryptionImprovement).toBeDefined()
    })

    it('should mark encryption as high priority', async () => {
      const analysis = await agent.analyze(mockContext)
      const encryptionImprovement = analysis.improvements.find((i) =>
        i.title.includes('encryption')
      )
      expect(encryptionImprovement?.priority).toBe('high')
    })

    it('should mark encryption as automatable', async () => {
      const analysis = await agent.analyze(mockContext)
      const encryptionImprovement = analysis.improvements.find((i) =>
        i.title.includes('encryption')
      )
      expect(encryptionImprovement?.automatable).toBe(true)
    })

    it('should provide reasonable safety score for encryption', async () => {
      const analysis = await agent.analyze(mockContext)
      const encryptionImprovement = analysis.improvements.find((i) =>
        i.title.includes('encryption')
      )
      expect(encryptionImprovement?.safetyScore).toBeGreaterThanOrEqual(70)
      expect(encryptionImprovement?.safetyScore).toBeLessThanOrEqual(100)
    })

    it('should include validation criteria for encryption', async () => {
      const analysis = await agent.analyze(mockContext)
      const encryptionImprovement = analysis.improvements.find((i) =>
        i.title.includes('encryption')
      )

      expect(encryptionImprovement?.implementation?.validationCriteria).toBeDefined()
      expect(encryptionImprovement?.implementation?.validationCriteria.length).toBeGreaterThan(0)
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
      expect(analysis.agentRole).toBe('security')
    })
  })

  describe('Finding Categories', () => {
    it('should categorize all findings as security', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', estimatedRevenue: 1000000 }]
      mockContext.userActions = Array(60)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      analysis.findings.forEach((finding) => {
        expect(finding.category).toBe('security')
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

    it('should handle prospects with no UCC filings', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', state: 'CA' }]

      const analysis = await agent.analyze(mockContext)
      expect(analysis).toBeDefined()
    })

    it('should handle prospects with empty UCC filings', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', uccFilings: [] }]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect(sensitiveDataFinding).toBeUndefined()
    })

    it('should handle mixed action types', async () => {
      mockContext.userActions = [
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date().toISOString(),
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'search',
            timestamp: new Date().toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      expect(accessPatternFinding).toBeUndefined()
    })
  })

  describe('Scenario-based Tests', () => {
    it('should handle high-risk security scenario', async () => {
      mockContext.prospects = Array(100)
        .fill(null)
        .map((_, i) => ({
          companyName: `Company ${i}`,
          estimatedRevenue: 1000000 + i * 10000,
          uccFilings: [{ id: `${i}`, lienAmount: 50000 }]
        }))
      mockContext.userActions = Array(80)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      expect(analysis.findings.length).toBeGreaterThan(0)
      expect(analysis.improvements.length).toBeGreaterThan(0)
    })

    it('should handle secure scenario with no issues', async () => {
      mockContext.prospects = [{ companyName: 'Test Co', state: 'CA' }]
      mockContext.userActions = Array(10)
        .fill(null)
        .map(() => ({
          type: 'search',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      // Should still suggest encryption as baseline security
      expect(analysis.improvements.length).toBeGreaterThan(0)
    })
  })

  describe('Improvement Reasoning', () => {
    it('should provide clear reasoning for improvements', async () => {
      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.reasoning).toBeDefined()
        expect(improvement.reasoning.length).toBeGreaterThan(0)
      })
    })

    it('should estimate security impact', async () => {
      const analysis = await agent.analyze(mockContext)
      analysis.improvements.forEach((improvement) => {
        expect(improvement.estimatedImpact).toBeDefined()
        expect(improvement.estimatedImpact.length).toBeGreaterThan(0)
      })
    })

    it('should identify security risks', async () => {
      const analysis = await agent.analyze(mockContext)
      const securityImprovement = analysis.improvements[0]

      if (securityImprovement?.implementation) {
        expect(securityImprovement.implementation.risks.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Security Thresholds', () => {
    it('should use 50 exports threshold for unusual activity', async () => {
      mockContext.userActions = Array(51)
        .fill(null)
        .map(() => ({
          type: 'export',
          timestamp: new Date().toISOString(),
          details: {}
        }))

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      expect(accessPatternFinding).toBeDefined()
    })

    it('should consider 24h time window for access patterns', async () => {
      const now = Date.now()
      mockContext.userActions = [
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date(now - 23 * 60 * 60 * 1000).toISOString(),
            details: {}
          })),
        ...Array(30)
          .fill(null)
          .map(() => ({
            type: 'export',
            timestamp: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
            details: {}
          }))
      ]

      const analysis = await agent.analyze(mockContext)
      const accessPatternFinding = analysis.findings.find((f) =>
        f.description.includes('export operations')
      )
      // Only 30 exports in last 24h, should not trigger
      expect(accessPatternFinding).toBeUndefined()
    })
  })

  describe('Data Types Tracking', () => {
    it('should track types of sensitive data found', async () => {
      mockContext.prospects = [
        {
          companyName: 'Test Co',
          estimatedRevenue: 1000000,
          uccFilings: [{ id: '1', lienAmount: 50000 }]
        }
      ]

      const analysis = await agent.analyze(mockContext)
      const sensitiveDataFinding = analysis.findings.find((f) =>
        f.description.includes('financial data')
      )
      expect((sensitiveDataFinding?.evidence as Record<string, any>).dataTypes).toContain('revenue')
      expect((sensitiveDataFinding?.evidence as Record<string, any>).dataTypes).toContain(
        'lienAmount'
      )
    })
  })
})
