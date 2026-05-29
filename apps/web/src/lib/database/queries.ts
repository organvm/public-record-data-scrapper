/**
 * Database Query Utilities
 *
 * Provides type-safe query builders and common database operations
 */

import { DatabaseClient } from './client'
import { UCCFiling, Prospect, GrowthSignal, HealthScore } from '@public-records/core'


// Database Row Types
export interface ProspectRow {
  id: string;
  company_name: string;
  industry: string;
  state: string;
  status: string;
  priority_score: number;
  health_score?: any;
  default_date: Date;
  time_since_default: number;
  last_filing_date?: Date;
  estimated_revenue?: number;
  claimed_by?: string;
  claimed_date?: Date;
  ml_scoring?: any;
}

export interface UCCFilingRow {
  id: string;
  filing_date: Date;
  debtor_name: string;
  secured_party: string;
  state: string;
  lien_amount?: number;
  status: string;
  filing_type?: string;
}

export interface GrowthSignalRow {
  id: string;
  prospect_id: string;
  type: string;
  description: string;
  detected_date: Date;
  source_url?: string;
  confidence: number;
}

export interface CompetitorRow {
  id: string
  lender_name: string
  lender_name_normalized: string
  filing_count: number
  avg_deal_size: string
  market_share: string
  industries: string[]
  top_state: string
  monthly_trend: string
  last_updated: Date
}

export class QueryBuilder {
  private client: DatabaseClient

  constructor(client: DatabaseClient) {
    this.client = client
  }

  // ============================================================================
  // UCC FILINGS
  // ============================================================================

  /**
   * Create UCC filing
   */
  async createUCCFiling(filing: Partial<UCCFiling>): Promise<UCCFiling> {
    const query = `
      INSERT INTO ucc_filings (
        file_number, filing_date, debtor_name, debtor_address,
        secured_party_name, secured_party_address, collateral_description,
        amount, state, status, lapse_date, source, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `

    const values = [
      filing.fileNumber,
      filing.filingDate,
      filing.debtorName,
      filing.debtorAddress,
      filing.securedParty,
      filing.securedPartyAddress,
      filing.collateral,
      filing.amount,
      filing.state,
      filing.status || 'active',
      filing.lapseDate,
      filing.source,
      JSON.stringify(filing)
    ]

    const result = await this.client.query<UCCFiling>(query, values)
    return result.rows[0]
  }

  /**
   * Get UCC filings by state
   */
  async getUCCFilingsByState(state: string, limit: number = 100): Promise<UCCFiling[]> {
    const query = `
      SELECT * FROM ucc_filings
      WHERE state = $1 AND status = 'active'
      ORDER BY filing_date DESC
      LIMIT $2
    `

    const result = await this.client.query<UCCFiling>(query, [state, limit])
    return result.rows
  }

  /**
   * Search UCC filings by debtor name
   */
  async searchUCCFilings(debtorName: string, limit: number = 50): Promise<UCCFiling[]> {
    const query = `
      SELECT * FROM ucc_filings
      WHERE debtor_name ILIKE $1
      ORDER BY filing_date DESC
      LIMIT $2
    `

    const result = await this.client.query<UCCFiling>(query, [`%${debtorName}%`, limit])
    return result.rows
  }

  /**
   * Get UCC filing by file number
   */
  async getUCCFilingByNumber(fileNumber: string): Promise<UCCFiling | null> {
    const query = 'SELECT * FROM ucc_filings WHERE file_number = $1'
    const result = await this.client.query<UCCFiling>(query, [fileNumber])
    return result.rows[0] || null
  }

  // ============================================================================
  // PROSPECTS
  // ============================================================================

  /**
   * Create prospect
   */
  async createProspect(prospect: Partial<Prospect>): Promise<Prospect> {
    const query = `
      INSERT INTO prospects (
        company_id, status, priority_score, health_grade, health_score,
        default_date, days_since_default, estimated_opportunity,
        assigned_to, narrative, tags, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `

    const values = [
      prospect.id, // company_id
      prospect.status || 'new',
      prospect.priorityScore || 0,
      prospect.healthScore?.grade || 'C',
      prospect.healthScore?.overall || 50,
      prospect.defaultDate,
      prospect.timeSinceDefault,
      prospect.estimatedRevenue,
      null, // assigned_to
      prospect.narrative,
      prospect.tags || [],
      JSON.stringify({})
    ]

    const result = await this.client.query<Prospect>(query, values)
    return result.rows[0]
  }

