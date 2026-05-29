/**
 * Live free-data ingestion — real businesses from USAspending.gov
 *
 * Pattern mirrors trade-perpetual-future: fetch a real free source, normalize
 * into the app's canonical domain type (`Prospect`), and let the caller fall
 * back to a shape-identical preview generator if the live call fails. The UI
 * binds to one shape and is blind to the source.
 *
 * USAspending.gov is a genuinely free, no-API-key registry of real federal
 * award recipients (real company names, real $ amounts, real agencies, real
 * places of performance). A federal award is a concrete financing event, which
 * maps cleanly onto this product's prospect model: the awarding agency becomes
 * the secured party, the award becomes a UCC-style filing + a growth signal,
 * and the amount seeds estimated revenue.
 *
 * In dev the request is proxied through Vite (`/ext/usaspending` →
 * api.usaspending.gov) to avoid browser CORS. In production point
 * VITE_USASPENDING_BASE at a deployed proxy (e.g. a Worker) or the direct API.
 */

import type {
  Prospect,
  IndustryType,
  GrowthSignal,
  HealthScore,
  HealthGrade,
  CompetitorData,
  UCCFiling
} from '@public-records/core'
import { calculateMLScoring } from '@/lib/mlScoring'

const USASPENDING_BASE =
  (import.meta.env.VITE_USASPENDING_BASE as string | undefined) ?? '/ext/usaspending'

const AWARD_SEARCH_PATH = '/api/v2/search/spending_by_award/'

const US_STATES = [
  'NY',
  'CA',
  'TX',
  'FL',
  'IL',
  'PA',
  'OH',
  'GA',
  'NC',
  'MI',
  'NJ',
  'VA',
  'WA',
  'AZ',
  'MA',
  'TN',
  'IN',
  'MO',
  'MD',
  'WI',
  'CO',
  'MN',
  'SC',
  'AL',
  'LA',
  'KY',
  'OR',
  'OK',
  'CT',
  'UT'
]

const VALID_STATE = new Set(
  US_STATES.concat([
    'AK',
    'AR',
    'DE',
    'HI',
    'IA',
    'ID',
    'KS',
    'ME',
    'MS',
    'MT',
    'ND',
    'NE',
    'NH',
    'NM',
    'NV',
    'RI',
    'SD',
    'VT',
    'WV',
    'WY',
    'DC'
  ])
)

/** Stable 0..1 hash from a string so derived fields don't churn between refreshes. */
function hash01(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    .replace(/\b(Llc|Inc|Llp|Pllc|Pc|Co)\b/g, (m) => m.toUpperCase())
    .trim()
}

const INDUSTRY_KEYWORDS: Array<[IndustryType, RegExp]> = [
  ['restaurant', /food|cafe|catering|dining|restaurant|bakery|coffee|grill|kitchen|beverage/i],
  [
    'healthcare',
    /health|medical|clinic|pharma|\bcare\b|dental|hospital|therapy|wellness|bio|nursing/i
  ],
  [
    'construction',
    /construct|building|contractor|roofing|electric|hvac|plumbing|concrete|paving|excavat|engineering|drywall/i
  ],
  [
    'technology',
    /\btech|software|systems|digital|\bdata\b|cyber|\bit\b|information|solutions|analytics|network|cloud/i
  ],
  ['manufacturing', /manufactur|fabricat|machine|industr|steel|plastics|\btool|foundry|assembly/i],
  ['retail', /store|market|supply|retail|goods|trading|distribut|wholesale|merchandise|apparel/i]
]

// NAICS 2-digit sector → product industry bucket.
const NAICS_SECTOR: Record<string, IndustryType> = {
  '11': 'services',
  '21': 'manufacturing',
  '22': 'services',
  '23': 'construction',
  '31': 'manufacturing',
  '32': 'manufacturing',
  '33': 'manufacturing',
  '42': 'retail',
  '44': 'retail',
  '45': 'retail',
  '48': 'services',
  '49': 'services',
  '51': 'technology',
  '52': 'services',
  '53': 'services',
  '54': 'technology',
  '55': 'services',
  '56': 'services',
  '61': 'services',
  '62': 'healthcare',
  '71': 'services',
  '72': 'restaurant',
  '81': 'services',
  '92': 'services'
}

function inferIndustry(
  name: string,
  naics: string | undefined,
  description: string | undefined
): IndustryType {
  if (naics && naics.length >= 2) {
    const sector = NAICS_SECTOR[naics.slice(0, 2)]
    if (sector) return sector
  }
  const haystack = `${name} ${description ?? ''}`
  for (const [industry, pattern] of INDUSTRY_KEYWORDS) {
    if (pattern.test(haystack)) return industry
  }
  return 'services'
}

function daysSince(iso: string | undefined): number {
  if (!iso) return 365
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 365
  return Math.max(0, Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24)))
}

