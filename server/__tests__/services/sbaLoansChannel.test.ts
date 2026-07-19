import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Rate limiter is a no-op in tests — never block / hit a real bucket.
vi.mock('@public-records/core/enrichment', () => ({
  rateLimiterManager: {
    waitForTokens: vi.fn().mockResolvedValue(undefined)
  }
}))

import { SBALoansChannel } from '../../services/discovery-channels/SBALoansChannel'
import { DiscoveryChannelError } from '../../services/discovery-channels/types'
import { rateLimiterManager } from '@public-records/core/enrichment'

const CKAN_RESOURCE_URL = 'https://data.sba.gov/dataset/x/foia-7a-fy2020-present-asof-250101.csv'

/**
 * Build a Response whose body is a streaming ReadableStream emitting `chunks`
 * (UTF-8). `cancelSpy` (if given) is invoked when the consumer cancels the
 * stream — the channel cancels once it has enough rows, so we assert on it.
 */
function streamingResponse(chunks: string[], cancelSpy?: () => void): Response {
  const encoder = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]))
      } else {
        controller.close()
      }
    },
    cancel() {
      cancelSpy?.()
    }
  })
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body
  } as unknown as Response
}

function ckanResponse(): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      result: {
        resources: [
          { format: 'CSV', url: CKAN_RESOURCE_URL, name: 'FOIA 7(a) FY2020-present' },
          { format: 'PDF', url: 'https://data.sba.gov/x/notes.pdf', name: 'notes' }
        ]
      }
    })
  } as unknown as Response
}

const HEADER =
  'asofdate,program,borrname,borrstreet,borrcity,borrstate,borrzip,bankname,grossapproval,approvaldate,naicscode,naicsdescription\n'

function row(name: string, state: string): string {
  return `2024-01-01,7a,"${name}",1 Main St,Townsville,${state},00000,Some Bank,150000,2024-01-15,722511,Full-Service Restaurants\n`
}

