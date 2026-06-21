import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock the shared enrichment data-source layer so tests NEVER hit live public
// APIs. Each source's `fetchData` is a controllable mock that mimics the
// DataSourceResponse contract (success/data or success:false/error).
const sourceMocks = vi.hoisted(() => ({
  sec: vi.fn(),
  osha: vi.fn(),
  uspto: vi.fn(),
  census: vi.fn()
}))

vi.mock('@public-records/core/enrichment', () => ({
  SECEdgarSource: class {
    fetchData = sourceMocks.sec
  },
  OSHASource: class {
    fetchData = sourceMocks.osha
  },
  USPTOSource: class {
    fetchData = sourceMocks.uspto
  },
  CensusSource: class {
    fetchData = sourceMocks.census
  }
}))

// Mock the queue accessor used by getQueueStatus.
const queueMocks = vi.hoisted(() => ({
  getEnrichmentQueue: vi.fn()
}))
vi.mock('../../queue/queues', () => ({
  getEnrichmentQueue: queueMocks.getEnrichmentQueue
}))

import { EnrichmentService } from '../../services/EnrichmentService'
import { database } from '../../database/connection'

const mockQuery = database.query as ReturnType<typeof vi.fn>

// DataSourceResponse helpers ------------------------------------------------
function ok(source: string, data: Record<string, unknown>) {
  return {
    success: true,
    data,
    source,
    timestamp: new Date().toISOString(),
    responseTime: 1
  }
}
function fail(source: string, error: string) {
  return {
    success: false,
    error,
    source,
    timestamp: new Date().toISOString(),
    responseTime: 1
  }
}

const PROSPECT = {
  id: 'prospect-1',
  company_name: 'Test Corp',
  industry: 'technology',
  state: 'CA'
}

/**
 * Wire mockQuery so the initial `SELECT * FROM prospects WHERE id` returns the
 * given prospect row and every subsequent INSERT/UPDATE resolves empty.
 */
function withProspect(row: Record<string, unknown> | null = PROSPECT) {
  mockQuery.mockImplementation((text: string) => {
    if (/SELECT \* FROM prospects WHERE id/.test(text)) {
      return Promise.resolve(row ? [row] : [])
    }
    return Promise.resolve([])
  })
}

