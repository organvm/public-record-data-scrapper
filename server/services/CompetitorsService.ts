/**
 * CompetitorsService
 *
 * Service layer for competitor analysis in the UCC-MCA Intelligence Platform.
 * Aggregates UCC filing data to identify and analyze competing secured parties.
 *
 * @module server/services/CompetitorsService
 */

import { database } from '../database/connection'
import type { ResolvedDataTier } from '../middleware/dataTier'

/**
 * Allowlist of valid columns for sorting to prevent SQL injection.
 * Only these columns can be used in ORDER BY clauses.
 */
const ALLOWED_SORT_COLUMNS = [
  'name',
  'filing_count',
  'total_amount',
  'avg_amount',
  'first_filing',
  'last_filing',
  'market_share'
] as const

type AllowedSortColumn = (typeof ALLOWED_SORT_COLUMNS)[number]

const COMPETITOR_TIER_LIMITS: Record<ResolvedDataTier, number> = {
  'free-tier': 20,
  'starter-tier': 100
}

const FREE_TIER_MIN_FILINGS = 3

/**
 * Validates and sanitizes a sort column to prevent SQL injection.
 *
 * @param column - The requested sort column name
 * @returns A safe column name from the allowlist, defaults to 'filing_count'
 */
function validateSortColumn(column: string): AllowedSortColumn {
  if (ALLOWED_SORT_COLUMNS.includes(column as AllowedSortColumn)) {
    return column as AllowedSortColumn
  }
  return 'filing_count' // Safe default
}

/**
 * Competitor entity representing an aggregated secured party from UCC filings.
 */
interface Competitor {
  /** Unique identifier */
  id: string
  /** Normalized secured party name */
  name: string
  /** Total number of UCC filings */
  filing_count: number
  /** Sum of all lien amounts */
  total_amount: number
  /** Average lien amount per filing */
  avg_amount: number
  /** States where filings exist */
  states: string[]
  /** Industries served */
  industries: string[]
  /** Date of first filing */
  first_filing: string
  /** Date of most recent filing */
  last_filing: string
  /** Percentage of total market */
  market_share: number
}

/**
 * Parameters for listing competitors with filtering and pagination.
 */
interface ListParams {
  /** Page number (1-indexed) */
  page: number
  /** Number of items per page */
  limit: number
  /** Filter by state code */
  state?: string
  /** Column to sort by (validated against allowlist) */
  sort_by: string
  /** Sort direction */
  sort_order: 'asc' | 'desc'
}

/**
 * Service for competitor intelligence and market analysis.
 *
 * Provides methods for:
 * - Listing competitors with aggregated metrics
 * - Individual competitor analysis
 * - SWOT analysis generation
 * - Market statistics
 *
 * @example
 * ```typescript
 * const service = new CompetitorsService()
 *
 * // List competitors
 * const result = await service.list({
 *   page: 1,
 *   limit: 20,
 *   sort_by: 'filing_count',
 *   sort_order: 'desc'
 * })
 *
 * // Get competitor SWOT analysis
 * const analysis = await service.getAnalysis('competitor-id')
 * ```
 */
