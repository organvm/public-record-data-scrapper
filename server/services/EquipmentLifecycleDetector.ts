/**
 * Equipment Lifecycle Detector
 *
 * Parses UCC collateral descriptions and secured-party names to surface a
 * commercially valuable signal: a business that has *recently financed
 * equipment* is investing in growth and frequently needs working capital
 * shortly after — making it a prime, MCA-adjacent lead.
 *
 * Two outputs justify the analysis:
 *   1. `hasRecentEquipmentPurchase` — a specific (non-blanket) equipment lien
 *      filed inside the recency window.
 *   2. `securedPartyType` — classifies the lien holder (equipment lender vs.
 *      MCA funder vs. bank vs. auto/SBA), so we can tell genuine equipment
 *      acquisition apart from an MCA dressed up with an "all equipment" blanket.
 *
 * The detector is deliberately DB-agnostic at its core: `analyzeFilings` and
 * the classifiers are pure functions and can be unit-tested in isolation
 * (mirroring FilingVelocityService). `detectForProspect` adds an optional
 * persistence-backed convenience layer.
 */

import { database } from '../database/connection'

/** Classification of the lien holder behind an equipment filing. */
export type SecuredPartyType =
  | 'equipment' // Captive/independent equipment finance & leasing companies
  | 'bank' // Depository banks / credit unions
  | 'mca' // Merchant cash advance / alternative working-capital funders
  | 'factor' // Receivables factoring companies
  | 'sba' // SBA / SBA-guaranteed lenders
  | 'auto' // Auto & truck captive finance (vehicle acquisition)
  | 'unknown'

/** Minimal UCC filing shape the detector needs. */
export interface EquipmentFilingInput {
  filingDate: string | Date
  collateralDescription?: string | null
  securedParty?: string | null
  status?: string | null
}

/** Result of analyzing one prospect's filings for equipment lifecycle signals. */
export interface EquipmentLifecycleSignal {
  hasRecentEquipmentPurchase: boolean
  recentEquipmentFilingCount: number
  totalEquipmentFilingCount: number
  mostRecentEquipmentDate: string | null
  daysSinceMostRecentEquipment: number | null
  equipmentCategories: string[]
  /** Dominant secured-party type across the equipment filings. */
  securedPartyType: SecuredPartyType
  /**
   * True when a recent equipment purchase was financed by a NON-MCA lender —
   * the business is growing and likely has untapped working-capital capacity.
   */
  isMcaAdjacent: boolean
  /** Points to add to a prospect's MCA score (+10 when MCA-adjacent, else 0). */
  scoreBoost: number
  rationale: string
}

export interface EquipmentDetectorConfig {
  /** A filing is "recent" if filed within this many days. Default 180. */
  recentWindowDays: number
  /** Score points awarded to an MCA-adjacent prospect. Default 10. */
  mcaAdjacencyBoost: number
}

const DEFAULT_CONFIG: EquipmentDetectorConfig = {
  recentWindowDays: 180,
  mcaAdjacencyBoost: 10
}

/**
 * Collateral phrases that indicate a *blanket* lien rather than a specific
 * equipment acquisition. A blanket lien may mention "equipment" while really
 * encumbering all assets — that is an MCA/working-capital signature, not an
 * equipment purchase, so we exclude it from equipment detection.
 */
const BLANKET_COLLATERAL_PATTERNS = [
  'all assets',
  'all business assets',
  'all present and future',
  'all personal property',
  'accounts receivable',
  'future receivables',
  'credit card receivables',
  'merchant accounts',
  'all inventory and accounts'
]

/**
 * Equipment categories keyed to detection keywords. Order matters only for the
 * reported category list; a description can match several categories.
 */
