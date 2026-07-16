import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildPublicDemoSourceUrl,
  loadPublicDemoData,
  parsePublicDemoReceipt,
  resolvePublicDemoReceiptUrl
} from '../publicDemo'

const receipt = {
  schema: 'public-records.pages_public_demo_source.v1',
  receipt_id: 'austin-issued-construction-permits-3syk-w9eu',
  mode: 'read_only_live_public_data',
  source: {
    owner: 'City of Austin',
    dataset_id: '3syk-w9eu',
    dataset_name: 'Issued Construction Permits',
    dataset_page_url:
      'https://data.austintexas.gov/Building-and-Development/Issued-Construction-Permits/3syk-w9eu',
    metadata_url: 'https://data.austintexas.gov/api/views/3syk-w9eu',
    api_url: 'https://data.austintexas.gov/resource/3syk-w9eu.json'
  },
  fields: {
    record_id: 'permit_number',
    company_name: 'contractor_company_name',
    event_date: 'issue_date',
    record_type: 'permit_type_desc'
  },
  rejected_fields: ['issued_date'],
  query: { limit: 24 },
  privacy: {
    displayed_fields: [
      'permit_number',
      'contractor_company_name',
      'issue_date',
      'permit_type_desc'
    ],
    excluded_categories: ['address', 'contact', 'owner', 'applicant'],
    browser_writes: false
  }
} as const

function jsonResponse(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

describe('public Pages demo source', () => {
  afterEach(() => vi.restoreAllMocks())

  it('resolves a relative receipt below the deployed Pages base path', () => {
    expect(
      resolvePublicDemoReceiptUrl(
        'data/austin-building-permits.receipt.json',
        '/public-record-data-scrapper/',
        'https://organvm.github.io'
      )
    ).toBe(
      'https://organvm.github.io/public-record-data-scrapper/data/austin-building-permits.receipt.json'
    )
  })

  it('builds the source query from issue_date, never the obsolete issued_date alias', () => {
    const sourceUrl = decodeURIComponent(
      buildPublicDemoSourceUrl(parsePublicDemoReceipt(receipt)).replaceAll('+', ' ')
    )
    expect(sourceUrl).toContain('issue_date IS NOT NULL')
    expect(sourceUrl).toContain('issue_date DESC')
    expect(sourceUrl).not.toContain('issued_date')
  })

  it('loads a same-origin receipt then a credential-free public endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(receipt))
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              permit_number: '2026-000001 PP',
              contractor_company_name: 'Example Plumbing LLC',
              issue_date: '2026-07-16T00:00:00.000',
              permit_type_desc: 'Plumbing Permit'
            }
          ],
          { 'last-modified': 'Thu, 16 Jul 2026 12:57:51 GMT' }
        )
      )

    const data = await loadPublicDemoData(
      'https://organvm.github.io/public-record-data-scrapper/data/austin-building-permits.receipt.json',
      undefined,
      fetchImpl
    )

    expect(data.permits).toEqual([
      {
        id: '2026-000001 PP',
        companyName: 'Example Plumbing LLC',
        issueDate: '2026-07-16T00:00:00.000',
        permitType: 'Plumbing Permit'
      }
    ])
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('austin-building-permits.receipt.json'),
      expect.objectContaining({ credentials: 'same-origin' })
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('data.austintexas.gov/resource/3syk-w9eu.json'),
      expect.objectContaining({ credentials: 'omit' })
    )
  })

  it('fails closed when a non-empty source response violates the field contract', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(receipt))
      .mockResolvedValueOnce(jsonResponse([{ issued_date: '2026-07-16' }]))

    await expect(
      loadPublicDemoData('https://organvm.github.io/receipt.json', undefined, fetchImpl)
    ).rejects.toThrow('no longer matches the receipt field contract')
  })
})
