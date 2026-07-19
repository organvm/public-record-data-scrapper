#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RECEIPT_SCHEMA = 'public-records.pages_public_demo_source.v1'
const DEFAULT_PAGES_ORIGIN = 'https://organvm.github.io'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value.trim()
}

function httpsUrl(value, label) {
  const parsed = new URL(nonEmptyString(value, label))
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS`)
  return parsed
}

export function validateReceipt(value) {
  if (!isRecord(value) || value.schema !== RECEIPT_SCHEMA) {
    throw new Error(`Receipt schema must be ${RECEIPT_SCHEMA}`)
  }
  if (value.mode !== 'read_only_live_public_data') {
    throw new Error('Receipt must declare read_only_live_public_data mode')
  }
  if (!isRecord(value.source) || !isRecord(value.fields) || !isRecord(value.query)) {
    throw new Error('Receipt source, fields, and query must be objects')
  }
  if (!isRecord(value.privacy) || value.privacy.browser_writes !== false) {
    throw new Error('Receipt must explicitly deny browser writes')
  }

  const datasetId = nonEmptyString(value.source.dataset_id, 'source.dataset_id')
  const apiUrl = httpsUrl(value.source.api_url, 'source.api_url')
  const metadataUrl = httpsUrl(value.source.metadata_url, 'source.metadata_url')
  const datasetPageUrl = httpsUrl(value.source.dataset_page_url, 'source.dataset_page_url')
  if (!apiUrl.pathname.endsWith(`/resource/${datasetId}.json`)) {
    throw new Error('source.api_url does not match source.dataset_id')
  }
  if (!metadataUrl.pathname.endsWith(`/api/views/${datasetId}`)) {
    throw new Error('source.metadata_url does not match source.dataset_id')
  }
  if (apiUrl.hostname !== metadataUrl.hostname || apiUrl.hostname !== datasetPageUrl.hostname) {
    throw new Error('Source URLs must share one owner hostname')
  }

  const fields = {
    record_id: nonEmptyString(value.fields.record_id, 'fields.record_id'),
    company_name: nonEmptyString(value.fields.company_name, 'fields.company_name'),
    event_date: nonEmptyString(value.fields.event_date, 'fields.event_date'),
    record_type: nonEmptyString(value.fields.record_type, 'fields.record_type')
  }
  const fieldPattern = /^[a-z][a-z0-9_]*$/
  if (Object.values(fields).some((field) => !fieldPattern.test(field))) {
    throw new Error('Receipt contains an unsafe source field')
  }

  if (!Array.isArray(value.rejected_fields)) {
    throw new Error('rejected_fields must be an array')
  }
  const rejectedFields = value.rejected_fields.map((field) =>
    nonEmptyString(field, 'rejected_fields entry')
  )
  if (rejectedFields.some((field) => !fieldPattern.test(field))) {
    throw new Error('rejected_fields contains an unsafe field')
  }
  if (rejectedFields.includes(fields.event_date)) {
    throw new Error('Event-date field cannot also be rejected')
  }

  if (
    !Array.isArray(value.privacy.displayed_fields) ||
    value.privacy.displayed_fields.some((field) => typeof field !== 'string')
  ) {
    throw new Error('privacy.displayed_fields must be an array of strings')
  }
  if (Object.values(fields).some((field) => !value.privacy.displayed_fields.includes(field))) {
    throw new Error('privacy.displayed_fields must cover every selected source field')
  }

  const limit = value.query.limit
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('query.limit must be an integer from 1 to 50')
  }

  return {
    ...value,
    source: {
      ...value.source,
      dataset_id: datasetId,
      api_url: apiUrl.toString(),
      metadata_url: metadataUrl.toString(),
      dataset_page_url: datasetPageUrl.toString()
    },
    fields,
    rejected_fields: rejectedFields,
    query: { ...value.query, limit }
  }
}

export function buildDataUrl(receipt) {
  const params = new URLSearchParams({
    $select: Object.values(receipt.fields).join(','),
    $where: `${receipt.fields.company_name} IS NOT NULL AND ${receipt.fields.event_date} IS NOT NULL`,
    $order: `${receipt.fields.event_date} DESC`,
    $limit: String(receipt.query.limit)
  })
  return `${receipt.source.api_url}?${params.toString()}`
}

function assertCors(response, label, pagesOrigin) {
  const allowOrigin = response.headers.get('access-control-allow-origin')
  if (allowOrigin !== '*' && allowOrigin !== pagesOrigin) {
    throw new Error(
      `${label} does not allow the Pages origin (got ${allowOrigin ?? 'no CORS header'})`
    )
  }
  return allowOrigin
}

async function fetchJson(fetchImpl, url, label, pagesOrigin) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', Origin: pagesOrigin },
    signal: AbortSignal.timeout(12000)
  })
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${label} returned non-JSON content`)
  }
  const cors = assertCors(response, label, pagesOrigin)
  return { body: await response.json(), cors }
}