const EQUIPMENT_CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: 'vehicle', keywords: ['vehicle', 'truck', 'trailer', 'tractor', 'van', 'fleet', 'automobile'] },
  {
    category: 'construction',
    keywords: ['excavator', 'bulldozer', 'forklift', 'backhoe', 'loader', 'crane', 'skid steer', 'compactor']
  },
  { category: 'machinery', keywords: ['machinery', 'machine', 'cnc', 'lathe', 'press', 'mill'] },
  {
    category: 'restaurant',
    keywords: ['oven', 'refrigerator', 'freezer', 'kitchen equipment', 'point of sale', 'pos system', 'fryer']
  },
  { category: 'medical', keywords: ['medical equipment', 'imaging', 'x-ray', 'xray', 'dental', 'ultrasound', 'mri'] },
  { category: 'office', keywords: ['copier', 'printer', 'computer', 'server', 'workstation', 'phone system'] },
  { category: 'general', keywords: ['equipment', 'machinery', 'tools', 'apparatus', 'furniture and fixtures'] }
]

/**
 * Known lien holders → secured-party type. Matched on whole-word tokens (and
 * multi-word phrases) so short tokens like "cit" don't false-match "capacity".
 */
const KNOWN_SECURED_PARTIES: { type: SecuredPartyType; patterns: string[] }[] = [
  {
    type: 'equipment',
    patterns: [
      'de lage landen',
      'dll finance',
      'cit',
      'balboa capital',
      'leaf commercial',
      'leaf capital',
      'wells fargo equipment',
      'us bank equipment',
      'pnc equipment',
      'key equipment',
      'equipment finance',
      'equipment leasing',
      'leasing'
    ]
  },
  {
    type: 'auto',
    patterns: [
      'ford motor credit',
      'toyota financial',
      'toyota motor credit',
      'gm financial',
      'ally financial',
      'ally bank',
      'paccar financial',
      'daimler truck',
      'navistar financial',
      'ryder'
    ]
  },
  {
    type: 'mca',
    patterns: [
      'ondeck',
      'kabbage',
      'bluevine',
      'credibly',
      'fundbox',
      'national funding',
      'forward financing',
      'rapid finance',
      'greenbox',
      'libertas',
      'reliant funding',
      'fora financial',
      'pearl capital',
      'merchant cash',
      'strategic funding',
      'cfg merchant',
      'world business lenders',
      'quickbridge'
    ]
  },
  {
    type: 'sba',
    patterns: ['small business administration', 'sba', 'lendio']
  }
]

/**
 * Generic name-pattern fallbacks, evaluated in order when no known funder
 * matches. Each entry: a secured-party type and the substrings/tokens that
 * imply it. More specific types are listed first.
 */
const SECURED_PARTY_HEURISTICS: { type: SecuredPartyType; tokens: string[] }[] = [
  { type: 'equipment', tokens: ['equipment finance', 'equipment leasing', 'leasing', 'credit corp'] },
  { type: 'auto', tokens: ['motor credit', 'auto finance', 'truck financial'] },
  { type: 'factor', tokens: ['factoring', 'factors', 'receivables funding'] },
  { type: 'sba', tokens: ['sba'] },
  { type: 'bank', tokens: ['bank', 'national association', 'n a', 'credit union', 'savings', 'trust company'] },
  // MCA heuristics last: "capital"/"funding"/"advance" are noisy and also occur
  // in equipment/bank names, so only fall back to MCA when nothing else fits.
  { type: 'mca', tokens: ['merchant cash', 'cash advance', 'merchant funding', 'working capital'] }
]

export class EquipmentLifecycleDetector {
  private config: EquipmentDetectorConfig

