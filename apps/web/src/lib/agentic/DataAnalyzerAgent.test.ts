/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for DataAnalyzerAgent
 * Tests data quality assessment, freshness monitoring, and completeness checks
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DataAnalyzerAgent } from './agents/DataAnalyzerAgent'
import { SystemContext } from './types'

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
      expect(agent.role).toBe('data-analyzer')
      expect(agent.name).toBe('Data Analyzer')
      expect(agent.capabilities).toContain('Data quality assessment')
      expect(agent.capabilities).toContain('Pattern detection')
      expect(agent.capabilities).toContain('Data freshness monitoring')
    })
  })

  describe('Data Freshness Detection', () => {
    it('should detect stale health scores', async () => {
      // Create prospects with stale data
      const staleDate = new Date()
      staleDate.setDate(staleDate.getDate() - 10) // 10 days old

      mockContext.prospects = [
        {
          id: '1',
          companyName: 'Company A',
          healthScore: {
            overall: 75,
            lastUpdated: staleDate.toISOString()
          }
        },
        {
          id: '2',
          companyName: 'Company B',
          healthScore: {
            overall: 80,
            lastUpdated: new Date().toISOString() // Fresh
          }
        },
        {
          id: '3',
          companyName: 'Company C',
          healthScore: {
            overall: 70,
            lastUpdated: new Date().toISOString() // Fresh
          }
        },
        {
          id: '4',
          companyName: 'Company D',
          healthScore: {
            overall: 85,
            lastUpdated: new Date().toISOString() // Fresh
          }
        },
        {
          id: '5',
          companyName: 'Company E',
          healthScore: {
            overall: 90,
            lastUpdated: new Date().toISOString() // Fresh
          }
        }
      ]

      const result = await agent.analyze(mockContext)

      // Should detect stale data among other findings
      expect(result.findings.length).toBeGreaterThan(0)
      const staleFinding = result.findings.find((f) => f.description.includes('stale'))
      expect(staleFinding).toBeDefined()
      expect(staleFinding?.severity).toBe('warning') // 1/5 = 20% < 30% threshold
      expect((staleFinding?.evidence as Record<string, any>).staleCount).toBe(1)
    })

    it('should mark as critical when >30% data is stale', async () => {
      const staleDate = new Date()
      staleDate.setDate(staleDate.getDate() - 10)

      mockContext.prospects = [
        { id: '1', healthScore: { overall: 75, lastUpdated: staleDate.toISOString() } },
        { id: '2', healthScore: { overall: 80, lastUpdated: staleDate.toISOString() } },
        { id: '3', healthScore: { overall: 70, lastUpdated: new Date().toISOString() } }
      ]

      const result = await agent.analyze(mockContext)
      const staleFinding = result.findings.find((f) => f.description.includes('stale'))

      expect(staleFinding?.severity).toBe('critical')
      expect((staleFinding?.evidence as Record<string, any>).percentage).toBe('66.7')
    })

    it('should not flag fresh data', async () => {
      mockContext.prospects = [
        {
          id: '1',
          healthScore: {
            overall: 75,
            lastUpdated: new Date().toISOString()
          }
        }
      ]

      const result = await agent.analyze(mockContext)
      const staleFinding = result.findings.find((f) => f.description.includes('stale'))

      expect(staleFinding).toBeUndefined()
    })
  })

  describe('Data Quality Assessment', () => {
    it('should detect missing revenue estimates', async () => {
      mockContext.prospects = [
        { id: '1', companyName: 'Company A' },
        { id: '2', companyName: 'Company B', estimatedRevenue: 1000000 }
      ]

      const result = await agent.analyze(mockContext)

      const revenueFinding = result.findings.find((f) => f.description.includes('revenue'))
      expect(revenueFinding).toBeDefined()
      expect((revenueFinding?.evidence as Record<string, any>).incompleteCount).toBe(1)
    })

    it('should detect missing growth signals', async () => {
      mockContext.prospects = [
        { id: '1', companyName: 'Company A', growthSignals: [] },
        { id: '2', companyName: 'Company B', growthSignals: ['hiring'] }
      ]

      const result = await agent.analyze(mockContext)

      const signalsFinding = result.findings.find((f) => f.description.includes('growth signals'))
      expect(signalsFinding).toBeDefined()
      expect(signalsFinding?.severity).toBe('warning')
      expect((signalsFinding?.evidence as Record<string, any>).missingSignalsCount).toBe(1)
    })
  })

  describe('Data Completeness Check', () => {
    it('should calculate completeness score correctly', async () => {
      mockContext.prospects = [
        {
          id: '1',
          companyName: 'Complete Company',
          industry: 'Tech',
          state: 'CA',
          priorityScore: 85,
          defaultDate: '2024-01-01',
          estimatedRevenue: 5000000,
          narrative: 'Test narrative',
          healthScore: { overall: 80 },
          uccFilings: [{ id: 'ucc1' }],
          growthSignals: ['expansion']
        }
      ]

      const result = await agent.analyze(mockContext)

      // Should not flag high completeness
      const completenessFinding = result.findings.find((f) =>
        f.description.includes('completeness')
      )
      expect(completenessFinding).toBeUndefined()
    })

    it('should flag low completeness as warning', async () => {
      mockContext.prospects = [
        {
          id: '1',
          companyName: 'Incomplete Company',
          industry: 'Tech'
          // Missing most fields
        }
      ]

      const result = await agent.analyze(mockContext)

      const completenessFinding = result.findings.find((f) =>
        f.description.includes('completeness')
      )
      expect(completenessFinding).toBeDefined()
      expect(completenessFinding?.severity).toBe('critical')
      expect((completenessFinding?.evidence as Record<string, any>).avgCompleteness).toBeLessThan(
        60
      )
    })
  })

  describe('Improvement Suggestions', () => {
    it('should suggest data enrichment pipeline when quality issues exist', async () => {
      mockContext.prospects = [
        { id: '1', companyName: 'Company A' }, // Missing most fields
        { id: '2', companyName: 'Company B' }
      ]

      const result = await agent.analyze(mockContext)

      const enrichmentSuggestion = result.improvements.find((i) => i.title.includes('enrichment'))
      expect(enrichmentSuggestion).toBeDefined()
      expect(enrichmentSuggestion?.category).toBe('data-quality')
      expect(enrichmentSuggestion?.priority).toBe('high')
      expect(enrichmentSuggestion?.automatable).toBe(true)
      expect(enrichmentSuggestion?.safetyScore).toBe(75)
      expect(enrichmentSuggestion?.implementation?.steps).toBeDefined()
    })

    it('should suggest automated refresh for stale data', async () => {
      const staleDate = new Date()
      staleDate.setDate(staleDate.getDate() - 10)

      mockContext.prospects = [
        {
          id: '1',
          healthScore: { overall: 75, lastUpdated: staleDate.toISOString() }
        }
      ]

      const result = await agent.analyze(mockContext)

      const refreshSuggestion = result.improvements.find((i) => i.title.includes('refresh'))
      expect(refreshSuggestion).toBeDefined()
      expect(refreshSuggestion?.category).toBe('data-quality')
      expect(refreshSuggestion?.priority).toBe('medium')
      expect(refreshSuggestion?.safetyScore).toBe(90)
      expect(refreshSuggestion?.implementation?.validationCriteria).toContain(
        'All health scores <7 days old'
      )
    })

    it('should include implementation details in suggestions', async () => {
      mockContext.prospects = [{ id: '1', companyName: 'Test' }]

      const result = await agent.analyze(mockContext)

      if (result.improvements.length > 0) {
        const suggestion = result.improvements[0]
        expect(suggestion.implementation).toBeDefined()
        expect(suggestion.implementation?.steps.length).toBeGreaterThan(0)
        expect(suggestion.implementation?.risks.length).toBeGreaterThan(0)
        expect(suggestion.implementation?.rollbackPlan.length).toBeGreaterThan(0)
        expect(suggestion.implementation?.validationCriteria.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Analysis Structure', () => {
    it('should return complete analysis structure', async () => {
      mockContext.prospects = [{ id: '1', companyName: 'Test Company' }]

      const result = await agent.analyze(mockContext)

      expect(result).toHaveProperty('agentId')
      expect(result).toHaveProperty('agentRole')
      expect(result).toHaveProperty('findings')
      expect(result).toHaveProperty('improvements')
      expect(result).toHaveProperty('timestamp')
      expect(result.agentRole).toBe('data-analyzer')
    })

    it('should handle empty prospect list', async () => {
      mockContext.prospects = []

      const result = await agent.analyze(mockContext)

      expect(result).toBeDefined()
      expect(result.findings).toEqual([])
      expect(result.improvements).toEqual([])
    })
  })
})
