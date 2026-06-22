/**
 * State Collector Factory
 *
 * Factory pattern for creating and managing state-specific UCC filing collectors.
 * Supports lazy loading, caching, tiered fallback, and batch operations.
 *
 * Access Method Tiers (in order of preference):
 * 1. API - Direct state SOS API access (fastest, cheapest per-query)
 * 2. Bulk - Bulk data download/subscription (best for high volume)
 * 3. Vendor - Third-party data vendor access (when state data is privatized)
 * 4. Scrape - Web scraping fallback (slowest, most fragile)
 */

import type { StateCollector } from './types'
import { createCAApiCollector } from './state-collectors/CAApiCollector'
import { createTXBulkCollector } from './state-collectors/TXBulkCollector'
import { createFLVendorCollector } from './state-collectors/FLVendorCollector'
import { createNYScraperCollector } from './state-collectors/NYScraperCollector'

/**
 * Access method types for state data
 */
export type AccessMethod = 'api' | 'bulk' | 'vendor' | 'scrape'

/**
 * State configuration with access methods and costs
 */
export interface StateConfig {
  code: string
  name: string
  /** Available access methods in order of preference */
  accessMethods: AccessMethod[]
  /** Currently active access method */
  activeMethod?: AccessMethod
  /** Whether the state has API access available */
  hasApi: boolean
  /** Whether bulk download is available */
  hasBulk: boolean
  /** Whether vendor data agreement is required */
  requiresVendor: boolean
  /** Estimated cost per 1000 queries */
  costPer1000Queries: Record<AccessMethod, number | null>
  /** Notes about the state's data access */
  notes?: string
}

/**
 * Access attempt result
 */
export interface AccessAttempt {
  method: AccessMethod
  success: boolean
  error?: string
  duration: number
  timestamp: string
}

/**
 * Cost tracking for a state
 */
export interface CostTracking {
  stateCode: string
  period: string
  totalQueries: number
  totalCost: number
  byMethod: Record<AccessMethod, { queries: number; cost: number }>
}

/**
 * State collector registry
 * Maps state codes to their collector instances
 */
type StateCollectorRegistry = Map<string, StateCollector>

/**
 * State collector factory configuration
 */
interface FactoryConfig {
  cacheCollectors?: boolean
  lazyLoad?: boolean
  /** Enable tiered fallback when primary method fails */
  enableFallback?: boolean
  /** Track costs per query */
  trackCosts?: boolean
  /** Maximum fallback attempts before giving up */
  maxFallbackAttempts?: number
}

/**
 * State configurations with access methods and costs
 */
const STATE_CONFIGS: Record<string, StateConfig> = {
  CA: {
    code: 'CA',
    name: 'California',
    accessMethods: ['api'],
    activeMethod: 'api',
    hasApi: true,
    hasBulk: false,
    requiresVendor: false,
    costPer1000Queries: {
      api: 10.0, // $0.01 per query
      bulk: null,
      vendor: null,
      scrape: 0
    },
    notes: 'CA SOS XML API available via bizfileonline.sos.ca.gov'
  },
  TX: {
    code: 'TX',
    name: 'Texas',
    accessMethods: ['bulk'],
    activeMethod: 'bulk',
    hasApi: false,
    hasBulk: true,
    requiresVendor: false,
    costPer1000Queries: {
      api: null,
      bulk: 5.0, // Amortized from subscription
      vendor: null,
      scrape: 0
    },
    notes: 'TX SOSDirect bulk subscription required for data access'
  },
  FL: {
    code: 'FL',
    name: 'Florida',
    accessMethods: ['vendor'],
    activeMethod: 'vendor',
    hasApi: false,
    hasBulk: false,
    requiresVendor: true,
    costPer1000Queries: {
      api: null,
      bulk: null,
      vendor: 25.0, // Higher cost for vendor data
      scrape: null // Not available
    },
    notes: 'FL UCC is privatized via Image API, LLC. Commercial agreement required.'
  },
  NY: {
    code: 'NY',
    name: 'New York',
    accessMethods: ['scrape'],
    activeMethod: 'scrape',
    hasApi: false,
    hasBulk: false,
    requiresVendor: false,
    costPer1000Queries: {
      api: null,
      bulk: null,
      vendor: null,
      scrape: 0
    },
    notes:
      'NY DOS UCC public portal scraper. Credential-gated like FL: set ' +
      'NY_UCC_DEBTOR_SEEDS (comma-separated debtor names) to activate; otherwise ' +
      'the collector reports isReady()=false and is withheld (fail-closed). The ' +
      'portal has no bulk/date-windowed query, so collection is seed-enumeration ' +
      'based. Live-portal extraction is implemented but pending production verification.'
  }
}

