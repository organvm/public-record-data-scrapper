const RECEIPT_SCHEMA = 'public-records.pages_public_demo_source.v1'
const FIELD_NAME = /^[a-z][a-z0-9_]*$/
const MAX_ROWS = 50

export interface PublicDemoReceipt {
  schema: typeof RECEIPT_SCHEMA
  receipt_id: string
  mode: 'read_only_live_public_data'
  source: {
    owner: string
    dataset_id: string
    dataset_name: string
    dataset_page_url: string
    metadata_url: string
    api_url: string
  }
  fields: {
    record_id: string
    company_name: string
    event_date: string
    record_type: string
  }
  rejected_fields: string[]
  query: {
    limit: number
  }
  privacy: {
    displayed_fields: string[]
    excluded_categories: string[]
    browser_writes: false
  }
}

export interface PublicDemoPermit {
  id: string
  companyName: string
  issueDate: string
  permitType: string
}

export interface PublicDemoData {
  receipt: PublicDemoReceipt
  permits: PublicDemoPermit[]
  sourceUrl: string
  sourceLastModified: string | null
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Public demo receipt field '${key}' must be a non-empty string`)
  }
  return value.trim()
}

function requiredRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) {
    throw new Error(`Public demo receipt field '${key}' must be an object`)
  }
  return value
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Public demo receipt field '${key}' must be an array of strings`)
  }
  return value.map((item) => item.trim())
}

function requireHttpsUrl(value: string, key: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`Public demo receipt field '${key}' must be an absolute URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Public demo receipt field '${key}' must use HTTPS`)
  }
  return parsed
}

export function parsePublicDemoReceipt(value: unknown): PublicDemoReceipt {
  if (!isRecord(value)) {
    throw new Error('Public demo receipt must be a JSON object')
  }
  if (value.schema !== RECEIPT_SCHEMA) {
    throw new Error(`Unsupported public demo receipt schema '${String(value.schema)}'`)
  }
  if (value.mode !== 'read_only_live_public_data') {
    throw new Error("Public demo receipt mode must be 'read_only_live_public_data'")
  }

  const source = requiredRecord(value, 'source')
  const fields = requiredRecord(value, 'fields')
  const query = requiredRecord(value, 'query')
  const privacy = requiredRecord(value, 'privacy')

  const datasetId = requiredString(source, 'dataset_id')
  const apiUrl = requireHttpsUrl(requiredString(source, 'api_url'), 'source.api_url')
  const metadataUrl = requireHttpsUrl(requiredString(source, 'metadata_url'), 'source.metadata_url')
  const datasetPageUrl = requireHttpsUrl(
    requiredString(source, 'dataset_page_url'),
    'source.dataset_page_url'
  )

  if (!apiUrl.pathname.endsWith(`/resource/${datasetId}.json`)) {
    throw new Error('Public demo API URL does not match its dataset_id')
  }
  if (!metadataUrl.pathname.endsWith(`/api/views/${datasetId}`)) {
    throw new Error('Public demo metadata URL does not match its dataset_id')
  }
  if (apiUrl.hostname !== metadataUrl.hostname || apiUrl.hostname !== datasetPageUrl.hostname) {
    throw new Error('Public demo source URLs must share one owner hostname')
  }

  const parsedFields = {
    record_id: requiredString(fields, 'record_id'),
    company_name: requiredString(fields, 'company_name'),
    event_date: requiredString(fields, 'event_date'),
    record_type: requiredString(fields, 'record_type')
  }
  for (const field of Object.values(parsedFields)) {
    if (!FIELD_NAME.test(field)) {
      throw new Error(`Unsafe public demo source field '${field}'`)
    }
  }

  const rejectedFields = stringArray(value, 'rejected_fields')
  if (rejectedFields.some((field) => !FIELD_NAME.test(field))) {
    throw new Error('Public demo rejected_fields contains an unsafe field name')
  }
  if (rejectedFields.includes(parsedFields.event_date)) {
    throw new Error('Public demo event-date field cannot also be rejected')
  }

  const limit = query.limit
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_ROWS) {
    throw new Error(`Public demo query.limit must be an integer from 1 to ${MAX_ROWS}`)
  }

  const displayedFields = stringArray(privacy, 'displayed_fields')
  const selectedFields = Object.values(parsedFields)
  if (selectedFields.some((field) => !displayedFields.includes(field))) {
    throw new Error('Public demo privacy.displayed_fields must cover every selected field')
  }
  if (privacy.browser_writes !== false) {
    throw new Error('Public demo receipt must explicitly disable browser writes')
  }

  return {
    schema: RECEIPT_SCHEMA,
    receipt_id: requiredString(value, 'receipt_id'),
    mode: 'read_only_live_public_data',
    source: {
      owner: requiredString(source, 'owner'),
      dataset_id: datasetId,
      dataset_name: requiredString(source, 'dataset_name'),
      dataset_page_url: datasetPageUrl.toString(),
      metadata_url: metadataUrl.toString(),
      api_url: apiUrl.toString()
    },
    fields: parsedFields,
    rejected_fields: rejectedFields,
    query: { limit: limit as number },
    privacy: {
      displayed_fields: displayedFields,
      excluded_categories: stringArray(privacy, 'excluded_categories'),
      browser_writes: false
    }
  }
}

