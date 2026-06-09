/**
 * Agentic Engine
 *
 * Core engine for autonomous decision-making and continuous improvement.
 * Manages feedback loops, autonomous execution, and system evolution.
 */

import { AgenticCouncil } from './AgenticCouncil'
import {
  SystemContext,
  Improvement,
  ImprovementStatus,
  FeedbackLoop,
  AgenticConfig,
  ImprovementResult,
  CouncilReview,
  AgentCallbackPayload
} from './types'
import { v4 as uuidv4 } from 'uuid'
import { AgentCallbackClient } from './AgentCallbackClient'
import { agenticApiClient, toExecuteRequest, type AgenticApiClient } from '../api/agentic'

export class AgenticEngine {
  private council: AgenticCouncil
  private config: AgenticConfig
  private feedbackLoops: FeedbackLoop[] = []
  private improvements: Map<string, Improvement> = new Map()
  private executionHistory: Array<{
    improvementId: string
    timestamp: string
    result: ImprovementResult
  }> = []
  private callbackClient?: AgentCallbackClient
  private readonly apiClient: AgenticApiClient

  constructor(
    config?: Partial<AgenticConfig>,
    options?: { callbackClient?: AgentCallbackClient; apiClient?: AgenticApiClient }
  ) {
    this.council = new AgenticCouncil()
    this.config = {
      enabled: true,
      autonomousExecutionEnabled: false, // Disabled by default for safety
      safetyThreshold: 80, // Only auto-execute if safety score >= 80
      maxDailyImprovements: 3,
      reviewRequired: [
        // Sensitive categories that must NEVER auto-execute and always require
        // manual review, regardless of safety score.
        'security',
        'data-quality',
        'threat-analysis',
        'strategic-recommendation',
        'competitor-intelligence',
        'opportunity-analysis',
        'competitor-analysis'
      ],
      enabledAgents: ['data-analyzer', 'optimizer', 'security', 'ux-enhancer', 'competitor-agent'],
      ...config
    }
    this.callbackClient = options?.callbackClient
    // The API client is the real execution seam. Defaults to the live HTTP
    // client; tests inject a mock. There is NO simulated fallback — execution
    // is only real (server-confirmed) or it fails closed.
    this.apiClient = options?.apiClient ?? agenticApiClient
  }

  /**
   * Main autonomous cycle: analyze, detect, and optionally execute improvements
   */
  async runAutonomousCycle(context: SystemContext): Promise<{
    review: CouncilReview
    executedImprovements: Improvement[]
    pendingImprovements: Improvement[]
  }> {
    console.log('🚀 Starting autonomous improvement cycle...')

    // Step 1: Conduct council review
    const review = await this.council.conductReview(context)

    // Step 2: Process improvements
    const executedImprovements: Improvement[] = []
    const pendingImprovements: Improvement[] = []

    for (const improvement of review.improvements) {
      this.improvements.set(improvement.id, improvement)

      // Check if can be executed autonomously
      if (await this.canExecuteAutonomously(improvement)) {
        const result = await this.executeImprovement(improvement, context)
        if (result.success) {
          executedImprovements.push(improvement)
        } else {
          pendingImprovements.push(improvement)
        }
      } else {
        pendingImprovements.push(improvement)
      }
    }

    // Step 3: Create feedback loop
    this.createFeedbackLoop('agent-review', {
      review,
      executed: executedImprovements.length,
      pending: pendingImprovements.length
    })

    console.log(`✨ Autonomous cycle complete:`)
    console.log(`   - Executed: ${executedImprovements.length} improvements`)
    console.log(`   - Pending: ${pendingImprovements.length} improvements`)

    await this.dispatchCallback({ review, executedImprovements, pendingImprovements })

    return { review, executedImprovements, pendingImprovements }
  }

  /**
   * Registers an agent callback client. Pass `null` to remove the current client.
   */
  setCallbackClient(client: AgentCallbackClient | null): void {
    this.callbackClient = client ?? undefined
  }

  /**
   * Checks if an improvement can be executed autonomously
   */
  private async canExecuteAutonomously(improvement: Improvement): Promise<boolean> {
    if (!this.config.enabled || !this.config.autonomousExecutionEnabled) {
      return false
    }

    // Check daily limit
    const today = new Date().toDateString()
    const todayExecutions = this.executionHistory.filter(
      (e) => new Date(e.timestamp).toDateString() === today
    )
    if (todayExecutions.length >= this.config.maxDailyImprovements) {
      console.log(`⏸️ Daily improvement limit reached (${this.config.maxDailyImprovements})`)
      return false
    }

    // Check if requires review
    if (this.config.reviewRequired.includes(improvement.suggestion.category)) {
      console.log(`⏸️ Improvement requires review: ${improvement.suggestion.title}`)
      return false
    }

    // Check safety score
    if (improvement.suggestion.safetyScore < this.config.safetyThreshold) {
      console.log(
        `⚠️ Safety score too low: ${improvement.suggestion.safetyScore} < ${this.config.safetyThreshold}`
      )
      return false
    }

    // Must be automatable
    if (!improvement.suggestion.automatable) {
      return false
    }

    return true
  }