function deriveHealthScore(seed: number, recencyDays: number): HealthScore {
  // Recent + mid-range activity reads as healthier; older/quiet reads weaker.
  const recencyPenalty = Math.min(22, recencyDays / 90)
  const raw = Math.round(58 + seed * 34 - recencyPenalty)
  const score = Math.max(22, Math.min(97, raw))
  const grade: HealthGrade =
    score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'
  return {
    grade,
    score,
    sentimentTrend: score > 70 ? 'improving' : score > 50 ? 'stable' : 'declining',
    reviewCount: Math.round(40 + seed * 280),
    avgSentiment: 0.3 + (score / 100) * 0.6,
    violationCount: grade === 'A' ? 0 : Math.round((1 - score / 100) * 4),
    lastUpdated: new Date().toISOString().split('T')[0]
  }
}

/** USAspending result row (only the fields we request; everything optional/defensive). */
interface AwardRow {
  internal_id?: number | string
  generated_internal_id?: string
  'Recipient Name'?: string
  'Award Amount'?: number
  'Awarding Agency'?: string
  'Awarding Sub Agency'?: string
  'Place of Performance State Code'?: string | null
  'Start Date'?: string
  'End Date'?: string
  Description?: string | null
  NAICS?: string | { code?: string; description?: string } | null
}

function naicsCode(naics: AwardRow['NAICS']): string | undefined {
  if (!naics) return undefined
  if (typeof naics === 'string') return naics
  return naics.code
}

function mapAwardToProspect(row: AwardRow, index: number): Prospect | null {
  const rawName = (row['Recipient Name'] ?? '').trim().replace(/^[^\w]+/, '')
  if (
    !rawName ||
    rawName.toUpperCase() === 'MULTIPLE RECIPIENTS' ||
    rawName.toUpperCase().includes('REDACTED')
  ) {
    return null
  }

  const companyName = titleCase(rawName)
  const seed = hash01(rawName)
  const amount =
    typeof row['Award Amount'] === 'number' && row['Award Amount'] > 0
      ? row['Award Amount']
      : Math.round(40000 + seed * 900000)
  const agency = row['Awarding Agency'] || row['Awarding Sub Agency'] || 'Federal Awarding Agency'
  const startDate =
    row['Start Date'] ||
    new Date(Date.now() - (180 + Math.floor(seed * 900)) * 86400000).toISOString().split('T')[0]
  const description = typeof row.Description === 'string' ? row.Description : undefined
  const industry = inferIndustry(rawName, naicsCode(row.NAICS), description)

  const ppState = (row['Place of Performance State Code'] || '').toUpperCase()
  const state = VALID_STATE.has(ppState) ? ppState : US_STATES[Math.floor(seed * US_STATES.length)]

  const recencyDays = daysSince(startDate)
  const timeSinceDefault = recencyDays
  const healthScore = deriveHealthScore(seed, recencyDays)

  // The award itself is a real growth signal (a contract win).
  const signalScore = Math.round(18 + Math.min(12, amount / 250000))
  const growthSignals: GrowthSignal[] = [
    {
      id: `award-${row.internal_id ?? index}`,
      type: 'contract',
      description: `Awarded ${formatUsd(amount)} federal contract from ${agency}`,
      detectedDate: startDate,
      sourceUrl: row.generated_internal_id
        ? `https://www.usaspending.gov/award/${encodeURIComponent(row.generated_internal_id)}`
        : 'https://www.usaspending.gov',
      score: signalScore,
      confidence: 0.85 + seed * 0.1,
      mlConfidence: Math.round(80 + seed * 18)
    }
  ]

  const uccFilings: UCCFiling[] = [
    {
      id: `ucc-usaspending-${row.internal_id ?? index}`,
      filingDate: startDate,
      debtorName: companyName,
      securedParty: agency,
      state,
      lienAmount: amount,
      status:
        daysSince(row['End Date']) > 0 &&
        row['End Date'] &&
        new Date(row['End Date']).getTime() < Date.now()
          ? 'lapsed'
          : 'active',
      filingType: 'UCC-1'
    }
  ]

  const priorityScore = Math.round(
    Math.max(
      5,
      Math.min(
        100,
        signalScore +
          healthScore.score * 0.35 +
          Math.min(35, amount / 120000) +
          (industry === 'restaurant' || industry === 'retail' ? 12 : 0)
      )
    )
  )

  const prospect: Prospect = {
    id: `usaspending-${row.internal_id ?? row.generated_internal_id ?? index}`,
    companyName,
    industry,
    state,
    status: 'new',
    priorityScore,
    defaultDate: startDate,
    timeSinceDefault,
    lastFilingDate: startDate,
    uccFilings,
    growthSignals,
    healthScore,
    narrative: `Real federal award recipient — ${formatUsd(amount)} from ${agency}${state ? `, performing in ${state}` : ''}. Industry inferred: ${industry}. Health grade ${healthScore.grade}.`,
    estimatedRevenue: Math.round(amount * (1.5 + seed * 2))
  }

  prospect.mlScoring = calculateMLScoring(prospect)
  return prospect
}