/**
 * A concrete collector implementation for one state.
 *
 * `build()` instantiates the collector and applies any credential gate, so it
 * returns `undefined` when the state is implemented but unconfigured (e.g. FL
 * without an active contract, NY without NY_UCC_DEBTOR_SEEDS). Each state is
 * served by exactly one access method; the factory only builds when the
 * requested method matches `method`.
 */
interface CollectorBuilder {
  method: AccessMethod
  build: () => StateCollector | undefined
}

/**
 * Apply the credential gate shared by FL and NY: only expose a collector once
 * it reports `isReady()`, so an unconfigured state fails closed rather than
 * running an empty/fabricated collection.
 */
function whenReady(collector: { isReady(): boolean } | null): StateCollector | undefined {
  return collector?.isReady() ? (collector as unknown as StateCollector) : undefined
}

/**
 * Registry of concrete state collector implementations, keyed by state code.
 * Replaces the per-method switch ladders: adding a state is a single entry.
 */
const COLLECTOR_BUILDERS: Record<string, CollectorBuilder> = {
  CA: { method: 'api', build: () => createCAApiCollector() ?? undefined },
  TX: { method: 'bulk', build: () => createTXBulkCollector() ?? undefined },
  FL: { method: 'vendor', build: () => whenReady(createFLVendorCollector()) },
  NY: { method: 'scrape', build: () => whenReady(createNYScraperCollector()) }
}

/**
 * Enhanced State Collector Factory
 * Creates and manages state-specific collectors with tiered fallback support
 */
export class StateCollectorFactory {
  private registry: StateCollectorRegistry = new Map()
  /** Per-method caches for getCollectorByMethod(), one registry per access method */
  private methodRegistries: Record<AccessMethod, StateCollectorRegistry> = {
    api: new Map(),
    bulk: new Map(),
    vendor: new Map(),
    scrape: new Map()
  }
  private config: Required<FactoryConfig>
  private accessAttempts: AccessAttempt[] = []
  private costTracking: Map<string, CostTracking> = new Map()

  constructor(config: FactoryConfig = {}) {
    this.config = {
      cacheCollectors: config.cacheCollectors ?? true,
      lazyLoad: config.lazyLoad ?? true,
      enableFallback: config.enableFallback ?? true,
      trackCosts: config.trackCosts ?? true,
      maxFallbackAttempts: config.maxFallbackAttempts ?? 3
    }
  }

  /**
   * Get collector for a specific state using tiered fallback
   * Tries methods in order: API -> Bulk -> Vendor -> Scrape
   */
  getCollector(stateCode: string): StateCollector | undefined {
    const normalizedCode = stateCode.toUpperCase()

    // Check cache first
    if (this.config.cacheCollectors && this.registry.has(normalizedCode)) {
      return this.registry.get(normalizedCode)
    }

    // Create collector if lazy loading is enabled
    if (this.config.lazyLoad) {
      const collector = this.createCollectorWithFallback(normalizedCode)
      if (collector && this.config.cacheCollectors) {
        this.registry.set(normalizedCode, collector)
      }
      return collector
    }

    return undefined
  }

  /**
   * Get collector for a specific state and access method
   */
  getCollectorByMethod(stateCode: string, method: AccessMethod): StateCollector | undefined {
    const normalizedCode = stateCode.toUpperCase()
    const registry = this.getRegistryForMethod(method)

    if (registry.has(normalizedCode)) {
      return registry.get(normalizedCode)
    }

    const collector = this.createCollectorForMethod(normalizedCode, method)
    if (collector) {
      registry.set(normalizedCode, collector)
    }
    return collector
  }

