/**
 * Unit tests for AgenticEngine
 * Tests the core autonomous improvement engine and its capabilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AgenticEngine } from './AgenticEngine'
import { SystemContext, Improvement } from './types'
import type { AgenticApiClient, ExecutionResult } from '../api/agentic'

/**
 * Builds a mock AgenticApiClient. `executeImprovement` resolves to the given
 * ExecutionResult (defaulting to a real-action success), and `sendCallback`
 * is a no-op spy. Pass an Error-rejecting executeImprovement to simulate an
 * unreachable API.
 */
function makeApiClient(
  result: ExecutionResult = { executed: true, action: 're-enrichment', details: { jobId: 'job-1' } }
): AgenticApiClient {
  return {
    executeImprovement: vi.fn(async () => result),
    sendCallback: vi.fn(async () => {})
  }
}

/**
 * An API client that always rejects, modelling an unreachable / failing server.
 */
function makeUnreachableApiClient(): AgenticApiClient {
  return {
    executeImprovement: vi.fn(async () => {
      throw new Error('Network request failed')
    }),
    sendCallback: vi.fn(async () => {})
  }
}

describe('AgenticEngine', () => {
  let engine: AgenticEngine
  let mockContext: SystemContext

  beforeEach(() => {
    // Inject a succeeding API client by default so execution-path tests assert
    // real server-confirmed behaviour rather than a removed simulation.
    engine = new AgenticEngine(undefined, { apiClient: makeApiClient() })
    mockContext = {
      prospects: [
        {
          id: '1',
          companyName: 'Test Company',
          industry: 'Tech',
          healthScore: { overall: 75, lastUpdated: new Date().toISOString() }
        }
      ],
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
    it('should create engine with default configuration', () => {
      const config = engine.getConfig()

      expect(config.enabled).toBe(true)
      expect(config.autonomousExecutionEnabled).toBe(false) // Safety first
      expect(config.safetyThreshold).toBe(80)
      expect(config.maxDailyImprovements).toBe(3)
      expect(config.reviewRequired).toContain('security')
      expect(config.reviewRequired).toContain('data-quality')
    })

    it('should accept custom configuration', () => {
      const customEngine = new AgenticEngine({
        autonomousExecutionEnabled: true,
        safetyThreshold: 90,
        maxDailyImprovements: 5
      })

      const config = customEngine.getConfig()
      expect(config.autonomousExecutionEnabled).toBe(true)
      expect(config.safetyThreshold).toBe(90)
      expect(config.maxDailyImprovements).toBe(5)
    })
  })

  describe('Configuration Management', () => {
    it('should update configuration', () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 85
      })

      const config = engine.getConfig()
      expect(config.autonomousExecutionEnabled).toBe(true)
      expect(config.safetyThreshold).toBe(85)
    })

    it('should preserve unmodified config values', () => {
      const originalMax = engine.getConfig().maxDailyImprovements

      engine.updateConfig({
        safetyThreshold: 85
      })

      expect(engine.getConfig().maxDailyImprovements).toBe(originalMax)
    })
  })

  describe('Autonomous Cycle', () => {
    it('should run autonomous cycle and return results', async () => {
      const result = await engine.runAutonomousCycle(mockContext)

      expect(result).toBeDefined()
      expect(result.review).toBeDefined()
      expect(result.executedImprovements).toBeInstanceOf(Array)
      expect(result.pendingImprovements).toBeInstanceOf(Array)
    })

    it('should detect improvements from council review', async () => {
      const result = await engine.runAutonomousCycle(mockContext)

      const totalImprovements =
        result.executedImprovements.length + result.pendingImprovements.length
      expect(totalImprovements).toBeGreaterThan(0)
    })

    it('should not execute improvements when autonomous execution disabled', async () => {
      // Default is disabled
      const result = await engine.runAutonomousCycle(mockContext)

      expect(result.executedImprovements).toHaveLength(0)
      expect(result.pendingImprovements.length).toBeGreaterThan(0)
    })

    it('should create feedback loop after cycle', async () => {
      await engine.runAutonomousCycle(mockContext)

      const feedbackLoops = engine.getFeedbackLoops()
      expect(feedbackLoops.length).toBeGreaterThan(0)

      const agentReview = feedbackLoops.find((f) => f.type === 'agent-review')
      expect(agentReview).toBeDefined()
    })
  })

  describe('Improvement Management', () => {
    it('should store improvements after cycle', async () => {
      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      expect(improvements.length).toBeGreaterThan(0)
    })

    it('should filter improvements by status', async () => {
      await engine.runAutonomousCycle(mockContext)

      const detected = engine.getImprovementsByStatus('detected')
      expect(detected).toBeInstanceOf(Array)
    })

    it('should track improvement status correctly', async () => {
      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      improvements.forEach((improvement) => {
        expect(improvement.status).toBeDefined()
        expect([
          'detected',
          'analyzing',
          'approved',
          'implementing',
          'testing',
          'completed',
          'rejected'
        ]).toContain(improvement.status)
      })
    })
  })

  describe('Safety Mechanisms', () => {
    it('should respect safety threshold', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 95 // Very high threshold
      })

      const result = await engine.runAutonomousCycle(mockContext)

      // Most improvements won't meet 95 safety score
      expect(result.executedImprovements.length).toBeLessThanOrEqual(
        result.pendingImprovements.length
      )
    })

    it('should enforce daily improvement limit', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 50, // Low threshold to allow execution
        maxDailyImprovements: 1
      })

      // Run multiple cycles
      await engine.runAutonomousCycle(mockContext)
      await engine.runAutonomousCycle(mockContext)

      const history = engine.getExecutionHistory()
      const today = new Date().toDateString()
      const todayExecutions = history.filter((e) => new Date(e.timestamp).toDateString() === today)

      expect(todayExecutions.length).toBeLessThanOrEqual(1)
    })

    it('should require review for security category', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 50
      })

      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      const securityImprovements = improvements.filter((i) => i.suggestion.category === 'security')

      // Security improvements should be pending, not executed
      securityImprovements.forEach((imp) => {
        expect(imp.status).not.toBe('completed')
      })
    })

    it('should require review for data-quality category', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 50
      })

      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      const dataQualityImprovements = improvements.filter(
        (i) => i.suggestion.category === 'data-quality'
      )

      // Data quality improvements should be pending, not executed
      dataQualityImprovements.forEach((imp) => {
        expect(imp.status).not.toBe('completed')
      })
    })
  })

  describe('Manual Approval', () => {
    it('should allow manual approval and execution', async () => {
      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      if (improvements.length > 0) {
        const improvementId = improvements[0].id
        const result = await engine.approveAndExecute(improvementId, mockContext)

        expect(result).toBeDefined()
        expect(result.success).toBeDefined()

        const approved = engine.getImprovements().find((i) => i.id === improvementId)
        expect(approved?.approvedAt).toBeDefined()
      }
    })

    it('should throw error for non-existent improvement', async () => {
      await expect(engine.approveAndExecute('non-existent-id', mockContext)).rejects.toThrow()
    })

    it('forwards the suggestion prospectIds to the execute request', async () => {
      const apiClient = makeApiClient({
        executed: true,
        action: 're-enrichment',
        details: { jobId: 'job-7' }
      })
      const engineWithIds = new AgenticEngine(undefined, { apiClient })

      // Inject a prospect-specific improvement (as an agent would emit it) so
      // the engine has concrete ids to forward.
      const improvement: Improvement = {
        id: 'imp-with-ids',
        suggestion: {
          id: 'sug-with-ids',
          category: 'data-quality',
          priority: 'high',
          title: 'Re-enrich stale prospects',
          description: 'Refresh stale rows',
          reasoning: 'stale',
          estimatedImpact: 'higher completeness',
          automatable: true,
          safetyScore: 75,
          prospectIds: ['p1', 'p2']
        },
        status: 'detected',
        detectedAt: new Date().toISOString()
      }
      engineWithIds.setImprovements([improvement])

      await engineWithIds.approveAndExecute('imp-with-ids', mockContext)

      expect(apiClient.executeImprovement).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'imp-with-ids',
          category: 'data-quality',
          prospectIds: ['p1', 'p2']
        })
      )
    })

    it('omits prospectIds for a system-level suggestion that carries none', async () => {
      const apiClient = makeApiClient({
        executed: false,
        action: 'none',
        details: {},
        reason: 'category data-quality requires prospectIds but none were provided'
      })
      const engineNoIds = new AgenticEngine(undefined, { apiClient })

      const improvement: Improvement = {
        id: 'imp-no-ids',
        suggestion: {
          id: 'sug-no-ids',
          category: 'data-quality',
          priority: 'high',
          title: 'Implement automated data enrichment pipeline',
          description: 'System-level pipeline work',
          reasoning: 'architecture',
          estimatedImpact: 'platform-wide',
          automatable: true,
          safetyScore: 75
          // No prospectIds: genuinely system-level.
        },
        status: 'detected',
        detectedAt: new Date().toISOString()
      }
      engineNoIds.setImprovements([improvement])

      const result = await engineNoIds.approveAndExecute('imp-no-ids', mockContext)

      // The request carries no ids, and the server (mock) fails closed with the
      // named reason — the correct honest outcome for a system-level suggestion.
      expect(apiClient.executeImprovement).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'imp-no-ids', prospectIds: undefined })
      )
      expect(result.success).toBe(false)
      expect(result.feedback).toContain('requires prospectIds')
      const stored = engineNoIds.getImprovements().find((i) => i.id === 'imp-no-ids')
      expect(stored?.status).toBe('rejected')
    })

    it('should mark an improvement completed when the server confirms a real action', async () => {
      const apiClient = makeApiClient({
        executed: true,
        action: 'alert',
        details: { alertId: 'alert-99' }
      })
      const realEngine = new AgenticEngine(undefined, { apiClient })

      await realEngine.runAutonomousCycle(mockContext)
      const [improvement] = realEngine.getImprovements()
      const result = await realEngine.approveAndExecute(improvement.id, mockContext)

      expect(result.success).toBe(true)
      expect(apiClient.executeImprovement).toHaveBeenCalled()
      // No fabricated metrics — server returns observed effects only.
      expect(result.metrics).toEqual({ before: {}, after: {} })
      expect(result.feedback).toContain('alert')
      const stored = realEngine.getImprovements().find((i) => i.id === improvement.id)
      expect(stored?.status).toBe('completed')
    })
  })

  describe('Fail-closed execution', () => {
    it('keeps an improvement rejected (not completed) when the API is unreachable', async () => {
      const apiClient = makeUnreachableApiClient()
      const failEngine = new AgenticEngine(undefined, { apiClient })

      await failEngine.runAutonomousCycle(mockContext)
      const [improvement] = failEngine.getImprovements()
      const result = await failEngine.approveAndExecute(improvement.id, mockContext)

      expect(result.success).toBe(false)
      expect(result.changes).toHaveLength(0)
      expect(result.feedback).toContain('Execution failed')
      // No invented metrics on failure.
      expect(result.metrics).toEqual({ before: {}, after: {} })

      const stored = failEngine.getImprovements().find((i) => i.id === improvement.id)
      expect(stored?.status).toBe('rejected')
      expect(stored?.status).not.toBe('completed')
    })

    it('fails closed with the named reason when the server returns executed:false', async () => {
      const apiClient = makeApiClient({
        executed: false,
        action: 'none',
        details: {},
        reason: 'no server-side action for category usability'
      })
      const failEngine = new AgenticEngine(undefined, { apiClient })

      await failEngine.runAutonomousCycle(mockContext)
      const [improvement] = failEngine.getImprovements()
      const result = await failEngine.approveAndExecute(improvement.id, mockContext)

      expect(result.success).toBe(false)
      expect(result.feedback).toBe('no server-side action for category usability')

      const stored = failEngine.getImprovements().find((i) => i.id === improvement.id)
      expect(stored?.status).toBe('rejected')
    })
  })

  describe('System Health Metrics', () => {
    it('should calculate system health correctly', async () => {
      await engine.runAutonomousCycle(mockContext)

      const health = engine.getSystemHealth()

      expect(health).toHaveProperty('totalImprovements')
      expect(health).toHaveProperty('implemented')
      expect(health).toHaveProperty('pending')
      expect(health).toHaveProperty('successRate')
      expect(health).toHaveProperty('avgSafetyScore')

      expect(health.totalImprovements).toBeGreaterThanOrEqual(0)
      expect(health.successRate).toBeGreaterThanOrEqual(0)
      expect(health.successRate).toBeLessThanOrEqual(100)
    })

    it('should track success rate accurately', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 70
      })

      await engine.runAutonomousCycle(mockContext)

      const history = engine.getExecutionHistory()
      if (history.length > 0) {
        const health = engine.getSystemHealth()
        const successful = history.filter((h) => h.result.success).length
        const expectedRate = (successful / history.length) * 100

        expect(health.successRate).toBe(expectedRate)
      }
    })

    it('should calculate average safety score', async () => {
      await engine.runAutonomousCycle(mockContext)

      const improvements = engine.getImprovements()
      const health = engine.getSystemHealth()

      if (improvements.length > 0) {
        const sum = improvements.reduce((acc, i) => acc + i.suggestion.safetyScore, 0)
        const expectedAvg = sum / improvements.length

        expect(health.avgSafetyScore).toBe(expectedAvg)
      }
    })
  })

  describe('Feedback Loops', () => {
    it('should track feedback loops', async () => {
      const loop = engine.createFeedbackLoop('system-metrics', {
        metric: 'test',
        value: 100
      })

      expect(loop).toBeDefined()
      expect(loop.type).toBe('system-metrics')
      expect(loop.id).toBeTruthy()
      expect(loop.timestamp).toBeTruthy()
    })

    it('should retrieve all feedback loops', async () => {
      engine.createFeedbackLoop('user-feedback', { rating: 5 })
      engine.createFeedbackLoop('system-metrics', { load: 0.5 })

      const loops = engine.getFeedbackLoops()
      expect(loops.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Council Integration', () => {
    it('should have access to council', () => {
      const council = engine.getCouncil()
      expect(council).toBeDefined()
    })

    it('should use council for analysis', async () => {
      const result = await engine.runAutonomousCycle(mockContext)

      expect(result.review).toBeDefined()
      expect(result.review.improvements).toBeDefined()
      expect(result.review.analyses).toBeDefined()
    })
  })

  describe('Execution History', () => {
    it('should track execution history', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 70
      })

      await engine.runAutonomousCycle(mockContext)

      const history = engine.getExecutionHistory()
      expect(history).toBeInstanceOf(Array)
    })

    it('should include result details in history', async () => {
      engine.updateConfig({
        autonomousExecutionEnabled: true,
        safetyThreshold: 70
      })

      await engine.runAutonomousCycle(mockContext)

      const history = engine.getExecutionHistory()
      if (history.length > 0) {
        const entry = history[0]
        expect(entry).toHaveProperty('improvementId')
        expect(entry).toHaveProperty('timestamp')
        expect(entry).toHaveProperty('result')
        expect(entry.result).toHaveProperty('success')
        expect(entry.result).toHaveProperty('changes')
      }
    })
  })
})
