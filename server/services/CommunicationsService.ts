/**
 * CommunicationsService
 *
 * Unified communications service for email, SMS, and calls.
 * Provides:
 * - Multi-channel communication (email, SMS, voice)
 * - Template rendering with variable substitution
 * - Delivery tracking and status updates
 * - Follow-up scheduling
 * - Communication history
 */

import { database } from '../database/connection'
import { ValidationError, DatabaseError, ExternalServiceError, ForbiddenError } from '../errors'
import type {
  Communication,
  CommunicationTemplate,
  CommunicationChannel,
  CommunicationDirection,
  CommunicationStatus
} from '@public-records/core'

// Import integration clients (stubbed)
import { TwilioClient } from '../integrations/twilio/client'
import { TwilioSMS } from '../integrations/twilio/sms'
import { TwilioVoice } from '../integrations/twilio/voice'
import { SendGridClient } from '../integrations/sendgrid/client'
import { SendGridSend } from '../integrations/sendgrid/send'

// Compliance dependencies — TCPA / DNC gating
import { SuppressionService } from './SuppressionService'
import { ConsentService } from './ConsentService'

// Database row types
interface CommunicationRow {
  id: string
  org_id: string
  contact_id?: string
  prospect_id?: string
  deal_id?: string
  template_id?: string
  sent_by?: string
  channel: string
  direction: string
  from_address?: string
  to_address?: string
  cc_addresses?: string[]
  bcc_addresses?: string[]
  subject?: string
  from_phone?: string
  to_phone?: string
  body?: string
  body_html?: string
  attachments: Array<{ name: string; url: string; size: number; mimeType: string }>
  status: string
  status_reason?: string
  call_duration_seconds?: number
  call_recording_url?: string
  external_id?: string
  opened_at?: string
  clicked_at?: string
  delivered_at?: string
  failed_at?: string
  failure_reason?: string
  received_at?: string
  scheduled_for?: string
  sent_at?: string
  metadata: Record<string, unknown>
  created_at: string
}

interface CommunicationTemplateRow {
  id: string
  org_id: string
  name: string
  description?: string
  channel: string
  category?: string
  subject?: string
  body: string
  variables: string[]
  is_active: boolean
  created_by?: string
  created_at: string
  updated_at: string
}

interface ScheduledFollowUpRow {
  id: string
  org_id: string
  contact_id: string
  deal_id?: string
  channel: string
  template_id?: string
  scheduled_for: string
  sent: boolean
  sent_at?: string
  created_by?: string
  created_at: string
}

// Input types
interface SendEmailInput {
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  templateId?: string
  sentBy?: string
  toAddress: string
  ccAddresses?: string[]
  bccAddresses?: string[]
  subject: string
  body: string
  bodyHtml?: string
  attachments?: Array<{ name: string; url: string; size: number; mimeType: string }>
  scheduledFor?: string
  metadata?: Record<string, unknown>
}

interface SendSMSInput {
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  templateId?: string
  sentBy?: string
  toPhone: string
  body: string
  scheduledFor?: string
  metadata?: Record<string, unknown>
}

interface InitiateCallInput {
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  sentBy?: string
  toPhone: string
  callScript?: string
  metadata?: Record<string, unknown>
}

interface ScheduleFollowUpInput {
  orgId: string
  contactId: string
  dealId?: string
  channel: CommunicationChannel
  templateId?: string
  scheduledFor: string
  createdBy?: string
}

interface GetHistoryParams {
  orgId: string
  contactId?: string
  prospectId?: string
  dealId?: string
  channel?: CommunicationChannel
  direction?: CommunicationDirection
  status?: CommunicationStatus
  limit?: number
  offset?: number
}

interface TemplateVariables {
  [key: string]: string | number | boolean | undefined
}

export class CommunicationsService {
  private twilioClient: TwilioClient
  private twilioSMS: TwilioSMS
  private twilioVoice: TwilioVoice
  private sendgridClient: SendGridClient
  private sendgridSend: SendGridSend
  private suppressionService: SuppressionService
  private consentService: ConsentService

