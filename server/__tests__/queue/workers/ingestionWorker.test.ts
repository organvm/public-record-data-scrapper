/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

let bullmqAvailable = false
try {
  require.resolve('bullmq')
  bullmqAvailable = true
} catch {
  bullmqAvailable = false
}

const describeConditional = bullmqAvailable ? describe : describe.skip

const mocks = vi.hoisted(() => {
  const mockWorkerOn = vi.fn()
  const mockUpdateProgress = vi.fn().mockResolvedValue(undefined)

  class MockWorker {
    name: string
    processor: (job: any) => Promise<void>
    opts: Record<string, unknown>
    on = mockWorkerOn

    constructor(
      name: string,
      processor: (job: any) => Promise<void>,
      opts: Record<string, unknown>
    ) {
      this.name = name
      this.processor = processor
      this.opts = opts
    }
  }

  const createCollector = () => ({
    searchByBusinessName: vi.fn(),
    searchByFilingNumber: vi.fn(),
    getFilingDetails: vi.fn(),
    collectNewFilings: vi.fn(),
    validateFiling: vi.fn(),
    getStatus: vi.fn()
  })

  return {
    MockWorker,
    mockWorkerOn,
    mockUpdateProgress,
    mockDatabaseQuery: vi.fn(),
    mockRedisConnect: vi.fn().mockReturnValue({ client: {}, subscriber: {} }),
    mockQueueAdd: vi.fn().mockResolvedValue({ id: 'recovery-job-1' }),
    mockGetIngestionQueue: vi.fn(),
    mockEvaluateIngestionRecoveryAction: vi.fn(),
    mockResolveStateIngestionStrategyChain: vi.fn(),
    mockRecordIngestionStarted: vi.fn(),
    mockRecordIngestionCompleted: vi.fn(),
    mockRecordIngestionFailed: vi.fn(),
    mockRecordIngestionQueued: vi.fn(),
    mockRecordIngestionFallbackEscalated: vi.fn(),
    mockResolveUccProvider: vi.fn(),
    mockListEnabledIntegrations: vi.fn(),
    mockCreateCAApiCollector: vi.fn(),
    mockCreateTXBulkCollector: vi.fn(),
    mockCreateFLVendorCollector: vi.fn(),
    mockCreateNYScraperCollector: vi.fn(),
    mockCACollector: createCollector(),
    mockTXCollector: createCollector(),
    mockFLCollector: {
      ...createCollector(),
      isReady: vi.fn(() => true)
    },
    mockNYCollector: {
      ...createCollector(),
      isReady: vi.fn(() => true)
    }
  }
})

vi.mock('bullmq', () => ({
  Worker: mocks.MockWorker
}))

vi.mock('../../../queue/connection', () => ({
  redisConnection: {
    connect: mocks.mockRedisConnect
  }
}))

vi.mock('../../../database/connection', () => ({
  database: {
    query: mocks.mockDatabaseQuery
  }
}))

vi.mock('../../../config/tieredIntegrations', () => ({
  listEnabledIntegrations: mocks.mockListEnabledIntegrations,
  resolveUccProvider: mocks.mockResolveUccProvider
}))

vi.mock('../../../queue/queues', () => ({
  evaluateIngestionRecoveryAction: mocks.mockEvaluateIngestionRecoveryAction,
  getIngestionQueue: mocks.mockGetIngestionQueue,
  recordIngestionStarted: mocks.mockRecordIngestionStarted,
  recordIngestionCompleted: mocks.mockRecordIngestionCompleted,
  recordIngestionFailed: mocks.mockRecordIngestionFailed,
  recordIngestionQueued: mocks.mockRecordIngestionQueued,
  recordIngestionFallbackEscalated: mocks.mockRecordIngestionFallbackEscalated,
  resolveStateIngestionStrategyChain: mocks.mockResolveStateIngestionStrategyChain
}))

vi.mock('../../../../apps/web/src/lib/collectors/state-collectors/CAApiCollector', () => ({
  createCAApiCollector: mocks.mockCreateCAApiCollector
}))

