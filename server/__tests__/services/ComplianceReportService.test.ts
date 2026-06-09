import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ComplianceReportService } from '../../services/ComplianceReportService'
import { ValidationError, DatabaseError } from '../../errors'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock dependent services
vi.mock('../../services/AuditService', () => ({
  auditService: {
    getAuditSummary: vi.fn().mockResolvedValue([]),
    getHighVolumeAlerts: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('../../services/ConsentService', () => ({
  consentService: {
    hasConsent: vi.fn().mockResolvedValue({
      hasConsent: true,
      consentType: 'express_written',
      grantedAt: '2024-01-01T00:00:00Z'
    })
  }
}))

vi.mock('../../services/SuppressionService', () => ({
  suppressionService: {
    isOnDNCList: vi.fn().mockResolvedValue({ isSuppressed: false })
  }
}))

vi.mock('../../services/DisclosureService', () => ({
  disclosureService: {
    list: vi.fn().mockResolvedValue({ disclosures: [], total: 0, page: 1, limit: 20 })
  }
}))

import { database } from '../../database/connection'
import { auditService } from '../../services/AuditService'
import { disclosureService } from '../../services/DisclosureService'

const mockQuery = vi.mocked(database.query)
const mockAuditSummary = vi.mocked(auditService.getAuditSummary)
const mockHighVolumeAlerts = vi.mocked(auditService.getHighVolumeAlerts)
const mockDisclosureList = vi.mocked(disclosureService.list)

describe('ComplianceReportService', () => {
  let service: ComplianceReportService

  const validDateRange = {
    start: new Date('2024-01-01'),
    end: new Date('2024-06-30')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockReset()
    service = new ComplianceReportService()
  })

  describe('generateOutreachReport', () => {
    it('should generate outreach report with consent status', async () => {
      const mockCommunications = [
        {
          id: 'comm-1',
          org_id: 'org-1',
          contact_id: 'contact-1',
          channel: 'email',
          direction: 'outbound',
          to_address: 'test@example.com',
          status: 'delivered',
          sent_at: '2024-01-15T00:00:00Z',
          created_at: '2024-01-15T00:00:00Z'
        },
        {
          id: 'comm-2',
          org_id: 'org-1',
          contact_id: 'contact-2',
          channel: 'sms',
          direction: 'outbound',
          to_phone: '1234567890',
          status: 'sent',
          sent_at: '2024-02-01T00:00:00Z',
          created_at: '2024-02-01T00:00:00Z'
        }
      ]

      // Consent is now evaluated AS OF the send time via a direct SQL query
      // (one per communication), not consentService.hasConsent(now). Mock the
      // communications query, then one consent-lookup per comm: contact-1 has an
      // active grant at send time, contact-2 does not.
      mockQuery
        .mockResolvedValueOnce(mockCommunications) // communications in range
        .mockResolvedValueOnce([
          { consent_type: 'express_written', granted_at: '2024-01-01T00:00:00Z' }
        ]) // contact-1 consent as-of-send
        .mockResolvedValueOnce([]) // contact-2 no consent as-of-send

      const result = await service.generateOutreachReport('org-1', validDateRange)

      expect(result).toHaveLength(2)
      expect(result[0].hadConsent).toBe(true)
      expect(result[0].consentType).toBe('express_written')
      expect(result[1].hadConsent).toBe(false)
    })

    it('should throw ValidationError for invalid date range', async () => {
      const invalidDateRange = {
        start: new Date('2024-06-30'),
        end: new Date('2024-01-01')
      }

      await expect(service.generateOutreachReport('org-1', invalidDateRange)).rejects.toThrow(
        ValidationError
      )
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.generateOutreachReport('org-1', validDateRange)).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('generateDNCReport', () => {
    it('should generate DNC check report', async () => {
      const mockAuditLogs = [
        {
          created_at: '2024-01-15T00:00:00Z',
          after_state: { phone: '1234567890', isSuppressed: true, source: 'federal_dnc' },
          entity_id: 'comm-1'
        }
      ]

      mockQuery.mockResolvedValueOnce(mockAuditLogs)

      const result = await service.generateDNCReport('org-1', validDateRange)

      expect(result).toHaveLength(1)
      expect(result[0].wasOnList).toBe(true)
      expect(result[0].action).toBe('blocked')
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.generateDNCReport('org-1', validDateRange)).rejects.toThrow(
        DatabaseError
      )
    })
  })

  describe('generateDisclosureReport', () => {
    it('should generate disclosure report', async () => {
      const mockDisclosures = {
        disclosures: [
          {
            id: 'disc-1',
            dealId: 'deal-1',
            state: 'CA',
            regulationName: 'SB 1235',
            status: 'signed',
            createdAt: '2024-01-15T00:00:00Z',
            signedAt: '2024-01-16T00:00:00Z',
            signedBy: 'John Doe'
          }
        ],
        total: 1,
        page: 1,
        limit: 1000
      }

      mockDisclosureList.mockResolvedValueOnce(mockDisclosures)

      const result = await service.generateDisclosureReport('org-1', validDateRange)

      expect(result).toHaveLength(1)
      expect(result[0].state).toBe('CA')
      expect(result[0].signedBy).toBe('John Doe')
    })
  })

  describe('detectViolations', () => {
    it('should detect DNC violations', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { id: 'comm-1', to_phone: '1234567890', created_at: '2024-01-15T00:00:00Z' }
        ]) // DNC violations
        .mockResolvedValueOnce([]) // Consent violations
        .mockResolvedValueOnce([]) // Disclosure violations

      const result = await service.detectViolations('org-1', validDateRange)

      expect(result.some((v) => v.type === 'dnc_violation')).toBe(true)
    })

    it('should detect consent violations', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // DNC violations
        .mockResolvedValueOnce([
          {
            id: 'comm-1',
            contact_id: 'contact-1',
            channel: 'email',
            created_at: '2024-01-15T00:00:00Z'
          }
        ]) // Consent violations
        .mockResolvedValueOnce([]) // Disclosure violations

      const result = await service.detectViolations('org-1', validDateRange)

      expect(result.some((v) => v.type === 'consent_missing')).toBe(true)
    })

    it('should detect disclosure violations', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // DNC violations
        .mockResolvedValueOnce([]) // Consent violations
        .mockResolvedValueOnce([
          { id: 'deal-1', deal_number: 'D-001', state: 'CA', funded_at: '2024-01-15T00:00:00Z' }
        ]) // Disclosure violations

      const result = await service.detectViolations('org-1', validDateRange)

      expect(result.some((v) => v.type === 'disclosure_missing')).toBe(true)
    })

    it('should detect audit anomalies', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

      mockHighVolumeAlerts.mockResolvedValueOnce([
        { userId: 'user-1', hour: '2024-01-15T10:00:00Z', actionCount: 250, entityTypes: ['deal'] }
      ])

      const result = await service.detectViolations('org-1', validDateRange)

      expect(result.some((v) => v.type === 'audit_anomaly')).toBe(true)
    })

    it('should throw DatabaseError on failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Query failed'))

      await expect(service.detectViolations('org-1', validDateRange)).rejects.toThrow(DatabaseError)
    })
  })

  describe('generateFullReport', () => {
    it('should generate full compliance report', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // Communications
        .mockResolvedValueOnce([]) // Audit logs for DNC
        .mockResolvedValueOnce([]) // DNC violations
        .mockResolvedValueOnce([]) // Consent violations
        .mockResolvedValueOnce([]) // Disclosure violations

      mockDisclosureList.mockResolvedValueOnce({ disclosures: [], total: 0, page: 1, limit: 1000 })
      mockAuditSummary.mockResolvedValueOnce([])

      const result = await service.generateFullReport('org-1', validDateRange)

      expect(result.reportId).toBeDefined()
      expect(result.orgId).toBe('org-1')
      expect(result.summary).toBeDefined()
    })

    it('should generate violations-only report', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.generateFullReport('org-1', validDateRange, {
        includeViolationsOnly: true
      })

      expect(result.outreachReport).toBeUndefined()
      expect(result.dncReport).toBeUndefined()
    })

    it('should throw ValidationError for date range exceeding 1 year', async () => {
      const longDateRange = {
        start: new Date('2023-01-01'),
        end: new Date('2024-06-01')
      }

      await expect(service.generateFullReport('org-1', longDateRange)).rejects.toThrow(
        ValidationError
      )
    })
  })

  describe('exportToCsv', () => {
    it('should export outreach report to CSV', async () => {
      const report = {
        reportId: 'CR-123',
        orgId: 'org-1',
        generatedAt: '2024-01-01T00:00:00Z',
        dateRange: validDateRange,
        summary: {
          totalOutreach: 1,
          outreachWithConsent: 1,
          consentRate: 100,
          dncChecks: 0,
          dncBlockedCount: 0,
          disclosuresGenerated: 0,
          disclosuresSigned: 0,
          disclosureSignRate: 0,
          violationsFound: 0,
          criticalViolations: 0
        },
        outreachReport: [
          {
            communicationId: 'comm-1',
            channel: 'email',
            direction: 'outbound',
            recipient: 'test@example.com',
            status: 'sent',
            sentAt: '2024-01-15T00:00:00Z',
            hadConsent: true
          }
        ],
        violations: []
      }

      const csv = await service.exportToCsv(report, 'outreach')

      expect(Buffer.isBuffer(csv)).toBe(true)
      const content = csv.toString('utf-8')
      expect(content).toContain('Communication ID')
      expect(content).toContain('comm-1')
    })

    it('should export violations to CSV', async () => {
      const report = {
        reportId: 'CR-123',
        orgId: 'org-1',
        generatedAt: '2024-01-01T00:00:00Z',
        dateRange: validDateRange,
        summary: {
          totalOutreach: 0,
          outreachWithConsent: 0,
          consentRate: 0,
          dncChecks: 0,
          dncBlockedCount: 0,
          disclosuresGenerated: 0,
          disclosuresSigned: 0,
          disclosureSignRate: 0,
          violationsFound: 1,
          criticalViolations: 1
        },
        violations: [
          {
            type: 'dnc_violation',
            severity: 'critical',
            description: 'Test violation',
            entityType: 'communication',
            occurredAt: '2024-01-15T00:00:00Z',
            details: {}
          }
        ]
      }

      const csv = await service.exportToCsv(report, 'violations')

      expect(Buffer.isBuffer(csv)).toBe(true)
      const content = csv.toString('utf-8')
      expect(content).toContain('Type')
      expect(content).toContain('dnc_violation')
    })
  })

  describe('getComplianceScore', () => {
    it('should calculate compliance score with no violations', async () => {
      mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])

      const result = await service.getComplianceScore('org-1', validDateRange)

      expect(result.overallScore).toBe(100)
      expect(result.consentScore).toBe(100)
      expect(result.dncScore).toBe(100)
      expect(result.disclosureScore).toBe(100)
      expect(result.auditScore).toBe(100)
    })

    it('should deduct points for violations', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { id: 'comm-1', to_phone: '1234567890', created_at: '2024-01-15T00:00:00Z' }
        ]) // DNC violation
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      const result = await service.getComplianceScore('org-1', validDateRange)

      expect(result.dncScore).toBeLessThan(100)
      expect(result.overallScore).toBeLessThan(100)
    })
  })
})
