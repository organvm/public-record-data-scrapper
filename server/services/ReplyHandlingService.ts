/**
 * ReplyHandlingService
 *
 * Closes the outbound→inbound automation loop. Once an inbound communication
 * (email or SMS) has been persisted, this service:
 *
 *   1. Classifies the reply body with a transparent, deterministic, rule-based
 *      classifier (NO LLM): POSITIVE (interest phrases), NEGATIVE / OPT_OUT
 *      ('stop', 'unsubscribe', 'remove me', ...), or NEUTRAL.
 *   2. Attaches the reply to the contact's in-flight outreach sequence(s),
 *      marking them replied and stopping any further pending/scheduled sends.
 *   3. On OPT_OUT, records a suppression entry (TCPA / CAN-SPAM obligation) for
 *      the originating channel via SuppressionService.
 *   4. On POSITIVE, creates a deal in the org's default pipeline stage via
 *      DealsService, deriving the title from the company/contact.
 *
 * Every step is FAILURE-ISOLATED: a downstream failure (e.g. deal creation)
 * must never lose the inbound communication row or block the other steps. The
 * caller persists the communication row FIRST and then hands the resolved
 * context here; failures are logged with a named reason and surfaced in the
 * returned result, never thrown back to the webhook (which must still 200 so
 * the provider does not retry indefinitely).
 *
 * This service is intentionally db/dependency-injected and side-effect-narrow
 * so it can be unit-tested without a live database or queue.
 */

export type ReplyDisposition = 'positive' | 'negative' | 'opt_out' | 'neutral'

export type ReplyChannel = 'email' | 'sms'

/**
 * Minimal structural contracts for the collaborators we depend on. Declaring
 * them here (rather than importing the concrete classes) keeps this service
 * unit-testable with lightweight fakes and avoids coupling to singletons.
 */
export interface OutreachSequencePort {
  getActiveSequenceIds(
    prospectId: string
  ): Promise<{ id: string; triggerType: string; status: string }[]>
  recordReply(
    sequenceId: string,
    communicationId: string | null,
    disposition: string
  ): Promise<void>
}

export interface SuppressionPort {
  addToSuppressionList(input: {
    orgId: string
    phone?: string
    email?: string
    source?: 'federal_dnc' | 'state_dnc' | 'internal' | 'complaint' | 'imported'
    channel?: 'call' | 'sms' | 'email' | 'all'
    reason?: string
    addedBy?: string
  }): Promise<unknown>
}

export interface DealsPort {
  create(input: {
    orgId: string
    prospectId?: string
    contactId?: string
    stageId?: string
    priority?: 'low' | 'normal' | 'high' | 'urgent'
  }): Promise<{ id: string }>
}

export interface ReplyContext {
  /** The id of the already-persisted inbound communications row (may be null if persistence could not resolve one). */
  communicationId: string | null
  /** Channel the reply arrived on; drives suppression channel + identifier. */
  channel: ReplyChannel
  /** Resolved org for the contact, or null when the inbound message could not be attributed to a tenant. */
  orgId: string | null
  /** Resolved contact id, or null when unattributed. */
  contactId: string | null
  /** Prospect linked to the contact, or null when none. */
  prospectId: string | null
  /** Company name for deal titling, when known. */
  companyName: string | null
  /** The sender's email address (email channel) — used for email suppression. */
  fromEmail: string | null
  /** The sender's phone (sms channel) — used for sms suppression. */
  fromPhone: string | null
  /** Raw reply text used for classification. */
  body: string
}

export interface ReplyHandlingResult {
  disposition: ReplyDisposition
  sequencesAttached: number
  suppressed: boolean
  dealId: string | null
  /** Named, non-fatal failures encountered while running the isolated steps. */
  failures: string[]
}

// ---------------------------------------------------------------------------
// Rule-based classifier — deterministic, transparent, unit-tested. No LLM.
// ---------------------------------------------------------------------------

// Opt-out wins over everything: it is a compliance obligation. Phrases are
// matched against the lower-cased, whitespace-collapsed body.
const OPT_OUT_PHRASES = [
  'stop',
  'unsubscribe',
  'remove me',
  'remove from list',
  'opt out',
  'opt-out',
  'do not contact',
  "don't contact",
  'take me off',
  'no longer interested in receiving'
]

const NEGATIVE_PHRASES = [
  'not interested',
  'no thanks',
  'no thank you',
  'not at this time',
  'not a good time',
  'we are all set',
  "we're all set",
  'already have',
  'no need',
  'pass'
]

const POSITIVE_PHRASES = [
  'interested',
  'tell me more',
  'learn more',
  'sounds good',
  "let's talk",
  'lets talk',
  'call me',
  'give me a call',
  'send me',
  'how much',
  'what are the rates',
  'what are the terms',
  'yes',
  'set up a call',
  'schedule a call',
  'i would like',
  "i'd like",
  'please reach out',
  'looking for funding',
  'need capital',
  'need funding'
]