vi.mock('../../../../apps/web/src/lib/collectors/state-collectors/TXBulkCollector', () => ({
  createTXBulkCollector: mocks.mockCreateTXBulkCollector
}))

vi.mock('../../../../apps/web/src/lib/collectors/state-collectors/FLVendorCollector', () => ({
  createFLVendorCollector: mocks.mockCreateFLVendorCollector
}))

vi.mock('../../../../apps/web/src/lib/collectors/state-collectors/NYScraperCollector', () => ({
  createNYScraperCollector: mocks.mockCreateNYScraperCollector
}))

function createFiling(overrides: Partial<Record<string, any>> = {}) {
  return {
    filingNumber: 'CA-0001',
    filingType: 'UCC-1',
    filingDate: '2026-03-20',
    status: 'active',
    state: 'CA',
    debtor: { name: 'Atlas Supply LLC' },
    securedParty: { name: 'Forward Funding' },
    collateral: 'All business assets',
    ...overrides
  }
}

describeConditional('Ingestion Worker', () => {
  let consoleSpy: MockInstance
  let consoleErrorSpy: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    mocks.mockDatabaseQuery.mockResolvedValue([])
    mocks.mockQueueAdd.mockReset().mockResolvedValue({ id: 'recovery-job-1' })
    mocks.mockGetIngestionQueue.mockReset().mockReturnValue({ add: mocks.mockQueueAdd })
    mocks.mockEvaluateIngestionRecoveryAction.mockReset().mockReturnValue({
      action: 'retry',
      nextStrategy: 'api',
      delayMs: 120000,
      backoffUntil: '2026-03-23T16:00:00.000Z',
      reason: 'Retrying api after Portal timeout'
    })
    mocks.mockResolveStateIngestionStrategyChain.mockReset().mockImplementation((state: string) => {
      if (state === 'CA') return ['api']
      if (state === 'TX') return ['bulk']
      if (state === 'FL') return ['vendor']
      if (state === 'NY') return ['scrape']
      return []
    })
    mocks.mockResolveUccProvider.mockReset().mockReturnValue('unconfigured')
    mocks.mockListEnabledIntegrations.mockReset().mockReturnValue([])
    mocks.mockRecordIngestionStarted.mockReset()
    mocks.mockRecordIngestionCompleted.mockReset()
    mocks.mockRecordIngestionFailed.mockReset()
    mocks.mockRecordIngestionQueued.mockReset()
    mocks.mockRecordIngestionFallbackEscalated.mockReset()

    mocks.mockCreateCAApiCollector.mockReset().mockReturnValue(mocks.mockCACollector)
    mocks.mockCreateTXBulkCollector.mockReset().mockReturnValue(mocks.mockTXCollector)
    mocks.mockCreateFLVendorCollector.mockReset().mockReturnValue(mocks.mockFLCollector)
    mocks.mockCreateNYScraperCollector.mockReset().mockReturnValue(mocks.mockNYCollector)

    mocks.mockCACollector.collectNewFilings.mockReset().mockResolvedValue([createFiling()])
    mocks.mockTXCollector.collectNewFilings
      .mockReset()
      .mockResolvedValue([createFiling({ filingNumber: 'TX-0001', state: 'TX' })])
    mocks.mockFLCollector.collectNewFilings
      .mockReset()
      .mockResolvedValue([createFiling({ filingNumber: 'FL-0001', state: 'FL' })])
    mocks.mockFLCollector.isReady.mockReset().mockReturnValue(true)
    mocks.mockNYCollector.collectNewFilings
      .mockReset()
      .mockResolvedValue([createFiling({ filingNumber: 'NY-0001', state: 'NY' })])
    mocks.mockNYCollector.isReady.mockReset().mockReturnValue(true)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    vi.useRealTimers()
    vi.resetModules()
  })

  describe('createIngestionWorker', () => {
    it('creates the worker with the expected queue name and options', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      const worker = createIngestionWorker()

      expect(worker.name).toBe('ucc-ingestion')
      expect(worker.opts).toMatchObject({
        concurrency: 2,
        limiter: {
          max: 10,
          duration: 60000
        }
      })
      expect(mocks.mockRedisConnect).toHaveBeenCalled()
      expect(mocks.mockWorkerOn).toHaveBeenCalledWith('completed', expect.any(Function))
      expect(mocks.mockWorkerOn).toHaveBeenCalledWith('failed', expect.any(Function))
      expect(mocks.mockWorkerOn).toHaveBeenCalledWith('error', expect.any(Function))
      expect(consoleSpy).toHaveBeenCalledWith('✓ Ingestion worker started')
    })
  })

  describe('processIngestion', () => {
    it('collects live filings and persists them', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      mocks.mockCACollector.collectNewFilings.mockResolvedValueOnce([
        createFiling(),
        createFiling({
          filingNumber: 'CA-0002',
          filingType: 'UCC-3',
          status: 'terminated'
        })
      ])

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-1',
        data: { state: 'CA', dataTier: 'free-tier', batchSize: 250 },
        updateProgress: mocks.mockUpdateProgress
      }

      await worker.processor(mockJob as any)

      expect(mocks.mockCACollector.collectNewFilings).toHaveBeenCalledWith({
        since: undefined,
        limit: 250,
        includeInactive: true
      })
      expect(mocks.mockUpdateProgress).toHaveBeenCalledWith(0)
      expect(mocks.mockUpdateProgress).toHaveBeenCalledWith(25)
      expect(mocks.mockUpdateProgress).toHaveBeenCalledWith(60)
      expect(mocks.mockUpdateProgress).toHaveBeenCalledWith(85)
      expect(mocks.mockUpdateProgress).toHaveBeenCalledWith(100)

      expect(mocks.mockRecordIngestionStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'CA',
          jobId: 'job-1',
          dataTier: 'free-tier',
          uccProvider: 'unconfigured',
          strategy: 'api',
          availableStrategies: ['api']
        })
      )

      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ucc_filings'),
        expect.arrayContaining([
          'CA:CA-0001',
          '2026-03-20',
          'Atlas Supply LLC',
          'Forward Funding',
          'CA',
          null,
          'active',
          'UCC-1',
          'ucc_ca_api'
        ])
      )
      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO data_ingestion_logs'),
        expect.arrayContaining([
          'ucc_ca_api',
          'success',
          2,
          expect.stringContaining('"recordsPersisted":2')
        ])
      )
      expect(mocks.mockRecordIngestionCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'CA',
          jobId: 'job-1',
          recordsProcessed: 2
        })
      )
    })

    it('fails without self-heal when the collector is not configured', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      mocks.mockCreateCAApiCollector.mockReturnValueOnce(null)

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-2',
        data: { state: 'CA', dataTier: 'free-tier' },
        updateProgress: mocks.mockUpdateProgress
      }

      const error = await worker.processor(mockJob as any).catch((caught) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('CA API collector is not configured in this environment.')
      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO data_ingestion_logs'),
        ['ucc_ca_api', 'failed', 'CA API collector is not configured in this environment.']
      )
      expect(mocks.mockRecordIngestionFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'CA',
          jobId: 'job-2',
          error: 'CA API collector is not configured in this environment.'
        })
      )
      expect(mocks.mockEvaluateIngestionRecoveryAction).not.toHaveBeenCalled()
      expect(mocks.mockQueueAdd).not.toHaveBeenCalled()
      expect(mocks.mockRecordIngestionFallbackEscalated).not.toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Ingestion Worker] Skipping self-heal for CA because the failure is not retryable'
      )
    })

    it('queues a self-healing retry for retryable collector failures', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      mocks.mockCACollector.collectNewFilings.mockRejectedValueOnce(new Error('Portal timeout'))

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-3',
        data: { state: 'CA', strategy: 'api', fallbackDepth: 0, dataTier: 'free-tier' },
        updateProgress: mocks.mockUpdateProgress
      }

      const error = await worker.processor(mockJob as any).catch((caught) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Portal timeout')
      expect(mocks.mockEvaluateIngestionRecoveryAction).toHaveBeenCalledWith({
        state: 'CA',
        currentStrategy: 'api',
        error: 'Portal timeout'
      })
      expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
        expect.stringContaining('ingest-CA-api-'),
        expect.objectContaining({
          state: 'CA',
          strategy: 'api',
          fallbackDepth: 0,
          selfHealReason: 'Retrying api after Portal timeout'
        }),
        expect.objectContaining({
          priority: 2,
          delay: 120000,
          attempts: 1
        })
      )
      expect(mocks.mockRecordIngestionQueued).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'CA',
          strategy: 'api',
          queuedBy: 'self-heal'
        })
      )
      expect(mocks.mockRecordIngestionFallbackEscalated).not.toHaveBeenCalled()
    })

    it('resolves the NY scraper collector for NY:scrape and persists its filings', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-ny-1',
        data: { state: 'NY', strategy: 'scrape', dataTier: 'free-tier', batchSize: 500 },
        updateProgress: mocks.mockUpdateProgress
      }

      await worker.processor(mockJob as any)

      expect(mocks.mockCreateNYScraperCollector).toHaveBeenCalled()
      expect(mocks.mockNYCollector.isReady).toHaveBeenCalled()
      expect(mocks.mockNYCollector.collectNewFilings).toHaveBeenCalledWith({
        since: undefined,
        limit: 500,
        includeInactive: true
      })
      expect(mocks.mockDatabaseQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ucc_filings'),
        expect.arrayContaining(['NY:NY-0001', 'NY', 'ucc_ny_scrape'])
      )
      expect(mocks.mockRecordIngestionCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'NY', strategy: 'scrape', recordsProcessed: 1 })
      )
    })

    it('fails closed without self-heal when the NY collector is not ready', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      mocks.mockNYCollector.isReady.mockReturnValue(false)

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-ny-2',
        data: { state: 'NY', strategy: 'scrape', dataTier: 'free-tier' },
        updateProgress: mocks.mockUpdateProgress
      }

      const error = await worker.processor(mockJob as any).catch((caught) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe(
        'NY scraper collector is not ready because no debtor seeds are configured (set NY_UCC_DEBTOR_SEEDS).'
      )
      expect(mocks.mockNYCollector.collectNewFilings).not.toHaveBeenCalled()
      expect(mocks.mockEvaluateIngestionRecoveryAction).not.toHaveBeenCalled()
      expect(mocks.mockQueueAdd).not.toHaveBeenCalled()
    })

    it('fails closed without self-heal when the NY collector factory returns null', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      mocks.mockCreateNYScraperCollector.mockReturnValueOnce(null)

      const worker = createIngestionWorker()
      const mockJob = {
        id: 'job-ny-3',
        data: { state: 'NY', strategy: 'scrape', dataTier: 'free-tier' },
        updateProgress: mocks.mockUpdateProgress
      }

      const error = await worker.processor(mockJob as any).catch((caught) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe(
        'NY scraper collector is not ready because no debtor seeds are configured (set NY_UCC_DEBTOR_SEEDS).'
      )
      expect(mocks.mockEvaluateIngestionRecoveryAction).not.toHaveBeenCalled()
    })
  })

  describe('event handlers', () => {
    it('logs completed and failed events', async () => {
      const { createIngestionWorker } = await import('../../../queue/workers/ingestionWorker')

      createIngestionWorker()

      const completedHandler = mocks.mockWorkerOn.mock.calls.find(
        (call) => call[0] === 'completed'
      )?.[1]
      const failedHandler = mocks.mockWorkerOn.mock.calls.find((call) => call[0] === 'failed')?.[1]

      completedHandler({ id: 'job-123' })
      failedHandler({ id: 'job-456' }, new Error('Processing failed'))

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Ingestion Worker] Job job-123 completed successfully'
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Ingestion Worker] Job job-456 failed:',
        'Processing failed'
      )
    })
  })
})

describe('Ingestion Worker Tests - Dependency Check', () => {
  it.skipIf(!bullmqAvailable)('runs when bullmq is installed', () => {
    expect(true).toBe(true)
  })

  it.skipIf(bullmqAvailable)('skips tests because bullmq is not installed', () => {
    console.log('Ingestion worker tests skipped: bullmq package not installed')
    expect(true).toBe(true)
  })
})
