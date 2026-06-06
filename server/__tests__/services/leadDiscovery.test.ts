import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the database module — every query is a controllable spy.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Use the REAL normalizeCompanyName from core (it is pure + framework-free),
// so the dedupe key matches the persisted company_name_normalized column.

import { LeadDiscoveryService } from '../../services/LeadDiscoveryService'
import { database } from '../../database/connection'
import {
  DiscoveryChannel,
  DiscoveryCandidate,
  DiscoveryParams,
  DiscoveryChannelError
} from '../../services/discovery-channels'

const mockQuery = database.query as ReturnType<typeof vi.fn>
const ORG_ID = 'org-1'

// ── Test channel helpers ───────────────────────────────────────────────────
function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    company_name: 'Acme Corp',
    state: 'CA',
    signal_type: 'permit',
    signal_strength: 60,
    source: 'test-channel',
    raw: { foo: 'bar' },
    ...overrides
  }
}

/** A channel that returns a fixed candidate list. */
class StubChannel implements DiscoveryChannel {
  constructor(
    readonly name: string,
    private readonly candidates: DiscoveryCandidate[],
    private readonly configured = true
  ) {}
  isConfigured(): boolean {
    return this.configured
  }
  async discover(params: DiscoveryParams): Promise<DiscoveryCandidate[]> {
    void params
    return this.candidates.map((c) => ({ ...c, source: this.name }))
  }
}

/** A channel that always throws a named DiscoveryChannelError. */
class FailingChannel implements DiscoveryChannel {
  constructor(
    readonly name: string,
    private readonly message: string
  ) {}
  isConfigured(): boolean {
    return true
  }
  async discover(): Promise<DiscoveryCandidate[]> {
    throw new DiscoveryChannelError(this.name, this.message)
  }
}

/**
 * Default query wiring: existence check returns empty (no dupes), inserts
 * return a fabricated id. Tests override per-case.
 */
function wireInsertsFresh() {
  mockQuery.mockImplementation((text: string) => {
    if (/SELECT id FROM prospects/.test(text)) {
      return Promise.resolve([]) // nothing exists yet
    }
    if (/INSERT INTO prospects/.test(text)) {
      return Promise.resolve([{ id: 'prospect-new' }])
    }
    return Promise.resolve([])
  })
}