  constructor(deps?: { suppressionService?: SuppressionService; consentService?: ConsentService }) {
    this.twilioClient = new TwilioClient()
    this.twilioSMS = new TwilioSMS(this.twilioClient)
    this.twilioVoice = new TwilioVoice(this.twilioClient)
    this.sendgridClient = new SendGridClient()
    this.sendgridSend = new SendGridSend(this.sendgridClient)
    // Compliance dependencies are injectable to keep the service test-friendly.
    this.suppressionService = deps?.suppressionService ?? new SuppressionService()
    this.consentService = deps?.consentService ?? new ConsentService()
  }

  /**
   * Enforce TCPA / DNC compliance before dispatching an outbound communication.
   *
   * Blocks the send when:
   * - the destination (phone or email) is on the DNC / suppression list, OR
   * - a contact is known and lacks active consent for the channel.
   *
   * Consent is only enforced when a contactId is present, since anonymous
   * one-off sends (e.g. transactional notices to a prospect address) have no
   * consent record to evaluate. DNC suppression is always enforced.
   *
   * Throws ForbiddenError (403) when blocked, and records a `blocked`
   * communication row so the suppression is auditable.
   */
  private async assertSendAllowed(params: {
    orgId: string
    channel: CommunicationChannel
    toPhone?: string
    toAddress?: string
    contactId?: string
  }): Promise<void> {
    const { orgId, channel, toPhone, toAddress, contactId } = params

    // 1. DNC / suppression check on the destination identifier
    if (channel === 'email' && toAddress) {
      const suppressed = await this.suppressionService.isEmailSuppressed(orgId, toAddress)
      if (suppressed.isSuppressed) {
        await this.recordBlockedCommunication({
          orgId,
          channel,
          toAddress,
          contactId,
          reason: `Email is on suppression list (${suppressed.source || 'internal'})`
        })
        throw new ForbiddenError('Recipient email is on the suppression (DNC) list')
      }
    } else if ((channel === 'sms' || channel === 'call') && toPhone) {
      const dncChannel = channel === 'call' ? 'call' : 'sms'
      const suppressed = await this.suppressionService.isOnDNCList(orgId, toPhone, dncChannel)
      if (suppressed.isSuppressed) {
        await this.recordBlockedCommunication({
          orgId,
          channel,
          toPhone,
          contactId,
          reason: `Number is on DNC list (${suppressed.source || 'internal'})`
        })
        throw new ForbiddenError('Recipient is on the Do-Not-Call (DNC) suppression list')
      }
    }

    // 2. Consent check (only when we know which contact we are reaching)
    if (contactId) {
      const consent = await this.consentService.hasConsent(orgId, contactId, channel)
      if (!consent.hasConsent) {
        await this.recordBlockedCommunication({
          orgId,
          channel,
          toPhone,
          toAddress,
          contactId,
          reason: `No active ${channel} consent on file for contact`
        })
        throw new ForbiddenError(`No active consent on file for ${channel} to this contact`)
      }
    }
  }

  /**
   * Record a blocked outbound communication for audit/compliance purposes.
   * Failures to persist the audit row are logged but do not mask the original
   * compliance block.
   */
  private async recordBlockedCommunication(params: {
    orgId: string
    channel: CommunicationChannel
    toPhone?: string
    toAddress?: string
    contactId?: string
    reason: string
  }): Promise<void> {
    try {
      // 'blocked' is not an allowed status in the communications CHECK
      // constraint; record as 'failed' with a compliance-block reason so the
      // suppression is auditable without violating the schema.
      await database.query(
        `INSERT INTO communications (
          org_id, contact_id, channel, direction, to_address, to_phone,
          status, status_reason, failure_reason, failed_at
        ) VALUES ($1, $2, $3, 'outbound', $4, $5, 'failed', $6, $6, CURRENT_TIMESTAMP)`,
        [
          params.orgId,
          params.contactId ?? null,
          params.channel,
          params.toAddress ?? null,
          params.toPhone ?? null,
          `COMPLIANCE_BLOCK: ${params.reason}`
        ]
      )
    } catch (error) {
      // Do not let an audit-write failure swallow the compliance block.
      console.warn(
        '[CommunicationsService] Failed to record blocked communication audit row:',
        error instanceof Error ? error.message : error
      )
    }
  }

