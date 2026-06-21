/**
 * Free Tier Data Sources (shared)
 *
 * Implementation of free public data sources that require no API keys:
 * - SEC EDGAR (company filings)
 * - OSHA Violations (workplace safety enforcement)
 * - USPTO Trademarks (trademark applications)
 * - Census Business Patterns (industry statistics)
 * - SAM.gov (federal contract registration)
 *
 * Framework-free (plain `fetch` + JSON parsing). Consumed by both the web app
 * and the Express server via @public-records/core/enrichment.
 */

import { BaseDataSource, DataSourceResponse } from './base-source'

/**
 * SEC EDGAR API - Company filings and financial data
 */
export class SECEdgarSource extends BaseDataSource {
  constructor() {
    super({
      name: 'sec-edgar',
      tier: 'free',
      cost: 0,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''

      // Search for company CIK (Central Index Key)
      const searchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(companyName)}&action=getcompany&output=json`

      // Note: SEC requires a User-Agent header
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'UCC-MCA-Intelligence Platform contact@example.com'
        }
      })

      if (!response.ok) {
        throw new Error(`SEC API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        cik: data.cik || null,
        companyName: data.name || null,
        sicCode: data.sic || null,
        stateOfIncorporation: data.stateOfIncorporation || null,
        filings: data.filings || []
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}

/**
 * OSHA Violations API - Workplace safety violations
 */
export class OSHASource extends BaseDataSource {
  constructor() {
    super({
      name: 'osha',
      tier: 'free',
      cost: 0,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''

      // OSHA enforcement API
      const searchUrl = `https://data.dol.gov/get/inspection?$filter=estab_name eq '${encodeURIComponent(companyName)}'&$select=activity_nr,estab_name,site_address,site_city,site_state,open_date,close_date,total_current_penalty&$format=json`

      const response = await fetch(searchUrl)

      if (!response.ok) {
        throw new Error(`OSHA API error: ${response.statusText}`)
      }

      const data = await response.json()
      const violations = Array.isArray(data) ? data : []

      return {
        violations: violations.length || 0,
        totalPenalties: violations.reduce((sum: number, violation: Record<string, unknown>) => {
          const penalty =
            typeof violation.total_current_penalty === 'number'
              ? violation.total_current_penalty
              : 0
          return sum + penalty
        }, 0),
        recentViolations: violations.slice(0, 5),
        companyName
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}

/**
 * USPTO Trademark API - Trademark registrations
 */
export class USPTOSource extends BaseDataSource {
  constructor() {
    super({
      name: 'uspto',
      tier: 'free',
      cost: 0,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''

      // USPTO trademark search
      // Note: This is a simplified example - actual API may require authentication
      const searchUrl = `https://developer.uspto.gov/ds-api/trademarks/v1/applications?searchText=${encodeURIComponent(companyName)}`

      const response = await fetch(searchUrl)

      if (!response.ok) {
        throw new Error(`USPTO API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        trademarkCount: data.count || 0,
        trademarks: data.results?.slice(0, 10) || [],
        companyName
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}

/**
 * Census Business Patterns API - Business statistics
 */
export class CensusSource extends BaseDataSource {
  constructor() {
    super({
      name: 'census',
      tier: 'free',
      cost: 0,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const state = typeof query.state === 'string' ? query.state : ''
      const naicsCode = typeof query.naicsCode === 'string' ? query.naicsCode : ''

      // Census Business Patterns API
      const year = new Date().getFullYear() - 1 // Use previous year
      const searchUrl = `https://api.census.gov/data/${year}/cbp?get=NAME,EMP,PAYANN&for=state:${state}&NAICS2017=${naicsCode || ''}`

      const response = await fetch(searchUrl)

      if (!response.ok) {
        throw new Error(`Census API error: ${response.statusText}`)
      }

      const data = await response.json()
      const rows = Array.isArray(data) ? data : []

      return {
        state,
        naicsCode,
        businessCount: rows.length > 1 ? rows[1][1] : 0,
        totalEmployees: rows.length > 1 ? rows[1][2] : 0,
        totalPayroll: rows.length > 1 ? rows[1][3] : 0
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.state === 'string' && query.state.length > 0
  }
}

/**
 * SAM.gov Federal Contracts API - Government contract awards
 */
export class SAMGovSource extends BaseDataSource {
  constructor() {
    super({
      name: 'sam-gov',
      tier: 'free',
      cost: 0,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    })
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''

      // SAM.gov entity information API
      const searchUrl = `https://api.sam.gov/entity-information/v3/entities?legalBusinessName=${encodeURIComponent(companyName)}`

      const response = await fetch(searchUrl)

      if (!response.ok) {
        throw new Error(`SAM.gov API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        isRegistered: data.totalRecords > 0,
        uei: data.entityData?.[0]?.entityRegistration?.ueiSAM || null,
        cageCode: data.entityData?.[0]?.entityRegistration?.cageCode || null,
        contractCount: data.entityData?.[0]?.contractCount || 0,
        companyName
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}