describe('EnrichmentService', () => {
  let service: EnrichmentService

  beforeEach(() => {
    mockQuery.mockReset()
    sourceMocks.sec.mockReset()
    sourceMocks.osha.mockReset()
    sourceMocks.uspto.mockReset()
    sourceMocks.census.mockReset()
    queueMocks.getEnrichmentQueue.mockReset()
    service = new EnrichmentService()
  })

  describe('enrichProspect', () => {
    it('persists real enrichment fields when sources succeed', async () => {
      withProspect()
      sourceMocks.sec.mockResolvedValue(
        ok('sec-edgar', { cik: '123', filings: [{ form: '10-K' }, { form: '8-K' }] })
      )
      sourceMocks.osha.mockResolvedValue(
        ok('osha', { violations: 2, totalPenalties: 5000, recentViolations: [{ x: 1 }] })
      )
      sourceMocks.uspto.mockResolvedValue(ok('uspto', { trademarkCount: 3, trademarks: [] }))
      sourceMocks.census.mockResolvedValue(
        ok('census', { businessCount: 100, totalEmployees: 5000, totalPayroll: 250000000 })
      )

      const result = await service.enrichProspect('prospect-1')

      // Returns real, source-derived data (no fabrication).
      expect(result.data_sources_used).toEqual(
        expect.arrayContaining(['sec-edgar', 'osha', 'uspto', 'census'])
      )
      expect(result.source_errors).toEqual([])
      expect(result.confidence).toBe(1)
      expect(result.health_score.violations).toBe(2)
      expect(result.growth_signals.contracts).toBe(2) // 2 SEC filings
      expect(result.growth_signals.expansion).toBe(3) // 3 trademarks
      expect(result.estimated_revenue).toBe(250000000)

      const queries = mockQuery.mock.calls.map((c) => String(c[0]))
      // Persisted growth signals, a health score, an enrichment log and the
      // prospect enrichment metadata.
      expect(queries.some((q) => /INSERT INTO growth_signals/.test(q))).toBe(true)
      expect(queries.some((q) => /INSERT INTO health_scores/.test(q))).toBe(true)
      expect(queries.some((q) => /INSERT INTO enrichment_logs/.test(q))).toBe(true)
      expect(queries.some((q) => /UPDATE prospects/.test(q))).toBe(true)

      // enrichment_logs row recorded as success.
      const logCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO enrichment_logs/.test(String(c[0]))
      )
      expect(logCall?.[1]?.[1]).toBe('success')
    })

    it('surfaces named errors on partial source failure but persists what succeeded', async () => {
      withProspect()
      // SEC + OSHA succeed; USPTO + Census fail with named errors.
      sourceMocks.sec.mockResolvedValue(
        ok('sec-edgar', { cik: '123', filings: [{ form: '10-K' }] })
      )
      sourceMocks.osha.mockResolvedValue(
        ok('osha', { violations: 0, totalPenalties: 0, recentViolations: [] })
      )
      sourceMocks.uspto.mockResolvedValue(fail('uspto', 'USPTO API error: Service Unavailable'))
      sourceMocks.census.mockResolvedValue(fail('census', 'Census API error: Bad Request'))

      const result = await service.enrichProspect('prospect-1')

      expect(result.data_sources_used).toEqual(expect.arrayContaining(['sec-edgar', 'osha']))
      expect(result.data_sources_used).not.toContain('uspto')
      expect(result.source_errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining('uspto: USPTO API error'),
          expect.stringContaining('census: Census API error')
        ])
      )
      expect(result.confidence).toBeCloseTo(0.5, 5) // 2 of 4 sources succeeded

      const queries = mockQuery.mock.calls.map((c) => String(c[0]))
      // OSHA succeeded → health score persisted; SEC succeeded → growth signal.
      expect(queries.some((q) => /INSERT INTO health_scores/.test(q))).toBe(true)
      expect(queries.some((q) => /INSERT INTO growth_signals/.test(q))).toBe(true)
      // Census failed → no estimated_revenue update (still updates metadata).
      expect(queries.some((q) => /UPDATE prospects/.test(q))).toBe(true)
      expect(result.estimated_revenue).toBe(0)

      // enrichment_logs row recorded as partial.
      const logCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO enrichment_logs/.test(String(c[0]))
      )
      expect(logCall?.[1]?.[1]).toBe('partial')
    })

    it('fails the job with aggregated reasons when ALL sources fail (no fabricated data persisted)', async () => {
      withProspect()
      sourceMocks.sec.mockResolvedValue(fail('sec-edgar', 'SEC API error: Forbidden'))
      sourceMocks.osha.mockResolvedValue(fail('osha', 'OSHA API error: Timeout'))
      sourceMocks.uspto.mockResolvedValue(fail('uspto', 'USPTO API error: 500'))
      sourceMocks.census.mockResolvedValue(fail('census', 'Census API error: 503'))

      await expect(service.enrichProspect('prospect-1')).rejects.toThrow(
        /Enrichment failed for prospect prospect-1/
      )

      const queries = mockQuery.mock.calls.map((c) => String(c[0]))
      // No fabricated data persisted to signals / health / prospects.
      expect(queries.some((q) => /INSERT INTO growth_signals/.test(q))).toBe(false)
      expect(queries.some((q) => /INSERT INTO health_scores/.test(q))).toBe(false)
      expect(queries.some((q) => /UPDATE prospects/.test(q))).toBe(false)
      // A failed enrichment_logs row IS recorded.
      const logCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO enrichment_logs/.test(String(c[0]))
      )
      expect(logCall?.[1]?.[1]).toBe('failed')
    })

    it('throws and queries no sources for a non-existent prospect', async () => {
      withProspect(null)

      await expect(service.enrichProspect('non-existent')).rejects.toThrow('Prospect')
      expect(sourceMocks.sec).not.toHaveBeenCalled()
      expect(sourceMocks.census).not.toHaveBeenCalled()
    })
  })

  describe('enrichBatch', () => {
    it('reports per-prospect success/failure without stopping the batch', async () => {
      mockQuery.mockImplementation((text: string, params?: unknown[]) => {
        if (/SELECT \* FROM prospects WHERE id/.test(text)) {
          const id = (params as string[])?.[0]
          // First prospect exists, second does not.
          return Promise.resolve(id === 'prospect-1' ? [PROSPECT] : [])
        }
        return Promise.resolve([])
      })
      // First prospect succeeds via SEC.
      sourceMocks.sec.mockResolvedValue(ok('sec-edgar', { cik: '1', filings: [{ form: '10-K' }] }))
      sourceMocks.osha.mockResolvedValue(ok('osha', { violations: 0 }))
      sourceMocks.uspto.mockResolvedValue(ok('uspto', { trademarkCount: 0 }))
      sourceMocks.census.mockResolvedValue(ok('census', { totalPayroll: 0 }))

      const results = await service.enrichBatch(['prospect-1', 'non-existent'])

      expect(results.length).toBe(2)
      expect(results[0]).toEqual({ prospect_id: 'prospect-1', success: true })
      expect(results[1].success).toBe(false)
      expect(results[1].error).toMatch(/not found/i)
    })

    it('should return empty array for empty input', async () => {
      const results = await service.enrichBatch([])
      expect(results).toEqual([])
    })
  })

  describe('triggerRefresh', () => {
    it('should query for unenriched prospects', async () => {
      mockQuery.mockResolvedValue([])

      await service.triggerRefresh(false)

      const firstCall = mockQuery.mock.calls[0]
      expect(firstCall[0]).toContain('SELECT id FROM prospects')
      expect(firstCall[0]).toContain('LIMIT 100')
    })

    it('should query all prospects when force=true', async () => {
      mockQuery.mockResolvedValue([])

      await service.triggerRefresh(true)

      const firstCall = mockQuery.mock.calls[0]
      expect(firstCall[0]).toContain('SELECT id FROM prospects')
      expect(firstCall[0]).not.toContain('WHERE')
    })

    it('should return zero counts when no prospects need refresh', async () => {
      mockQuery.mockResolvedValueOnce([])

      const result = await service.triggerRefresh(false)

      expect(result.queued).toBe(0)
      expect(result.successful).toBe(0)
      expect(result.failed).toBe(0)
    })
  })

  describe('getStatus', () => {
    it('should return enrichment pipeline status', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          total_prospects: 8,
          enriched_count: 3,
          unenriched_count: 5,
          stale_count: 1,
          avg_confidence: 0.85
        }
      ])

      const status = await service.getStatus()

      expect(status.total_prospects).toBe(8)
      expect(status.enriched_count).toBe(3)
      expect(status.unenriched_count).toBe(5)
    })

    it('should return defaults when query returns empty', async () => {
      mockQuery.mockResolvedValueOnce([])

      const status = await service.getStatus()

      expect(status.total_prospects).toBe(0)
      expect(status.enriched_count).toBe(0)
      expect(status.avg_confidence).toBe(0)
    })
  })

  describe('getQueueStatus', () => {
    it('reports real job counts when the queue is initialized', async () => {
      queueMocks.getEnrichmentQueue.mockReturnValue({
        getJobCounts: vi.fn().mockResolvedValue({
          waiting: 5,
          active: 2,
          completed: 100,
          failed: 3,
          delayed: 1
        })
      })

      const status = await service.getQueueStatus()

      expect(status.supported).toBe(true)
      expect(status.waiting).toBe(5)
      expect(status.active).toBe(2)
      expect(status.completed).toBe(100)
      expect(status.failed).toBe(3)
      expect(status.delayed).toBe(1)
    })

    it('reports honest unsupported when the queue is not initialized', async () => {
      queueMocks.getEnrichmentQueue.mockImplementation(() => {
        throw new Error('Enrichment queue not initialized. Call initializeQueues() first.')
      })

      const status = await service.getQueueStatus()

      expect(status.supported).toBe(false)
      expect(status.reason).toMatch(/not initialized/i)
      expect(status.waiting).toBeNull()
      expect(status.active).toBeNull()
    })
  })
})