export function buildPublicDemoSourceUrl(receipt: PublicDemoReceipt): string {
  const selectedFields = Object.values(receipt.fields)
  const params = new URLSearchParams({
    $select: selectedFields.join(','),
    $where: `${receipt.fields.company_name} IS NOT NULL AND ${receipt.fields.event_date} IS NOT NULL`,
    $order: `${receipt.fields.event_date} DESC`,
    $limit: String(receipt.query.limit)
  })
  return `${receipt.source.api_url}?${params.toString()}`
}

export function resolvePublicDemoReceiptUrl(
  configuredUrl: string,
  baseUrl: string,
  origin: string
): string {
  const deploymentBase = new URL(baseUrl, origin)
  return new URL(configuredUrl, deploymentBase).toString()
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${label} returned non-JSON content`)
  }
  return response.json()
}

export async function loadPublicDemoData(
  receiptUrl: string,
  signal?: AbortSignal,
  fetchImpl: FetchLike = fetch
): Promise<PublicDemoData> {
  const receiptResponse = await fetchImpl(receiptUrl, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    signal
  })
  const receipt = parsePublicDemoReceipt(
    await responseJson(receiptResponse, 'Public demo source receipt')
  )
  const sourceUrl = buildPublicDemoSourceUrl(receipt)
  const sourceResponse = await fetchImpl(sourceUrl, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    signal
  })
  const body = await responseJson(sourceResponse, receipt.source.dataset_name)
  if (!Array.isArray(body)) {
    throw new Error(`${receipt.source.dataset_name} changed shape: expected an array`)
  }

  const seen = new Set<string>()
  const permits: PublicDemoPermit[] = []
  for (const value of body) {
    if (!isRecord(value)) continue
    const recordId = value[receipt.fields.record_id]
    const companyName = value[receipt.fields.company_name]
    const issueDate = value[receipt.fields.event_date]
    const permitType = value[receipt.fields.record_type]
    if (
      typeof recordId !== 'string' ||
      typeof companyName !== 'string' ||
      typeof issueDate !== 'string'
    ) {
      continue
    }
    const key = `${recordId.trim()}\u0000${companyName.trim()}`
    if (!recordId.trim() || !companyName.trim() || !issueDate.trim() || seen.has(key)) continue
    seen.add(key)
    permits.push({
      id: recordId.trim(),
      companyName: companyName.trim(),
      issueDate: issueDate.trim(),
      permitType:
        typeof permitType === 'string' && permitType.trim().length > 0
          ? permitType.trim()
          : 'Construction permit'
    })
  }

  if (body.length > 0 && permits.length === 0) {
    throw new Error(`${receipt.source.dataset_name} no longer matches the receipt field contract`)
  }

  return {
    receipt,
    permits,
    sourceUrl,
    sourceLastModified: sourceResponse.headers.get('last-modified')
  }
}