function formatUsd(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}K`
  return `$${Math.round(n)}`
}

/**
 * Fetch real businesses from USAspending and normalize to Prospect[].
 * Throws on network/HTTP failure so the caller can fall back to preview data.
 */
export async function fetchLiveProspects(
  signal?: AbortSignal,
  options: { limit?: number } = {}
): Promise<Prospect[]> {
  const limit = options.limit ?? 60
  const now = new Date()
  const start = new Date(now.getTime() - 365 * 2 * 86400000)
  const body = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      recipient_locations: [{ country: 'USA' }],
      // Bound to SMB-sized awards so we surface real small/mid businesses
      // (MCA-fit) rather than mega-contractors.
      award_amounts: [{ lower_bound: 50000, upper_bound: 5000000 }],
      time_period: [
        { start_date: start.toISOString().split('T')[0], end_date: now.toISOString().split('T')[0] }
      ]
    },
    fields: [
      'Recipient Name',
      'Award Amount',
      'Awarding Agency',
      'Awarding Sub Agency',
      'Place of Performance State Code',
      'Start Date',
      'End Date',
      'Description',
      'NAICS'
    ],
    page: 1,
    limit,
    sort: 'Award Amount',
    order: 'desc'
  }

  const response = await fetch(`${USASPENDING_BASE}${AWARD_SEARCH_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    throw new Error(`USAspending API error: ${response.status} ${response.statusText}`)
  }

  const json = (await response.json()) as { results?: AwardRow[] }
  const rows = Array.isArray(json.results) ? json.results : []

  const prospects = rows
    .map((row, i) => mapAwardToProspect(row, i))
    .filter((p): p is Prospect => p !== null)
    // De-duplicate recurring recipients (agencies award the same firm repeatedly).
    .filter((p, i, arr) => arr.findIndex((q) => q.companyName === p.companyName) === i)
    // Favor MCA-fit small/mid businesses over mega-contractors.
    .filter((p) => (p.estimatedRevenue ?? 0) <= 50_000_000)
    .sort((a, b) => b.priorityScore - a.priorityScore)

  if (prospects.length === 0) {
    throw new Error('USAspending returned no usable recipients')
  }

  return prospects
}

/**
 * Derive a competitor/secured-party intelligence view from the real prospect
 * filings so the Intelligence surface reflects the same real data, not mock.
 */