  /**
   * Get prospects by status
   */
  async getProspectsByStatus(status: string, limit: number = 100): Promise<Prospect[]> {
    const query = `
      SELECT p.*, c.name as company_name, c.industry, c.state
      FROM prospects p
      JOIN companies c ON p.company_id = c.id
      WHERE p.status = $1
      ORDER BY p.priority_score DESC
      LIMIT $2
    `

    const result = await this.client.query<Prospect>(query, [status, limit])
    return result.rows
  }

  /**
   * Get top priority prospects
   */
  async getTopProspects(limit: number = 50): Promise<Prospect[]> {
    const query = `
      SELECT p.*, c.name as company_name, c.industry, c.state,
             COUNT(DISTINCT gs.id) as growth_signal_count
      FROM prospects p
      JOIN companies c ON p.company_id = c.id
      LEFT JOIN growth_signals gs ON p.id = gs.prospect_id
      WHERE p.status NOT IN ('closed-won', 'closed-lost')
      GROUP BY p.id, c.id
      ORDER BY p.priority_score DESC, growth_signal_count DESC
      LIMIT $1
    `

    const result = await this.client.query<Prospect>(query, [limit])
    return result.rows
  }

  /**
   * Update prospect status
   */
  async updateProspectStatus(prospectId: string, status: string): Promise<void> {
    const query = 'UPDATE prospects SET status = $1 WHERE id = $2'
    await this.client.query(query, [status, prospectId])
  }

  /**
   * Update prospect priority score
   */
  async updateProspectPriority(prospectId: string, score: number): Promise<void> {
    const query = 'UPDATE prospects SET priority_score = $1 WHERE id = $2'
    await this.client.query(query, [score, prospectId])
  }

  // ============================================================================
  // GROWTH SIGNALS
  // ============================================================================

  /**
   * Create growth signal
   */
  async createGrowthSignal(signal: Partial<GrowthSignal> & { prospectId: string }): Promise<void> {
    const query = `
      INSERT INTO growth_signals (
        prospect_id, type, description,
        detected_date, source_url, score, confidence, raw_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `

    const values = [
      signal.prospectId,
      signal.type,
      signal.description,
      signal.detectedDate || new Date().toISOString().split('T')[0],
      signal.sourceUrl,
      signal.score || 0,
      signal.confidence,
      JSON.stringify(signal)
    ]

    await this.client.query(query, values)
  }

  /**
   * Get growth signals for prospect
   */
  async getGrowthSignalsForProspect(prospectId: string): Promise<GrowthSignal[]> {
    const query = `
      SELECT * FROM growth_signals
      WHERE prospect_id = $1
      ORDER BY detected_date DESC
    `

    const result = await this.client.query<GrowthSignal>(query, [prospectId])
    return result.rows
  }