export async function verifyPublicDemoSource(
  rawReceipt,
  { fetchImpl = fetch, pagesOrigin = DEFAULT_PAGES_ORIGIN } = {}
) {
  const receipt = validateReceipt(rawReceipt)
  const metadataResult = await fetchJson(
    fetchImpl,
    receipt.source.metadata_url,
    'Socrata metadata endpoint',
    pagesOrigin
  )
  if (!isRecord(metadataResult.body) || metadataResult.body.id !== receipt.source.dataset_id) {
    throw new Error('Metadata endpoint returned the wrong dataset')
  }
  if (!Array.isArray(metadataResult.body.columns)) {
    throw new Error('Metadata endpoint omitted its columns contract')
  }
  const liveFields = new Set(
    metadataResult.body.columns
      .filter(isRecord)
      .map((column) => column.fieldName)
      .filter((field) => typeof field === 'string')
  )
  const requiredFields = Object.values(receipt.fields)
  const missingFields = requiredFields.filter((field) => !liveFields.has(field))
  if (missingFields.length > 0) {
    throw new Error(`Metadata endpoint is missing required fields: ${missingFields.join(', ')}`)
  }
  const obsoleteFieldsPresent = receipt.rejected_fields.filter((field) => liveFields.has(field))
  if (obsoleteFieldsPresent.length > 0) {
    throw new Error(
      `Metadata endpoint unexpectedly exposes rejected fields: ${obsoleteFieldsPresent.join(', ')}`
    )
  }

  const sourceUrl = buildDataUrl(receipt)
  const dataResult = await fetchJson(fetchImpl, sourceUrl, 'Socrata resource endpoint', pagesOrigin)
  if (!Array.isArray(dataResult.body) || dataResult.body.length === 0) {
    throw new Error('Socrata resource endpoint returned no source rows')
  }
  const matchingRows = dataResult.body.filter(
    (row) =>
      isRecord(row) &&
      requiredFields.every((field) => typeof row[field] === 'string' && row[field].trim())
  )
  if (matchingRows.length === 0) {
    throw new Error('Socrata resource rows do not satisfy the receipt field contract')
  }

  return {
    schema: 'public-records.pages_public_demo_verification.v1',
    receipt_id: receipt.receipt_id,
    dataset_id: receipt.source.dataset_id,
    pages_origin: pagesOrigin,
    metadata_cors: metadataResult.cors,
    resource_cors: dataResult.cors,
    event_date_field: receipt.fields.event_date,
    rejected_fields_absent: receipt.rejected_fields,
    rows_observed: dataResult.body.length,
    rows_matching_contract: matchingRows.length,
    source_url: sourceUrl,
    status: 'pass'
  }
}

async function main() {
  const receiptPath = process.argv[2]
  if (!receiptPath) {
    throw new Error('usage: node scripts/verify-pages-public-demo.mjs <receipt.json>')
  }
  const rawReceipt = JSON.parse(await readFile(resolve(receiptPath), 'utf8'))
  const result = await verifyPublicDemoSource(rawReceipt)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).toString()
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