/**
 * Classify an inbound reply body.
 *
 * Precedence is OPT_OUT > NEGATIVE > POSITIVE > NEUTRAL. Opt-out is checked
 * first because it carries a legal obligation and must never be misread as
 * positive interest. Negative is checked before positive so a phrase like
 * "not interested" is not captured by the bare "interested" positive token.
 */
export function classifyReply(body: string): ReplyDisposition {
  const text = (body || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text) return 'neutral'

  // Word-boundary match for short, ambiguous opt-out tokens like "stop" so we
  // don't fire on substrings ("stopwatch"). Multi-word phrases use includes().
  const hasPhrase = (phrase: string): boolean => {
    if (/^[a-z]+$/.test(phrase)) {
      const re = new RegExp(`\\b${phrase}\\b`)
      return re.test(text)
    }
    return text.includes(phrase)
  }

  if (OPT_OUT_PHRASES.some(hasPhrase)) return 'opt_out'
  if (NEGATIVE_PHRASES.some((p) => text.includes(p))) return 'negative'
  if (POSITIVE_PHRASES.some(hasPhrase)) return 'positive'
  return 'neutral'
}

export class ReplyHandlingService {
  constructor(
    private readonly sequences: OutreachSequencePort,
    private readonly suppression: SuppressionPort,
    private readonly deals: DealsPort,
    private readonly logger: Pick<Console, 'warn' | 'error'> = console
  ) {}

  /**
   * Run the full reply-handling flow against a context whose communication row
   * has already been persisted by the caller. Never throws — failures are
   * collected and returned so the webhook can still respond 200.
   */
  async handleInboundReply(ctx: ReplyContext): Promise<ReplyHandlingResult> {
    const disposition = classifyReply(ctx.body)
    const result: ReplyHandlingResult = {
      disposition,
      sequencesAttached: 0,
      suppressed: false,
      dealId: null,
      failures: []
    }

    // Step 1: attach the reply to in-flight sequences + stop further sends.
    // Isolated: a sequence-update failure must not block suppression/deal steps.
    if (ctx.prospectId) {
      try {
        const active = await this.sequences.getActiveSequenceIds(ctx.prospectId)
        for (const seq of active) {
          try {
            await this.sequences.recordReply(seq.id, ctx.communicationId, disposition)
            result.sequencesAttached += 1
          } catch (error) {
            result.failures.push(`sequence_reply_failed:${seq.id}:${this.reason(error)}`)
          }
        }
      } catch (error) {
        result.failures.push(`sequence_lookup_failed:${this.reason(error)}`)
      }
    }

    // Step 2: opt-out → suppression (TCPA / CAN-SPAM). Fail-closed on missing
    // org/identifier with a named reason rather than guessing.
    if (disposition === 'opt_out') {
      try {
        await this.recordSuppression(ctx)
        result.suppressed = true
      } catch (error) {
        result.failures.push(`suppression_failed:${this.reason(error)}`)
      }
    }

    // Step 3: positive → create a deal in the default pipeline stage. Isolated
    // so a deal-creation failure never loses the inbound communication row.
    if (disposition === 'positive') {
      try {
        const dealId = await this.createDealFromReply(ctx)
        result.dealId = dealId
      } catch (error) {
        result.failures.push(`deal_creation_failed:${this.reason(error)}`)
      }
    }

    return result
  }

  /**
   * Record a suppression entry for the channel the opt-out arrived on. Requires
   * an org and a channel-appropriate identifier; throws a named error otherwise
   * (caught and recorded by the caller — never silently dropped).
   */
  private async recordSuppression(ctx: ReplyContext): Promise<void> {
    if (!ctx.orgId) {
      throw new Error('no_org_for_suppression')
    }

    if (ctx.channel === 'email') {
      if (!ctx.fromEmail) {
        throw new Error('no_email_identifier')
      }
      await this.suppression.addToSuppressionList({
        orgId: ctx.orgId,
        email: ctx.fromEmail,
        channel: 'email',
        source: 'complaint',
        reason: 'Inbound opt-out reply (email)'
      })
      return
    }

    // SMS opt-out.
    if (!ctx.fromPhone) {
      throw new Error('no_phone_identifier')
    }
    await this.suppression.addToSuppressionList({
      orgId: ctx.orgId,
      phone: ctx.fromPhone,
      channel: 'sms',
      source: 'complaint',
      reason: 'Inbound opt-out reply (SMS)'
    })
  }

  /**
   * Create a deal from a positive reply in the org's default pipeline stage.
   * Fails closed (throws a named reason) when there is no org or no prospect to
   * anchor the deal to. DealsService.create resolves the default stage itself
   * and throws NotFoundError('DealStage','default') when the org has no stages,
   * which surfaces here as a named failure.
   */
  private async createDealFromReply(ctx: ReplyContext): Promise<string> {
    if (!ctx.orgId) {
      throw new Error('no_org_for_deal')
    }
    if (!ctx.prospectId) {
      throw new Error('no_prospect_for_deal')
    }

    const deal = await this.deals.create({
      orgId: ctx.orgId,
      prospectId: ctx.prospectId,
      contactId: ctx.contactId ?? undefined,
      priority: 'high'
    })
    return deal.id
  }

  private reason(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