  /**
   * Get count of new signals detected today
   */
  async getNewSignalsCountForToday(): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM growth_signals
      WHERE detected_date = CURRENT_DATE
    `

    const result = await this.client.query<{ count: string }>(query)
    return parseInt(result.rows[0]?.count || '0', 10)
  }

  // ============================================================================
  // HEALTH METRICS
  // ============================================================================

  /**
   * Create health metric
   */
  async createHealthMetric(companyId: string, healthScore: HealthScore): Promise<void> {
    const query = `
      INSERT INTO health_metrics (
        company_id, metric_date, overall_score,
        payment_history_score, online_reputation_score,
        legal_compliance_score, financial_stability_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `

    const values = [
      companyId,
      new Date().toISOString().split('T')[0], // Today's date
      healthScore.overall,
      healthScore.factors.paymentHistory,
      healthScore.factors.onlineReputation,
      healthScore.factors.legalCompliance,
      healthScore.factors.financialStability
    ]

    await this.client.query(query, values)
  }

  /**
   * Get latest health metric for company
   */
  async getLatestHealthMetric(companyId: string): Promise<HealthScore | null> {
    const query = `
      SELECT * FROM health_metrics
      WHERE company_id = $1
      ORDER BY metric_date DESC
      LIMIT 1
    `

    const result = await this.client.query(query, [companyId])

    if (result.rows.length === 0) return null

    const row = result.rows[0]
    return {
      overall: row.overall_score,
      grade: this.scoreToGrade(row.overall_score),
      factors: {
        paymentHistory: row.payment_history_score,
        onlineReputation: row.online_reputation_score,
        legalCompliance: row.legal_compliance_score,
        financialStability: row.financial_stability_score
      },
      trends: {
        improving: false, // Would need historical comparison
        recentChanges: []
      },
      lastUpdated: row.created_at
    }
  }

  // ============================================================================
  // COMPETITORS
  // ============================================================================

  /**
   * Get competitor data
   */
  async getCompetitors(limit: number = 20): Promise<CompetitorRow[]> {
    const query = `
      SELECT * FROM competitors
      ORDER BY market_share DESC
      LIMIT $1
    `
    const result = await this.client.query<CompetitorRow>(query, [limit])
    return result.rows
  }

  // ============================================================================
  // ANALYTICS
  // ============================================================================

  /**
   * Get prospect statistics
   */
  async getProspectStats(): Promise<{
    total: number
    by_status: Record<string, number>
    avg_priority_score: number
    avg_health_score: number
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        AVG(priority_score) as avg_priority,
        AVG(health_score) as avg_health,
        json_object_agg(status, status_count) as by_status
      FROM (
        SELECT
          status,
          COUNT(*) as status_count,
          AVG(priority_score)::numeric as avg_priority,
          AVG(health_score)::numeric as avg_health
        FROM prospects
        GROUP BY status
      ) stats
    `

    const result = await this.client.query(query)
    const row = result.rows[0]

    return {
      total: parseInt(row.total),
      by_status: row.by_status || {},
      avg_priority_score: parseFloat(row.avg_priority) || 0,
      avg_health_score: parseFloat(row.avg_health) || 0
    }
  }

  /**
   * Get portfolio statistics
   */
  async getPortfolioStats(): Promise<{
    total: number
    atRisk: number
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE current_status IN ('at-risk', 'default')) as at_risk
      FROM portfolio_companies
    `
    const result = await this.client.query(query)
    const row = result.rows[0]

    return {
      total: parseInt(row.total || '0'),
      atRisk: parseInt(row.at_risk || '0')
    }
  }

  /**
   * Get growth signal statistics
   */
  async getGrowthSignalStats(): Promise<{
    total: number
    newToday: number
  }> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE detected_date = CURRENT_DATE) as new_today
      FROM growth_signals
    `
    const result = await this.client.query(query)
    const row = result.rows[0]

    return {
      total: parseInt(row.total || '0'),
      newToday: parseInt(row.new_today || '0')
    }
  }

  /**
   * Get data source performance
   */
  async getDataSourcePerformance(): Promise<unknown[]> {
    const query = 'SELECT * FROM v_data_source_performance ORDER BY total_requests DESC'
    const result = await this.client.query(query)
    return result.rows
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Convert score to grade
   */
  private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= 90) return 'A'
    if (score >= 80) return 'B'
    if (score >= 70) return 'C'
    if (score >= 60) return 'D'
    return 'F'
  }

  /**
   * Bulk insert (for performance)
   */
  async bulkInsert(table: string, columns: string[], values: unknown[][]): Promise<void> {
    if (values.length === 0) return

    // Validate table name (alphanumeric and underscores only)
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new Error(`Invalid table name: ${table}`)
    }

    // Validate column names
    for (const column of columns) {
      if (!/^[a-zA-Z0-9_]+$/.test(column)) {
        throw new Error(`Invalid column name: ${column}`)
      }
    }

    const placeholders = values
      .map((_, i) => {
        const rowPlaceholders = columns.map((_, j) => `$${i * columns.length + j + 1}`)
        return `(${rowPlaceholders.join(', ')})`
      })
      .join(', ')

    const query = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`
    const flatValues = values.flat()

    await this.client.query(query, flatValues)
  }
}

/**
 * Create query builder instance
 */
export function createQueryBuilder(client: DatabaseClient): QueryBuilder {
  return new QueryBuilder(client)
}
