/**
 * Test Utilities and Mock Data
 *
 * Shared utilities, fixtures, and mock data for service tests
 */

import { vi, expect } from 'vitest'
import {
  UCCFiling,
  Prospect,
  GrowthSignal,
  HealthScore,
  SignalType,
  HealthGrade,
  IndustryType
} from '@public-records/core'
import { DataSource, IngestionConfig } from '../DataIngestionService'
import { EnrichmentSource } from '../DataEnrichmentService'

/**
 * Mock UCC Filings
 */
export const createMockUCCFiling = (overrides?: Partial<UCCFiling>): UCCFiling => ({
  id: `filing-${Date.now()}`,
  filingDate: '2024-01-15',
  debtorName: 'Acme Corporation',
  securedParty: 'Big Bank LLC',
  state: 'CA',
  status: 'active',
  filingType: 'UCC-1',
  ...overrides
})

export const createMockUCCFilings = (count: number): UCCFiling[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockUCCFiling({
      id: `filing-${i}`
    })
  )
}

/**
 * Mock Growth Signals
 */
export const createMockGrowthSignal = (overrides?: Partial<GrowthSignal>): GrowthSignal => ({
  id: `sig-${Date.now()}`,
  type: 'hiring' as SignalType,
  description: 'Posted 15 new job openings',
  detectedDate: new Date().toISOString(),
  sourceUrl: 'https://example.com',
  score: 75,
  confidence: 0.85,
  ...overrides
})

export const createMockGrowthSignals = (): GrowthSignal[] => [
  createMockGrowthSignal({ type: 'hiring', description: 'Posted 15 jobs', confidence: 0.85 }),
  createMockGrowthSignal({
    type: 'permit',
    description: 'New construction permit for $2M',
    confidence: 0.9
  }),
  createMockGrowthSignal({
    type: 'contract',
    description: 'Won $500K federal contract',
    confidence: 0.95
  }),
  createMockGrowthSignal({
    type: 'expansion',
    description: 'Opened new facility',
    confidence: 0.8
  }),
  createMockGrowthSignal({
    type: 'equipment',
    description: 'Purchased new machinery',
    confidence: 0.75
  })
]

/**
 * Mock Health Score
 */
export const createMockHealthScore = (overrides?: Partial<HealthScore>): HealthScore => ({
  score: 75,
  grade: 'B' as HealthGrade,
  sentimentTrend: 'stable',
  reviewCount: 15,
  avgSentiment: 0.85,
  violationCount: 0,
  lastUpdated: new Date().toISOString(),
  ...overrides
})

/**
 * Mock Prospect
 */
export const createMockProspect = (overrides?: Partial<Prospect>): Prospect => ({
  id: `prospect-${Date.now()}`,
  companyName: 'Acme Corporation',
  industry: 'technology' as IndustryType,
  state: 'CA',
  status: 'new',
  priorityScore: 75,
  defaultDate: '2024-01-15',
  timeSinceDefault: 30,
  uccFilings: [createMockUCCFiling()],
  growthSignals: createMockGrowthSignals(),
  healthScore: createMockHealthScore(),
  narrative: 'High-potential prospect with strong growth signals',
  estimatedRevenue: 5000000,
  ...overrides
})

export const createMockProspects = (count: number): Prospect[] => {
  return Array.from({ length: count }, (_, i) =>
    createMockProspect({
      id: `prospect-${i}`,
      companyName: `Company ${i}`,
      priorityScore: 50 + i * 5,
      estimatedRevenue: 1000000 + i * 500000
    })
  )
}

/**
 * Mock Data Sources
 */
export const createMockDataSource = (overrides?: Partial<DataSource>): DataSource => ({
  id: 'source-1',
  name: 'California UCC Portal',
  type: 'state-portal',
  endpoint: 'https://api.example.com/ucc',
  rateLimit: 60,
  ...overrides
})

