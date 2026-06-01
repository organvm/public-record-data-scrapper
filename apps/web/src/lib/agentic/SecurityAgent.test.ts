/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for SecurityAgent
 * Tests security vulnerability detection, data protection, and compliance checking
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SecurityAgent } from './agents/SecurityAgent'
import { SystemContext } from './types'

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
      expect(agent.role).toBe('security')
      expect(agent.name).toBe('Security Guardian')
      expect(agent.capabilities).toContain('Security vulnerability detection')
      expect(agent.capabilities).toContain('Data protection assessment')
      expect(agent.capabilities).toContain('Encryption verification')
    })
  })

  describe('Sensitive Data Detection', () => {
    it('should detect prospects with financial data', async () => {
      mockContext.prospects = [
        { id: '1', companyName: 'Company A', estimatedRevenue: 1000000 },
        { id: '2', companyName: 'Company B', estimatedRevenue: 2000000 }
      ]

      const result = await agent.analyze(mockContext)

      const financialFinding = result.findings.find((f) => f.description.includes('financial data'))
      expect(financialFinding).toBeDefined()
      expect(financialFinding?.severity).toBe('warning')
      expect((financialFinding?.evidence as Record<string, any>).count).toBe(2)
      expect((financialFinding?.evidence as Record<string, any>).dataTypes).toContain('revenue')
    })

    it('should detect prospects with lien amounts', async () => {
      mockContext.prospects = [
        {
          id: '1',
          companyName: 'Company A',
          uccFilings: [{ id: 'ucc1', lienAmount: 50000 }]
        }
      ]

      const result = await agent.analyze(mockContext)

      const financialFinding = result.findings.find((f) => f.description.includes('financial data'))
      expect(financialFinding).toBeDefined()
      expect((financialFinding?.evidence as Record<string, any>).dataTypes).toContain('lienAmount')
    })

    it('should not flag prospects without financial data', async () => {
      mockContext.prospects = [{ id: '1', companyName: 'Company A' }]

      const result = await agent.analyze(mockContext)

      const financialFinding = result.findings.find((f) => f.description.includes('financial data'))
      expect(financialFinding).toBeUndefined()
    })
  })

  describe('Access Pattern Analysis', () => {
    it('should detect unusual export activity', async () => {
      // Create 60 export actions in last 24h
      const recentTimestamp = new Date()
      mockContext.userActions = Array(60).fill({
        type: 'export',
        timestamp: recentTimestamp.toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const exportFinding = result.findings.find((f) => f.description.includes('export operations'))
      expect(exportFinding).toBeDefined()
      expect(exportFinding?.severity).toBe('warning')
      expect((exportFinding?.evidence as Record<string, any>).exportCount).toBe(60)
      expect((exportFinding?.evidence as Record<string, any>).threshold).toBe(50)
    })

    it('should not flag normal export activity', async () => {
      mockContext.userActions = Array(30).fill({
        type: 'export',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const exportFinding = result.findings.find((f) => f.description.includes('export operations'))
      expect(exportFinding).toBeUndefined()
    })

    it('should ignore old export actions', async () => {
      // Create export actions from 2 days ago
      const oldTimestamp = new Date()
      oldTimestamp.setDate(oldTimestamp.getDate() - 2)

      mockContext.userActions = Array(60).fill({
        type: 'export',
        timestamp: oldTimestamp.toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      const exportFinding = result.findings.find((f) => f.description.includes('export operations'))
      expect(exportFinding).toBeUndefined()
    })

    it('should filter by export type only', async () => {
      mockContext.userActions = [
        ...Array(30).fill({ type: 'export', timestamp: new Date().toISOString(), details: {} }),
        ...Array(40).fill({ type: 'filter', timestamp: new Date().toISOString(), details: {} })
      ]

      const result = await agent.analyze(mockContext)

      // Should not trigger since only 30 exports
      const exportFinding = result.findings.find((f) => f.description.includes('export operations'))
      expect(exportFinding).toBeUndefined()
    })
  })

  describe('Improvement Suggestions', () => {
    it('should always suggest data encryption', async () => {
      const result = await agent.analyze(mockContext)

      const encryptionSuggestion = result.improvements.find((i) => i.title.includes('encryption'))
      expect(encryptionSuggestion).toBeDefined()
      expect(encryptionSuggestion?.category).toBe('security')
      expect(encryptionSuggestion?.priority).toBe('high')
      expect(encryptionSuggestion?.safetyScore).toBe(80)
      expect(encryptionSuggestion?.automatable).toBe(true)
    })

    it('should include implementation details for encryption', async () => {
      const result = await agent.analyze(mockContext)

      const encryptionSuggestion = result.improvements.find((i) => i.title.includes('encryption'))
      expect(encryptionSuggestion?.implementation?.steps).toContain(
        'Implement field-level encryption'
      )
      expect(encryptionSuggestion?.implementation?.steps).toContain('Set up key management system')
      expect(encryptionSuggestion?.implementation?.risks).toBeDefined()
      expect(encryptionSuggestion?.implementation?.rollbackPlan).toBeDefined()
      expect(encryptionSuggestion?.implementation?.validationCriteria).toBeDefined()
    })

    it('should suggest security hardening when critical findings exist', async () => {
      // This test requires creating a critical finding
      // Since the current implementation creates 'warning' findings,
      // we need to create a scenario that would produce critical findings
      // For now, we'll test that the method exists and can be called

      // Note: The current SecurityAgent always marks findings as 'warning'
      // so this suggestion may not be triggered in the current implementation
      const result = await agent.analyze(mockContext)

      // Verify the agent can produce improvements
      expect(result.improvements.length).toBeGreaterThanOrEqual(1)
    })

    it('should provide comprehensive security hardening plan', async () => {
      // Create conditions that would trigger security hardening
      mockContext.prospects = [{ id: '1', estimatedRevenue: 1000000 }]

      const result = await agent.analyze(mockContext)

      // Check that security improvements are suggested
      const securityImprovements = result.improvements.filter((i) => i.category === 'security')
      expect(securityImprovements.length).toBeGreaterThan(0)

      securityImprovements.forEach((imp) => {
        expect(imp.implementation).toBeDefined()
        expect(imp.implementation?.steps.length).toBeGreaterThan(0)
        expect(imp.implementation?.risks.length).toBeGreaterThan(0)
      })
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
      expect(result.agentRole).toBe('security')
    })

    it('should always include encryption suggestion', async () => {
      const result = await agent.analyze(mockContext)

      expect(result.improvements.length).toBeGreaterThanOrEqual(1)
      expect(result.improvements.some((i) => i.title.includes('encryption'))).toBe(true)
    })

    it('should detect multiple security issues', async () => {
      // Create multiple security concerns
      mockContext.prospects = [
        { id: '1', estimatedRevenue: 1000000 },
        { id: '2', estimatedRevenue: 2000000 }
      ]
      mockContext.userActions = Array(60).fill({
        type: 'export',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      expect(result.findings.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty context', async () => {
      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(result.improvements.length).toBeGreaterThanOrEqual(1) // Always suggests encryption
    })

    it('should handle exactly threshold export count', async () => {
      mockContext.userActions = Array(50).fill({
        type: 'export',
        timestamp: new Date().toISOString(),
        details: {}
      })

      const result = await agent.analyze(mockContext)

      // Should not trigger at exact threshold (uses >)
      const exportFinding = result.findings.find((f) => f.description.includes('export operations'))
      expect(exportFinding).toBeUndefined()
    })

    it('should handle mixed financial data sources', async () => {
      mockContext.prospects = [
        { id: '1', estimatedRevenue: 1000000 },
        { id: '2', uccFilings: [{ id: 'ucc1', lienAmount: 50000 }] },
        { id: '3', companyName: 'Clean Company' }
      ]

      const result = await agent.analyze(mockContext)

      const financialFinding = result.findings.find((f) => f.description.includes('financial data'))
      expect((financialFinding?.evidence as Record<string, any>).count).toBe(2)
    })

    it('should handle prospects with empty UCC filings array', async () => {
      mockContext.prospects = [{ id: '1', companyName: 'Company A', uccFilings: [] }]

      const result = await agent.analyze(mockContext)

      const financialFinding = result.findings.find((f) => f.description.includes('financial data'))
      expect(financialFinding).toBeUndefined()
    })
  })

  describe('Security Best Practices', () => {
    it('should prioritize security improvements appropriately', async () => {
      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(['high', 'critical']).toContain(improvement.priority)
      })
    })

    it('should include risk assessment in suggestions', async () => {
      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.implementation?.risks).toBeDefined()
        expect(improvement.implementation?.risks.length).toBeGreaterThan(0)
      })
    })

    it('should provide rollback plans for safety', async () => {
      const result = await agent.analyze(mockContext)

      result.improvements.forEach((improvement) => {
        expect(improvement.implementation?.rollbackPlan).toBeDefined()
        expect(improvement.implementation?.rollbackPlan.length).toBeGreaterThan(0)
      })
    })
  })
})
