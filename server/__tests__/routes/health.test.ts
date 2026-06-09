import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import healthRouter from '../../routes/health'

// Mock the database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

import { database } from '../../database/connection'
import {
  evaluateIngestionRecoveryAction,
  recordIngestionFailed,
  resetIngestionCoverageTelemetry
} from '../../queue/queues'

describe('Health Routes', () => {
  let app: Express
  const originalNodeEnv = process.env.NODE_ENV
  const originalEnv = {
    CA_SOS_API_KEY: process.env.CA_SOS_API_KEY,
    TX_SOSDIRECT_API_KEY: process.env.TX_SOSDIRECT_API_KEY,
    TX_SOSDIRECT_ACCOUNT_ID: process.env.TX_SOSDIRECT_ACCOUNT_ID,
    FL_VENDOR_API_KEY: process.env.FL_VENDOR_API_KEY,
    FL_VENDOR_API_SECRET: process.env.FL_VENDOR_API_SECRET,
    FL_VENDOR_CONTRACT_ACTIVE: process.env.FL_VENDOR_CONTRACT_ACTIVE
  }

  beforeEach(() => {
    // Set NODE_ENV to development so we get full response details
    process.env.NODE_ENV = 'development'
    app = express()
    app.use(express.json())
    app.use('/api/health', healthRouter)
    vi.clearAllMocks()
    resetIngestionCoverageTelemetry()
    delete process.env.CA_SOS_API_KEY
    delete process.env.TX_SOSDIRECT_API_KEY
    delete process.env.TX_SOSDIRECT_ACCOUNT_ID
    delete process.env.FL_VENDOR_API_KEY
    delete process.env.FL_VENDOR_API_SECRET
    delete process.env.FL_VENDOR_CONTRACT_ACTIVE
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    Object.assign(process.env, originalEnv)
  })

  describe('GET /api/health', () => {
    it('returns basic health status', async () => {
      const response = await request(app).get('/api/health')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        status: 'ok',
        environment: expect.any(String)
      })
      expect(response.body.timestamp).toBeDefined()
      expect(response.body.uptime).toBeGreaterThanOrEqual(0)
    })

    it('includes environment information', async () => {
      const response = await request(app).get('/api/health')

      expect(response.body.environment).toBe(process.env.NODE_ENV || 'development')
    })
  })

  describe('GET /api/health/detailed', () => {
    it('returns detailed health status when database is healthy', async () => {
      vi.mocked(database.query).mockResolvedValueOnce([{ '?column?': 1 }])

      const response = await request(app).get('/api/health/detailed')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        status: 'ok',
        services: {
          database: 'ok',
          memory: expect.any(String),
          cpu: 'ok'
        }
      })
    })

    it('returns degraded status when database fails', async () => {
      vi.mocked(database.query).mockRejectedValueOnce(new Error('Database connection failed'))

      const response = await request(app).get('/api/health/detailed')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        status: 'degraded',
        services: {
          database: 'error'
        }
      })
    })

    it('includes all service checks', async () => {
      vi.mocked(database.query).mockResolvedValueOnce([{ '?column?': 1 }])

      const response = await request(app).get('/api/health/detailed')

      expect(response.body.services).toBeDefined()
      expect(response.body.services.database).toBeDefined()
      expect(response.body.services.memory).toBeDefined()
      expect(response.body.services.cpu).toBeDefined()
    })
  })

  describe('GET /api/health/ready', () => {
    it('returns ready when database is available', async () => {
      vi.mocked(database.query).mockResolvedValueOnce([{ '?column?': 1 }])

      const response = await request(app).get('/api/health/ready')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        ready: true
      })
      expect(response.body.timestamp).toBeDefined()
    })

    it('returns 503 when database is unavailable', async () => {
      vi.mocked(database.query).mockRejectedValueOnce(new Error('Connection refused'))

      const response = await request(app).get('/api/health/ready')

      expect(response.status).toBe(503)
      expect(response.body).toMatchObject({
        ready: false,
        error: 'Database not ready'
      })
    })
  })

  describe('GET /api/health/live', () => {
    it('returns alive status', async () => {
      const response = await request(app).get('/api/health/live')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        alive: true
      })
      expect(response.body.timestamp).toBeDefined()
    })

    it('always returns 200 for liveness checks', async () => {
      // Liveness probe should always succeed if the process is running
      const response = await request(app).get('/api/health/live')

      expect(response.status).toBe(200)
    })
  })

  describe('GET /api/health/coverage', () => {
    it('returns a 50-state coverage snapshot', async () => {
      const response = await request(app).get('/api/health/coverage')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        mode: 'readiness',
        tier: 'free-tier',
        overallStatus: 'red',
        summary: {
          totalStates: 50,
          implementedStates: 4,
          greenStates: 0,
          yellowStates: 0,
          redStates: 50
        }
      })
      expect(response.body.states).toHaveLength(50)
    })

    it('shows blocked high-value states when live credentials are missing', async () => {
      const response = await request(app).get('/api/health/coverage')
      const stateIndex = Object.fromEntries(
        response.body.states.map((state: { stateCode: string }) => [state.stateCode, state])
      )

      expect(stateIndex.CA).toMatchObject({
        status: 'red',
        primaryStrategy: 'api',
        fallbackStrategy: null,
        isHighValue: true
      })
      expect(stateIndex.TX).toMatchObject({
        status: 'red',
        primaryStrategy: 'bulk',
        fallbackStrategy: null,
        isHighValue: true
      })
      expect(stateIndex.FL).toMatchObject({
        status: 'red',
        primaryStrategy: 'vendor',
        isHighValue: true
      })
      expect(stateIndex.NY).toMatchObject({
        status: 'red',
        primaryStrategy: 'scrape',
        // NY is scheduled since STATE_STRATEGY_PROFILES gained NY: ['scrape'];
        // it stays red until NY_UCC_DEBTOR_SEEDS is configured.
        scheduled: true,
        isHighValue: true
      })
    })

    it('surfaces circuit telemetry when self-healing opens protection for a state', async () => {
      recordIngestionFailed({
        state: 'CA',
        strategy: 'api',
        error: 'Portal timeout',
        timestamp: '2026-03-23T14:00:00.000Z'
      })
      evaluateIngestionRecoveryAction({
        state: 'CA',
        currentStrategy: 'api',
        error: 'Portal timeout',
        timestamp: '2026-03-23T14:00:00.000Z'
      })

      const response = await request(app).get('/api/health/coverage/ca')

      expect(response.status).toBe(200)
      expect(response.body.telemetry).toMatchObject({
        currentStrategy: 'api',
        circuitState: 'open',
        escalationCount: 0,
        lastEscalationReason: null
      })
    })
  })

  describe('GET /api/health/coverage/:stateCode', () => {
    it('returns a single-state readiness snapshot', async () => {
      const response = await request(app).get('/api/health/coverage/ca')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        stateCode: 'CA',
        stateName: 'California',
        status: 'red',
        primaryStrategy: 'api',
        fallbackStrategy: null
      })
    })

    it('returns 404 for unknown state codes', async () => {
      const response = await request(app).get('/api/health/coverage/zz')

      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        message: 'Unknown state code: zz'
      })
    })
  })
})
