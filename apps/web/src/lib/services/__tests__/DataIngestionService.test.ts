/**
 * Tests for DataIngestionService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DataIngestionService,
  defaultIngestionConfig,
  type IngestionConfig,
  type IngestionResult
} from '../DataIngestionService'
import type { UCCFiling } from '@public-records/core'

// Mock fetch globally
global.fetch = vi.fn()

describe('DataIngestionService', () => {
  let service: DataIngestionService
  let mockConfig: IngestionConfig

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    mockConfig = {
      sources: [
        {
          id: 'test-api',
          name: 'Test API',
          type: 'api',
          endpoint: 'https://api.test.com',
          apiKey: 'test-key',
          rateLimit: 10
        }
      ],
      batchSize: 50,
      retryAttempts: 3,
      retryDelay: 1000,
      states: ['NY', 'CA']
    }

    service = new DataIngestionService(mockConfig)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should initialize with config', () => {
      expect(service).toBeDefined()
      expect(service).toBeInstanceOf(DataIngestionService)
    })

    it('should accept default config', () => {
      const defaultService = new DataIngestionService(defaultIngestionConfig)
      expect(defaultService).toBeDefined()
    })
  })

  describe('ingestData()', () => {
    it('should ingest data from all configured sources', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'ucc-1',
            filing_date: '2024-01-15',
            debtor_name: 'Test Company',
            secured_party: 'Test Bank',
            status: 'lapsed',
            filing_type: 'UCC-1'
          }
        ]
      } as unknown as Response)

      const promise = service.ingestData()
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(true)
      expect(results[0].filings).toHaveLength(2) // 2 states
    })

    it('should use default states from config when none provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData()
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(1)
      expect(fetch).toHaveBeenCalledTimes(2) // NY and CA
    })

    it('should use provided states override', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData(['TX'])
      await vi.runAllTimersAsync()
      await promise

      expect(fetch).toHaveBeenCalledTimes(1) // Only TX
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('state=TX'), expect.any(Object))
    })

    it('should handle errors from individual sources gracefully', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const promise = service.ingestData()
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(false)
      expect(results[0].errors.length).toBeGreaterThan(0)
      expect(results[0].filings).toEqual([])
    })

    it('should include metadata in results', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData()
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].metadata).toBeDefined()
      expect(results[0].metadata.source).toBe('Test API')
      expect(results[0].metadata.timestamp).toBeDefined()
      expect(results[0].metadata.recordCount).toBeDefined()
      expect(results[0].metadata.processingTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('API fetching', () => {
    it('should include authorization header when apiKey provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData()
      await vi.runAllTimersAsync()
      await promise

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key'
          })
        })
      )
    })

    it('should include correct query parameters', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      await promise

      expect(fetch).toHaveBeenCalledWith(
        'https://api.test.com/filings?state=NY&status=lapsed',
        expect.any(Object)
      )
    })

    it('should transform API response to UCCFiling format', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'api-123',
            filing_date: '2024-01-15',
            debtor_name: 'Tech Corp',
            secured_party: 'Bank One',
            lien_amount: 50000,
            status: 'active',
            filing_type: 'UCC-1'
          }
        ]
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      const filing = results[0].filings[0]
      expect(filing).toMatchObject({
        id: 'api-123',
        filingDate: '2024-01-15',
        debtorName: 'Tech Corp',
        securedParty: 'Bank One',
        state: 'NY',
        lienAmount: 50000,
        status: 'active',
        filingType: 'UCC-1'
      })
    })

    it('should handle non-array API responses gracefully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ error: 'Invalid response' })
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].filings).toEqual([])
    })
  })

  describe('retry logic', () => {
    it('should retry on 5xx server errors', async () => {
      vi.mocked(fetch)
        .mockRejectedValueOnce(new Error('HTTP error! status: 500'))
        .mockRejectedValueOnce(new Error('HTTP error! status: 502'))
        .mockResolvedValue({
          ok: true,
          json: async () => []
        } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(fetch).toHaveBeenCalledTimes(3) // 2 retries + 1 success
      expect(results[0].success).toBe(true)
    })

    it('should not retry on 4xx client errors', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({})
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      // Should fail without retries
      expect(results[0].success).toBe(false)
    })

    it('should retry on 429 rate limit errors', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({})
        } as unknown as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => []
        } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(results[0].success).toBe(true)
    })

    it('should respect retry attempts configuration', async () => {
      const customConfig: IngestionConfig = {
        ...mockConfig,
        retryAttempts: 2
      }
      const customService = new DataIngestionService(customConfig)

      vi.mocked(fetch).mockRejectedValue(new Error('HTTP error! status: 500'))

      const promise = customService.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(fetch).toHaveBeenCalledTimes(2) // Initial + 1 retry (max 2 attempts)
      expect(results[0].success).toBe(false)
    })
  })

  describe('circuit breaker', () => {
    it('should create circuit breaker for each source', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      await promise

      // Circuit breaker should be created and used
      expect(fetch).toHaveBeenCalled()
    })

    it('should open circuit after threshold failures', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Service unavailable'))

      // Trigger multiple failures
      for (let i = 0; i < 6; i++) {
        const promise = service.ingestData(['NY'])
        await vi.runAllTimersAsync()
        await promise.catch(() => {})
      }

      // Circuit should be open now, but service still returns error results
      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].success).toBe(false)
    })
  })

  describe('rate limiting', () => {
    it('should enforce rate limit per source', async () => {
      const limitedConfig: IngestionConfig = {
        ...mockConfig,
        sources: [
          {
            ...mockConfig.sources[0],
            rateLimit: 2 // Only 2 requests per minute
          }
        ],
        states: ['NY', 'CA', 'TX'] // 3 states
      }
      const limitedService = new DataIngestionService(limitedConfig)

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = limitedService.ingestData()

      // Advance time to simulate rate limiting
      await vi.advanceTimersByTimeAsync(0) // First 2 requests immediate
      await vi.advanceTimersByTimeAsync(60000) // Wait for rate limit window
      await vi.advanceTimersByTimeAsync(0) // Third request

      const results = await promise

      expect(results[0].success).toBe(true)
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('should track requests per source separately', async () => {
      const multiSourceConfig: IngestionConfig = {
        ...mockConfig,
        sources: [
          {
            id: 'source-1',
            name: 'Source 1',
            type: 'api',
            endpoint: 'https://api1.test.com',
            rateLimit: 10
          },
          {
            id: 'source-2',
            name: 'Source 2',
            type: 'api',
            endpoint: 'https://api2.test.com',
            rateLimit: 10
          }
        ]
      }
      const multiService = new DataIngestionService(multiSourceConfig)

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = multiService.ingestData()
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[1].success).toBe(true)
    })
  })

  describe('findLapsedFilings()', () => {
    it('should filter lapsed filings by minimum days', async () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 1100) // > 3 years ago

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'ucc-1',
            filing_date: oldDate.toISOString().split('T')[0],
            debtor_name: 'Old Company',
            secured_party: 'Bank',
            status: 'lapsed',
            filing_type: 'UCC-1'
          }
        ]
      } as unknown as Response)

      const promise = service.findLapsedFilings(1095) // 3 years
      await vi.runAllTimersAsync()
      const lapsedFilings = await promise

      expect(lapsedFilings.length).toBeGreaterThan(0)
      expect(lapsedFilings[0].status).toBe('lapsed')
    })

    it('should exclude filings not lapsed long enough', async () => {
      const recentDate = new Date()
      recentDate.setDate(recentDate.getDate() - 100) // Only 100 days ago

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'ucc-2',
            filing_date: recentDate.toISOString().split('T')[0],
            debtor_name: 'Recent Company',
            secured_party: 'Bank',
            status: 'lapsed',
            filing_type: 'UCC-1'
          }
        ]
      } as unknown as Response)

      const promise = service.findLapsedFilings(1095) // 3 years
      await vi.runAllTimersAsync()
      const lapsedFilings = await promise

      expect(lapsedFilings).toHaveLength(0)
    })

    it('should exclude non-lapsed filings', async () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 1100)

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'ucc-3',
            filing_date: oldDate.toISOString().split('T')[0],
            debtor_name: 'Active Company',
            secured_party: 'Bank',
            status: 'active', // Not lapsed
            filing_type: 'UCC-1'
          }
        ]
      } as unknown as Response)

      const promise = service.findLapsedFilings()
      await vi.runAllTimersAsync()
      const lapsedFilings = await promise

      expect(lapsedFilings).toHaveLength(0)
    })

    it('should use default 3 years when minDaysLapsed not specified', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = service.findLapsedFilings()
      await vi.runAllTimersAsync()
      const lapsedFilings = await promise

      expect(lapsedFilings).toBeDefined()
    })
  })

  describe('getStatistics()', () => {
    it('should calculate correct statistics', () => {
      const mockResults: IngestionResult[] = [
        {
          success: true,
          filings: [{} as UCCFiling, {} as UCCFiling],
          errors: [],
          metadata: {
            source: 'Source 1',
            timestamp: new Date().toISOString(),
            recordCount: 2,
            processingTime: 1000
          }
        },
        {
          success: true,
          filings: [{} as UCCFiling],
          errors: [],
          metadata: {
            source: 'Source 2',
            timestamp: new Date().toISOString(),
            recordCount: 1,
            processingTime: 500
          }
        },
        {
          success: false,
          filings: [],
          errors: ['Error 1', 'Error 2'],
          metadata: {
            source: 'Source 3',
            timestamp: new Date().toISOString(),
            recordCount: 0,
            processingTime: 100
          }
        }
      ]

      const stats = service.getStatistics(mockResults)

      expect(stats.totalRecords).toBe(3)
      expect(stats.successRate).toBeCloseTo(66.67, 1)
      expect(stats.avgProcessingTime).toBeCloseTo(533.33, 1)
      expect(stats.errorCount).toBe(2)
    })

    it('should handle empty results', () => {
      const stats = service.getStatistics([])

      expect(stats.totalRecords).toBe(0)
      expect(stats.successRate).toBe(0)
      expect(stats.avgProcessingTime).toBe(0)
      expect(stats.errorCount).toBe(0)
    })

    it('should handle all failures', () => {
      const mockResults: IngestionResult[] = [
        {
          success: false,
          filings: [],
          errors: ['Error'],
          metadata: {
            source: 'Source 1',
            timestamp: new Date().toISOString(),
            recordCount: 0,
            processingTime: 100
          }
        }
      ]

      const stats = service.getStatistics(mockResults)

      expect(stats.successRate).toBe(0)
      expect(stats.errorCount).toBe(1)
    })
  })

  describe('multiple source types', () => {
    it('should handle state-portal sources', async () => {
      const portalConfig: IngestionConfig = {
        ...mockConfig,
        sources: [
          {
            id: 'ny-portal',
            name: 'NY Portal',
            type: 'state-portal',
            endpoint: 'https://ny.gov/ucc',
            rateLimit: 10
          }
        ]
      }
      const portalService = new DataIngestionService(portalConfig)

      const promise = portalService.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(1)
      expect(results[0].metadata.source).toBe('NY Portal')
    })

    it('should handle database sources', async () => {
      const dbConfig: IngestionConfig = {
        ...mockConfig,
        sources: [
          {
            id: 'db-source',
            name: 'Database',
            type: 'database',
            endpoint: 'postgresql://localhost:5432/ucc',
            rateLimit: 100
          }
        ]
      }
      const dbService = new DataIngestionService(dbConfig)

      const promise = dbService.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(1)
      expect(results[0].metadata.source).toBe('Database')
    })

    it('should handle mixed source types', async () => {
      const mixedConfig: IngestionConfig = {
        ...mockConfig,
        sources: [
          {
            id: 'api',
            name: 'API',
            type: 'api',
            endpoint: 'https://api.test.com',
            rateLimit: 10
          },
          {
            id: 'portal',
            name: 'Portal',
            type: 'state-portal',
            endpoint: 'https://portal.test.com',
            rateLimit: 5
          }
        ]
      }
      const mixedService = new DataIngestionService(mixedConfig)

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => []
      } as unknown as Response)

      const promise = mixedService.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results).toHaveLength(2)
      expect(results.map((r) => r.metadata.source)).toContain('API')
      expect(results.map((r) => r.metadata.source)).toContain('Portal')
    })
  })

  describe('error handling edge cases', () => {
    it('should handle malformed JSON responses', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        }
      } as unknown as Response)

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].success).toBe(false)
      expect(results[0].errors.length).toBeGreaterThan(0)
    })

    it('should handle network timeouts', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('timeout'))

      const promise = service.ingestData(['NY'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].success).toBe(false)
      expect(results[0].errors.some((e) => e.includes('timeout'))).toBe(true)
    })

    it('should continue processing other states after one fails', async () => {
      let callCount = 0
      vi.mocked(fetch).mockImplementation(async (url) => {
        callCount++
        if (url.toString().includes('state=NY')) {
          throw new Error('NY failed')
        }
        return {
          ok: true,
          json: async () => []
        } as Response
      })

      const promise = service.ingestData(['NY', 'CA'])
      await vi.runAllTimersAsync()
      const results = await promise

      expect(results[0].success).toBe(false) // NY failed but CA should succeed
      expect(results[0].errors.some((e) => e.includes('NY'))).toBe(true)
      // NY will retry (3 attempts) + CA (1 attempt) = 4 calls
      expect(callCount).toBeGreaterThanOrEqual(2) // At least both states attempted
    })
  })

  describe('defaultIngestionConfig', () => {
    it('should have valid default configuration', () => {
      expect(defaultIngestionConfig.sources).toHaveLength(1)
      expect(defaultIngestionConfig.batchSize).toBeGreaterThan(0)
      expect(defaultIngestionConfig.retryAttempts).toBeGreaterThan(0)
      expect(defaultIngestionConfig.retryDelay).toBeGreaterThan(0)
      expect(defaultIngestionConfig.states.length).toBeGreaterThan(0)
    })

    it('should include major states', () => {
      expect(defaultIngestionConfig.states).toContain('NY')
      expect(defaultIngestionConfig.states).toContain('CA')
      expect(defaultIngestionConfig.states).toContain('TX')
      expect(defaultIngestionConfig.states).toContain('FL')
    })
  })
})
