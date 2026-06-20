/**
 * Commercial Tier Data Sources (shared)
 *
 * Key-gated adapters for paid commercial enrichment providers:
 * - D&B (Dun & Bradstreet) — business credit / firmographics
 * - Clearbit — company firmographics / tech stack
 * - ZoomInfo — company intelligence (revenue / headcount)
 *
 * Each adapter is FAIL-CLOSED: with no credential configured it returns a named
 * "not configured" error (never fabricated data) and `isConfigured()` is false,
 * so the EnrichmentService skips it entirely. With a credential present it issues
 * a real HTTP request to the provider and returns a named error on any non-2xx.
 *
 * HONESTY NOTE: the request/response shapes below follow each vendor's published
 * REST API but cannot be end-to-end verified here without a paid account. They
 * are wired and fail-closed; the exact field mapping should be confirmed against
 * the customer's specific contract/product tier before relying on the values.
 * No field is invented — anything the provider omits is returned as null.
 *
 * Framework-free (plain `fetch`); runs in apps/web and the Express server.
 */

import { BaseDataSource, DataSourceResponse } from './base-source'
import { readEnv, notConfiguredResponse } from './credentials'

/**
 * D&B (Dun & Bradstreet) Direct+ API — business credit & firmographics.
 *
 * Auth: OAuth bearer token (`DNB_API_KEY`). Real deployments exchange a
 * client_id/secret for a short-lived token; we accept a pre-issued token here so
 * the adapter stays stateless and fail-closed.
 */
export class DnBSource extends BaseDataSource {
  private readonly apiKey: string

  constructor(apiKey?: string) {
    super({
      name: 'dnb',
      tier: 'starter',
      cost: 0.5,
      timeout: 15000,
      retryAttempts: 2,
      retryDelay: 2000
    })
    this.apiKey = (apiKey ?? readEnv('DNB_API_KEY')).trim()
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.isConfigured()) {
      return notConfiguredResponse(this.config.name, 'D&B API key not configured (set DNB_API_KEY)')
    }

    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''
      const state = typeof query.state === 'string' ? query.state : ''

      const searchUrl =
        `https://plus.dnb.com/v1/match/cleanseMatch` +
        `?name=${encodeURIComponent(companyName)}` +
        (state ? `&countryISOAlpha2Code=US&addressRegion=${encodeURIComponent(state)}` : '')

      const response = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`D&B API error: ${response.statusText}`)
      }

      const data = await response.json()
      const match = data?.matchCandidates?.[0]?.organization ?? null

      return {
        dunsNumber: match?.duns ?? null,
        businessName: match?.primaryName ?? null,
        creditRating: match?.dnbAssessment?.standardRating?.rating ?? null,
        employeeCount: match?.numberOfEmployees?.[0]?.value ?? null,
        annualRevenue: match?.financials?.[0]?.yearlyRevenue?.[0]?.value ?? null,
        companyName,
        state
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}

/**
 * Clearbit Company API — firmographics, industry, headcount, revenue estimate.
 *
 * Auth: bearer secret key (`CLEARBIT_API_KEY`). Name lookups use the
 * autocomplete/find endpoint; domain lookups (when a domain is supplied) are
 * more accurate.
 */
export class ClearbitSource extends BaseDataSource {
  private readonly apiKey: string

  constructor(apiKey?: string) {
    super({
      name: 'clearbit',
      tier: 'starter',
      cost: 1.0,
      timeout: 10000,
      retryAttempts: 2,
      retryDelay: 2000
    })
    this.apiKey = (apiKey ?? readEnv('CLEARBIT_API_KEY')).trim()
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.isConfigured()) {
      return notConfiguredResponse(
        this.config.name,
        'Clearbit API key not configured (set CLEARBIT_API_KEY)'
      )
    }

    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''
      const domain = typeof query.domain === 'string' ? query.domain : ''

      const searchUrl = domain
        ? `https://company.clearbit.com/v2/companies/find?domain=${encodeURIComponent(domain)}`
        : `https://company.clearbit.com/v1/domains/find?name=${encodeURIComponent(companyName)}`

      const response = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      })

      if (!response.ok) {
        throw new Error(`Clearbit API error: ${response.statusText}`)
      }

      const data = await response.json()

      return {
        name: data?.name ?? null,
        domain: data?.domain ?? null,
        industry: data?.category?.industry ?? null,
        sector: data?.category?.sector ?? null,
        employeeCount: data?.metrics?.employees ?? null,
        estimatedRevenue: data?.metrics?.estimatedAnnualRevenue ?? null,
        foundedYear: data?.foundedYear ?? null,
        companyName
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return (
      (typeof query.companyName === 'string' && query.companyName.length > 0) ||
      (typeof query.domain === 'string' && query.domain.length > 0)
    )
  }
}

/**
 * ZoomInfo Enrich API — company intelligence (revenue, headcount, industry).
 *
 * Auth: bearer JWT issued from a username/clientId/privateKey pair. We accept a
 * pre-issued token via `ZOOMINFO_API_KEY` so the adapter is stateless and
 * fail-closed; production may add the token-exchange step upstream.
 */
export class ZoomInfoSource extends BaseDataSource {
  private readonly apiToken: string

  constructor(apiToken?: string) {
    super({
      name: 'zoominfo',
      tier: 'starter',
      cost: 2.5,
      timeout: 12000,
      retryAttempts: 2,
      retryDelay: 2000
    })
    this.apiToken = (apiToken ?? readEnv('ZOOMINFO_API_KEY')).trim()
  }

  isConfigured(): boolean {
    return this.apiToken.length > 0
  }

  async fetchData(query: Record<string, unknown>): Promise<DataSourceResponse> {
    if (!this.isConfigured()) {
      return notConfiguredResponse(
        this.config.name,
        'ZoomInfo API key not configured (set ZOOMINFO_API_KEY)'
      )
    }

    return this.executeFetch(async () => {
      const companyName = typeof query.companyName === 'string' ? query.companyName : ''
      const state = typeof query.state === 'string' ? query.state : ''

      const response = await fetch('https://api.zoominfo.com/enrich/company', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          matchCompanyInput: [{ companyName, state }],
          outputFields: ['id', 'name', 'revenue', 'employeeCount', 'industry', 'website']
        })
      })

      if (!response.ok) {
        throw new Error(`ZoomInfo API error: ${response.statusText}`)
      }

      const data = await response.json()
      const company = data?.data?.result?.[0]?.data?.[0] ?? null

      return {
        companyId: company?.id ?? null,
        name: company?.name ?? null,
        revenue: company?.revenue ?? null,
        employeeCount: company?.employeeCount ?? null,
        industry: company?.industry ?? null,
        website: company?.website ?? null,
        companyName,
        state
      }
    }, query)
  }

  protected validateQuery(query: Record<string, unknown>): boolean {
    return typeof query.companyName === 'string' && query.companyName.length > 0
  }
}