export class CompetitorsService {
  /**
   * List competitors with aggregated metrics from UCC filings.
   *
   * Aggregates UCC filing data by secured party to calculate:
   * - Filing count
   * - Total and average lien amounts
   * - Geographic presence (states)
   * - Filing date range
   *
   * @param params - Query parameters for filtering and pagination
   * @returns Paginated list of competitors with total count
   */
  async list(params: ListParams, dataTier: ResolvedDataTier = 'free-tier') {
    const { page, limit, state, sort_by, sort_order } = params
    const safeSortBy = validateSortColumn(sort_by)
    const maxLimit = COMPETITOR_TIER_LIMITS[dataTier]
    const effectiveLimit = Math.min(limit, maxLimit)
    const minFilings = dataTier === 'free-tier' ? FREE_TIER_MIN_FILINGS : 1
    const offset = (page - 1) * effectiveLimit

    // Build WHERE clause
    const conditions: string[] = []
    const values: (string | number)[] = []
    let paramCount = 1

    if (state) {
      conditions.push(`$${paramCount}::text = ANY(c.states)`)
      values.push(state)
      paramCount++
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const havingClause = minFilings > 1 ? `HAVING COUNT(*) >= $${paramCount}` : ''
    if (minFilings > 1) {
      values.push(minFilings)
      paramCount++
    }

    // Query competitors (aggregated from UCC filings) - safeSortBy is validated against allowlist
    const safeSortOrder = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
    const query = `
      SELECT
        md5(secured_party_normalized)::uuid as id,
        secured_party_normalized as name,
        COUNT(*) as filing_count,
        COALESCE(SUM(lien_amount), 0) as total_amount,
        COALESCE(AVG(lien_amount), 0) as avg_amount,
        ARRAY_AGG(DISTINCT state) as states,
        MIN(filing_date) as first_filing,
        MAX(filing_date) as last_filing
      FROM ucc_filings
      ${whereClause}
      GROUP BY secured_party_normalized
      ${havingClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `
    values.push(effectiveLimit, offset)

    const competitors = await database.query<Competitor>(query, values)

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM (
        SELECT secured_party_normalized
        FROM ucc_filings
        ${whereClause}
        GROUP BY secured_party_normalized
        ${havingClause}
      ) as grouped
    `
    const countResult = await database.query<{ count: string }>(countQuery, values.slice(0, -2))
    const total = parseInt(countResult[0]?.count || '0')

    return {
      competitors,
      page,
      limit: effectiveLimit,
      total
    }
  }

  /**
   * Get a competitor by ID.
   *
   * Note: Competitors are dynamically aggregated from UCC filings,
   * so this queries the underlying filing data.
   *
   * @param id - The competitor's unique identifier
   * @returns The competitor if found, null otherwise
   */
  async getById(id: string) {
    // Competitors are aggregated from UCC filings rather than stored separately.
    // The competitor id is a stable UUID derived from md5(secured_party_normalized)
    // (see list()), so we filter the aggregate by matching that derived id rather
    // than returning an arbitrary row.
    const query = `
      SELECT
        md5(secured_party_normalized)::uuid as id,
        secured_party_normalized as name,
        COUNT(*) as filing_count,
        COALESCE(SUM(lien_amount), 0) as total_amount,
        COALESCE(AVG(lien_amount), 0) as avg_amount,
        ARRAY_AGG(DISTINCT state) as states,
        MIN(filing_date) as first_filing,
        MAX(filing_date) as last_filing
      FROM ucc_filings
      WHERE md5(secured_party_normalized)::uuid = $1::uuid
      GROUP BY secured_party_normalized
    `

    const results = await database.query<Competitor>(query, [id])
    return results[0] || null
  }

  /**
   * Get detailed analysis for a competitor including SWOT analysis.
   *
   * Calculates market share and generates a SWOT analysis based on
   * the competitor's metrics compared to the overall market.
   *
   * @param id - The competitor's unique identifier
   * @returns Competitor with SWOT analysis, or null if not found
   */
  async getAnalysis(id: string) {
    // Get competitor and perform SWOT analysis
    const competitor = await this.getById(id)

    if (!competitor) {
      return null
    }

    // Calculate market position
    const totalMarketQuery = `
      SELECT COALESCE(SUM(lien_amount), 0) as total_market
      FROM ucc_filings
    `
    const marketResult = await database.query<{ total_market: number }>(totalMarketQuery)
    const totalMarket = marketResult[0]?.total_market || 0

    const marketShare = totalMarket > 0 ? (competitor.total_amount / totalMarket) * 100 : 0

    return {
      ...competitor,
      market_share: marketShare,
      analysis: {
        strengths: this.calculateStrengths(competitor, marketShare),
        weaknesses: this.calculateWeaknesses(competitor, marketShare),
        opportunities: this.calculateOpportunities(competitor),
        threats: this.calculateThreats(competitor)
      }
    }
  }

  /**
   * Get aggregate market statistics.
   *
   * @returns Market-wide statistics including total competitors,
   *          filings, market value, and average filing amount
   */
  async getStats() {
    const query = `
      SELECT
        COUNT(DISTINCT secured_party_normalized) as total_competitors,
        COUNT(*) as total_filings,
        COALESCE(SUM(lien_amount), 0) as total_market_value,
        COALESCE(AVG(lien_amount), 0) as avg_filing_amount
      FROM ucc_filings
    `

    const results = await database.query(query)
    return (
      results[0] || {
        total_competitors: 0,
        total_filings: 0,
        total_market_value: 0,
        avg_filing_amount: 0
      }
    )
  }

  /**
   * Calculate strengths based on competitor metrics.
   *
   * @param competitor - The competitor to analyze
   * @param marketShare - The competitor's market share percentage
   * @returns Array of strength statements
   */
  private calculateStrengths(competitor: Competitor, marketShare: number): string[] {
    const strengths: string[] = []

    if (marketShare > 10) {
      strengths.push('Dominant market position')
    }
    if (competitor.filing_count > 100) {
      strengths.push('High volume of transactions')
    }
    if (competitor.avg_amount > 500000) {
      strengths.push('Large average deal size')
    }
    if (competitor.states.length > 5) {
      strengths.push('Geographic diversification')
    }

    return strengths.length > 0 ? strengths : ['Established market presence']
  }

  /**
   * Calculate weaknesses based on competitor metrics.
   *
   * @param competitor - The competitor to analyze
   * @param marketShare - The competitor's market share percentage
   * @returns Array of weakness statements
   */
  private calculateWeaknesses(competitor: Competitor, marketShare: number): string[] {
    const weaknesses: string[] = []

    if (marketShare < 1) {
      weaknesses.push('Limited market share')
    }
    if (competitor.filing_count < 10) {
      weaknesses.push('Low transaction volume')
    }
    if (competitor.states.length < 3) {
      weaknesses.push('Limited geographic reach')
    }

    return weaknesses.length > 0 ? weaknesses : ['Competitive pressure from larger players']
  }

  /**
   * Calculate market opportunities.
   *
   * @param _competitor - The competitor to analyze (unused, for consistency)
   * @returns Array of opportunity statements
   */

  private calculateOpportunities(_competitor: Competitor): string[] {
    return [
      'Expansion into underserved markets',
      'Partnerships with local lenders',
      'Technology-driven efficiency improvements'
    ]
  }

  /**
   * Calculate market threats.
   *
   * @param _competitor - The competitor to analyze (unused, for consistency)
   * @returns Array of threat statements
   */

  private calculateThreats(_competitor: Competitor): string[] {
    return [
      'Increased competition from fintech lenders',
      'Regulatory changes affecting lending practices',
      'Economic downturn reducing lending opportunities'
    ]
  }
}
