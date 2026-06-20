import { database } from './database/connection'
import { initializeQueues, closeQueues } from './queue/queues'
import { createIngestionWorker } from './queue/workers/ingestionWorker'
import { createEnrichmentWorker } from './queue/workers/enrichmentWorker'
import { createHealthWorker } from './queue/workers/healthWorker'
import { createOutreachWorker } from './queue/workers/outreachWorker'
import { createDigestWorker } from './queue/workers/digestWorker'
import { createTerminationDetectionWorker } from './queue/workers/terminationDetectionWorker'
import { createVelocityAnalysisWorker } from './queue/workers/velocityAnalysisWorker'
import { createPortalProbeWorker } from './queue/workers/portalProbeWorker'
import { redisConnection } from './queue/connection'
import { config } from './config'
import { createServiceLogger } from './utils/logger'

type ClosableWorker = {
  close: () => Promise<unknown>
}

const workerLogger = createServiceLogger('WorkerProcess')

class WorkerProcess {
  private workers: ClosableWorker[] = []
  private shuttingDown = false

  async start() {
    workerLogger.info('Worker process starting', {
      env: config.server.env,
      redis: `${config.redis.host}:${config.redis.port}`
    })

    try {
      // Connect to database
      await database.connect()

      // Initialize queues
      initializeQueues()

      // Start workers — one consumer per queue the scheduler enqueues into.
      // Every worker registered here is also drained by the 30s graceful
      // shutdown handler below (via the shared this.workers list).
      workerLogger.info('Starting queue workers')
      this.workers.push(createIngestionWorker())
      this.workers.push(createEnrichmentWorker())
      this.workers.push(createHealthWorker())
      this.workers.push(createOutreachWorker())
      this.workers.push(createDigestWorker())
      this.workers.push(createTerminationDetectionWorker())
      this.workers.push(createVelocityAnalysisWorker())
      this.workers.push(createPortalProbeWorker())

      workerLogger.info('Worker process started successfully', { workerCount: this.workers.length })
    } catch (error) {
      workerLogger.error('Failed to start worker process', toError(error))
      process.exit(1)
    }
  }

  async shutdown(signal?: string) {
    // Guard against duplicate SIGTERM/SIGINT triggering concurrent shutdowns.
    if (this.shuttingDown) {
      workerLogger.warn('Shutdown already in progress, ignoring duplicate signal', { signal })
      return
    }
    this.shuttingDown = true

    workerLogger.info('Worker process shutdown started', { signal })

    // Force exit if graceful shutdown hangs (e.g. a job won't drain in time).
    const forceExitTimer = setTimeout(() => {
      workerLogger.error('Worker graceful shutdown timed out after 30s, forcing exit')
      process.exit(1)
    }, 30_000)
    forceExitTimer.unref()

    try {
      // Close workers (drains in-flight jobs)
      workerLogger.info('Closing workers', { workerCount: this.workers.length })
      await Promise.all(this.workers.map((worker) => worker.close()))

      // Close queues
      await closeQueues()

      // Disconnect from Redis
      await redisConnection.disconnect()

      // Disconnect from database
      await database.disconnect()

      workerLogger.info('Worker process shutdown complete')
      clearTimeout(forceExitTimer)
      process.exit(0)
    } catch (error) {
      workerLogger.error('Error during worker shutdown', toError(error))
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
  }
}

// Start worker process
const worker = new WorkerProcess()
worker.start().catch((error) => {
  workerLogger.error('Fatal error during worker startup', toError(error))
  process.exit(1)
})

// Graceful shutdown on termination signals
process.on('SIGTERM', () => {
  void worker.shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  void worker.shutdown('SIGINT')
})

// Process-level safety nets
process.on('unhandledRejection', (reason) => {
  workerLogger.error('Unhandled promise rejection', toError(reason))
  void worker.shutdown('unhandledRejection')
})
process.on('uncaughtException', (error) => {
  workerLogger.error('Uncaught exception', toError(error))
  void worker.shutdown('uncaughtException')
})

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