  /**
   * Get the appropriate registry for an access method
   */
  private getRegistryForMethod(method: AccessMethod): Map<string, StateCollector> {
    return this.methodRegistries[method]
  }

  /**
   * Create collector with tiered fallback
   */
  private createCollectorWithFallback(stateCode: string): StateCollector | undefined {
    const stateConfig = STATE_CONFIGS[stateCode]
    if (!stateConfig) {
      return undefined
    }

    // Try each access method in order
    for (const method of stateConfig.accessMethods) {
      const collector = this.createCollectorForMethod(stateCode, method)
      if (collector) {
        // Update active method
        stateConfig.activeMethod = method
        return this.wrapWithFallback(collector, stateCode, method)
      }
    }

    return undefined
  }

  /**
   * Create collector for a specific state and access method.
   *
   * Each state is served by a single access method (see COLLECTOR_BUILDERS).
   * Returns undefined when no implementation exists for the state, when the
   * requested method is not the state's method, or when a credential-gated
   * collector (FL/NY) is unconfigured and fails closed.
   */
  private createCollectorForMethod(
    stateCode: string,
    method: AccessMethod
  ): StateCollector | undefined {
    const builder = COLLECTOR_BUILDERS[stateCode]
    return builder?.method === method ? builder.build() : undefined
  }

  /**
   * Wrap collector with fallback support
   */
  private wrapWithFallback(
    collector: StateCollector,
    stateCode: string,
    primaryMethod: AccessMethod
  ): StateCollector {
    if (!this.config.enableFallback) {
      return collector
    }

    const stateConfig = STATE_CONFIGS[stateCode]

    // Create a proxy that falls back on failure
    return new Proxy(collector, {
      get: (target, prop) => {
        const value = target[prop as keyof StateCollector]

        // Wrap async methods with fallback logic
        if (
          typeof value === 'function' &&
          ['searchByBusinessName', 'searchByFilingNumber', 'collectNewFilings'].includes(
            prop as string
          )
        ) {
          return async (...args: unknown[]) => {
            const startTime = Date.now()
            try {
              const result = await (value as (...args: unknown[]) => Promise<unknown>).apply(
                target,
                args
              )
              this.recordAttempt(primaryMethod, true, undefined, Date.now() - startTime)
              this.trackQueryCost(stateCode, primaryMethod)
              return result
            } catch (error) {
              this.recordAttempt(
                primaryMethod,
                false,
                (error as Error).message,
                Date.now() - startTime
              )

              // Try fallback methods
              if (stateConfig) {
                const methodIndex = stateConfig.accessMethods.indexOf(primaryMethod)
                // Count fallback ATTEMPTS rather than bounding by the array
                // index. Previously the loop compared the index `i` against
                // maxFallbackAttempts, so e.g. a primary method at index 2 would
                // never attempt any fallback when maxFallbackAttempts was 3.
                let fallbackAttempts = 0
                for (
                  let i = methodIndex + 1;
                  i < stateConfig.accessMethods.length &&
                  fallbackAttempts < this.config.maxFallbackAttempts;
                  i++, fallbackAttempts++
                ) {
                  const fallbackMethod = stateConfig.accessMethods[i]
                  const fallbackCollector = this.createCollectorForMethod(stateCode, fallbackMethod)

                  if (fallbackCollector) {
                    const fallbackStartTime = Date.now()
                    try {
                      const fallbackValue = fallbackCollector[prop as keyof StateCollector]
                      if (typeof fallbackValue === 'function') {
                        const result = await (
                          fallbackValue as (...args: unknown[]) => Promise<unknown>
                        ).apply(fallbackCollector, args)
                        this.recordAttempt(
                          fallbackMethod,
                          true,
                          undefined,
                          Date.now() - fallbackStartTime
                        )
                        this.trackQueryCost(stateCode, fallbackMethod)
                        return result
                      }
                    } catch (fallbackError) {
                      this.recordAttempt(
                        fallbackMethod,
                        false,
                        (fallbackError as Error).message,
                        Date.now() - fallbackStartTime
                      )
                    }
                  }
                }
              }

              // All methods failed
              throw error
            }
          }
        }

        return value
      }
    })
  }

