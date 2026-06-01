import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Prospect } from '@public-records/core'

// Mock prospect factory
function createMockProspect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: crypto.randomUUID(),
    companyName: 'Test Company',
    state: 'CA',
    industry: 'technology',
    status: 'new',
    priorityScore: 75,
    defaultDate: '2024-01-15',
    timeSinceDefault: 180,
    uccFilings: [],
    growthSignals: [],
    healthScore: {
      grade: 'C',
      score: 65,
      sentimentTrend: 'stable',
      reviewCount: 10,
      avgSentiment: 3.2,
      violationCount: 2,
      lastUpdated: '2024-01-15'
    },
    narrative: 'Test company narrative',
    ...overrides
  }
}

// Create mock implementations
const mockGenerateProspects = vi.fn(() => [createMockProspect()])
const mockInitDatabaseService = vi.fn()
const mockFetchProspects = vi.fn(() => Promise.resolve([createMockProspect()]))
const mockHasDatabaseData = vi.fn(() => Promise.resolve(true))

// Mock all dependencies at module level
vi.mock('@/lib/demoData', () => ({
  generateProspects: () => mockGenerateProspects()
}))

vi.mock('@/lib/services/databaseService', () => ({
  initDatabaseService: () => mockInitDatabaseService(),
  fetchProspects: () => mockFetchProspects(),
  hasDatabaseData: () => mockHasDatabaseData()
}))

vi.mock('@/lib/services', () => ({
  DataRefreshScheduler: class MockScheduler {
    start = vi.fn()
    stop = vi.fn()
    getStatus = vi.fn(() => ({ isRunning: false }))
    getProspects = vi.fn(() => [])
    refreshProspect = vi.fn()
    triggerIngestion = vi.fn()
  }
}))

vi.mock('@/hooks/useDataTier', () => ({
  useDataTier: () => ({ dataTier: 'oss', setDataTier: vi.fn() })
}))

// Mock feature flags as useDemoData: true by default for simpler tests
vi.mock('@/lib/config/dataPipeline', () => ({
  getDataPipelineConfig: vi.fn().mockReturnValue({}),
  featureFlags: {
    useDemoData: true,
    useMockData: true
  }
}))

describe('useDataPipeline', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('initial state', () => {
    it('should provide all action functions', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      expect(typeof result.current.refresh).toBe('function')
      expect(typeof result.current.startScheduler).toBe('function')
      expect(typeof result.current.stopScheduler).toBe('function')
      expect(typeof result.current.refreshProspect).toBe('function')
      expect(typeof result.current.triggerIngestion).toBe('function')
    })

    it('should have prospects array', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      expect(Array.isArray(result.current.prospects)).toBe(true)
    })

    it('should have error property', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      // Error can be null or a string
      expect(result.current.error === null || typeof result.current.error === 'string').toBe(true)
    })

    it('should have loading property', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      expect(typeof result.current.loading).toBe('boolean')
    })
  })

  describe('async operations', () => {
    it('should load mock data when useMockData is true', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(result.current.loading).toBe(false)
        },
        { timeout: 2000 }
      )

      // Mock data should have been generated
      expect(mockGenerateProspects).toHaveBeenCalled()
    })

    it('should have initial loading state', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      // Initially loading should be true or transition quickly
      expect(typeof result.current.loading).toBe('boolean')
    })

    it('should have no error in successful case', async () => {
      const { useDataPipeline } = await import('../use-data-pipeline')

      const { result } = renderHook(() => useDataPipeline())

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false)
        },
        { timeout: 2000 }
      )

      expect(result.current.error).toBeNull()
    })
  })
})