  /**
   * Transform database row to Communication type
   */
  private transformCommunication(row: CommunicationRow): Communication {
    return {
      id: row.id,
      orgId: row.org_id,
      contactId: row.contact_id,
      prospectId: row.prospect_id,
      dealId: row.deal_id,
      templateId: row.template_id,
      sentBy: row.sent_by,
      channel: row.channel as CommunicationChannel,
      direction: row.direction as CommunicationDirection,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      ccAddresses: row.cc_addresses,
      bccAddresses: row.bcc_addresses,
      subject: row.subject,
      fromPhone: row.from_phone,
      toPhone: row.to_phone,
      body: row.body,
      bodyHtml: row.body_html,
      attachments: row.attachments || [],
      status: row.status as CommunicationStatus,
      statusReason: row.status_reason,
      callDurationSeconds: row.call_duration_seconds,
      callRecordingUrl: row.call_recording_url,
      externalId: row.external_id,
      openedAt: row.opened_at,
      clickedAt: row.clicked_at,
      deliveredAt: row.delivered_at,
      failedAt: row.failed_at,
      failureReason: row.failure_reason,
      receivedAt: row.received_at,
      scheduledFor: row.scheduled_for,
      sentAt: row.sent_at,
      metadata: row.metadata || {},
      createdAt: row.created_at
    }
  }

