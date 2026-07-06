/**
 * Webhook Routes
 *
 * Handles incoming webhooks from external services:
 * - Twilio: SMS delivery status, inbound SMS, voice call status
 * - SendGrid: Email events (delivered, opened, clicked, bounced)
 * - Plaid: Transaction updates, item status changes
 *
 * All webhook endpoints verify signatures before processing.
 */

import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { asyncHandler } from '../middleware/errorHandler'
import { validateRequest } from '../middleware/validateRequest'
import {
  verifyTwilioSignature,
  verifySendGridSignature,
  verifyPlaidSignature
} from '../middleware/webhookAuth'
import { CommunicationsService } from '../services/CommunicationsService'
import { database } from '../database/connection'
import { OutreachSequenceService } from '../services/OutreachSequenceService'
import { suppressionService } from '../services/SuppressionService'
import { dealsService } from '../services/DealsService'
import {
  ReplyHandlingService,
  type ReplyChannel,
  type ReplyContext
} from '../services/ReplyHandlingService'

const router = Router()

// Shared secret gating SendGrid Inbound Parse. Inbound Parse has NO signature
// mechanism, so we gate the route on a shared-secret token supplied as a query
// param (?token=...). FAIL CLOSED: when the env var is unset the route rejects
// every request 401, exactly like the signature-based webhooks reject when
// their verification material is missing.
/**
 * Read the inbound-parse shared secret. Read lazily (per-request, not at module
 * load) so deployment can rotate it without a restart and so it is unambiguous
 * in tests. An empty/unset value means the route fails closed.
 */
function inboundParseToken(): string {
  return process.env.INBOUND_PARSE_TOKEN || ''
}

/**
 * Timing-safe string comparison for the inbound-parse shared secret. Length
 * mismatches return false immediately (lengths are not secret); equal-length
 * inputs are compared with crypto.timingSafeEqual.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  try {
    return crypto.timingSafeEqual(bufA, bufB)
  } catch {
    return false
  }
}

/**
 * Construct the reply-handling service with the production collaborators. The
 * OutreachSequenceService is db-injected; suppression/deals are singletons.
 */
function buildReplyHandler(): ReplyHandlingService {
  const sequenceService = new OutreachSequenceService(database)
  return new ReplyHandlingService(sequenceService, suppressionService, dealsService)
}

/**
 * Resolve the prospect + company linked to a contact, used to attach replies to
 * sequences and to title deals. Returns nulls (never throws) so reply handling
 * stays failure-isolated from the inbound persistence.
 */
