/**
 * ComplianceReportService
 *
 * Generates compliance reports for audits. Aggregates data from various
 * compliance-related services to produce comprehensive audit reports.
 *
 * Report types:
 * - Outreach Report: All communications with consent status
 * - DNC Report: Do Not Call check results and violations
 * - Disclosure Report: Disclosure delivery confirmations
 * - Full Compliance Report: Combined comprehensive report
 */

import { database } from '../database/connection'
import { DatabaseError, ValidationError } from '../errors'
import { auditService } from './AuditService'
import { disclosureService } from './DisclosureService'

// Date range for reports
interface DateRange {
  start: Date
  end: Date
}

// Communication row from database
interface CommunicationRow {
  id: string
  org_id: string
  contact_id?: string
  channel: string
  direction: string
  to_phone?: string
  to_address?: string
  status: string
  sent_at?: string
  created_at: string
}

// Outreach report entry
interface OutreachEntry {
  communicationId: string
  contactId?: string
  channel: string
  direction: string
  recipient: string
  status: string
  sentAt: string
  hadConsent: boolean
  consentType?: string
  consentGrantedAt?: string
}

// DNC check record
interface DNCCheckRecord {
  phone: string
  checkTime: string
  wasOnList: boolean
  source?: string
  action: 'blocked' | 'allowed'
  communicationId?: string
}

// Disclosure delivery record
interface DisclosureDeliveryRecord {
  disclosureId: string
  dealId: string
  state: string
  regulationName: string
  status: string
  generatedAt: string
  sentAt?: string
  viewedAt?: string
  signedAt?: string
  signedBy?: string
}

// Compliance violation record
interface ComplianceViolation {
  type: 'dnc_violation' | 'consent_missing' | 'disclosure_missing' | 'audit_anomaly'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  entityType: string
  entityId?: string
  occurredAt: string
  details: Record<string, unknown>
}

// Full compliance report
interface ComplianceReport {
  reportId: string
  orgId: string
  generatedAt: string
  dateRange: DateRange
  summary: {
    totalOutreach: number
    outreachWithConsent: number
    consentRate: number
    dncChecks: number
    dncBlockedCount: number
    disclosuresGenerated: number
    disclosuresSigned: number
    disclosureSignRate: number
    violationsFound: number
    criticalViolations: number
  }
  outreachReport?: OutreachEntry[]
  dncReport?: DNCCheckRecord[]
  disclosureReport?: DisclosureDeliveryRecord[]
  violations: ComplianceViolation[]
  auditSummary?: {
    entityType: string
    totalChanges: number
    creates: number
    updates: number
    deletes: number
  }[]
}

