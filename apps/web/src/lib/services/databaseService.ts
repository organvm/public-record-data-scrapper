/**
 * Database Service
 *
 * Service layer for fetching and managing prospect data from PostgreSQL
 */

import { initDatabase, getDatabase, createQueryBuilder } from '@/lib/database'
import type {
  Prospect,
  GrowthSignal,
  HealthScore,
  MLScoring,
  CompetitorData,
  PortfolioCompany,
  SignalType,
  IndustryType,
  ProspectStatus
} from '@public-records/core'
import type {
  ProspectRow,
  UCCFilingRow,
  GrowthSignalRow,
  CompetitorRow
} from '@/lib/database/queries'

/**
 * Initialize database connection
 */
export async function initDatabaseService(): Promise<void> {
  try {
    await initDatabase({
      connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/public_records'
    })
    console.log('✅ Database service initialized')
  } catch (error) {
    console.error('❌ Failed to initialize database service:', error)
    throw error
  }
}

/**
 * Convert database row to Prospect type
 */
function mapProspectRowToProspect(
  row: ProspectRow,
  uccFilings: UCCFilingRow[],
  growthSignals: GrowthSignalRow[]
): Prospect {
  // Map growth signals
  const signals: GrowthSignal[] = growthSignals.map((s) => ({
    id: s.id,
    type: s.type as SignalType,
    description: s.description,
    detectedDate: s.detected_date.toISOString().split('T')[0],
    sourceUrl: s.source_url || undefined,
    score: Math.round(s.confidence * 100), // Convert confidence to score
    confidence: s.confidence
  }))

  // Calculate health score from metadata or use default
  const healthScore: HealthScore = (row.health_score as HealthScore) || {
    grade: 'B',
    score: row.priority_score,
    sentimentTrend: 'stable',
    reviewCount: 0,
    avgSentiment: 0.7,
    violationCount: 0,
    lastUpdated: new Date().toISOString().split('T')[0]
  }

  // Map UCC filings
  const filings = uccFilings.map((f) => ({
    id: f.id,
    filingDate: f.filing_date.toISOString().split('T')[0],
    debtorName: f.debtor_name,
    securedParty: f.secured_party,
    state: f.state,
    lienAmount: f.lien_amount,
    status: f.status as 'active' | 'terminated' | 'lapsed',
    filingType: f.filing_type as 'UCC-1' | 'UCC-3'
  }))

  // Build narrative
  const timeSinceDefaultDays = row.time_since_default
  const narrativeParts: string[] = []

  if (timeSinceDefaultDays > 1095) {
    narrativeParts.push(`Defaulted ${Math.floor(timeSinceDefaultDays / 365)} years ago`)
  }
  if (signals.length > 0) {
    const topSignals = signals
      .slice(0, 2)
      .map((s) => s.type)
      .join(', ')
    narrativeParts.push(`showing ${signals.length} growth signals (${topSignals})`)
  }
  narrativeParts.push(`Current health grade: ${healthScore.grade}`)

  return {
    id: row.id,
    companyName: row.company_name,
    industry: row.industry as IndustryType,
    state: row.state,
    status: row.status as ProspectStatus,
    priorityScore: row.priority_score,
    defaultDate: row.default_date.toISOString().split('T')[0],
    timeSinceDefault: row.time_since_default,
    lastFilingDate: row.last_filing_date?.toISOString().split('T')[0],
    uccFilings: filings,
    growthSignals: signals,
    healthScore,
    narrative: narrativeParts.join(', '),
    estimatedRevenue: row.estimated_revenue,
    claimedBy: row.claimed_by || undefined,
    claimedDate: row.claimed_date?.toISOString().split('T')[0],
    mlScoring: (row.ml_scoring as MLScoring) || undefined
  }
}

/**
 * Fetch all prospects from database
 */
export async function fetchProspects(options?: {
  status?: string
  industry?: string
  state?: string
  minScore?: number
  limit?: number
  offset?: number
}): Promise<Prospect[]> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)

    // Get prospects with filters
    const prospectRows = await queries.getProspects(options)

    // Fetch related data for each prospect
    const prospects: Prospect[] = []

    for (const row of prospectRows) {
      // Get UCC filings
      const uccFilings = await queries.getUCCFilingsByProspect(row.id)

      // Get growth signals
      const growthSignals = await queries.getGrowthSignalsByProspect(row.id)

      // Map to Prospect type
      const prospect = mapProspectRowToProspect(row, uccFilings, growthSignals)
      prospects.push(prospect)
    }

    return prospects
  } catch (error) {
    console.error('Failed to fetch prospects:', error)
    throw error
  }
}