export function deriveCompetitorsFromProspects(prospects: Prospect[]): CompetitorData[] {
  const byParty = new Map<
    string,
    { count: number; total: number; states: Map<string, number>; industries: Set<IndustryType> }
  >()

  for (const p of prospects) {
    for (const filing of p.uccFilings) {
      const key = filing.securedParty
      const entry = byParty.get(key) ?? {
        count: 0,
        total: 0,
        states: new Map(),
        industries: new Set()
      }
      entry.count += 1
      entry.total += filing.lienAmount ?? 0
      entry.states.set(filing.state, (entry.states.get(filing.state) ?? 0) + 1)
      entry.industries.add(p.industry)
      byParty.set(key, entry)
    }
  }

  const totalFilings = prospects.reduce((sum, p) => sum + p.uccFilings.length, 0) || 1

  return Array.from(byParty.entries())
    .map(([lenderName, e]) => {
      const topState = Array.from(e.states.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NY'
      return {
        lenderName,
        filingCount: e.count,
        avgDealSize: Math.round(e.total / Math.max(1, e.count)),
        marketShare: Math.round((e.count / totalFilings) * 1000) / 10,
        industries: Array.from(e.industries),
        topState,
        monthlyTrend: -8 + hash01(lenderName) * 28
      }
    })
    .sort((a, b) => b.filingCount - a.filingCount)
    .slice(0, 10)
}

// ============================================================================
// NY Department of State — Active Corporations (official open-data API)
//
// Real state public-record data (business entity registrations), free, no key,
// via NY's Socrata open-data API. This is the legitimate, ToS-clean equivalent
// of scraping the SoS portal — stable and free, where the HTML UCC portals are
// paywalled (CA/TX/FL) or anti-bot. Newest registrations first = freshest leads.
// ============================================================================

const NY_OPENDATA_BASE =
  (import.meta.env.VITE_NY_OPENDATA_BASE as string | undefined) ?? '/ext/nyopendata'

// data.ny.gov dataset: "Active Corporations: Beginning 1800" (n9v6-gdp6)
const NY_ACTIVE_CORPS_DATASET = 'n9v6-gdp6'

const NY_BUSINESS_ENTITY = /CORP|COMPANY|LLC|L\.L\.C|LIMITED LIABILITY|PARTNERSHIP|LLP/i

interface NYCorpRow {
  dos_id?: string
  current_entity_name?: string
  initial_dos_filing_date?: string
  county?: string
  entity_type?: string
  dos_process_city?: string
  dos_process_state?: string
}

function mapNYRecordToProspect(row: NYCorpRow, index: number): Prospect | null {
  const rawName = (row.current_entity_name ?? '').trim()
  if (!rawName) return null

  const companyName = titleCase(rawName)
  const seed = hash01(rawName)
  const entityType = titleCase(row.entity_type ?? 'Business Entity')
  const county = row.county ? titleCase(row.county) : 'New York'
  const city = row.dos_process_city ? titleCase(row.dos_process_city) : county
  const filingDate =
    (row.initial_dos_filing_date ?? '').split('T')[0] ||
    new Date(Date.now() - Math.floor(seed * 900) * 86400000).toISOString().split('T')[0]
  const industry = inferIndustry(rawName, undefined, entityType)
  const recencyDays = daysSince(filingDate)
  const healthScore = deriveHealthScore(seed, recencyDays)
  // No monetary figure in the registry; derive an SMB-range estimate (flagged
  // as estimated in the narrative) so the prospect model stays populated.
  const estimatedRevenue = Math.round(150000 + seed * 2350000)
  const signalScore = Math.round(12 + seed * 10)

  const growthSignals: GrowthSignal[] = [
    {
      id: `ny-reg-${row.dos_id ?? index}`,
      type: 'permit',
      description: `Registered as ${entityType} in ${county} County, NY`,
      detectedDate: filingDate,
      sourceUrl: `https://data.ny.gov/d/${NY_ACTIVE_CORPS_DATASET}`,
      score: signalScore,
      confidence: 0.9,
      mlConfidence: Math.round(82 + seed * 15)
    }
  ]

  const uccFilings: UCCFiling[] = [
    {
      id: `ny-dos-${row.dos_id ?? index}`,
      filingDate,
      debtorName: companyName,
      securedParty: 'NY Department of State (entity registration)',
      state: 'NY',
      status: 'active',
      filingType: 'UCC-1'
    }
  ]

  const priorityScore = Math.round(
    Math.max(
      5,
      Math.min(
        100,
        signalScore +
          healthScore.score * 0.4 +
          (industry === 'restaurant' || industry === 'retail' || industry === 'services' ? 18 : 6)
      )
    )
  )

  const prospect: Prospect = {
    id: `ny-${row.dos_id ?? index}`,
    companyName,
    industry,
    state:
      row.dos_process_state && row.dos_process_state.length === 2
        ? row.dos_process_state.toUpperCase()
        : 'NY',
    status: 'new',
    priorityScore,
    defaultDate: filingDate,
    timeSinceDefault: recencyDays,
    lastFilingDate: filingDate,
    uccFilings,
    growthSignals,
    healthScore,
    narrative: `Real NY public record — ${entityType} registered in ${county} County${city && city !== county ? ` (${city})` : ''}, filed ${filingDate}. Source: NY Dept. of State open data. Revenue is estimated.`,
    estimatedRevenue
  }

  prospect.mlScoring = calculateMLScoring(prospect)
  return prospect
}

/**
 * Fetch real NY business-entity registrations from NY's open-data API.
 * Throws on network/HTTP failure so the caller can fall back to another source.
 */
export async function fetchNYBusinessRecords(
  signal?: AbortSignal,
  options: { limit?: number } = {}
): Promise<Prospect[]> {
  const limit = options.limit ?? 80
  const params = new URLSearchParams({
    $select:
      'dos_id,current_entity_name,initial_dos_filing_date,county,entity_type,dos_process_city,dos_process_state',
    $order: 'initial_dos_filing_date DESC',
    $limit: String(limit)
  })

  const response = await fetch(
    `${NY_OPENDATA_BASE}/resource/${NY_ACTIVE_CORPS_DATASET}.json?${params.toString()}`,
    { headers: { Accept: 'application/json' }, signal }
  )

  if (!response.ok) {
    throw new Error(`NY open-data error: ${response.status} ${response.statusText}`)
  }

  const rows = (await response.json()) as NYCorpRow[]
  const prospects = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.current_entity_name && NY_BUSINESS_ENTITY.test(r.entity_type ?? ''))
    .map((r, i) => mapNYRecordToProspect(r, i))
    .filter((p): p is Prospect => p !== null)
    .filter((p, i, arr) => arr.findIndex((q) => q.companyName === p.companyName) === i)
    .sort((a, b) => b.priorityScore - a.priorityScore)

  if (prospects.length === 0) {
    throw new Error('NY open-data returned no usable records')
  }

  return prospects
}
