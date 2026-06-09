/**
 * Security Agent
 *
 * Monitors security issues and suggests security improvements.
 */

import { BaseAgent } from '../BaseAgent'
import { AgentAnalysis, SystemContext, Finding, ImprovementSuggestion } from '../types'

export class SecurityAgent extends BaseAgent {
  constructor() {
    super('security', 'Security Guardian', [
      'Security vulnerability detection',
      'Data protection assessment',
      'Access control review',
      'Encryption verification',
      'Compliance checking'
    ])
  }

  async analyze(context: SystemContext): Promise<AgentAnalysis> {
    const findings: Finding[] = []
    const improvements: ImprovementSuggestion[] = []

    // Check for security concerns
    const securityChecks = this.performSecurityChecks(context)
    findings.push(...securityChecks)

    // Prospects holding financial data are the concrete subjects of these
    // security suggestions. Attaching their ids lets the server-side executor
    // raise a real alert against a specific prospect; with no such prospect the
    // suggestion is genuinely system-level and (correctly) fails closed.
    const financialDataProspectIds = this.collectFinancialDataProspectIds(context)

    // Suggest improvements based on findings
    if (findings.some((f) => f.severity === 'critical')) {
      improvements.push(this.suggestSecurityHardening(financialDataProspectIds))
    }

    improvements.push(this.suggestDataEncryption(financialDataProspectIds))

    return this.createAnalysis(findings, improvements)
  }

  /**
   * Ids of prospects that carry financial data (estimated revenue or a UCC
   * filing lien amount) — the rows that warrant an encryption / hardening
   * alert. Mirrors the predicate in checkSensitiveDataHandling.
   */
  private collectFinancialDataProspectIds(context: SystemContext): string[] {
    const prospects = context.prospects as Array<Record<string, unknown>>
    return prospects
      .filter((prospect) => {
        const hasEstimatedRevenue = typeof prospect.estimatedRevenue === 'number'
        const filings = Array.isArray(prospect.uccFilings) ? prospect.uccFilings : []
        const hasLienAmount = filings.some((filing) => {
          const record = filing as Record<string, unknown>
          return typeof record.lienAmount === 'number'
        })
        return hasEstimatedRevenue || hasLienAmount
      })
      .map((prospect) => prospect.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  private performSecurityChecks(context: SystemContext): Finding[] {
    const findings: Finding[] = []

    // Check for sensitive data exposure
    const sensitiveDataCheck = this.checkSensitiveDataHandling(context)
    if (sensitiveDataCheck) findings.push(sensitiveDataCheck)

    // Check access patterns
    const accessPatternCheck = this.analyzeAccessPatterns(context)
    if (accessPatternCheck) findings.push(accessPatternCheck)

    return findings
  }

  private checkSensitiveDataHandling(context: SystemContext): Finding | null {
    // Check if financial data is properly handled
    const prospects = context.prospects as Array<Record<string, unknown>>
    const prospectsWithFinancialData = prospects.filter((prospect) => {
      const hasEstimatedRevenue = typeof prospect.estimatedRevenue === 'number'
      const filings = Array.isArray(prospect.uccFilings) ? prospect.uccFilings : []
      const hasLienAmount = filings.some((filing) => {
        const record = filing as Record<string, unknown>
        return typeof record.lienAmount === 'number'
      })
      return hasEstimatedRevenue || hasLienAmount
    })

    if (prospectsWithFinancialData.length > 0) {
      return this.createFinding(
        'security',
        'warning',
        `${prospectsWithFinancialData.length} prospects contain financial data that should be encrypted`,
        { count: prospectsWithFinancialData.length, dataTypes: ['revenue', 'lienAmount'] }
      )
    }

    return null
  }

  private analyzeAccessPatterns(context: SystemContext): Finding | null {
    // Check for unusual access patterns
    const recentActions = context.userActions.filter((a) => {
      const actionTime = new Date(a.timestamp)
      const hoursSince = (Date.now() - actionTime.getTime()) / (1000 * 60 * 60)
      return hoursSince < 24
    })

    const exportActions = recentActions.filter((a) => a.type === 'export')

    if (exportActions.length > 50) {
      return this.createFinding(
        'security',
        'warning',
        `Unusual number of export operations detected in last 24h: ${exportActions.length}`,
        { exportCount: exportActions.length, threshold: 50, timeWindow: '24h' }
      )
    }

    return null
  }

  private suggestSecurityHardening(prospectIds: string[]): ImprovementSuggestion {
    const suggestion = this.createImprovement(
      'security',
      'critical',
      'Implement comprehensive security hardening',
      'Add rate limiting, audit logging, and access controls to protect sensitive data',
      'Multiple security concerns detected that require immediate attention',
      'Significantly reduce security risk, ensure compliance with data protection regulations',
      true,
      70,
      {
        steps: [
          'Implement rate limiting on sensitive operations',
          'Add audit logging for all data access',
          'Implement role-based access control (RBAC)',
          'Add data encryption for sensitive fields',
          'Set up security monitoring and alerts'
        ],
        risks: [
          'Potential user workflow disruption',
          'Increased system complexity',
          'Performance overhead from encryption'
        ],
        rollbackPlan: [
          'Disable rate limiting',
          'Remove audit logs',
          'Revert to simpler access model'
        ],
        validationCriteria: [
          'All sensitive operations rate-limited',
          'Audit log coverage >95%',
          'No unauthorized access incidents',
          'Performance impact <10%'
        ]
      }
    )

    return prospectIds.length > 0 ? { ...suggestion, prospectIds } : suggestion
  }

  private suggestDataEncryption(prospectIds: string[]): ImprovementSuggestion {
    const suggestion = this.createImprovement(
      'security',
      'high',
      'Enable encryption for sensitive data fields',
      'Encrypt financial and personal data at rest and in transit',
      'Financial and personal data should be encrypted to meet security best practices',
      'Protect sensitive data from unauthorized access, meet compliance requirements',
      true,
      80,
      {
        steps: [
          'Implement field-level encryption',
          'Set up key management system',
          'Encrypt existing sensitive data',
          'Add decryption layer for authorized access'
        ],
        risks: [
          'Key management complexity',
          'Performance overhead',
          'Potential data loss if keys are lost'
        ],
        rollbackPlan: [
          'Decrypt all data',
          'Store decryption keys securely',
          'Revert to unencrypted storage'
        ],
        validationCriteria: [
          'All sensitive fields encrypted',
          'Encryption key rotation working',
          'Performance impact <5%',
          'No data accessibility issues'
        ]
      }
    )

    return prospectIds.length > 0 ? { ...suggestion, prospectIds } : suggestion
  }
}