export class ComplianceReportService {
  /**
   * Generate outreach report with consent status
   */
  async generateOutreachReport(orgId: string, dateRange: DateRange): Promise<OutreachEntry[]> {
    this.validateDateRange(dateRange)

    try {
      // Get all communications in date range
      const communications = await database.query<CommunicationRow>(
        `SELECT * FROM communications
        WHERE org_id = $1
          AND direction = 'outbound'
          AND created_at >= $2
          AND created_at <= $3
        ORDER BY created_at DESC`,
        [orgId, dateRange.start.toISOString(), dateRange.end.toISOString()]
      )

      const entries: OutreachEntry[] = []

      for (const comm of communications) {
        let hadConsent = false
        let consentType: string | undefined
        let consentGrantedAt: string | undefined

        // Check consent if we have a contact. Evaluate consent AS OF the time
        // the communication was sent (comm.created_at), not the report-run time
        // — using point-in-time-now consent (consentService.hasConsent) would
        // mislabel a send that was compliant when made but whose consent has
        // since expired/been revoked, and vice-versa. This mirrors the
        // as-of-send-time logic used in detectViolations().
        if (comm.contact_id) {
          const sentAtIso = comm.sent_at || comm.created_at
          const consentRows = await database.query<{
            consent_type: string
            granted_at: string
          }>(
            `SELECT cr.consent_type, cr.granted_at
            FROM consent_records cr
            WHERE cr.org_id = $1
              AND cr.contact_id = $2
              AND (cr.channel = $3 OR cr.channel = 'all')
              AND cr.is_granted = true
              AND cr.granted_at <= $4
              AND (cr.revoked_at IS NULL OR cr.revoked_at > $4)
              AND (cr.expires_at IS NULL OR cr.expires_at > $4)
            ORDER BY cr.granted_at DESC
            LIMIT 1`,
            [orgId, comm.contact_id, comm.channel, sentAtIso]
          )

          if (consentRows[0]) {
            hadConsent = true
            consentType = consentRows[0].consent_type
            consentGrantedAt = consentRows[0].granted_at
          }
        }

        entries.push({
          communicationId: comm.id,
          contactId: comm.contact_id,
          channel: comm.channel,
          direction: comm.direction,
          recipient: comm.to_phone || comm.to_address || 'Unknown',
          status: comm.status,
          sentAt: comm.sent_at || comm.created_at,
          hadConsent,
          consentType,
          consentGrantedAt
        })
      }

      return entries
    } catch (error) {
      throw new DatabaseError(
        'Failed to generate outreach report',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Generate DNC check report
   * Note: This queries audit logs for DNC check events
   */
  async generateDNCReport(orgId: string, dateRange: DateRange): Promise<DNCCheckRecord[]> {
    this.validateDateRange(dateRange)

    try {
      // Get DNC check events from audit logs
      const auditLogs = await database.query<{
        created_at: string
        after_state: Record<string, unknown>
        entity_id?: string
      }>(
        `SELECT created_at, after_state, entity_id FROM audit_logs
        WHERE org_id = $1
          AND entity_type = 'dnc_check'
          AND created_at >= $2
          AND created_at <= $3
        ORDER BY created_at DESC`,
        [orgId, dateRange.start.toISOString(), dateRange.end.toISOString()]
      )

      return auditLogs.map((log) => ({
        phone: (log.after_state?.phone as string) || 'Unknown',
        checkTime: log.created_at,
        wasOnList: (log.after_state?.isSuppressed as boolean) || false,
        source: log.after_state?.source as string,
        action: log.after_state?.isSuppressed ? 'blocked' : ('allowed' as const),
        communicationId: log.entity_id
      }))
    } catch (error) {
      throw new DatabaseError(
        'Failed to generate DNC report',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Generate disclosure delivery confirmation report
   */
  async generateDisclosureReport(
    orgId: string,
    dateRange: DateRange
  ): Promise<DisclosureDeliveryRecord[]> {
    this.validateDateRange(dateRange)

    const disclosures = await disclosureService.list(orgId, {
      startDate: dateRange.start,
      endDate: dateRange.end,
      limit: 1000
    })

    return disclosures.disclosures.map((d) => ({
      disclosureId: d.id,
      dealId: d.dealId,
      state: d.state,
      regulationName: d.regulationName,
      status: d.status,
      generatedAt: d.createdAt,
      sentAt: d.sentAt,
      viewedAt: d.viewedAt,
      signedAt: d.signedAt,
      signedBy: d.signedBy
    }))
  }

  /**
   * Detect compliance violations
   */
  async detectViolations(orgId: string, dateRange: DateRange): Promise<ComplianceViolation[]> {
    const violations: ComplianceViolation[] = []

    try {
      // Check for DNC violations (outbound to suppressed numbers)
      const dncViolations = await database.query<{
        id: string
        to_phone: string
        created_at: string
      }>(
        // Normalize BOTH sides of the phone join the same way the
        // SuppressionService does (strip non-digits, then drop a leading US
        // country-code '1' on 11-digit numbers). Comparing raw c.to_phone to
        // d.phone misses violations whenever the two were stored with different
        // formatting (e.g. '+1 (555) 123-4567' vs '5551234567').
        `SELECT c.id, c.to_phone, c.created_at
        FROM communications c
        JOIN dnc_list d ON
          regexp_replace(
            regexp_replace(c.to_phone, '\\D', '', 'g'),
            '^1(\\d{10})$', '\\1'
          ) = regexp_replace(
            regexp_replace(d.phone, '\\D', '', 'g'),
            '^1(\\d{10})$', '\\1'
          )
          AND c.org_id = d.org_id
        WHERE c.org_id = $1
          AND c.direction = 'outbound'
          AND c.channel IN ('call', 'sms')
          AND c.created_at >= $2
          AND c.created_at <= $3
          AND (d.expires_at IS NULL OR d.expires_at > c.created_at)`,
        [orgId, dateRange.start.toISOString(), dateRange.end.toISOString()]
      )

      for (const v of dncViolations) {
        violations.push({
          type: 'dnc_violation',
          severity: 'critical',
          description: `Outbound communication sent to DNC-listed phone: ${v.to_phone}`,
          entityType: 'communication',
          entityId: v.id,
          occurredAt: v.created_at,
          details: { phone: v.to_phone }
        })
      }

      // Check for missing consent on marketing communications
      const consentViolations = await database.query<{
        id: string
        contact_id: string
        channel: string
        created_at: string
      }>(
        `SELECT c.id, c.contact_id, c.channel, c.created_at
        FROM communications c
        LEFT JOIN consent_records cr ON
          c.contact_id = cr.contact_id
          AND c.org_id = cr.org_id
          AND (cr.channel = c.channel OR cr.channel = 'all')
          AND cr.is_granted = true
          AND cr.revoked_at IS NULL
          AND (cr.expires_at IS NULL OR cr.expires_at > c.created_at)
        WHERE c.org_id = $1
          AND c.direction = 'outbound'
          AND c.contact_id IS NOT NULL
          AND c.created_at >= $2
          AND c.created_at <= $3
          AND cr.id IS NULL`,
        [orgId, dateRange.start.toISOString(), dateRange.end.toISOString()]
      )

      for (const v of consentViolations) {
        violations.push({
          type: 'consent_missing',
          severity: 'high',
          description: `Communication sent without documented consent`,
          entityType: 'communication',
          entityId: v.id,
          occurredAt: v.created_at,
          details: { contactId: v.contact_id, channel: v.channel }
        })
      }

      // Check for deals funded without signed disclosure
      const disclosureViolations = await database.query<{
        id: string
        deal_number: string
        state: string
        funded_at: string
      }>(
        `SELECT d.id, d.deal_number, p.state, d.funded_at
        FROM deals d
        JOIN deal_stages ds ON d.stage_id = ds.id
        JOIN prospects p ON d.prospect_id = p.id
        JOIN disclosure_requirements dr ON p.state = dr.state
        LEFT JOIN disclosures disc ON d.id = disc.deal_id AND disc.status = 'signed'
        WHERE d.org_id = $1
          AND ds.slug = 'funded'
          AND d.funded_at >= $2
          AND d.funded_at <= $3
          AND dr.effective_date <= d.funded_at
          AND (dr.expiry_date IS NULL OR dr.expiry_date > d.funded_at)
          AND disc.id IS NULL`,
        [orgId, dateRange.start.toISOString(), dateRange.end.toISOString()]
      )

      for (const v of disclosureViolations) {
        violations.push({
          type: 'disclosure_missing',
          severity: 'critical',
          description: `Deal funded in ${v.state} without signed disclosure`,
          entityType: 'deal',
          entityId: v.id,
          occurredAt: v.funded_at,
          details: { dealNumber: v.deal_number, state: v.state }
        })
      }

      // Check for high-volume user activity (potential anomaly)
      const anomalyAlerts = await auditService.getHighVolumeAlerts(orgId, {
        thresholdPerHour: 200,
        hoursBack: Math.ceil(
          (dateRange.end.getTime() - dateRange.start.getTime()) / (1000 * 60 * 60)
        )
      })

      for (const alert of anomalyAlerts) {
        violations.push({
          type: 'audit_anomaly',
          severity: 'medium',
          description: `Unusually high activity detected: ${alert.actionCount} actions in one hour`,
          entityType: 'user',
          entityId: alert.userId,
          occurredAt: alert.hour,
          details: {
            actionCount: alert.actionCount,
            entityTypes: alert.entityTypes
          }
        })
      }

      return violations
    } catch (error) {
      throw new DatabaseError(
        'Failed to detect violations',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Generate full compliance report
   */
  async generateFullReport(
    orgId: string,
    dateRange: DateRange,
    options: {
      includeOutreach?: boolean
      includeDNC?: boolean
      includeDisclosure?: boolean
      includeViolationsOnly?: boolean
    } = {}
  ): Promise<ComplianceReport> {
    this.validateDateRange(dateRange)

    const {
      includeOutreach = true,
      includeDNC = true,
      includeDisclosure = true,
      includeViolationsOnly = false
    } = options

    // Generate report ID
    const reportId = `CR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Gather data in parallel
    const [outreachReport, dncReport, disclosureReport, violations, auditSummary] =
      await Promise.all([
        includeOutreach && !includeViolationsOnly
          ? this.generateOutreachReport(orgId, dateRange)
          : Promise.resolve(undefined),
        includeDNC && !includeViolationsOnly
          ? this.generateDNCReport(orgId, dateRange)
          : Promise.resolve(undefined),
        includeDisclosure && !includeViolationsOnly
          ? this.generateDisclosureReport(orgId, dateRange)
          : Promise.resolve(undefined),
        this.detectViolations(orgId, dateRange),
        !includeViolationsOnly
          ? auditService.getAuditSummary(orgId, dateRange)
          : Promise.resolve(undefined)
      ])

    // Calculate summary statistics
    const outreachCount = outreachReport?.length || 0
    const outreachWithConsent = outreachReport?.filter((e) => e.hadConsent).length || 0
    const dncBlockedCount = dncReport?.filter((r) => r.action === 'blocked').length || 0
    const disclosuresSigned = disclosureReport?.filter((d) => d.signedAt).length || 0

    return {
      reportId,
      orgId,
      generatedAt: new Date().toISOString(),
      dateRange,
      summary: {
        totalOutreach: outreachCount,
        outreachWithConsent,
        consentRate: outreachCount > 0 ? (outreachWithConsent / outreachCount) * 100 : 0,
        dncChecks: dncReport?.length || 0,
        dncBlockedCount,
        disclosuresGenerated: disclosureReport?.length || 0,
        disclosuresSigned,
        disclosureSignRate:
          disclosureReport && disclosureReport.length > 0
            ? (disclosuresSigned / disclosureReport.length) * 100
            : 0,
        violationsFound: violations.length,
        criticalViolations: violations.filter((v) => v.severity === 'critical').length
      },
      outreachReport,
      dncReport,
      disclosureReport,
      violations,
      auditSummary
    }
  }

  /**
   * Export compliance report as CSV
   */
  async exportToCsv(
    report: ComplianceReport,
    section: 'outreach' | 'dnc' | 'disclosure' | 'violations'
  ): Promise<Buffer> {
    let headers: string[]
    let rows: string[][]

    switch (section) {
      case 'outreach':
        headers = [
          'Communication ID',
          'Contact ID',
          'Channel',
          'Recipient',
          'Status',
          'Sent At',
          'Had Consent',
          'Consent Type',
          'Consent Granted At'
        ]
        rows = (report.outreachReport || []).map((e) => [
          e.communicationId,
          e.contactId || '',
          e.channel,
          e.recipient,
          e.status,
          e.sentAt,
          e.hadConsent ? 'Yes' : 'No',
          e.consentType || '',
          e.consentGrantedAt || ''
        ])
        break

      case 'dnc':
        headers = ['Phone', 'Check Time', 'Was On List', 'Source', 'Action', 'Communication ID']
        rows = (report.dncReport || []).map((r) => [
          r.phone,
          r.checkTime,
          r.wasOnList ? 'Yes' : 'No',
          r.source || '',
          r.action,
          r.communicationId || ''
        ])
        break

      case 'disclosure':
        headers = [
          'Disclosure ID',
          'Deal ID',
          'State',
          'Regulation',
          'Status',
          'Generated At',
          'Sent At',
          'Viewed At',
          'Signed At',
          'Signed By'
        ]
        rows = (report.disclosureReport || []).map((d) => [
          d.disclosureId,
          d.dealId,
          d.state,
          d.regulationName,
          d.status,
          d.generatedAt,
          d.sentAt || '',
          d.viewedAt || '',
          d.signedAt || '',
          d.signedBy || ''
        ])
        break

      case 'violations':
        headers = [
          'Type',
          'Severity',
          'Description',
          'Entity Type',
          'Entity ID',
          'Occurred At',
          'Details'
        ]
        rows = report.violations.map((v) => [
          v.type,
          v.severity,
          v.description,
          v.entityType,
          v.entityId || '',
          v.occurredAt,
          JSON.stringify(v.details)
        ])
        break
    }

    const escapeCsvValue = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map(escapeCsvValue).join(','))
    ].join('\n')

    return Buffer.from(csvContent, 'utf-8')
  }

  /**
   * Get compliance score for an organization
   */
  async getComplianceScore(
    orgId: string,
    dateRange: DateRange
  ): Promise<{
    overallScore: number
    consentScore: number
    dncScore: number
    disclosureScore: number
    auditScore: number
    details: string[]
  }> {
    const report = await this.generateFullReport(orgId, dateRange, {
      includeViolationsOnly: true
    })

    // Calculate component scores (100 = perfect, deductions for violations)
    let consentScore = 100
    let dncScore = 100
    let disclosureScore = 100
    let auditScore = 100
    const details: string[] = []

    for (const violation of report.violations) {
      const deduction =
        violation.severity === 'critical'
          ? 25
          : violation.severity === 'high'
            ? 15
            : violation.severity === 'medium'
              ? 10
              : 5

      switch (violation.type) {
        case 'consent_missing':
          consentScore = Math.max(0, consentScore - deduction)
          break
        case 'dnc_violation':
          dncScore = Math.max(0, dncScore - deduction)
          break
        case 'disclosure_missing':
          disclosureScore = Math.max(0, disclosureScore - deduction)
          break
        case 'audit_anomaly':
          auditScore = Math.max(0, auditScore - deduction)
          break
      }

      details.push(`${violation.severity.toUpperCase()}: ${violation.description}`)
    }

    // Calculate weighted overall score
    const overallScore =
      consentScore * 0.3 + dncScore * 0.25 + disclosureScore * 0.3 + auditScore * 0.15

    return {
      overallScore: Math.round(overallScore * 10) / 10,
      consentScore,
      dncScore,
      disclosureScore,
      auditScore,
      details
    }
  }

  /**
   * Validate date range
   */
  private validateDateRange(dateRange: DateRange): void {
    if (dateRange.start > dateRange.end) {
      throw new ValidationError('Start date must be before end date')
    }

    const maxRangeMs = 365 * 24 * 60 * 60 * 1000 // 1 year
    if (dateRange.end.getTime() - dateRange.start.getTime() > maxRangeMs) {
      throw new ValidationError('Date range cannot exceed 1 year')
    }
  }
}

// Export singleton instance
export const complianceReportService = new ComplianceReportService()