  constructor(config: Partial<EquipmentDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Detect whether a collateral description represents a *specific* equipment
   * acquisition (excluding blanket liens that merely list "equipment").
   */
  detectEquipment(description?: string | null): { isEquipment: boolean; categories: string[] } {
    if (!description) return { isEquipment: false, categories: [] }
    const lower = description.toLowerCase()

    // A blanket / all-assets lien is a working-capital signature, not an
    // equipment purchase — even when it enumerates "equipment".
    if (BLANKET_COLLATERAL_PATTERNS.some((p) => lower.includes(p))) {
      return { isEquipment: false, categories: [] }
    }

    const categories = new Set<string>()
    for (const { category, keywords } of EQUIPMENT_CATEGORIES) {
      if (keywords.some((kw) => lower.includes(kw))) {
        categories.add(category)
      }
    }

    return { isEquipment: categories.size > 0, categories: Array.from(categories) }
  }

  /**
   * Classify the lien holder type from the secured-party name.
   */
  classifySecuredPartyType(securedParty?: string | null): SecuredPartyType {
    if (!securedParty) return 'unknown'
    const normalized = this.normalize(securedParty)
    const tokens = new Set(normalized.split(' ').filter(Boolean))

    // 1. Known funders — most specific phrase wins (longest-first).
    const knownMatches: { type: SecuredPartyType; pattern: string }[] = []
    for (const { type, patterns } of KNOWN_SECURED_PARTIES) {
      for (const pattern of patterns) {
        if (this.matchesAsWords(pattern, normalized, tokens)) {
          knownMatches.push({ type, pattern })
        }
      }
    }
    if (knownMatches.length > 0) {
      knownMatches.sort((a, b) => b.pattern.length - a.pattern.length)
      return knownMatches[0].type
    }

    // 2. Generic heuristics, in priority order.
    for (const { type, tokens: heuristicTokens } of SECURED_PARTY_HEURISTICS) {
      if (heuristicTokens.some((t) => this.matchesAsWords(t, normalized, tokens))) {
        return type
      }
    }

    return 'unknown'
  }

  /**
   * Analyze a set of filings (pure — no I/O) and produce the lifecycle signal.
   */
  analyzeFilings(
    filings: EquipmentFilingInput[],
    now: Date = new Date()
  ): EquipmentLifecycleSignal {
    const equipmentFilings: {
      date: Date
      categories: string[]
      securedPartyType: SecuredPartyType
      isRecent: boolean
    }[] = []

    for (const filing of filings) {
      // Terminated/lapsed liens reflect *past* equipment that may already be
      // paid off; only standing (active or unspecified) liens signal a live
      // acquisition. Treat missing status as active so the pure path stays usable.
      const status = (filing.status ?? 'active').toLowerCase()
      if (status === 'terminated' || status === 'lapsed') continue

      const { isEquipment, categories } = this.detectEquipment(filing.collateralDescription)
      if (!isEquipment) continue

      const date = filing.filingDate instanceof Date ? filing.filingDate : new Date(filing.filingDate)
      if (Number.isNaN(date.getTime())) continue

      const ageDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
      equipmentFilings.push({
        date,
        categories,
        securedPartyType: this.classifySecuredPartyType(filing.securedParty),
        isRecent: ageDays >= 0 && ageDays <= this.config.recentWindowDays
      })
    }

    if (equipmentFilings.length === 0) {
      return {
        hasRecentEquipmentPurchase: false,
        recentEquipmentFilingCount: 0,
        totalEquipmentFilingCount: 0,
        mostRecentEquipmentDate: null,
        daysSinceMostRecentEquipment: null,
        equipmentCategories: [],
        securedPartyType: 'unknown',
        isMcaAdjacent: false,
        scoreBoost: 0,
        rationale: 'No active equipment-specific UCC filings detected.'
      }
    }

    const recent = equipmentFilings.filter((f) => f.isRecent)
    const hasRecentEquipmentPurchase = recent.length > 0

    // Most recent equipment filing overall (for reporting).
    const mostRecent = equipmentFilings.reduce((a, b) => (b.date > a.date ? b : a))
    const daysSinceMostRecentEquipment = Math.floor(
      (now.getTime() - mostRecent.date.getTime()) / (1000 * 60 * 60 * 24)
    )

    // Dominant secured-party type across the *relevant* (recent if any, else
    // all) equipment filings.
    const relevant = hasRecentEquipmentPurchase ? recent : equipmentFilings
    const securedPartyType = this.dominantType(relevant.map((f) => f.securedPartyType))

    const categories = Array.from(new Set(relevant.flatMap((f) => f.categories)))

    // MCA-adjacent: recently bought equipment, and NOT via an MCA funder. Such
    // a business is expanding and typically has fresh working-capital appetite.
    const isMcaAdjacent = hasRecentEquipmentPurchase && securedPartyType !== 'mca'
    const scoreBoost = isMcaAdjacent ? this.config.mcaAdjacencyBoost : 0

    return {
      hasRecentEquipmentPurchase,
      recentEquipmentFilingCount: recent.length,
      totalEquipmentFilingCount: equipmentFilings.length,
      mostRecentEquipmentDate: mostRecent.date.toISOString(),
      daysSinceMostRecentEquipment,
      equipmentCategories: categories,
      securedPartyType,
      isMcaAdjacent,
      scoreBoost,
      rationale: this.buildRationale(
        hasRecentEquipmentPurchase,
        recent.length,
        securedPartyType,
        categories,
        isMcaAdjacent
      )
    }
  }

  /**
   * Convenience: fetch a prospect's filings and analyze them.
   */
  async detectForProspect(prospectId: string): Promise<EquipmentLifecycleSignal> {
    const rows = await database.query<{
      status: string
      filing_date: string
      secured_party: string
      collateral_description: string | null
    }>(
      `SELECT uf.status, uf.filing_date, uf.secured_party,
              COALESCE(
                uf.raw_data->>'collateral_description',
                uf.raw_data->>'collateral',
                uf.raw_data->>'description'
              ) AS collateral_description
       FROM ucc_filings uf
       JOIN prospect_ucc_filings puf ON uf.id = puf.ucc_filing_id
       WHERE puf.prospect_id = $1
       ORDER BY uf.filing_date DESC`,
      [prospectId]
    )

    return this.analyzeFilings(
      rows.map((r) => ({
        filingDate: r.filing_date,
        collateralDescription: r.collateral_description,
        securedParty: r.secured_party,
        status: r.status
      }))
    )
  }

  /** Pick the most frequent secured-party type, preferring non-unknown. */
  private dominantType(types: SecuredPartyType[]): SecuredPartyType {
    const counts = new Map<SecuredPartyType, number>()
    for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1)

    let best: SecuredPartyType = 'unknown'
    let bestCount = -1
    for (const [type, count] of counts) {
      // Prefer a known type over 'unknown' on ties so the signal stays useful.
      if (count > bestCount || (count === bestCount && best === 'unknown' && type !== 'unknown')) {
        best = type
        bestCount = count
      }
    }
    return best
  }

