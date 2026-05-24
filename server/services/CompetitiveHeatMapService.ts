export interface GeographicHeatMapEntry {
  state: string
  filingCount: number
  activeFilingCount: number
  uniqueDebtors: number
  marketSharePct: number | null
}

export interface SaturationEntry {
  funder: string
  filingCount: number
  uniqueDebtors: number
  rank: number
  marketSharePct: number
}

export interface SaturationAnalysis {
  state: string
  industry: string | null
  competitors: SaturationEntry[]
  hhi: number
  concentrationLevel: 'high' | 'moderate' | 'competitive'
}

export class CompetitiveHeatMapService {
  constructor(private db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }) {}

  // Where does a specific funder operate?
  async getGeographicHeatMap(funderNormalized: string): Promise<GeographicHeatMapEntry[]> {
    return this.db.query(
      `
      SELECT
        state,
        COUNT(*)::integer as "filingCount",
        COUNT(*) FILTER (WHERE status = 'active')::integer as "activeFilingCount",
        COUNT(DISTINCT debtor_name_normalized)::integer as "uniqueDebtors",
        NULL::numeric as "marketSharePct"
      FROM ucc_filings
      WHERE secured_party_normalized = LOWER(TRIM($1))
      GROUP BY state
      ORDER BY COUNT(*) DESC
    `,
      [funderNormalized]
    )
  }

  // Who dominates a given state? Compute HHI.
  async getCompetitiveSaturation(state: string, industry?: string): Promise<SaturationAnalysis> {
    // Group by the NORMALIZED secured party so name variants ("ABC Funding",
    // "ABC FUNDING ", "abc funding") collapse into a single competitor rather
    // than being counted as separate funders (which would understate each one's
    // share and distort the HHI). A representative raw display name is kept via
    // MAX().
    const query = `
      SELECT
        MAX(secured_party) as funder,
        secured_party_normalized as "funderNormalized",
        COUNT(*)::integer as "filingCount",
        COUNT(DISTINCT debtor_name_normalized)::integer as "uniqueDebtors"
      FROM ucc_filings
      WHERE state = $1
      GROUP BY secured_party_normalized
      ORDER BY COUNT(*) DESC
    `
    const competitors = await this.db.query<{
      funder: string
      funderNormalized: string
      filingCount: number
      uniqueDebtors: number
    }>(query, [state.toUpperCase()])

    // Calculate market shares and HHI
    const totalFilings = competitors.reduce((sum, c) => sum + c.filingCount, 0)

    const ranked: SaturationEntry[] = competitors.map((c, i) => {
      const share = totalFilings > 0 ? (c.filingCount / totalFilings) * 100 : 0
      return {
        funder: c.funder,
        filingCount: c.filingCount,
        uniqueDebtors: c.uniqueDebtors,
        rank: i + 1,
        marketSharePct: Number(share.toFixed(2))
      }
    })

    // HHI must be computed from UNROUNDED shares. Squaring 2-decimal-rounded
    // percentages zeroes out every funder with <0.005% share and biases the
    // index, so we recompute exact shares here from the raw filing counts.
    const hhi =
      totalFilings > 0
        ? competitors.reduce((sum, c) => {
            const exactShare = (c.filingCount / totalFilings) * 100
            return sum + exactShare * exactShare
          }, 0)
        : 0

    return {
      state: state.toUpperCase(),
      industry: industry ?? null,
      competitors: ranked,
      hhi: Number(hhi.toFixed(2)),
      concentrationLevel: hhi > 2500 ? 'high' : hhi > 1500 ? 'moderate' : 'competitive'
    }
  }

  // Persist a market position snapshot for a state
  async computeMarketPositions(state: string): Promise<number> {
    const saturation = await this.getCompetitiveSaturation(state)
    let persisted = 0

    for (const entry of saturation.competitors) {
      await this.db.query(
        `INSERT INTO competitor_market_positions
         (funder_name, funder_normalized, state, snapshot_date, filing_count, active_filing_count, unique_debtors, market_share_pct)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, 0, $5, $6)
         ON CONFLICT (funder_normalized, state, snapshot_date) DO UPDATE SET
           filing_count = EXCLUDED.filing_count,
           unique_debtors = EXCLUDED.unique_debtors,
           market_share_pct = EXCLUDED.market_share_pct`,
        [
          entry.funder,
          entry.funder.toLowerCase().trim(),
          state.toUpperCase(),
          entry.filingCount,
          entry.uniqueDebtors,
          entry.marketSharePct
        ]
      )
      persisted++
    }

    return persisted
  }
}
