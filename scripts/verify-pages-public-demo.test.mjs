import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildDataUrl,
  validateReceipt,
  verifyPublicDemoSource
} from './verify-pages-public-demo.mjs'

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
    browser_writes: false
  }
}

function jsonResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      ...headers
    }
  })
}

test('Pages deployment watches every receipt verification input', async () => {
  const workflow = await readFile('.github/workflows/deploy-pages.yml', 'utf8')
  assert.match(workflow, /- 'scripts\/verify-pages-public-demo\.mjs'/)
  assert.match(workflow, /- 'scripts\/verify-pages-public-demo\.test\.mjs'/)
})

test('builds the live query from issue_date and never the obsolete issued_date alias', () => {
  const url = decodeURIComponent(buildDataUrl(validateReceipt(receipt)).replaceAll('+', ' '))
  assert.match(url, /issue_date IS NOT NULL/)
  assert.match(url, /issue_date DESC/)
  assert.doesNotMatch(url, /issued_date/)
})

test('verifies metadata, endpoint rows, and browser-readable CORS', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/views/')) {
      return jsonResponse({
        id: '3syk-w9eu',
        columns: Object.values(receipt.fields).map((fieldName) => ({ fieldName }))
      })
    }
    return jsonResponse([
      {
        permit_number: '2026-000001 PP',
        contractor_company_name: 'Example Plumbing LLC',
        issue_date: '2026-07-16T00:00:00.000',
        permit_type_desc: 'Plumbing Permit'
      }
    ])
  }

  const result = await verifyPublicDemoSource(receipt, { fetchImpl })
  assert.equal(result.status, 'pass')
  assert.equal(result.event_date_field, 'issue_date')
  assert.deepEqual(result.rejected_fields_absent, ['issued_date'])
  assert.equal(result.rows_matching_contract, 1)
})

test('fails closed when the source omits a Pages-readable CORS header', async () => {
  const fetchImpl = async () =>
    jsonResponse(
      { id: '3syk-w9eu', columns: [] },
      { 'access-control-allow-origin': 'https://not-the-pages-origin.example' }
    )

  await assert.rejects(
    verifyPublicDemoSource(receipt, { fetchImpl }),
    /does not allow the Pages origin/
  )
})

test('fails closed if metadata starts exposing a rejected schema alias', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/api/views/')) {
      return jsonResponse({
        id: '3syk-w9eu',
        columns: [...Object.values(receipt.fields), 'issued_date'].map((fieldName) => ({
          fieldName
        }))
      })
    }
    return jsonResponse([])
  }

  await assert.rejects(
    verifyPublicDemoSource(receipt, { fetchImpl }),
    /unexpectedly exposes rejected fields: issued_date/
  )
})