  /**
   * Executes an improvement by dispatching it to the real server-side
   * ImprovementExecutor via the API client.
   *
   * There is no simulation and no fabricated metrics. The improvement is only
   * marked `completed` when the server confirms a real action ran
   * (`executed: true`). When the server reports `executed: false` (no
   * server-side action for the category, or missing inputs) OR the API is
   * unreachable, the improvement fails closed: status `rejected`, the named
   * reason captured as feedback, and empty metrics (no invented before/after).
   *
   * The `context` is intentionally unused now that execution is real — its
   * only previous consumer was the deleted simulation.
   */
  private async executeImprovement(
    improvement: Improvement,
    context: SystemContext
  ): Promise<ImprovementResult> {
    void context
    console.log(`🔧 Executing improvement: ${improvement.suggestion.title}`)

    improvement.status = 'implementing'

    let result: ImprovementResult

    try {
      const execution = await this.apiClient.executeImprovement(toExecuteRequest(improvement))

      if (execution.executed) {
        result = {
          success: true,
          changes: [`Executed ${execution.action} for ${improvement.suggestion.title}`],
          // No fabricated metrics: the server returns observed effects only.
          metrics: { before: {}, after: {} },
          feedback: `Server executed action '${execution.action}': ${JSON.stringify(
            execution.details
          )}`
        }
      } else {
        // Fail closed: the server explicitly declined to act. Surface the
        // named reason; never claim success.
        result = {
          success: false,
          changes: [],
          metrics: { before: {}, after: {} },
          feedback:
            execution.reason ?? `No server-side action executed for ${improvement.suggestion.title}`
        }
      }
    } catch (error) {
      // API unreachable / errored: fail closed with the named error. The
      // improvement is NOT marked complete and no metrics are invented.
      console.error(`❌ Execution failed:`, error)
      result = {
        success: false,
        changes: [],
        metrics: { before: {}, after: {} },
        feedback: `Execution failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    improvement.status = result.success ? 'completed' : 'rejected'
    improvement.completedAt = new Date().toISOString()
    improvement.result = result

    this.executionHistory.push({
      improvementId: improvement.id,
      timestamp: new Date().toISOString(),
      result
    })

    return result
  }

  /**
   * Creates a feedback loop entry
   */
  createFeedbackLoop(type: FeedbackLoop['type'], data: unknown): FeedbackLoop {
    const loop: FeedbackLoop = {
      id: uuidv4(),
      type,
      data,
      timestamp: new Date().toISOString(),
      processedBy: ['agentic-engine']
    }

    this.feedbackLoops.push(loop)
    return loop
  }

  /**
   * Gets all improvements
   */
  getImprovements(): Improvement[] {
    return Array.from(this.improvements.values())
  }

  /**
   * Rehydrates the engine's internal improvement map from a persisted list.
   *
   * After a page reload the React layer restores improvements from storage, but
   * the engine's in-memory Map starts empty — which previously caused
   * approveAndExecute() to throw "not found". Call this on init to keep the
   * engine consistent with persisted state. Existing entries with the same id
   * are overwritten with the persisted version.
   */
  setImprovements(improvements: Improvement[]): void {
    for (const improvement of improvements) {
      if (improvement && typeof improvement.id === 'string') {
        this.improvements.set(improvement.id, improvement)
      }
    }
  }

  /**
   * Gets improvements by status
   */
  getImprovementsByStatus(status: ImprovementStatus): Improvement[] {
    return this.getImprovements().filter((i) => i.status === status)
  }

  /**
   * Gets execution history
   */
  getExecutionHistory() {
    return this.executionHistory
  }

  /**
   * Gets feedback loops
   */
  getFeedbackLoops(): FeedbackLoop[] {
    return this.feedbackLoops
  }

  private async dispatchCallback(payload: AgentCallbackPayload): Promise<void> {
    if (!this.callbackClient) {
      return
    }

    try {
      await this.callbackClient.sendCycleResult(payload)
    } catch (error) {
      console.error('⚠️ Failed to send agent callback:', error)
    }
  }

  /**
   * Gets the council
   */
  getCouncil(): AgenticCouncil {
    return this.council
  }

  /**
   * Gets configuration
   */
  getConfig(): AgenticConfig {
    return { ...this.config }
  }

  /**
   * Updates configuration
   */
  updateConfig(updates: Partial<AgenticConfig>): void {
    this.config = { ...this.config, ...updates }
    console.log('⚙️ Agentic engine configuration updated')
  }

  /**
   * Manually approves and executes an improvement
   */
  async approveAndExecute(
    improvementId: string,
    context: SystemContext
  ): Promise<ImprovementResult> {
    const improvement = this.improvements.get(improvementId)
    if (!improvement) {
      throw new Error(`Improvement ${improvementId} not found`)
    }

    improvement.status = 'approved'
    improvement.approvedAt = new Date().toISOString()

    return await this.executeImprovement(improvement, context)
  }

  /**
   * Gets system health metrics
   */
  getSystemHealth(): {
    totalImprovements: number
    implemented: number
    pending: number
    successRate: number
    avgSafetyScore: number
  } {
    const improvements = this.getImprovements()
    const implemented = improvements.filter((i) => i.status === 'completed').length
    const pending = improvements.filter(
      (i) => i.status === 'detected' || i.status === 'approved'
    ).length

    const successful = this.executionHistory.filter((h) => h.result.success).length
    const successRate =
      this.executionHistory.length > 0 ? (successful / this.executionHistory.length) * 100 : 0

    const avgSafetyScore =
      improvements.length > 0
        ? improvements.reduce((sum, i) => sum + i.suggestion.safetyScore, 0) / improvements.length
        : 0

    return {
      totalImprovements: improvements.length,
      implemented,
      pending,
      successRate,
      avgSafetyScore
    }
  }
}