describe('LeadDiscoveryService', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  describe('run() fan-out + insert', () => {
    it('fans across configured channels and inserts unique new candidates', async () => {
      wireInsertsFresh()
      const service = new LeadDiscoveryService([
        new StubChannel('sec', [candidate({ company_name: 'Alpha LLC', state: 'CA' })]),
        new StubChannel('socrata', [candidate({ company_name: 'Beta Inc', state: 'NY' })])
      ])

      const result = await service.run({ orgId: ORG_ID })

      expect(result.candidates_found).toBe(2)
      expect(result.inserted).toBe(2)
      expect(result.duplicates).toBe(0)
      expect(result.per_channel).toEqual([
        { channel: 'sec', configured: true, candidates_found: 1, error: null },
        { channel: 'socrata', configured: true, candidates_found: 1, error: null }
      ])

      // Each insert writes a prospects row AND a growth_signals row.
      const queries = mockQuery.mock.calls.map((c) => String(c[0]))
      expect(queries.filter((q) => /INSERT INTO prospects/.test(q)).length).toBe(2)
      expect(queries.filter((q) => /INSERT INTO growth_signals/.test(q)).length).toBe(2)
    })

    it('inserts prospects with status new, unscored priority, and org scoping', async () => {
      wireInsertsFresh()
      const service = new LeadDiscoveryService([
        new StubChannel('sec', [candidate({ company_name: 'Gamma Co', state: 'TX' })])
      ])

      await service.run({ orgId: ORG_ID })

      const insertCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO prospects/.test(String(c[0]))
      )
      expect(insertCall).toBeDefined()
      const sql = String(insertCall![0])
      const params = insertCall![1] as unknown[]
      // status literal 'new' baked into the SQL; priority sentinel 0; org first.
      expect(sql).toContain("'new'")
      expect(params[0]).toBe(ORG_ID) // org_id
      expect(params[1]).toBe('Gamma Co') // company_name
      expect(params[3]).toBe('TX') // state (uppercased)
      expect(params[4]).toBe(0) // unscored priority_score sentinel
      // No raw_data column on prospects → provenance rides on narrative.
      expect(sql).toContain('narrative')
      expect(sql).not.toContain('raw_data')
      expect(String(params[5])).toMatch(/Discovered via sec/)
    })

    it('writes the discovery signal with the candidate signal_type + strength', async () => {
      wireInsertsFresh()
      const service = new LeadDiscoveryService([
        new StubChannel('sba', [
          candidate({
            company_name: 'Delta LLC',
            state: 'FL',
            signal_type: 'contract',
            signal_strength: 75
          })
        ])
      ])

      await service.run({ orgId: ORG_ID })

      const signalCall = mockQuery.mock.calls.find((c) =>
        /INSERT INTO growth_signals/.test(String(c[0]))
      )
      expect(signalCall).toBeDefined()
      const params = signalCall![1] as unknown[]
      expect(params[0]).toBe('prospect-new') // prospect_id from RETURNING
      expect(params[1]).toBe('contract') // type
      expect(params[4]).toBe(75) // score = signal_strength
      // raw_data carries the source + verbatim upstream payload.
      const raw = JSON.parse(String(params[6]))
      expect(raw.source).toBe('sba')
      expect(raw.raw).toEqual({ foo: 'bar' })
    })
  })

  describe('dedupe', () => {
    it('collapses duplicates ACROSS channels on normalized name + state', async () => {
      wireInsertsFresh()
      // "Acme Corp" vs "ACME, Corp." normalize to the same key in CA.
      const service = new LeadDiscoveryService([
        new StubChannel('sec', [candidate({ company_name: 'Acme Corp', state: 'CA' })]),
        new StubChannel('socrata', [candidate({ company_name: 'ACME, Corp.', state: 'CA' })])
      ])

      const result = await service.run({ orgId: ORG_ID })

      expect(result.candidates_found).toBe(2)
      expect(result.inserted).toBe(1)
      expect(result.duplicates).toBe(1)
      const inserts = mockQuery.mock.calls.filter((c) => /INSERT INTO prospects/.test(String(c[0])))
      expect(inserts.length).toBe(1)
    })

    it('dedupes against existing prospects already in the database', async () => {
      mockQuery.mockImplementation((text: string) => {
        if (/SELECT id FROM prospects/.test(text)) {
          return Promise.resolve([{ id: 'existing-prospect' }]) // already exists
        }
        if (/INSERT INTO prospects/.test(text)) {
          return Promise.resolve([{ id: 'prospect-new' }])
        }
        return Promise.resolve([])
      })
      const service = new LeadDiscoveryService([
        new StubChannel('sec', [candidate({ company_name: 'Existing LLC', state: 'CA' })])
      ])

      const result = await service.run({ orgId: ORG_ID })

      expect(result.candidates_found).toBe(1)
      expect(result.inserted).toBe(0)
      expect(result.duplicates).toBe(1)
      // The existence check uses the org + normalized name + state.
      const existsCall = mockQuery.mock.calls.find((c) =>
        /SELECT id FROM prospects/.test(String(c[0]))
      )
      const params = existsCall![1] as unknown[]
      expect(params[0]).toBe(ORG_ID)
      expect(params[1]).toBe('existing') // normalizeCompanyName('Existing LLC')
      expect(params[2]).toBe('CA')
      // Nothing inserted.
      expect(mockQuery.mock.calls.some((c) => /INSERT INTO prospects/.test(String(c[0])))).toBe(
        false
      )
    })
  })

  describe('fail-closed channel behavior', () => {
    it('records a named per-channel error and still inserts from healthy channels', async () => {
      wireInsertsFresh()
      const service = new LeadDiscoveryService([
        new FailingChannel('sba', 'SBA CSV returned HTTP 503 Service Unavailable'),
        new StubChannel('sec', [candidate({ company_name: 'Healthy Co', state: 'CA' })])
      ])

      const result = await service.run({ orgId: ORG_ID })

      const sba = result.per_channel.find((r) => r.channel === 'sba')!
      expect(sba.error).toBe('sba: SBA CSV returned HTTP 503 Service Unavailable')
      expect(sba.candidates_found).toBe(0)
      // Healthy channel still produced an insert.
      expect(result.inserted).toBe(1)
    })

    it('reports unconfigured channels and does not call discover()', async () => {
      wireInsertsFresh()
      const stub = new StubChannel('sec', [candidate()], /* configured */ false)
      const discoverSpy = vi.spyOn(stub, 'discover')
      const service = new LeadDiscoveryService([stub])

      const result = await service.run({ orgId: ORG_ID })

      expect(discoverSpy).not.toHaveBeenCalled()
      const sec = result.per_channel.find((r) => r.channel === 'sec')!
      expect(sec.configured).toBe(false)
      expect(sec.error).toBe('sec: not configured')
      expect(result.inserted).toBe(0)
    })

    it('inserts NOTHING when ALL channels fail', async () => {
      wireInsertsFresh()
      const service = new LeadDiscoveryService([
        new FailingChannel('sec', 'SEC EDGAR unreachable: network down'),
        new FailingChannel('socrata', 'Socrata (NY) returned HTTP 500 Internal Server Error'),
        new FailingChannel('sba', 'SBA dataset changed: recent 7(a) CSV resource not found')
      ])

      const result = await service.run({ orgId: ORG_ID })

      expect(result.candidates_found).toBe(0)
      expect(result.inserted).toBe(0)
      expect(result.per_channel.every((r) => r.error !== null)).toBe(true)
      // No INSERT of any kind was issued.
      expect(mockQuery.mock.calls.some((c) => /INSERT INTO/.test(String(c[0])))).toBe(false)
    })
  })

  describe('channel selection', () => {
    it('restricts the run to requested channel names', async () => {
      wireInsertsFresh()
      const secSpy = new StubChannel('sec', [candidate({ company_name: 'Sec Co', state: 'CA' })])
      const sbaSpy = new StubChannel('sba', [candidate({ company_name: 'Sba Co', state: 'CA' })])
      const secDiscover = vi.spyOn(secSpy, 'discover')
      const sbaDiscover = vi.spyOn(sbaSpy, 'discover')
      const service = new LeadDiscoveryService([secSpy, sbaSpy])

      const result = await service.run({ orgId: ORG_ID, channels: ['sec'] })

      expect(secDiscover).toHaveBeenCalledTimes(1)
      expect(sbaDiscover).not.toHaveBeenCalled()
      expect(result.per_channel.map((r) => r.channel)).toEqual(['sec'])
    })

    it('passes state and limit through to channels', async () => {
      wireInsertsFresh()
      const stub = new StubChannel('sec', [candidate()])
      const spy = vi.spyOn(stub, 'discover')
      const service = new LeadDiscoveryService([stub])

      await service.run({ orgId: ORG_ID, state: 'NY', limit: 5 })

      expect(spy).toHaveBeenCalledWith({ state: 'NY', limit: 5 })
    })
  })

  describe('listChannels', () => {
    it('reports each channel name and configured state', () => {
      const service = new LeadDiscoveryService([
        new StubChannel('sec', [], true),
        new StubChannel('sba', [], false)
      ])
      expect(service.listChannels()).toEqual([
        { name: 'sec', configured: true },
        { name: 'sba', configured: false }
      ])
    })
  })

  describe('guards', () => {
    it('throws when orgId is missing', async () => {
      const service = new LeadDiscoveryService([new StubChannel('sec', [])])
      await expect(service.run({ orgId: '' })).rejects.toThrow(/orgId/)
    })
  })
})
