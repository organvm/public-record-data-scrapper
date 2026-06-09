import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OutreachSequenceService } from '../../services/OutreachSequenceService'

/**
 * Focused coverage for OutreachSequenceService.recordReply transactionality.
 *
 * recordReply marks a sequence terminal and skips its remaining steps. These two
 * writes must be atomic (a crash between them would leave a "cancelled" sequence
 * with live pending steps the worker keeps sending), and the matched/no-match
 * outcome must be observable so the caller does not claim a phantom attachment.
 *
 * `recordReplyResult` carries the boolean outcome (used here for assertions);
 * `recordReply` is the void-typed wrapper the ReplyHandlingService port calls,
 * which logs a named warning on a no-match.
 *
 * Two execution paths are exercised:
 *   - pool-client path: BEGIN/COMMIT on one connection, rowCount-gated.
 *   - fallback path: sequential db.query (no getPoolClient), rows-length-gated.
 */
describe('OutreachSequenceService.recordReply', () => {
  describe('transactional path (getPoolClient present)', () => {
    let clientQuery: ReturnType<typeof vi.fn>
    let release: ReturnType<typeof vi.fn>
    let getPoolClient: ReturnType<typeof vi.fn>
    let service: OutreachSequenceService

    beforeEach(() => {
      clientQuery = vi.fn()
      release = vi.fn()
      getPoolClient = vi.fn().mockResolvedValue({ query: clientQuery, release })
      // query() is only used by the fallback path; provide a stub so the type
      // is satisfied but assert below that it is never touched here.
      const db = { query: vi.fn(), getPoolClient }
      service = new OutreachSequenceService(db as never)
    })

    it('commits both UPDATEs on one connection and returns true when the sequence matches', async () => {
      clientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'seq-1' }] }) // sequence UPDATE
        .mockResolvedValueOnce({ rowCount: 3, rows: [] }) // steps UPDATE
        .mockResolvedValueOnce(undefined) // COMMIT

      const result = await service.recordReplyResult('seq-1', 'comm-1', 'neutral')

      expect(result).toBe(true)

      const order = clientQuery.mock.calls.map((c) => c[0])
      expect(order[0]).toBe('BEGIN')
      expect(order[1]).toMatch(/UPDATE outreach_sequences/)
      expect(order[1]).toMatch(/RETURNING id/)
      expect(order[2]).toMatch(/UPDATE outreach_steps SET status = 'skipped'/)
      expect(order[3]).toBe('COMMIT')

      // Reply provenance is stamped into the merged metadata JSON.
      const seqParams = clientQuery.mock.calls[1][1] as [string, string]
      expect(seqParams[0]).toBe('seq-1')
      const meta = JSON.parse(seqParams[1]) as Record<string, unknown>
      expect(meta.reply_communication_id).toBe('comm-1')
      expect(meta.reply_disposition).toBe('neutral')
      expect(typeof meta.replied_at).toBe('string')

      expect(release).toHaveBeenCalledOnce()
    })

    it('rolls back and returns false when no sequence row matches (rowCount 0)', async () => {
      clientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // sequence UPDATE — no match
        .mockResolvedValueOnce(undefined) // ROLLBACK

      const result = await service.recordReplyResult('unknown-seq', 'comm-1', 'neutral')

      expect(result).toBe(false)

      const order = clientQuery.mock.calls.map((c) => c[0])
      expect(order[0]).toBe('BEGIN')
      expect(order[1]).toMatch(/UPDATE outreach_sequences/)
      expect(order[2]).toBe('ROLLBACK')
      // The steps UPDATE must NOT run when the sequence did not match.
      expect(order.some((sql) => /UPDATE outreach_steps/.test(sql))).toBe(false)
      expect(release).toHaveBeenCalledOnce()
    })

    it('rolls back, rethrows, and releases the client when the steps UPDATE fails', async () => {
      const boom = new Error('steps update failed')
      clientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'seq-1' }] }) // sequence UPDATE
        .mockRejectedValueOnce(boom) // steps UPDATE throws
        .mockResolvedValueOnce(undefined) // ROLLBACK

      await expect(service.recordReplyResult('seq-1', 'comm-1', 'positive')).rejects.toThrow(
        'steps update failed'
      )

      const order = clientQuery.mock.calls.map((c) => c[0])
      expect(order).toContain('ROLLBACK')
      expect(order).not.toContain('COMMIT')
      expect(release).toHaveBeenCalledOnce()
    })
  })

  describe('fallback path (no getPoolClient — unit fakes)', () => {
    let query: ReturnType<typeof vi.fn>
    let service: OutreachSequenceService

    beforeEach(() => {
      query = vi.fn()
      service = new OutreachSequenceService({ query })
    })

    it('runs the two UPDATEs sequentially and returns true when a row is returned', async () => {
      query
        .mockResolvedValueOnce([{ id: 'seq-1' }]) // sequence UPDATE RETURNING id
        .mockResolvedValueOnce([]) // steps UPDATE

      const result = await service.recordReplyResult('seq-1', 'comm-1', 'neutral')

      expect(result).toBe(true)
      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[0][0]).toMatch(/UPDATE outreach_sequences/)
      expect(query.mock.calls[1][0]).toMatch(/UPDATE outreach_steps SET status = 'skipped'/)
    })

    it('returns false when no sequence row is returned, but still runs both UPDATEs', async () => {
      query
        .mockResolvedValueOnce([]) // sequence UPDATE — no row matched
        .mockResolvedValueOnce([]) // steps UPDATE still runs (preserves query-count contract)

      const result = await service.recordReplyResult('unknown-seq', null, 'neutral')

      expect(result).toBe(false)
      // Both writes run in the fallback path (no transaction to roll back); the
      // boolean is derived from the sequence UPDATE's returned rows. Keeping the
      // steps UPDATE preserves the two-query contract consumers rely on.
      expect(query).toHaveBeenCalledTimes(2)
      expect(query.mock.calls[0][0]).toMatch(/UPDATE outreach_sequences/)
      expect(query.mock.calls[1][0]).toMatch(/UPDATE outreach_steps SET status = 'skipped'/)
    })
  })

  describe('recordReply (void wrapper — the OutreachSequencePort contract)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('resolves to void (no value) and stays silent when a sequence matched', async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce([{ id: 'seq-1' }]) // sequence UPDATE matched
        .mockResolvedValueOnce([]) // steps UPDATE
      const service = new OutreachSequenceService({ query })

      const result = await service.recordReply('seq-1', 'comm-1', 'neutral')

      expect(result).toBeUndefined()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('emits a named warning (no throw) when no in-flight sequence matched', async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce([]) // sequence UPDATE — no match
        .mockResolvedValueOnce([]) // steps UPDATE
      const service = new OutreachSequenceService({ query })

      const result = await service.recordReply('unknown-seq', 'comm-1', 'opt_out')

      expect(result).toBeUndefined()
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0][0]).toMatch(/matched no in-flight sequence/)
      expect(warnSpy.mock.calls[0][1]).toMatchObject({
        sequenceId: 'unknown-seq',
        disposition: 'opt_out'
      })
    })
  })
})
