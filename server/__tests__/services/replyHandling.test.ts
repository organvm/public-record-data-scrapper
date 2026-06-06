import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ReplyHandlingService,
  classifyReply,
  type OutreachSequencePort,
  type SuppressionPort,
  type DealsPort,
  type ReplyContext
} from '../../services/ReplyHandlingService'

// ---------------------------------------------------------------------------
// classifyReply — deterministic, rule-based, no LLM.
// ---------------------------------------------------------------------------
describe('classifyReply', () => {
  it('classifies opt-out phrases as opt_out (precedence over everything)', () => {
    expect(classifyReply('STOP')).toBe('opt_out')
    expect(classifyReply('Please unsubscribe me')).toBe('opt_out')
    expect(classifyReply('remove me from your list')).toBe('opt_out')
    // Opt-out wins even when an interest token is also present.
    expect(classifyReply('I was interested but please remove me')).toBe('opt_out')
  })

  it('does not fire opt-out on substrings of short tokens', () => {
    // "stopwatch" must not match the bare "stop" opt-out token.
    expect(classifyReply('I bought a stopwatch yesterday')).not.toBe('opt_out')
  })

  it('classifies negative phrases as negative (before positive)', () => {
    expect(classifyReply('Not interested, thanks')).toBe('negative')
    expect(classifyReply("We're all set")).toBe('negative')
    expect(classifyReply('no thanks')).toBe('negative')
  })

  it('classifies interest phrases as positive', () => {
    expect(classifyReply('Yes, tell me more')).toBe('positive')
    expect(classifyReply('What are the rates?')).toBe('positive')
    expect(classifyReply("Let's talk — call me")).toBe('positive')
    expect(classifyReply('We are looking for funding')).toBe('positive')
  })

  it('classifies everything else as neutral', () => {
    expect(classifyReply('Out of office until Monday')).toBe('neutral')
    expect(classifyReply('')).toBe('neutral')
    expect(classifyReply('   ')).toBe('neutral')
  })
})

// ---------------------------------------------------------------------------
// ReplyHandlingService orchestration + failure isolation.
// ---------------------------------------------------------------------------
describe('ReplyHandlingService', () => {
  let sequences: {
    getActiveSequenceIds: ReturnType<typeof vi.fn>
    recordReply: ReturnType<typeof vi.fn>
  }
  let suppression: { addToSuppressionList: ReturnType<typeof vi.fn> }
  let deals: { create: ReturnType<typeof vi.fn> }
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> }
  let service: ReplyHandlingService

  const baseCtx = (over: Partial<ReplyContext>): ReplyContext => ({
    communicationId: 'comm-1',
    channel: 'email',
    orgId: 'org-1',
    contactId: 'contact-1',
    prospectId: 'prospect-1',
    companyName: 'Acme LLC',
    fromEmail: 'owner@acme.com',
    fromPhone: null,
    body: 'hello',
    ...over
  })

  beforeEach(() => {
    sequences = {
      getActiveSequenceIds: vi.fn().mockResolvedValue([]),
      recordReply: vi.fn().mockResolvedValue(undefined)
    }
    suppression = { addToSuppressionList: vi.fn().mockResolvedValue({ id: 'dnc-1' }) }
    deals = { create: vi.fn().mockResolvedValue({ id: 'deal-1' }) }
    logger = { warn: vi.fn(), error: vi.fn() }
    service = new ReplyHandlingService(
      sequences as unknown as OutreachSequencePort,
      suppression as unknown as SuppressionPort,
      deals as unknown as DealsPort,
      logger
    )
  })

  it('attaches the reply to every active sequence and stops further sends', async () => {
    sequences.getActiveSequenceIds.mockResolvedValue([
      { id: 'seq-1', triggerType: 'termination', status: 'active' },
      { id: 'seq-2', triggerType: 'new_filing', status: 'pending' }
    ])

    const result = await service.handleInboundReply(baseCtx({ body: 'just checking in' }))

    expect(result.disposition).toBe('neutral')
    expect(result.sequencesAttached).toBe(2)
    expect(sequences.recordReply).toHaveBeenCalledWith('seq-1', 'comm-1', 'neutral')
    expect(sequences.recordReply).toHaveBeenCalledWith('seq-2', 'comm-1', 'neutral')
    expect(result.failures).toHaveLength(0)
  })

  it('records suppression on opt-out (email channel)', async () => {
    const result = await service.handleInboundReply(baseCtx({ body: 'unsubscribe me please' }))

    expect(result.disposition).toBe('opt_out')
    expect(result.suppressed).toBe(true)
    expect(suppression.addToSuppressionList).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', email: 'owner@acme.com', channel: 'email' })
    )
    // Opt-out must NOT create a deal.
    expect(deals.create).not.toHaveBeenCalled()
  })

  it('records SMS suppression with the phone identifier on opt-out', async () => {
    const result = await service.handleInboundReply(
      baseCtx({ channel: 'sms', fromEmail: null, fromPhone: '+15551234567', body: 'STOP' })
    )

    expect(result.disposition).toBe('opt_out')
    expect(suppression.addToSuppressionList).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', phone: '+15551234567', channel: 'sms' })
    )
  })

  it('creates a deal on a positive reply in the default pipeline stage', async () => {
    const result = await service.handleInboundReply(
      baseCtx({ body: 'Yes! Tell me more about the rates' })
    )

    expect(result.disposition).toBe('positive')
    expect(deals.create).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', prospectId: 'prospect-1', contactId: 'contact-1' })
    )
    // No stageId passed -> DealsService resolves the org default stage.
    expect(deals.create.mock.calls[0][0].stageId).toBeUndefined()
    expect(result.dealId).toBe('deal-1')
    expect(suppression.addToSuppressionList).not.toHaveBeenCalled()
  })

  it('isolates a deal-creation failure (still records sequence attach, never throws)', async () => {
    sequences.getActiveSequenceIds.mockResolvedValue([
      { id: 'seq-1', triggerType: 'termination', status: 'active' }
    ])
    deals.create.mockRejectedValue(new Error('DealStage not found'))

    const result = await service.handleInboundReply(baseCtx({ body: 'interested, please call me' }))

    expect(result.disposition).toBe('positive')
    // Sequence attach still happened.
    expect(result.sequencesAttached).toBe(1)
    // Deal failure captured as a named, non-fatal failure.
    expect(result.dealId).toBeNull()
    expect(result.failures.some((f) => f.startsWith('deal_creation_failed:'))).toBe(true)
  })

  it('fails closed with a named reason on positive reply when org has no prospect', async () => {
    const result = await service.handleInboundReply(
      baseCtx({ prospectId: null, body: 'interested' })
    )

    expect(result.dealId).toBeNull()
    expect(result.failures).toContain('deal_creation_failed:no_prospect_for_deal')
    expect(deals.create).not.toHaveBeenCalled()
  })

  it('fails closed with a named reason on opt-out when org is unattributed', async () => {
    const result = await service.handleInboundReply(baseCtx({ orgId: null, body: 'remove me' }))

    expect(result.suppressed).toBe(false)
    expect(result.failures).toContain('suppression_failed:no_org_for_suppression')
  })

  it('does not attach sequences when prospect is unknown', async () => {
    const result = await service.handleInboundReply(baseCtx({ prospectId: null, body: 'ok' }))

    expect(sequences.getActiveSequenceIds).not.toHaveBeenCalled()
    expect(result.sequencesAttached).toBe(0)
  })
})