  /**
   * Transform database row to CommunicationTemplate type
   */
  private transformTemplate(row: CommunicationTemplateRow): CommunicationTemplate {
    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      description: row.description,
      channel: row.channel as CommunicationTemplate['channel'],
      category: row.category as CommunicationTemplate['category'],
      subject: row.subject,
      body: row.body,
      variables: row.variables || [],
      isActive: row.is_active,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  // ============================================
  // Template Management
  // ============================================

  /**
   * Get a template by ID
   */
  async getTemplate(id: string, orgId: string): Promise<CommunicationTemplate | null> {
    try {
      const results = await database.query<CommunicationTemplateRow>(
        'SELECT * FROM communication_templates WHERE id = $1 AND org_id = $2 AND is_active = true',
        [id, orgId]
      )
      return results[0] ? this.transformTemplate(results[0]) : null
    } catch (error) {
      throw new DatabaseError('Failed to get template', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Render a template with variable substitution
   */
  renderTemplate(
    template: CommunicationTemplate,
    variables: TemplateVariables
  ): {
    subject?: string
    body: string
    bodyHtml?: string
  } {
    const renderString = (str: string): string => {
      return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        const value = variables[key]
        return value !== undefined ? String(value) : match
      })
    }

    return {
      subject: template.subject ? renderString(template.subject) : undefined,
      body: renderString(template.body),
      bodyHtml: undefined // Could render HTML version if needed
    }
  }

  /**
   * List templates for an organization
   */
  async listTemplates(
    orgId: string,
    channel?: CommunicationChannel
  ): Promise<CommunicationTemplate[]> {
    try {
      let query = 'SELECT * FROM communication_templates WHERE org_id = $1 AND is_active = true'
      const values: unknown[] = [orgId]

      if (channel) {
        query += ' AND channel = $2'
        values.push(channel)
      }

      query += ' ORDER BY name'

      const results = await database.query<CommunicationTemplateRow>(query, values)
      return results.map(this.transformTemplate)
    } catch (error) {
      throw new DatabaseError(
        'Failed to list templates',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Send Communications
  // ============================================

  /**
   * Unified send method for all channels
   */
  async send(
    channel: CommunicationChannel,
    input: SendEmailInput | SendSMSInput | InitiateCallInput
  ): Promise<Communication> {
    switch (channel) {
      case 'email':
        return this.sendEmail(input as SendEmailInput)
      case 'sms':
        return this.sendSMS(input as SendSMSInput)
      case 'call':
        return this.initiateCall(input as InitiateCallInput)
      default:
        throw new ValidationError(`Unsupported channel: ${channel}`)
    }
  }

  /**
   * Send an email
   */
  async sendEmail(input: SendEmailInput): Promise<Communication> {
    // Validate email address
    if (!input.toAddress || !input.toAddress.includes('@')) {
      throw new ValidationError('Invalid email address')
    }

    // TCPA / suppression compliance gate — blocks send if suppressed or no consent
    await this.assertSendAllowed({
      orgId: input.orgId,
      channel: 'email',
      toAddress: input.toAddress,
      contactId: input.contactId
    })

    try {
      // Create communication record with pending status
      const communicationResults = await database.query<CommunicationRow>(
        `INSERT INTO communications (
          org_id, contact_id, prospect_id, deal_id, template_id, sent_by,
          channel, direction, to_address, cc_addresses, bcc_addresses,
          subject, body, body_html, attachments, status, scheduled_for, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *`,
        [
          input.orgId,
          input.contactId,
          input.prospectId,
          input.dealId,
          input.templateId,
          input.sentBy,
          'email',
          'outbound',
          input.toAddress,
          input.ccAddresses || [],
          input.bccAddresses || [],
          input.subject,
          input.body,
          input.bodyHtml,
          input.attachments || [],
          input.scheduledFor ? 'pending' : 'queued',
          input.scheduledFor,
          input.metadata || {}
        ]
      )

      const communication = this.transformCommunication(communicationResults[0])

      // If not scheduled, send immediately via SendGrid
      if (!input.scheduledFor) {
        try {
          const result = await this.sendgridSend.sendTransactional({
            to: input.toAddress,
            cc: input.ccAddresses,
            bcc: input.bccAddresses,
            subject: input.subject,
            text: input.body,
            html: input.bodyHtml,
            attachments: input.attachments
          })

          // SendGridSend.sendTransactional does NOT throw on a provider error —
          // it resolves to { status: 'failed', errors: [...] }. Recording 'sent'
          // for that case would fabricate a delivered message (the campaign's
          // cardinal sin). Fail closed: mark the row failed with the named
          // provider reason and surface a 502 via ExternalServiceError.
          if (result.status === 'failed') {
            const providerReason = result.errors?.join('; ') || 'SendGrid rejected the message'
            await this.updateCommunicationStatus(
              communication.id,
              'failed',
              undefined,
              providerReason
            )
            throw new ExternalServiceError('SendGrid', `Failed to send email: ${providerReason}`)
          }

          // Update communication with sent status
          await this.updateCommunicationStatus(communication.id, 'sent', result.messageId)

          return { ...communication, status: 'sent', externalId: result.messageId }
        } catch (sendError) {
          // A provider-returned failure (handled above) already recorded the
          // failed row — re-throw as-is rather than double-writing the status.
          if (sendError instanceof ExternalServiceError) throw sendError

          // A thrown error (network/validation inside the adapter): record the
          // failed status, then surface it as a 502.
          await this.updateCommunicationStatus(
            communication.id,
            'failed',
            undefined,
            sendError instanceof Error ? sendError.message : 'Unknown error'
          )

          throw new ExternalServiceError('SendGrid', 'Failed to send email')
        }
      }

      return communication
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) throw error
      throw new DatabaseError('Failed to send email', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Send an SMS
   */
  async sendSMS(input: SendSMSInput): Promise<Communication> {
    // Validate phone number (basic validation)
    const normalizedPhone = input.toPhone.replace(/\D/g, '')
    if (normalizedPhone.length < 10) {
      throw new ValidationError('Invalid phone number')
    }

    // TCPA / DNC compliance gate — blocks send if suppressed or no consent
    await this.assertSendAllowed({
      orgId: input.orgId,
      channel: 'sms',
      toPhone: normalizedPhone,
      contactId: input.contactId
    })

    try {
      // Create communication record
      const communicationResults = await database.query<CommunicationRow>(
        `INSERT INTO communications (
          org_id, contact_id, prospect_id, deal_id, template_id, sent_by,
          channel, direction, to_phone, body, status, scheduled_for, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`,
        [
          input.orgId,
          input.contactId,
          input.prospectId,
          input.dealId,
          input.templateId,
          input.sentBy,
          'sms',
          'outbound',
          normalizedPhone,
          input.body,
          input.scheduledFor ? 'pending' : 'queued',
          input.scheduledFor,
          input.metadata || {}
        ]
      )

      const communication = this.transformCommunication(communicationResults[0])

      // If not scheduled, send immediately via Twilio
      if (!input.scheduledFor) {
        try {
          const result = await this.twilioSMS.send({
            to: normalizedPhone,
            body: input.body
          })

          // Update communication with sent status
          await this.updateCommunicationStatus(communication.id, 'sent', result.messageSid)

          return { ...communication, status: 'sent', externalId: result.messageSid }
        } catch (sendError) {
          // Update communication with failed status
          await this.updateCommunicationStatus(
            communication.id,
            'failed',
            undefined,
            sendError instanceof Error ? sendError.message : 'Unknown error'
          )

          throw new ExternalServiceError('Twilio', 'Failed to send SMS')
        }
      }

      return communication
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) throw error
      throw new DatabaseError('Failed to send SMS', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Initiate a phone call
   */
  async initiateCall(input: InitiateCallInput): Promise<Communication> {
    // Validate phone number
    const normalizedPhone = input.toPhone.replace(/\D/g, '')
    if (normalizedPhone.length < 10) {
      throw new ValidationError('Invalid phone number')
    }

    // TCPA / DNC compliance gate — blocks call if suppressed or no consent
    await this.assertSendAllowed({
      orgId: input.orgId,
      channel: 'call',
      toPhone: normalizedPhone,
      contactId: input.contactId
    })

    try {
      // Create communication record
      const communicationResults = await database.query<CommunicationRow>(
        `INSERT INTO communications (
          org_id, contact_id, prospect_id, deal_id, sent_by,
          channel, direction, to_phone, body, status, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
          input.orgId,
          input.contactId,
          input.prospectId,
          input.dealId,
          input.sentBy,
          'call',
          'outbound',
          normalizedPhone,
          input.callScript,
          'pending',
          input.metadata || {}
        ]
      )

      const communication = this.transformCommunication(communicationResults[0])

      // Initiate call via Twilio
      try {
        const result = await this.twilioVoice.initiateCall({
          to: normalizedPhone,
          callScript: input.callScript
        })

        // Update communication with external ID
        await this.updateCommunicationStatus(communication.id, 'pending', result.callSid)

        return { ...communication, externalId: result.callSid }
      } catch (callError) {
        // Update communication with failed status
        await this.updateCommunicationStatus(
          communication.id,
          'failed',
          undefined,
          callError instanceof Error ? callError.message : 'Unknown error'
        )

        throw new ExternalServiceError('Twilio', 'Failed to initiate call')
      }
    } catch (error) {
      if (error instanceof ExternalServiceError || error instanceof ValidationError) throw error
      throw new DatabaseError('Failed to initiate call', error instanceof Error ? error : undefined)
    }
  }

  /**
   * Update communication status
   */
  async updateCommunicationStatus(
    id: string,
    status: CommunicationStatus,
    externalId?: string,
    failureReason?: string
  ): Promise<void> {
    try {
      const updates: string[] = ['status = $2']
      const values: unknown[] = [id, status]
      let paramCount = 3

      if (externalId) {
        updates.push(`external_id = $${paramCount++}`)
        values.push(externalId)
      }

      if (status === 'sent') {
        updates.push(`sent_at = CURRENT_TIMESTAMP`)
      } else if (status === 'delivered') {
        updates.push(`delivered_at = CURRENT_TIMESTAMP`)
      } else if (status === 'opened') {
        updates.push(`opened_at = CURRENT_TIMESTAMP`)
      } else if (status === 'clicked') {
        updates.push(`clicked_at = CURRENT_TIMESTAMP`)
      } else if (status === 'failed') {
        updates.push(`failed_at = CURRENT_TIMESTAMP`)
        if (failureReason) {
          updates.push(`failure_reason = $${paramCount++}`)
          values.push(failureReason)
        }
      }

      await database.query(`UPDATE communications SET ${updates.join(', ')} WHERE id = $1`, values)
    } catch (error) {
      throw new DatabaseError(
        'Failed to update communication status',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Communication History
  // ============================================

  /**
   * Get communication history with filters
   */
  async getHistory(params: GetHistoryParams): Promise<{
    communications: Communication[]
    total: number
  }> {
    const {
      orgId,
      contactId,
      prospectId,
      dealId,
      channel,
      direction,
      status,
      limit = 50,
      offset = 0
    } = params

    const conditions: string[] = ['org_id = $1']
    const values: unknown[] = [orgId]
    let paramCount = 2

    if (contactId) {
      conditions.push(`contact_id = $${paramCount++}`)
      values.push(contactId)
    }

    if (prospectId) {
      conditions.push(`prospect_id = $${paramCount++}`)
      values.push(prospectId)
    }

    if (dealId) {
      conditions.push(`deal_id = $${paramCount++}`)
      values.push(dealId)
    }

    if (channel) {
      conditions.push(`channel = $${paramCount++}`)
      values.push(channel)
    }

    if (direction) {
      conditions.push(`direction = $${paramCount++}`)
      values.push(direction)
    }

    if (status) {
      conditions.push(`status = $${paramCount++}`)
      values.push(status)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    try {
      const communications = await database.query<CommunicationRow>(
        `SELECT * FROM communications
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
        [...values, limit, offset]
      )

      const countResult = await database.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM communications ${whereClause}`,
        values
      )
      const total = parseInt(countResult[0]?.count || '0')

      return {
        communications: communications.map(this.transformCommunication),
        total
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to get communication history',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get a single communication by ID
   */
  async getById(id: string, orgId: string): Promise<Communication | null> {
    try {
      const results = await database.query<CommunicationRow>(
        'SELECT * FROM communications WHERE id = $1 AND org_id = $2',
        [id, orgId]
      )
      return results[0] ? this.transformCommunication(results[0]) : null
    } catch (error) {
      throw new DatabaseError(
        'Failed to get communication',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Follow-up Scheduling
  // ============================================

  /**
   * Schedule a follow-up communication
   */
  async scheduleFollowUp(input: ScheduleFollowUpInput): Promise<{
    id: string
    scheduledFor: string
    channel: CommunicationChannel
  }> {
    try {
      const results = await database.query<ScheduledFollowUpRow>(
        `INSERT INTO scheduled_followups (
          org_id, contact_id, deal_id, channel, template_id, scheduled_for, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *`,
        [
          input.orgId,
          input.contactId,
          input.dealId,
          input.channel,
          input.templateId,
          input.scheduledFor,
          input.createdBy
        ]
      )

      const row = results[0]
      return {
        id: row.id,
        scheduledFor: row.scheduled_for,
        channel: row.channel as CommunicationChannel
      }
    } catch (error) {
      throw new DatabaseError(
        'Failed to schedule follow-up',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Get pending follow-ups for a contact within a tenant.
   *
   * The query is org-scoped (AND org_id = $2) so a contactId cannot leak
   * follow-ups belonging to another tenant — the RLS policy is defense in
   * depth, not the only guard.
   */
  async getPendingFollowUps(
    contactId: string,
    orgId: string
  ): Promise<
    Array<{
      id: string
      scheduledFor: string
      channel: CommunicationChannel
      templateId?: string
    }>
  > {
    try {
      const results = await database.query<ScheduledFollowUpRow>(
        `SELECT * FROM scheduled_followups
         WHERE contact_id = $1 AND org_id = $2 AND sent = false AND scheduled_for > NOW()
         ORDER BY scheduled_for`,
        [contactId, orgId]
      )

      return results.map((row) => ({
        id: row.id,
        scheduledFor: row.scheduled_for,
        channel: row.channel as CommunicationChannel,
        templateId: row.template_id
      }))
    } catch (error) {
      throw new DatabaseError(
        'Failed to get pending follow-ups',
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Cancel a scheduled follow-up within a tenant.
   *
   * The DELETE is org-scoped (AND org_id = $2) so a follow-up id from another
   * tenant cannot be cancelled — a cross-org id deletes nothing and returns
   * false (surfaced as a 404 by the route).
   */
  async cancelFollowUp(id: string, orgId: string): Promise<boolean> {
    try {
      const results = await database.query(
        'DELETE FROM scheduled_followups WHERE id = $1 AND org_id = $2 AND sent = false',
        [id, orgId]
      )
      return (results as unknown as { rowCount: number }).rowCount > 0
    } catch (error) {
      throw new DatabaseError(
        'Failed to cancel follow-up',
        error instanceof Error ? error : undefined
      )
    }
  }

  // ============================================
  // Webhook Handlers
  // ============================================

  /**
   * Handle delivery status webhook from SendGrid
   */
  async handleSendGridWebhook(event: {
    event: string
    messageId: string
    timestamp: string
    reason?: string
  }): Promise<void> {
    const statusMap: Record<string, CommunicationStatus> = {
      delivered: 'delivered',
      open: 'opened',
      click: 'clicked',
      bounce: 'bounced',
      dropped: 'failed',
      spam_report: 'failed',
      unsubscribe: 'failed'
    }

    const status = statusMap[event.event]
    if (!status) return

    try {
      // Find communication by external ID
      const results = await database.query<CommunicationRow>(
        'SELECT id FROM communications WHERE external_id = $1 AND channel = $2',
        [event.messageId, 'email']
      )

      if (results[0]) {
        await this.updateCommunicationStatus(results[0].id, status, undefined, event.reason)
      }
    } catch (error) {
      console.error('Failed to handle SendGrid webhook:', error)
    }
  }

  /**
   * Handle delivery status webhook from Twilio (SMS)
   */
  async handleTwilioSMSWebhook(event: {
    MessageSid: string
    MessageStatus: string
    ErrorCode?: string
    ErrorMessage?: string
  }): Promise<void> {
    const statusMap: Record<string, CommunicationStatus> = {
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      failed: 'failed',
      undelivered: 'failed'
    }

    const status = statusMap[event.MessageStatus]
    if (!status) return

    try {
      const results = await database.query<CommunicationRow>(
        'SELECT id FROM communications WHERE external_id = $1 AND channel = $2',
        [event.MessageSid, 'sms']
      )

      if (results[0]) {
        await this.updateCommunicationStatus(results[0].id, status, undefined, event.ErrorMessage)
      }
    } catch (error) {
      console.error('Failed to handle Twilio SMS webhook:', error)
    }
  }

  /**
   * Handle call status webhook from Twilio
   */
  async handleTwilioCallWebhook(event: {
    CallSid: string
    CallStatus: string
    Duration?: string
    RecordingUrl?: string
  }): Promise<void> {
    const statusMap: Record<string, CommunicationStatus> = {
      queued: 'pending',
      ringing: 'pending',
      'in-progress': 'pending',
      completed: 'answered',
      busy: 'busy',
      'no-answer': 'no_answer',
      failed: 'failed',
      canceled: 'failed'
    }

    const status = statusMap[event.CallStatus]
    if (!status) return

    try {
      const results = await database.query<CommunicationRow>(
        'SELECT id FROM communications WHERE external_id = $1 AND channel = $2',
        [event.CallSid, 'call']
      )

      if (results[0]) {
        const updates: string[] = ['status = $2']
        const values: unknown[] = [results[0].id, status]
        let paramCount = 3

        if (event.Duration) {
          updates.push(`call_duration_seconds = $${paramCount++}`)
          values.push(parseInt(event.Duration))
        }

        if (event.RecordingUrl) {
          updates.push(`call_recording_url = $${paramCount++}`)
          values.push(event.RecordingUrl)
        }

        await database.query(
          `UPDATE communications SET ${updates.join(', ')} WHERE id = $1`,
          values
        )
      }
    } catch (error) {
      console.error('Failed to handle Twilio call webhook:', error)
    }
  }
}

// Export singleton instance
export const communicationsService = new CommunicationsService()
