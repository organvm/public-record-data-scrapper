/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for StateAgent
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { StateAgent, type StateConfig } from './StateAgent'
import type { SystemContext } from '../../types'

describe('StateAgent', () => {
  let mockStateConfig: StateConfig
  let agent: StateAgent
  let mockContext: SystemContext

  beforeEach(() => {
    mockStateConfig = {
      stateCode: 'NY',
      stateName: 'New York',
      portalUrl: 'https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame',
      requiresAuth: false,
      rateLimit: { requestsPerMinute: 30, requestsPerHour: 500, requestsPerDay: 5000 },
      dataFormat: 'html',
      updateFrequency: 'daily',
      businessHours: { timezone: 'America/New_York', start: '08:00', end: '17:00' }
    }

    agent = new StateAgent(mockStateConfig)

    mockContext = {
      prospects: [
        { id: '1', state: 'NY', priorityScore: 85, company: 'Tech Corp' },
        { id: '2', state: 'NY', priorityScore: 72, company: 'Finance LLC' },
        { id: '3', state: 'CA', priorityScore: 65, company: 'West Co' }
      ],
      competitors: [],
      portfolio: [],
      userActions: [],
      performanceMetrics: {
        avgResponseTime: 200,
        errorRate: 0.01,
        userSatisfactionScore: 4.5,
        dataFreshnessScore: 0.8
      },
      timestamp: new Date().toISOString()
    }
  })

  describe('initialization', () => {
    it('should create agent with correct ID format', () => {
      expect(agent['customId']).toBe('state-agent-ny')
    })

    it('should create agent with correct name', () => {
      expect(agent['name']).toBe('New York State Agent')
    })

    it('should set correct agent role', () => {
      expect(agent['role']).toBe('state-collector')
    })

    it('should have correct capabilities', () => {
      const capabilities = agent['capabilities']
      expect(capabilities).toContain('Collect UCC filings from New York')
      expect(capabilities).toContain('Parse HTML format data')
      expect(capabilities).toContain('Respect 30 req/min rate limit')
      expect(capabilities).toContain('Monitor daily updates')
    })

    it('should initialize with default metrics', () => {
      const metrics = agent.getMetrics()
      expect(metrics.totalFilings).toBe(0)
      expect(metrics.recentFilings).toBe(0)
      expect(metrics.activeFilings).toBe(0)
      expect(metrics.successRate).toBe(100)
      expect(metrics.errors).toBe(0)
    })
  })

  describe('analyze()', () => {
    it('should detect stale data when not updated for >24 hours', async () => {
      // Update metrics to have old timestamp
      const oldTimestamp = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
      agent.updateMetrics({ lastUpdate: oldTimestamp })

      const analysis = await agent.analyze(mockContext)

      expect(analysis.findings.length).toBeGreaterThan(0)
      const staleFinding = analysis.findings.find((f) => f.category === 'data-quality')
      expect(staleFinding).toBeDefined()
      expect(staleFinding?.description).toContain('New York data is')
    })

    it('should suggest data refresh when stale', async () => {
      const oldTimestamp = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
      agent.updateMetrics({ lastUpdate: oldTimestamp })

      const analysis = await agent.analyze(mockContext)

      const refreshSuggestion = analysis.improvements.find(
        (i) => i.category === 'data-quality' && i.title.includes('Refresh')
      )
      expect(refreshSuggestion).toBeDefined()
      expect(refreshSuggestion?.automatable).toBe(true)
      expect(refreshSuggestion?.safetyScore).toBe(95)
    })

    it('should detect low success rate issues', async () => {
      agent.updateMetrics({ successRate: 75, errors: 25 })

      const analysis = await agent.analyze(mockContext)

      const criticalFinding = analysis.findings.find(
        (f) => f.severity === 'critical' && f.category === 'performance'
      )
      expect(criticalFinding).toBeDefined()
      expect(criticalFinding?.description).toContain('75%')
    })

    it('should provide implementation plan for collection failures', async () => {
      agent.updateMetrics({ successRate: 85 })

      const analysis = await agent.analyze(mockContext)

      const fixSuggestion = analysis.improvements.find(
        (i) => i.priority === 'critical' && i.title.includes('Fix')
      )
      expect(fixSuggestion).toBeDefined()
      expect(fixSuggestion?.implementation).toBeDefined()
      expect(fixSuggestion?.implementation?.steps.length).toBeGreaterThan(0)
      expect(fixSuggestion?.implementation?.risks.length).toBeGreaterThan(0)
    })

    it('should analyze state-specific trends', async () => {
      const analysis = await agent.analyze(mockContext)

      const trendFinding = analysis.findings.find(
        (f) => f.severity === 'info' && f.description.includes('prospects')
      )
      expect(trendFinding).toBeDefined()
      expect((trendFinding?.evidence as Record<string, any>).count).toBe(2) // NY prospects in context
    })

    it('should suggest increased focus for high-value states', async () => {
      // Create context with many high-scoring NY prospects
      const highValueContext = {
        ...mockContext,
        prospects: Array.from({ length: 15 }, (_, i) => ({
          id: `${i}`,
          state: 'NY',
          priorityScore: 75 + i,
          company: `Company ${i}`
        }))
      }

      const analysis = await agent.analyze(highValueContext)

      const focusSuggestion = analysis.improvements.find(
        (i) => i.category === 'opportunity-analysis'
      )
      expect(focusSuggestion).toBeDefined()
      expect(focusSuggestion?.title).toContain('Increase collection frequency')
    })

    it('should include agent metadata in analysis', async () => {
      const analysis = await agent.analyze(mockContext)

      expect(analysis.agentId).toBe('state-agent-ny')
      expect(analysis.agentRole).toBe('state-collector')
      expect(analysis.timestamp).toBeDefined()
    })

    it('should not suggest improvements for fresh data with good metrics', async () => {
      // Recent update, high success rate
      agent.updateMetrics({
        lastUpdate: new Date().toISOString(),
        successRate: 98
      })

      const analysis = await agent.analyze(mockContext)

      const dataQualityImprovements = analysis.improvements.filter(
        (i) => i.category === 'data-quality'
      )
      expect(dataQualityImprovements.length).toBe(0)
    })
  })

  describe('collectFilings()', () => {
    it('should accept collection options', async () => {
      const options = {
        since: new Date('2024-01-01'),
        limit: 100,
        filingTypes: ['UCC-1', 'UCC-3']
      }

      const result = await agent.collectFilings(options)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should work without options', async () => {
      const result = await agent.collectFilings()
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('validateFiling()', () => {
    it('should validate filing IDs', async () => {
      const result = await agent.validateFiling('UCC-123456')
      expect(typeof result).toBe('boolean')
    })
  })

  describe('metrics management', () => {
    it('should return metrics copy', () => {
      const metrics1 = agent.getMetrics()
      const metrics2 = agent.getMetrics()
      expect(metrics1).not.toBe(metrics2) // Different objects
      expect(metrics1).toEqual(metrics2) // Same content
    })

    it('should update metrics partially', () => {
      agent.updateMetrics({ recentFilings: 50 })
      const metrics = agent.getMetrics()
      expect(metrics.recentFilings).toBe(50)
      expect(metrics.totalFilings).toBe(0) // Unchanged
    })

    it('should update metrics with multiple fields', () => {
      agent.updateMetrics({
        totalFilings: 1000,
        recentFilings: 100,
        successRate: 95
      })
      const metrics = agent.getMetrics()
      expect(metrics.totalFilings).toBe(1000)
      expect(metrics.recentFilings).toBe(100)
      expect(metrics.successRate).toBe(95)
    })
  })

  describe('config management', () => {
    it('should return config copy', () => {
      const config1 = agent.getConfig()
      const config2 = agent.getConfig()
      expect(config1).not.toBe(config2) // Different objects
      expect(config1).toEqual(config2) // Same content
    })

    it('should preserve all config fields', () => {
      const config = agent.getConfig()
      expect(config.stateCode).toBe('NY')
      expect(config.stateName).toBe('New York')
      expect(config.portalUrl).toBeDefined()
      expect(config.rateLimit).toBeDefined()
      expect(config.dataFormat).toBe('html')
    })
  })

  describe('different data formats', () => {
    it('should handle JSON format state', () => {
      const jsonConfig: StateConfig = {
        ...mockStateConfig,
        stateCode: 'CA',
        stateName: 'California',
        dataFormat: 'json'
      }
      const jsonAgent = new StateAgent(jsonConfig)
      const capabilities = jsonAgent['capabilities']
      expect(capabilities).toContain('Parse JSON format data')
    })

    it('should handle XML format state', () => {
      const xmlConfig: StateConfig = {
        ...mockStateConfig,
        stateCode: 'TX',
        stateName: 'Texas',
        dataFormat: 'xml'
      }
      const xmlAgent = new StateAgent(xmlConfig)
      const capabilities = xmlAgent['capabilities']
      expect(capabilities).toContain('Parse XML format data')
    })
  })

  describe('update frequency handling', () => {
    it('should handle realtime update frequency', () => {
      const realtimeConfig: StateConfig = {
        ...mockStateConfig,
        updateFrequency: 'realtime'
      }
      const realtimeAgent = new StateAgent(realtimeConfig)
      const capabilities = realtimeAgent['capabilities']
      expect(capabilities).toContain('Monitor realtime updates')
    })

    it('should handle hourly update frequency', () => {
      const hourlyConfig: StateConfig = {
        ...mockStateConfig,
        updateFrequency: 'hourly'
      }
      const hourlyAgent = new StateAgent(hourlyConfig)
      const capabilities = hourlyAgent['capabilities']
      expect(capabilities).toContain('Monitor hourly updates')
    })
  })
})