  /**
   * Record an access attempt for analytics
   */
  private recordAttempt(
    method: AccessMethod,
    success: boolean,
    error: string | undefined,
    duration: number
  ): void {
    this.accessAttempts.push({
      method,
      success,
      error,
      duration,
      timestamp: new Date().toISOString()
    })

    // Keep only last 1000 attempts
    if (this.accessAttempts.length > 1000) {
      this.accessAttempts.shift()
    }
  }

  /**
   * Track query cost
   */
  private trackQueryCost(stateCode: string, method: AccessMethod): void {
    if (!this.config.trackCosts) return

    const period = new Date().toISOString().slice(0, 7) // YYYY-MM
    const key = `${stateCode}-${period}`

    if (!this.costTracking.has(key)) {
      this.costTracking.set(key, {
        stateCode,
        period,
        totalQueries: 0,
        totalCost: 0,
        byMethod: {
          api: { queries: 0, cost: 0 },
          bulk: { queries: 0, cost: 0 },
          vendor: { queries: 0, cost: 0 },
          scrape: { queries: 0, cost: 0 }
        }
      })
    }

    const tracking = this.costTracking.get(key)!
    const stateConfig = STATE_CONFIGS[stateCode]
    const costPer1000 = stateConfig?.costPer1000Queries[method] || 0
    const queryCost = costPer1000 / 1000

    tracking.totalQueries++
    tracking.totalCost += queryCost
    tracking.byMethod[method].queries++
    tracking.byMethod[method].cost += queryCost
  }

  /**
   * Get multiple collectors by state codes
   */
  getCollectors(stateCodes: string[]): Map<string, StateCollector> {
    const collectors = new Map<string, StateCollector>()

    for (const code of stateCodes) {
      const collector = this.getCollector(code)
      if (collector) {
        collectors.set(code.toUpperCase(), collector)
      }
    }

    return collectors
  }

  /**
   * Get all implemented collectors
   */
  getAllCollectors(): Map<string, StateCollector> {
    const implementedStates = this.getImplementedStates()
    return this.getCollectors(implementedStates)
  }

  /**
   * Check if a state has an implemented collector.
   *
   * This reports whether a concrete collector implementation exists for a state
   * (CA, TX, FL, NY). Like FL, a credential-gated state can be "implemented" yet
   * still have getCollector() return undefined when its configuration is absent
   * (FL: contract inactive; NY: NY_UCC_DEBTOR_SEEDS unset). Callers that
   * materialise collectors go through getCollectors(), which skips undefined
   * results, so the gated-but-implemented state never causes a null dereference.
   */
  hasCollector(stateCode: string): boolean {
    const normalizedCode = stateCode.toUpperCase()
    return this.getImplementedStates().includes(normalizedCode)
  }

  /**
   * Get list of states with implemented collectors.
   *
   * Includes every state that has an actual collector implementation wired up
   * via createCollectorForMethod(). Some entries are credential-gated and will
   * only yield a live collector once configured: FL needs an active vendor
   * contract, NY needs NY_UCC_DEBTOR_SEEDS. They are still "implemented" — the
   * collection code exists and is tested — but fail closed when unconfigured.
   */
  getImplementedStates(): string[] {
    // Derived from COLLECTOR_BUILDERS so the implemented set stays in lockstep
    // with the wired-up collectors: CA (API), TX (bulk), FL (vendor, requires
    // active contract), NY (portal scraper, requires NY_UCC_DEBTOR_SEEDS).
    return Object.keys(COLLECTOR_BUILDERS)
  }

  /**
   * Get list of states without collectors (pending implementation)
   */
  getPendingStates(): string[] {
    const allStates = this.getAllStatesCodes()
    const implemented = this.getImplementedStates()
    return allStates.filter((state) => !implemented.includes(state))
  }

  /**
   * Get state configuration
   */
  getStateConfig(stateCode: string): StateConfig | undefined {
    return STATE_CONFIGS[stateCode.toUpperCase()]
  }

  /**
   * Get all state configurations
   */
  getAllStateConfigs(): Record<string, StateConfig> {
    return { ...STATE_CONFIGS }
  }