async function resolveContactProspect(
  contactId: string | null
): Promise<{ prospectId: string | null; companyName: string | null }> {
  if (!contactId) return { prospectId: null, companyName: null }
  try {
    const rows = await database.query<{ prospect_id: string; company_name: string }>(
      `SELECT p.id AS prospect_id, p.company_name
       FROM prospect_contacts pc
       JOIN prospects p ON p.id = pc.prospect_id
       WHERE pc.contact_id = $1
       ORDER BY pc.is_primary DESC, pc.created_at ASC
       LIMIT 1`,
      [contactId]
    )
    if (rows[0]) {
      return { prospectId: rows[0].prospect_id, companyName: rows[0].company_name }
    }
  } catch (error) {
    console.error('[webhooks] Failed to resolve prospect for inbound contact', {
      contactId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
  return { prospectId: null, companyName: null }
}

/**
 * Run reply handling for an already-persisted inbound communication. Logs
 * named failures; never throws (so the webhook still returns 200/empty).
 */
async function runReplyHandling(ctx: ReplyContext, context: { messageId?: string }): Promise<void> {
  try {
    const handler = buildReplyHandler()
    const result = await handler.handleInboundReply(ctx)
    if (result.failures.length > 0) {
      console.warn('[webhooks] Reply handling completed with non-fatal failures', {
        ...context,
        disposition: result.disposition,
        sequencesAttached: result.sequencesAttached,
        suppressed: result.suppressed,
        dealId: result.dealId,
        failures: result.failures
      })
    }
  } catch (error) {
    // Defensive: handleInboundReply is built not to throw, but never let a
    // reply-handling fault bubble out and turn into a provider retry.
    console.error('[webhooks] Reply handling threw unexpectedly', {
      ...context,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Minimal, dependency-free parser for `multipart/form-data` TEXT fields.
 *
 * SendGrid Inbound Parse posts its parsed fields (from/to/subject/text/...) as
 * multipart/form-data. The app's global webhook body parsers only handle
 * application/json (raw) and x-www-form-urlencoded, and no multipart middleware
 * (multer/busboy) is a project dependency. Rather than add one, this route-
 * scoped middleware reads the raw stream and extracts the named text parts.
 *
 * Scope is deliberately narrow: it only collects field name → value for parts
 * with a `name="..."` Content-Disposition, decodes as UTF-8, and ignores file
 * uploads (we only need from/to/subject/text). Non-multipart requests pass
 * through untouched so urlencoded posts (already parsed into req.body) work too.
 */
function parseMultipartFields(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('multipart/form-data')) {
      return next()
    }

    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
    const boundary = boundaryMatch ? (boundaryMatch[1] || boundaryMatch[2]).trim() : ''
    if (!boundary) {
      // Malformed multipart with no boundary: nothing to parse. Leave body as-is.
      return next()
    }

    const chunks: Buffer[] = []
    let total = 0
    const LIMIT = 1024 * 1024 // 1mb, mirroring the other webhook body limits
    let aborted = false

    req.on('data', (chunk: Buffer) => {
      if (aborted) return
      total += chunk.length
      if (total > LIMIT) {
        aborted = true
        res.status(413).json({ error: { message: 'Payload too large', statusCode: 413 } })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      if (aborted) return
      try {
        const fields = extractMultipartTextFields(Buffer.concat(chunks), boundary)
        req.body = { ...(req.body as Record<string, unknown>), ...fields }
      } catch (error) {
        console.error('[webhooks] Failed to parse multipart inbound body', {
          error: error instanceof Error ? error.message : String(error)
        })
        req.body = req.body || {}
      }
      next()
    })

    req.on('error', (error) => {
      if (aborted) return
      aborted = true
      console.error('[webhooks] Inbound multipart stream error', {
        error: error instanceof Error ? error.message : String(error)
      })
      next()
    })
  }
}

/**
 * Extract text fields (name → value) from a raw multipart/form-data buffer.
 * Parts carrying a `filename=` are skipped (file uploads are not needed here).
 */
function extractMultipartTextFields(buf: Buffer, boundary: string): Record<string, string> {
  const fields: Record<string, string> = {}
  const delimiter = `--${boundary}`
  const raw = buf.toString('latin1') // byte-preserving split; values re-decoded as utf8
  const segments = raw.split(delimiter)

  for (const segment of segments) {
    // Skip the preamble, the closing "--", and empty trailers.
    if (!segment || segment === '--' || segment === '--\r\n' || segment.trim() === '') {
      continue
    }
    const headerEnd = segment.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue

    const headerBlock = segment.slice(0, headerEnd)
    const disposition = /content-disposition:[^\r\n]*/i.exec(headerBlock)?.[0] || ''
    if (/filename=/i.test(disposition)) {
      continue // file part — not needed
    }
    const nameMatch = /name="([^"]*)"/i.exec(disposition)
    if (!nameMatch) continue
    const name = nameMatch[1]

    // Body runs from after the blank line to the trailing CRLF before the next
    // delimiter. Re-decode the byte slice as UTF-8 to recover non-ASCII text.
    let body = segment.slice(headerEnd + 4)
    body = body.replace(/\r\n$/, '')
    fields[name] = Buffer.from(body, 'latin1').toString('utf8')
  }

  return fields
}

// ============================================
// Twilio SMS Webhooks
// ============================================

/**
 * SMS delivery status webhook schema
 *
 * Twilio sends status updates as the message progresses through delivery.
 */
const twilioSmsStatusSchema = z.object({
  MessageSid: z.string().min(1),
  MessageStatus: z.enum([
    'queued',
    'failed',
    'sent',
    'delivered',
    'undelivered',
    'receiving',
    'received',
    'accepted'
  ]),
  To: z.string().optional(),
  From: z.string().optional(),
  ErrorCode: z.string().optional(),
  ErrorMessage: z.string().optional()
})

/**
 * POST /api/webhooks/twilio/sms/status
 *
 * Receives SMS delivery status updates from Twilio.
 * Updates the communication record with the new status.
 */
router.post(
  '/twilio/sms/status',
  verifyTwilioSignature,
  validateRequest({ body: twilioSmsStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioSmsStatusSchema>

    console.log('[webhooks] Twilio SMS status received:', {
      messageSid: body.MessageSid,
      status: body.MessageStatus,
      errorCode: body.ErrorCode
    })

    const communicationsService = new CommunicationsService()

    await communicationsService.handleTwilioSMSWebhook({
      MessageSid: body.MessageSid,
      MessageStatus: body.MessageStatus,
      ErrorCode: body.ErrorCode,
      ErrorMessage: body.ErrorMessage
    })

    // Twilio expects empty 200 response
    res.status(200).send()
  })
)

/**
 * Inbound SMS webhook schema
 *
 * Twilio sends inbound messages with full message details.
 */
const twilioSmsInboundSchema = z.object({
  MessageSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string(),
  NumMedia: z.coerce.number().default(0),
  // Media URLs if present (up to 10)
  MediaUrl0: z.string().url().optional(),
  MediaUrl1: z.string().url().optional(),
  MediaUrl2: z.string().url().optional(),
  MediaContentType0: z.string().optional(),
  MediaContentType1: z.string().optional(),
  MediaContentType2: z.string().optional()
})

/**
 * POST /api/webhooks/twilio/sms/inbound
 *
 * Receives inbound SMS messages from Twilio.
 * Creates a communication record for the incoming message.
 */
router.post(
  '/twilio/sms/inbound',
  verifyTwilioSignature,
  validateRequest({ body: twilioSmsInboundSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioSmsInboundSchema>

    console.log('[webhooks] Twilio inbound SMS received:', {
      messageSid: body.MessageSid,
      from: body.From,
      to: body.To
    })

    // Extract media attachments if present. Twilio sends at most 10 media
    // parts; the schema only models the first 3. Bound the loop to the smaller
    // of the reported count and the supported field count to avoid an
    // unbounded loop driven by an attacker-controlled NumMedia value.
    const MAX_SUPPORTED_MEDIA = 3
    const mediaCount = Math.max(0, Math.min(body.NumMedia, MAX_SUPPORTED_MEDIA))
    const attachments: Array<{ url: string; contentType: string }> = []
    for (let i = 0; i < mediaCount; i++) {
      const urlKey = `MediaUrl${i}` as keyof typeof body
      const typeKey = `MediaContentType${i}` as keyof typeof body
      if (body[urlKey]) {
        attachments.push({
          url: body[urlKey] as string,
          contentType: (body[typeKey] as string) || 'application/octet-stream'
        })
      }
    }

    try {
      // Resolve the contact for this inbound message. The previous lookup used
      // a `LIKE '%<last10>'` match with no tenant scoping and `LIMIT 1`, which
      // could attach the message to an ARBITRARY tenant's contact and stamp
      // that tenant's org_id onto the record (cross-tenant data leakage).
      //
      // Without an org↔Twilio-number mapping we cannot derive the receiving
      // org from `To`, so we fail closed: only associate a contact (and its
      // org) when the sender's full normalized phone matches EXACTLY ONE
      // contact. If the match is ambiguous (multiple tenants share the number)
      // we leave contact_id/org_id NULL rather than guess.
      //
      // TODO(security): introduce an organization↔Twilio-number mapping so the
      // receiving org can be derived from `To`, then scope the contact lookup
      // to that org.
      const normalizedPhone = body.From.replace(/\D/g, '')
      const last10 = normalizedPhone.slice(-10)
      const contactResults = await database.query<{ id: string; org_id: string }>(
        `SELECT c.id, c.org_id FROM contacts c
         WHERE RIGHT(REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g'), 10) = $1
            OR RIGHT(REGEXP_REPLACE(COALESCE(c.mobile, ''), '\\D', '', 'g'), 10) = $1
         LIMIT 2`,
        [last10]
      )

      // Only trust the association when it is unambiguous (single match).
      const contact = contactResults.length === 1 ? contactResults[0] : undefined
      if (contactResults.length > 1) {
        console.warn(
          '[webhooks] Inbound SMS phone matched multiple tenants; leaving contact/org unset',
          { messageSid: body.MessageSid, last10 }
        )
      }

      // Create inbound communication record. Capture the id so reply handling
      // can attach the reply to the originating sequence(s).
      const inserted = await database.query<{ id: string }>(
        `INSERT INTO communications (
          org_id, contact_id, channel, direction, from_phone, to_phone,
          body, external_id, status, metadata, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          contact?.org_id || null,
          contact?.id || null,
          'sms',
          'inbound',
          body.From,
          body.To,
          body.Body,
          body.MessageSid,
          'received',
          JSON.stringify({ attachments, accountSid: body.AccountSid })
        ]
      )
      const communicationId = inserted[0]?.id ?? null

      console.log('[webhooks] Inbound SMS recorded successfully')

      // Close the loop: classify the reply, attach it to the contact's active
      // outreach sequence(s), suppress on opt-out (TCPA), create a deal on a
      // positive reply. Failure-isolated and non-throwing — the communication
      // row above is already durably persisted regardless of what follows.
      const { prospectId, companyName } = await resolveContactProspect(contact?.id ?? null)
      const replyCtx: ReplyContext = {
        communicationId,
        channel: 'sms' as ReplyChannel,
        orgId: contact?.org_id ?? null,
        contactId: contact?.id ?? null,
        prospectId,
        companyName,
        fromEmail: null,
        fromPhone: body.From,
        body: body.Body
      }
      await runReplyHandling(replyCtx, { messageId: body.MessageSid })
    } catch (error) {
      // Log with context for observability; do NOT swallow silently. We still
      // return 200 below so Twilio does not retry a request that will keep
      // failing (e.g. a persistent DB error), but the failure is recorded.
      console.error('[webhooks] Failed to record inbound SMS', {
        messageSid: body.MessageSid,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Return TwiML response (empty response for no auto-reply)
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
  })
)

// ============================================
// Twilio Voice Webhooks
// ============================================

/**
 * Voice call status webhook schema
 */
const twilioVoiceStatusSchema = z.object({
  CallSid: z.string().min(1),
  AccountSid: z.string().min(1),
  From: z.string().optional(),
  To: z.string().optional(),
  CallStatus: z.enum([
    'queued',
    'ringing',
    'in-progress',
    'completed',
    'busy',
    'no-answer',
    'canceled',
    'failed'
  ]),
  CallDuration: z.coerce.number().optional(),
  Duration: z.coerce.number().optional(),
  RecordingUrl: z.string().url().optional(),
  RecordingSid: z.string().optional(),
  Direction: z.enum(['inbound', 'outbound-api', 'outbound-dial']).optional(),
  AnsweredBy: z.enum(['human', 'machine', 'fax', 'unknown']).optional()
})

/**
 * POST /api/webhooks/twilio/voice/status
 *
 * Receives voice call status updates from Twilio.
 * Updates the communication record with call details.
 */
router.post(
  '/twilio/voice/status',
  verifyTwilioSignature,
  validateRequest({ body: twilioVoiceStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof twilioVoiceStatusSchema>

    console.log('[webhooks] Twilio voice status received:', {
      callSid: body.CallSid,
      status: body.CallStatus,
      duration: body.CallDuration || body.Duration
    })

    const communicationsService = new CommunicationsService()

    await communicationsService.handleTwilioCallWebhook({
      CallSid: body.CallSid,
      CallStatus: body.CallStatus,
      Duration: String(body.CallDuration || body.Duration || 0),
      RecordingUrl: body.RecordingUrl
    })

    // Twilio expects empty 200 response
    res.status(200).send()
  })
)

// ============================================
// SendGrid Webhooks
// ============================================

/**
 * SendGrid event webhook schema
 *
 * SendGrid batches events and sends them as an array.
 */
const sendgridEventSchema = z.object({
  email: z.string().email().optional(),
  timestamp: z.number().optional(),
  event: z.enum([
    'processed',
    'dropped',
    'delivered',
    'deferred',
    'bounce',
    'open',
    'click',
    'spam_report',
    'unsubscribe',
    'group_unsubscribe',
    'group_resubscribe'
  ]),
  sg_event_id: z.string().optional(),
  sg_message_id: z.string().optional(),
  category: z.union([z.string(), z.array(z.string())]).optional(),
  url: z.string().optional(),
  reason: z.string().optional(),
  status: z.string().optional(),
  response: z.string().optional(),
  attempt: z.string().optional(),
  useragent: z.string().optional(),
  ip: z.string().optional()
})

const sendgridEventsSchema = z.array(sendgridEventSchema)

/**
 * POST /api/webhooks/sendgrid/events
 *
 * Receives email event notifications from SendGrid.
 * Processes events like delivered, opened, clicked, bounced.
 */
router.post(
  '/sendgrid/events',
  verifySendGridSignature,
  asyncHandler(async (req: Request, res: Response) => {
    // SendGrid sends events as an array
    const parseResult = sendgridEventsSchema.safeParse(req.body)

    if (!parseResult.success) {
      console.error('[webhooks] Invalid SendGrid event format:', parseResult.error)
      // Still return 200 to prevent retries for malformed events
      return res.status(200).send()
    }

    const events = parseResult.data

    console.log('[webhooks] SendGrid events received:', {
      count: events.length,
      types: [...new Set(events.map((e) => e.event))]
    })

    const communicationsService = new CommunicationsService()

    // Process each event
    for (const event of events) {
      try {
        // Extract message ID from sg_message_id (format: "message_id.filter_id")
        const messageId = event.sg_message_id?.split('.')[0]

        if (messageId) {
          await communicationsService.handleSendGridWebhook({
            event: event.event,
            messageId,
            timestamp: event.timestamp
              ? new Date(event.timestamp * 1000).toISOString()
              : new Date().toISOString(),
            reason: event.reason
          })
        }
      } catch (error) {
        console.error('[webhooks] Failed to process SendGrid event:', error, event)
        // Continue processing other events
      }
    }

    // SendGrid expects 200 response
    res.status(200).send()
  })
)

/**
 * Parse the email address out of a SendGrid `from`/`to` header value, which may
 * be a bare address (`a@b.com`) or RFC-5322 display form (`Name <a@b.com>`).
 * Returns the lower-cased bare address, or null when none can be extracted.
 */
function extractEmailAddress(raw: string | undefined): string | null {
  if (!raw) return null
  const angle = /<([^>]+)>/.exec(raw)
  const candidate = (angle ? angle[1] : raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null
}

/**
 * SendGrid Inbound Parse webhook schema (text fields). SendGrid posts the parsed
 * message as multipart form fields; we only require `from`. Everything else is
 * optional/best-effort.
 */
const sendgridInboundQuerySchema = z.object({
  token: z.string().optional()
})

const sendgridInboundSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional()
})

/**
 * POST /api/webhooks/sendgrid/inbound?token=...
 *
 * Receives parsed inbound emails from SendGrid Inbound Parse. Inbound Parse has
 * NO signature mechanism (unlike the Event Webhook), so the route is gated on a
 * shared-secret query token (INBOUND_PARSE_TOKEN). FAIL CLOSED: a missing env
 * var, missing token, or mismatched token all reject 401.
 *
 * On success the inbound email is persisted as a communications row (direction
 * inbound, status received, received_at now), the sending contact is resolved by
 * from-address (unambiguous match only — mirrors the inbound-SMS fail-closed
 * tenant scoping), and reply handling runs (sequence attach + opt-out
 * suppression + positive→deal), all failure-isolated.
 */
router.post(
  '/sendgrid/inbound',
  validateRequest({ query: sendgridInboundQuerySchema }),
  parseMultipartFields(),
  asyncHandler(async (req: Request, res: Response) => {
    // FAIL CLOSED on the shared secret before doing any work.
    const expectedToken = inboundParseToken()
    if (!expectedToken) {
      console.error('[webhooks] INBOUND_PARSE_TOKEN not configured - rejecting inbound email')
      return res.status(401).json({
        error: { message: 'Inbound parse token not configured', statusCode: 401 }
      })
    }
    const { token } = req.query as z.infer<typeof sendgridInboundQuerySchema>
    if (!token || !timingSafeEqualStr(token, expectedToken)) {
      console.error('[webhooks] Invalid inbound parse token')
      return res.status(401).json({
        error: { message: 'Invalid inbound parse token', statusCode: 401 }
      })
    }

    const parsed = sendgridInboundSchema.safeParse(req.body)
    if (!parsed.success) {
      console.error('[webhooks] Invalid SendGrid inbound payload:', parsed.error)
      // 400 (not 200): a malformed inbound parse payload is a real client error
      // and there is nothing to durably record without at least a `from`.
      return res
        .status(400)
        .json({ error: { message: 'Invalid inbound payload', statusCode: 400 } })
    }
    const data = parsed.data

    const fromEmail = extractEmailAddress(data.from)
    const toEmail = extractEmailAddress(data.to)

    console.log('[webhooks] SendGrid inbound email received:', {
      from: fromEmail,
      to: toEmail,
      hasText: !!data.text
    })

    try {
      // Resolve the sending contact by from-address. Mirror the inbound-SMS
      // fail-closed tenant scoping: associate the contact (and its org) ONLY on
      // an unambiguous single match; otherwise leave contact_id/org_id NULL.
      let contact: { id: string; org_id: string } | undefined
      if (fromEmail) {
        const matches = await database.query<{ id: string; org_id: string }>(
          `SELECT id, org_id FROM contacts WHERE LOWER(email) = $1 LIMIT 2`,
          [fromEmail]
        )
        contact = matches.length === 1 ? matches[0] : undefined
        if (matches.length > 1) {
          console.warn(
            '[webhooks] Inbound email from-address matched multiple tenants; leaving contact/org unset',
            { fromEmail }
          )
        }
      }

      const bodyText = data.text ?? ''

      // Persist the inbound email first (durable regardless of reply handling).
      const inserted = await database.query<{ id: string }>(
        `INSERT INTO communications (
          org_id, contact_id, channel, direction, from_address, to_address,
          subject, body, body_html, status, metadata, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
        RETURNING id`,
        [
          contact?.org_id || null,
          contact?.id || null,
          'email',
          'inbound',
          fromEmail || data.from,
          toEmail || data.to || null,
          data.subject || null,
          bodyText,
          data.html || null,
          'received',
          JSON.stringify({ source: 'sendgrid-inbound-parse' })
        ]
      )
      const communicationId = inserted[0]?.id ?? null

      console.log('[webhooks] Inbound email recorded successfully')

      // Close the loop (failure-isolated, non-throwing).
      const { prospectId, companyName } = await resolveContactProspect(contact?.id ?? null)
      const replyCtx: ReplyContext = {
        communicationId,
        channel: 'email' as ReplyChannel,
        orgId: contact?.org_id ?? null,
        contactId: contact?.id ?? null,
        prospectId,
        companyName,
        fromEmail,
        fromPhone: null,
        body: bodyText
      }
      await runReplyHandling(replyCtx, { messageId: communicationId ?? undefined })
    } catch (error) {
      // The inbound record is the primary obligation; log loudly but still 200
      // so SendGrid does not retry a request that will keep failing.
      console.error('[webhooks] Failed to record inbound email', {
        from: fromEmail,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // SendGrid Inbound Parse expects a 2xx to consider the message handled.
    res.status(200).send()
  })
)

// ============================================
// Plaid Webhooks
// ============================================

/**
 * Plaid transaction webhook schema
 */
const plaidTransactionSchema = z.object({
  webhook_type: z.literal('TRANSACTIONS'),
  webhook_code: z.enum([
    'INITIAL_UPDATE',
    'HISTORICAL_UPDATE',
    'DEFAULT_UPDATE',
    'TRANSACTIONS_REMOVED',
    'SYNC_UPDATES_AVAILABLE'
  ]),
  item_id: z.string().min(1),
  new_transactions: z.number().optional(),
  removed_transactions: z.array(z.string()).optional(),
  error: z
    .object({
      error_type: z.string(),
      error_code: z.string(),
      error_message: z.string()
    })
    .optional()
})

/**
 * POST /api/webhooks/plaid/transactions
 *
 * Receives transaction update notifications from Plaid.
 * Triggers sync for new or updated transactions.
 */
router.post(
  '/plaid/transactions',
  verifyPlaidSignature,
  validateRequest({ body: plaidTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof plaidTransactionSchema>

    console.log('[webhooks] Plaid transaction webhook received:', {
      itemId: body.item_id,
      code: body.webhook_code,
      newTransactions: body.new_transactions
    })

    if (body.error) {
      console.error('[webhooks] Plaid transaction error:', body.error)
    }

    try {
      // Record the webhook event
      await database.query(
        `INSERT INTO plaid_webhook_events (
          item_id, webhook_type, webhook_code, new_transactions,
          removed_transactions, error, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          body.item_id,
          body.webhook_type,
          body.webhook_code,
          body.new_transactions || 0,
          body.removed_transactions || [],
          body.error ? JSON.stringify(body.error) : null
        ]
      )

      // For DEFAULT_UPDATE or SYNC_UPDATES_AVAILABLE, trigger a transaction sync
      if (
        body.webhook_code === 'DEFAULT_UPDATE' ||
        body.webhook_code === 'SYNC_UPDATES_AVAILABLE'
      ) {
        // Find the deal/prospect associated with this Plaid item
        const itemResults = await database.query<{ deal_id: string; prospect_id: string }>(
          'SELECT deal_id, prospect_id FROM plaid_items WHERE item_id = $1',
          [body.item_id]
        )

        if (itemResults[0]) {
          // TODO: Queue a job to sync transactions for this item
          console.log('[webhooks] Would queue transaction sync for:', {
            itemId: body.item_id,
            dealId: itemResults[0].deal_id,
            prospectId: itemResults[0].prospect_id
          })
        }
      }
    } catch (error) {
      console.error('[webhooks] Failed to process Plaid transaction webhook:', error)
    }

    // Plaid expects 200 response
    res.status(200).send()
  })
)

/**
 * Plaid item webhook schema
 */
const plaidItemSchema = z.object({
  webhook_type: z.literal('ITEM'),
  webhook_code: z.enum([
    'ERROR',
    'PENDING_EXPIRATION',
    'USER_PERMISSION_REVOKED',
    'WEBHOOK_UPDATE_ACKNOWLEDGED',
    'NEW_ACCOUNTS_AVAILABLE'
  ]),
  item_id: z.string().min(1),
  error: z
    .object({
      error_type: z.string(),
      error_code: z.string(),
      error_message: z.string(),
      display_message: z.string().optional()
    })
    .optional(),
  consent_expiration_time: z.string().optional()
})

/**
 * POST /api/webhooks/plaid/item
 *
 * Receives item status change notifications from Plaid.
 * Handles errors, expiration, and permission changes.
 */
router.post(
  '/plaid/item',
  verifyPlaidSignature,
  validateRequest({ body: plaidItemSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof plaidItemSchema>

    console.log('[webhooks] Plaid item webhook received:', {
      itemId: body.item_id,
      code: body.webhook_code,
      hasError: !!body.error
    })

    try {
      // Record the webhook event
      await database.query(
        `INSERT INTO plaid_webhook_events (
          item_id, webhook_type, webhook_code, error, received_at
        ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [
          body.item_id,
          body.webhook_type,
          body.webhook_code,
          body.error ? JSON.stringify(body.error) : null
        ]
      )

      // Update item status based on webhook code
      let status = 'active'
      let errorMessage: string | null = null

      switch (body.webhook_code) {
        case 'ERROR':
          status = 'error'
          errorMessage = body.error?.error_message || 'Unknown error'
          break
        case 'PENDING_EXPIRATION':
          status = 'pending_expiration'
          break
        case 'USER_PERMISSION_REVOKED':
          status = 'revoked'
          break
        case 'NEW_ACCOUNTS_AVAILABLE':
          // User has added new accounts, may need to re-link
          console.log('[webhooks] New accounts available for item:', body.item_id)
          break
      }

      // Update the item record
      await database.query(
        `UPDATE plaid_items SET
          status = $2,
          error_message = $3,
          consent_expiration_time = $4,
          updated_at = CURRENT_TIMESTAMP
        WHERE item_id = $1`,
        [body.item_id, status, errorMessage, body.consent_expiration_time]
      )

      // If there's an error, notify the user/broker
      if (body.webhook_code === 'ERROR' || body.webhook_code === 'USER_PERMISSION_REVOKED') {
        // Find the associated deal/contact
        const itemResults = await database.query<{
          deal_id: string
          prospect_id: string
          contact_id: string
        }>('SELECT deal_id, prospect_id, contact_id FROM plaid_items WHERE item_id = $1', [
          body.item_id
        ])

        if (itemResults[0]) {
          // TODO: Send notification to broker about the issue
          console.log('[webhooks] Plaid item requires attention:', {
            itemId: body.item_id,
            status,
            dealId: itemResults[0].deal_id,
            error: body.error
          })
        }
      }
    } catch (error) {
      console.error('[webhooks] Failed to process Plaid item webhook:', error)
    }

    // Plaid expects 200 response
    res.status(200).send()
  })
)

export default router