export const createMockDataSources = (): DataSource[] => [
  createMockDataSource({ id: 'ca-portal', name: 'CA UCC Portal', type: 'state-portal' }),
  createMockDataSource({ id: 'ny-portal', name: 'NY UCC Portal', type: 'state-portal' }),
  createMockDataSource({ id: 'api-provider', name: 'Commercial API', type: 'api' })
]

/**
 * Mock Enrichment Sources
 */
export const createMockEnrichmentSource = (
  overrides?: Partial<EnrichmentSource>
): EnrichmentSource => ({
  id: 'enrichment-1',
  name: 'Growth Signal Detector',
  type: 'api',
  capabilities: ['growth-signals'],
  endpoint: 'https://api.example.com/signals',
  ...overrides
})

export const createMockEnrichmentSources = (): EnrichmentSource[] => [
  createMockEnrichmentSource({
    id: 'growth-api',
    name: 'Growth Signals API',
    capabilities: ['growth-signals']
  }),
  createMockEnrichmentSource({
    id: 'health-api',
    name: 'Health Score API',
    capabilities: ['health-score']
  }),
  createMockEnrichmentSource({
    id: 'ml-revenue',
    name: 'Revenue Estimator ML',
    type: 'ml-inference',
    capabilities: ['revenue-estimate']
  }),
  createMockEnrichmentSource({
    id: 'industry-classifier',
    name: 'Industry Classifier',
    type: 'ml-inference',
    capabilities: ['industry-classification']
  })
]

/**
 * Mock Ingestion Config
 */
export const createMockIngestionConfig = (
  overrides?: Partial<IngestionConfig>
): IngestionConfig => ({
  sources: createMockDataSources(),
  batchSize: 100,
  retryAttempts: 3,
  retryDelay: 1000,
  states: ['CA', 'NY', 'TX'],
  ...overrides
})

/**
 * Mock Fetch Responses
 */
export const createMockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Internal Server Error',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: 'https://api.example.com/test',
    clone: function () {
      return this
    },
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData()
  }) as Response

/**
 * Wait Utility for async tests
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Flush Promises
 * Useful for testing async operations
 */
export const flushPromises = (): Promise<void> => {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * Mock Timer Utilities
 */
export class MockTimer {
  private currentTime = 0
  private timers: Array<{ callback: () => void; time: number }> = []

  now(): number {
    return this.currentTime
  }

  setTimeout(callback: () => void, delay: number): number {
    this.timers.push({ callback, time: this.currentTime + delay })
    return this.timers.length - 1
  }

  clearTimeout(id: number): void {
    this.timers[id] = { callback: () => {}, time: -1 }
  }

  advance(ms: number): void {
    this.currentTime += ms
    const readyTimers = this.timers.filter((t) => t.time <= this.currentTime && t.time >= 0)
    readyTimers.forEach((t) => {
      t.callback()
      t.time = -1
    })
  }

  reset(): void {
    this.currentTime = 0
    this.timers = []
  }
}

/**
 * Mock Circuit Breaker State
 */
export const createMockCircuitBreakerState = () => ({
  failures: 0,
  lastFailureTime: null as number | null,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  isOpen: () => false,
  recordSuccess: vi.fn(),
  recordFailure: vi.fn()
})

/**
 * Assertion Helpers
 */
export const expectDateToBeRecent = (dateString: string, maxAgeMs = 5000) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  expect(diff).toBeLessThan(maxAgeMs)
  expect(diff).toBeGreaterThanOrEqual(0)
}

export const expectArrayToContainObject = <T extends Record<string, unknown>>(
  array: T[],
  partialObject: Partial<T>
) => {
  const found = array.some((item) =>
    Object.entries(partialObject).every(([key, value]) => item[key] === value)
  )
  expect(found).toBe(true)
}

/**
 * Mock console methods
 */
export const mockConsole = () => {
  const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info
  }

  const mocks = {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
  }

  console.log = mocks.log
  console.error = mocks.error
  console.warn = mocks.warn
  console.info = mocks.info

  return {
    mocks,
    restore: () => {
      console.log = originalConsole.log
      console.error = originalConsole.error
      console.warn = originalConsole.warn
      console.info = originalConsole.info
    }
  }
}