  private buildRationale(
    hasRecent: boolean,
    recentCount: number,
    securedPartyType: SecuredPartyType,
    categories: string[],
    isMcaAdjacent: boolean
  ): string {
    if (!hasRecent) {
      return 'Equipment financing on file but none within the recency window; no MCA-adjacency boost.'
    }
    const cats = categories.length > 0 ? categories.join(', ') : 'equipment'
    const via = securedPartyType === 'unknown' ? 'an unidentified lender' : `a(n) ${securedPartyType} lender`
    if (isMcaAdjacent) {
      return `${recentCount} recent equipment purchase(s) (${cats}) financed via ${via} — business is expanding and likely has working-capital appetite. MCA-adjacent: +score boost.`
    }
    return `${recentCount} recent equipment filing(s) (${cats}) but financed by an MCA funder — already in-market, no adjacency boost.`
  }

  /**
   * Whether a pattern matches a normalized name on word boundaries. Multi-word
   * patterns must appear as a contiguous phrase; single-word patterns must be a
   * whole token (so "cit" matches "cit group" but not "capacity").
   */
  private matchesAsWords(pattern: string, normalizedName: string, nameTokens: Set<string>): boolean {
    if (!pattern) return false
    if (pattern.includes(' ')) {
      return new RegExp(`(^|\\s)${this.escapeRegExp(pattern)}(\\s|$)`).test(normalizedName)
    }
    return nameTokens.has(pattern)
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private normalize(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }
}

// Export singleton instance
export const equipmentLifecycleDetector = new EquipmentLifecycleDetector()