  /**
   * Get cost tracking data
   */
  getCostTracking(stateCode?: string): CostTracking[] {
    const results: CostTracking[] = []
    for (const [, tracking] of this.costTracking.entries()) {
      if (!stateCode || tracking.stateCode === stateCode.toUpperCase()) {
        results.push(tracking)
      }
    }
    return results
  }

  /**
   * Get access attempt history
   */
  getAccessAttempts(limit: number = 100): AccessAttempt[] {
    return this.accessAttempts.slice(-limit)
  }

  /**
   * Get success rates by method
   */
  getSuccessRates(): Record<AccessMethod, { attempts: number; successes: number; rate: number }> {
    const rates: Record<AccessMethod, { attempts: number; successes: number; rate: number }> = {
      api: { attempts: 0, successes: 0, rate: 0 },
      bulk: { attempts: 0, successes: 0, rate: 0 },
      vendor: { attempts: 0, successes: 0, rate: 0 },
      scrape: { attempts: 0, successes: 0, rate: 0 }
    }

    for (const attempt of this.accessAttempts) {
      rates[attempt.method].attempts++
      if (attempt.success) {
        rates[attempt.method].successes++
      }
    }

    for (const method of Object.keys(rates) as AccessMethod[]) {
      const data = rates[method]
      data.rate = data.attempts > 0 ? data.successes / data.attempts : 0
    }

    return rates
  }

  /**
   * Clear all cached collectors
   */
  clearCache(): void {
    this.registry.clear()
    for (const registry of Object.values(this.methodRegistries)) {
      registry.clear()
    }
  }

  /**
   * Get collector statistics
   */
  getStats() {
    const implemented = this.getImplementedStates()
    const pending = this.getPendingStates()
    const cached = Array.from(this.registry.keys())
    const successRates = this.getSuccessRates()

    return {
      total: this.getAllStatesCodes().length,
      implemented: implemented.length,
      pending: pending.length,
      cached: cached.length,
      implementedStates: implemented,
      pendingStates: pending,
      cachedStates: cached,
      successRates,
      stateConfigs: Object.values(STATE_CONFIGS).map((c) => ({
        code: c.code,
        name: c.name,
        activeMethod: c.activeMethod,
        availableMethods: c.accessMethods
      }))
    }
  }

  /**
   * Get all US state codes (50 states + DC)
   * @private
   */
  private getAllStatesCodes(): string[] {
    return [
      'AL',
      'AK',
      'AZ',
      'AR',
      'CA',
      'CO',
      'CT',
      'DE',
      'FL',
      'GA',
      'HI',
      'ID',
      'IL',
      'IN',
      'IA',
      'KS',
      'KY',
      'LA',
      'ME',
      'MD',
      'MA',
      'MI',
      'MN',
      'MS',
      'MO',
      'MT',
      'NE',
      'NV',
      'NH',
      'NJ',
      'NM',
      'NY',
      'NC',
      'ND',
      'OH',
      'OK',
      'OR',
      'PA',
      'RI',
      'SC',
      'SD',
      'TN',
      'TX',
      'UT',
      'VT',
      'VA',
      'WA',
      'WV',
      'WI',
      'WY',
      'DC'
    ]
  }
}

/**
 * Singleton factory instance
 */
export const stateCollectorFactory = new StateCollectorFactory()

/**
 * Helper function to get a collector for a state
 */
export function getCollectorForState(stateCode: string): StateCollector | undefined {
  return stateCollectorFactory.getCollector(stateCode)
}

/**
 * Helper function to get a collector for a state with specific method
 */
export function getCollectorByMethod(
  stateCode: string,
  method: AccessMethod
): StateCollector | undefined {
  return stateCollectorFactory.getCollectorByMethod(stateCode, method)
}

/**
 * Helper function to check if a state has a collector
 */
export function hasCollectorForState(stateCode: string): boolean {
  return stateCollectorFactory.hasCollector(stateCode)
}

/**
 * Helper function to get state configuration
 */
export function getStateConfig(stateCode: string): StateConfig | undefined {
  return stateCollectorFactory.getStateConfig(stateCode)
}

/**
 * Helper function to get cost tracking
 */
export function getCostTracking(stateCode?: string): CostTracking[] {
  return stateCollectorFactory.getCostTracking(stateCode)
}