/**
 * Fetch single prospect by ID
 */
export async function fetchProspectById(id: string): Promise<Prospect | null> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)

    const row = await queries.getProspectById(id)
    if (!row) return null

    const uccFilings = await queries.getUCCFilingsByProspect(id)
    const growthSignals = await queries.getGrowthSignalsByProspect(id)

    return mapProspectRowToProspect(row, uccFilings, growthSignals)
  } catch (error) {
    console.error('Failed to fetch prospect:', error)
    throw error
  }
}

/**
 * Search prospects by company name
 */
export async function searchProspects(query: string, limit?: number): Promise<Prospect[]> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)

    const prospectRows = await queries.searchProspects(query, limit)

    const prospects: Prospect[] = []
    for (const row of prospectRows) {
      const uccFilings = await queries.getUCCFilingsByProspect(row.id)
      const growthSignals = await queries.getGrowthSignalsByProspect(row.id)
      prospects.push(mapProspectRowToProspect(row, uccFilings, growthSignals))
    }

    return prospects
  } catch (error) {
    console.error('Failed to search prospects:', error)
    throw error
  }
}

/**
 * Update prospect status
 */
export async function updateProspectStatus(
  id: string,
  status: string,
  claimedBy?: string
): Promise<Prospect | null> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)

    const updated = await queries.updateProspect(id, {
      status,
      claimedBy,
      claimedDate: status === 'claimed' ? new Date() : undefined
    })

    if (!updated) return null

    const uccFilings = await queries.getUCCFilingsByProspect(id)
    const growthSignals = await queries.getGrowthSignalsByProspect(id)

    return mapProspectRowToProspect(updated, uccFilings, growthSignals)
  } catch (error) {
    console.error('Failed to update prospect:', error)
    throw error
  }
}

/**
 * Get database statistics for dashboard
 */
export async function fetchDashboardStats() {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)

    const stats = await queries.getProspectStats()
    const newSignalsCount = await queries.getNewSignalsCountForToday()
    const portfolioStats = await queries.getPortfolioStats()

    // Helper to calculate grade from score
    const scoreToGrade = (score: number): 'A' | 'B' | 'C' | 'D' | 'F' => {
      if (score >= 90) return 'A'
      if (score >= 80) return 'B'
      if (score >= 70) return 'C'
      if (score >= 60) return 'D'
      return 'F'
    }

    return {
      totalProspects: stats.total,
      highValueProspects: stats.total > 0 ? Math.round(stats.total * 0.3) : 0, // Estimate
      avgPriorityScore: Math.round(stats.avg_priority_score || 0),
      newSignalsToday: newSignalsCount,
      portfolioAtRisk: portfolioStats.atRisk,
      avgHealthGrade: scoreToGrade(Math.round(stats.avg_health_score || 0))
    }
  } catch (error) {
    console.error('Failed to fetch dashboard stats:', error)
    throw error
  }
}

/**
 * Fetch competitor data
 */
export async function fetchCompetitorData(): Promise<CompetitorData[]> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)
    const competitors = await queries.getCompetitors()

    return competitors.map((row: CompetitorRow) => ({
      lenderName: row.lender_name,
      filingCount: row.filing_count,
      avgDealSize: parseFloat(row.avg_deal_size),
      marketShare: parseFloat(row.market_share),
      industries: row.industries as IndustryType[],
      topState: row.top_state,
      monthlyTrend: parseFloat(row.monthly_trend)
    }))
  } catch (error) {
    console.error('Failed to fetch competitor data:', error)
    return []
  }
}

/**
 * Fetch portfolio companies.
 */
export async function fetchPortfolioCompanies(): Promise<PortfolioCompany[]> {
  // TODO: Wire portfolio tracking data source.
  return []
}

/**
 * Check if database has data
 */
export async function hasDatabaseData(): Promise<boolean> {
  try {
    const db = getDatabase()
    const queries = createQueryBuilder(db)
    const stats = await queries.getProspectStats()
    return stats.total > 0
  } catch (error) {
    console.error('Failed to check database data:', error)
    return false
  }
}