describe('SBALoansChannel (streaming)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(rateLimiterManager.waitForTokens).mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('always reports as configured (key-less public dataset)', () => {
    expect(new SBALoansChannel().isConfigured()).toBe(true)
  })

  it('parses candidates incrementally from a chunked streaming body', async () => {
    const csvChunks = [
      HEADER,
      row('Alpha LLC', 'CA'),
      row('Beta Inc', 'NY'),
      // A row split ACROSS two chunks exercises the buffer reassembly.
      '2024-01-01,7a,"Gamma C',
      'orp",2 Main St,City,TX,11111,Bank,90000,2024-02-01,722511,Full-Service Restaurants\n'
    ]
    fetchSpy
      .mockResolvedValueOnce(ckanResponse())
      .mockResolvedValueOnce(streamingResponse(csvChunks))

    const candidates = await new SBALoansChannel().discover({ limit: 10 })

    expect(candidates.map((c) => c.company_name)).toEqual(['Alpha LLC', 'Beta Inc', 'Gamma Corp'])
    expect(candidates[0]).toMatchObject({
      state: 'CA',
      signal_type: 'contract',
      signal_strength: 75,
      source: 'sba-7a-loans'
    })
    expect(candidates[0].raw.approval_date).toBe('2024-01-15')
  })

  it('aborts/cancels the stream once the limit is reached (does not drain the body)', async () => {
    const cancelSpy = vi.fn()
    // Many rows available, but limit=2 — the stream must be cancelled before
    // the rest are pulled.
    const rows = Array.from({ length: 50 }, (_, n) => row(`Co ${n}`, 'CA'))
    fetchSpy
      .mockResolvedValueOnce(ckanResponse())
      .mockResolvedValueOnce(streamingResponse([HEADER, ...rows], cancelSpy))

    const candidates = await new SBALoansChannel().discover({ limit: 2 })

    expect(candidates).toHaveLength(2)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('filters to the requested state', async () => {
    fetchSpy
      .mockResolvedValueOnce(ckanResponse())
      .mockResolvedValueOnce(
        streamingResponse([HEADER, row('CA Co', 'CA'), row('NY Co', 'NY'), row('CA Co 2', 'CA')])
      )

    const candidates = await new SBALoansChannel().discover({ state: 'CA', limit: 10 })

    expect(candidates.map((c) => c.company_name)).toEqual(['CA Co', 'CA Co 2'])
    expect(candidates.every((c) => c.state === 'CA')).toBe(true)
  })

  it('fails closed when the header lost a required column (schema drift)', async () => {
    const badHeader = 'asofdate,program,borrstreet,borrcity,borrstate,borrzip\n' // no borrname/approvaldate
    fetchSpy
      .mockResolvedValueOnce(ckanResponse())
      .mockResolvedValueOnce(
        streamingResponse([badHeader, '2024-01-01,7a,1 Main St,City,CA,00000\n'])
      )

    const err = await new SBALoansChannel().discover({ limit: 10 }).catch((e) => e)
    expect(err).toBeInstanceOf(DiscoveryChannelError)
    expect((err as Error).message).toMatch(/required column 'borrname' missing/)
  })

  it('fails closed on an empty CSV body', async () => {
    fetchSpy.mockResolvedValueOnce(ckanResponse()).mockResolvedValueOnce(streamingResponse(['']))

    await expect(new SBALoansChannel().discover({ limit: 10 })).rejects.toThrow(/SBA CSV was empty/)
  })

  it('fails closed on a non-2xx CSV response', async () => {
    fetchSpy.mockResolvedValueOnce(ckanResponse()).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: null
    } as unknown as Response)

    await expect(new SBALoansChannel().discover({ limit: 10 })).rejects.toThrow(
      /SBA CSV returned HTTP 503/
    )
  })

  it('falls through to the DCAT catalog when CKAN is gone (2026 Drupal migration)', async () => {
    // CKAN rung: the post-migration portal answers every /api/3/action/* with
    // an HTML 404 — modelled here as a non-2xx response.
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({})
      } as unknown as Response)
      // DCAT rung: data.json carries the dataset distribution.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          dataset: [
            { distribution: [{ format: 'pdf', downloadURL: 'https://x/notes.pdf' }] },
            {
              distribution: [
                {
                  format: 'ZIP',
                  downloadURL:
                    'https://data.sba.gov/dataset/x/foia-7a-fy2020-present-asof-250101.zip'
                },
                { mediaType: 'text/csv', downloadURL: CKAN_RESOURCE_URL }
              ]
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce(streamingResponse([HEADER, row('Dcat Co', 'CA')]))

    const candidates = await new SBALoansChannel().discover({ limit: 10 })

    expect(candidates.map((c) => c.company_name)).toEqual(['Dcat Co'])
    expect(rateLimiterManager.waitForTokens).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[2]?.[0]).toBe(CKAN_RESOURCE_URL)
  })

  it('skips a same-stem non-CSV DCAT distribution that precedes the CSV', async () => {
    const csvUrl =
      'https://data.sba.gov/dataset/x/foia-7a-fy2020-present-asof-250102.csv?download=1'
    fetchSpy
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({})
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          dataset: [
            {
              distribution: [
                {
                  format: 'XLSX',
                  mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  downloadURL:
                    'https://data.sba.gov/dataset/x/foia-7a-fy2020-present-asof-250102.xlsx'
                },
                { downloadURL: csvUrl }
              ]
            }
          ]
        })
      } as unknown as Response)
      .mockResolvedValueOnce(streamingResponse([HEADER, row('CSV Co', 'NY')]))

    const candidates = await new SBALoansChannel().discover({ limit: 10 })

    expect(candidates.map((candidate) => candidate.company_name)).toEqual(['CSV Co'])
    expect(fetchSpy.mock.calls[2]?.[0]).toBe(csvUrl)
  })

  it('fails closed with a named unavailability reason when CKAN and DCAT both lack the dataset', async () => {
    fetchSpy
      // CKAN answers but the recent-7(a) resource is gone.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          result: { resources: [{ format: 'CSV', url: 'https://x/other.csv' }] }
        })
      } as unknown as Response)
      // DCAT catalog exists but has no matching distribution.
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ dataset: [{ distribution: [{ downloadURL: 'https://x/a.csv' }] }] })
      } as unknown as Response)

    await expect(new SBALoansChannel().discover({ limit: 10 })).rejects.toThrow(
      /SBA 7\(a\) FOIA dataset unavailable/
    )
  })
})
