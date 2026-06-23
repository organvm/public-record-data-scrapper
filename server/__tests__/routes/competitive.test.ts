import { describe, it, expect, vi, beforeEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'

// Mock database module
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Mock services — hoisted so imports below see the mocked versions
const mockGetGeographicHeatMap = vi.fn()
const mockGetCompetitiveSaturation = vi.fn()
const mockComputeMarketPositions = vi.fn()
const mockComputeVelocity = vi.fn()
const mockDetectAccelerating = vi.fn()
const mockComputeForProspect = vi.fn()

vi.mock('../../services/CompetitiveHeatMapService', () => ({
  CompetitiveHeatMapService: vi.fn().mockImplementation(function () {
    return {
      getGeographicHeatMap: mockGetGeographicHeatMap,
      getCompetitiveSaturation: mockGetCompetitiveSaturation,
      computeMarketPositions: mockComputeMarketPositions
    }
  })
}))

vi.mock('../../services/FilingVelocityService', () => ({
  FilingVelocityService: vi.fn().mockImplementation(function () {
    return {
      computeVelocity: mockComputeVelocity,
      detectAccelerating: mockDetectAccelerating
    }
  })
}))

vi.mock('../../services/FreshCapacityService', () => ({
  FreshCapacityService: vi.fn().mockImplementation(function () {
    return {
      computeForProspect: mockComputeForProspect
    }
  })
}))

import { database } from '../../database/connection'
import competitiveRouter from '../../routes/competitive'

describe('Competitive Intelligence Routes', () => {
  let app: Express

  beforeEach(() => {
    app = express()
    app.use(express.json())
    app.use('/api/competitive', competitiveRouter)
    vi.clearAllMocks()
  })

  describe('GET /api/competitive/saturation/:state', () => {
    it('returns 200 with saturation data for a valid state', async () => {
      const mockSaturation = {
        state: 'CA',
        industry: null,
        competitors: [
          { funder: 'OnDeck', filingCount: 50, uniqueDebtors: 40, rank: 1, marketSharePct: 50.0 }
        ],
        hhi: 2500.0,
        concentrationLevel: 'high'
      }
      mockGetCompetitiveSaturation.mockResolvedValueOnce(mockSaturation)

      const response = await request(app).get('/api/competitive/saturation/CA')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        state: 'CA',
        hhi: expect.any(Number),
        concentrationLevel: expect.any(String),
        competitors: expect.any(Array)
      })
    })

    it('returns 400 for an invalid state code', async () => {
      const response = await request(app).get('/api/competitive/saturation/INVALID')

      expect(response.status).toBe(400)
      expect(response.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed' }
      })
    })

    it('returns 500 when the service throws', async () => {
      mockGetCompetitiveSaturation.mockRejectedValueOnce(new Error('DB error'))

      const response = await request(app).get('/api/competitive/saturation/CA')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to compute saturation' })
    })
  })

  describe('GET /api/competitive/funder/:name', () => {
    it('returns 200 with funder heat map', async () => {
      const mockHeatMap = [
        {
          state: 'CA',
          filingCount: 100,
          activeFilingCount: 80,
          uniqueDebtors: 70,
          marketSharePct: null
        }
      ]
      mockGetGeographicHeatMap.mockResolvedValueOnce(mockHeatMap)

      const response = await request(app).get('/api/competitive/funder/OnDeck')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        funder: 'OnDeck',
        states: expect.any(Array)
      })
    })

    it('returns 500 when heat map service throws', async () => {
      mockGetGeographicHeatMap.mockRejectedValueOnce(new Error('Query failed'))

      const response = await request(app).get('/api/competitive/funder/UnknownFunder')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to get funder heat map' })
    })
  })

  describe('GET /api/competitive/events/recent', () => {
    it('returns 200 with events array', async () => {
      const mockEvents = [
        {
          id: 'evt-1',
          prospectId: 'p-1',
          eventType: 'filing_added',
          filingId: 'f-1',
          eventDate: '2026-03-20T00:00:00Z',
          metadata: {},
          createdAt: '2026-03-20T12:00:00Z'
        }
      ]
      vi.mocked(database.query).mockResolvedValueOnce(mockEvents)

      const response = await request(app).get('/api/competitive/events/recent')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        events: expect.any(Array),
        count: expect.any(Number)
      })
    })

    it('returns 500 when database query throws', async () => {
      vi.mocked(database.query).mockRejectedValueOnce(new Error('Table not found'))

      const response = await request(app).get('/api/competitive/events/recent')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to get recent events' })
    })
  })

  describe('GET /api/competitive/velocity/:prospectId', () => {
    it('returns 200 with velocity metrics', async () => {
      const mockMetrics = [
        { windowDays: 30, filingsInWindow: 5, avgFilingsPerMonth: 5.0, trend: 'accelerating' },
        { windowDays: 90, filingsInWindow: 12, avgFilingsPerMonth: 4.0, trend: 'stable' },
        { windowDays: 365, filingsInWindow: 40, avgFilingsPerMonth: 3.29, trend: 'stable' }
      ]
      mockComputeVelocity.mockResolvedValueOnce(mockMetrics)

      const response = await request(app).get('/api/competitive/velocity/prospect-123')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        prospectId: 'prospect-123',
        metrics: expect.any(Array)
      })
      expect(response.body.metrics).toHaveLength(3)
    })

    it('returns 500 when velocity service throws', async () => {
      mockComputeVelocity.mockRejectedValueOnce(new Error('Computation failed'))

      const response = await request(app).get('/api/competitive/velocity/bad-id')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to compute velocity' })
    })
  })

  describe('GET /api/competitive/capacity/:prospectId', () => {
    it('returns 200 with capacity score', async () => {
      const mockResult = {
        score: 45,
        input: {
          terminatedFilings: 2,
          activeFilings: 1,
          daysSinceRecentTermination: 60,
          recentTerminationAmount: 50000,
          avgActiveAmount: 30000
        }
      }
      mockComputeForProspect.mockResolvedValueOnce(mockResult)

      const response = await request(app).get('/api/competitive/capacity/prospect-456')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        prospectId: 'prospect-456',
        score: expect.any(Number),
        input: expect.any(Object)
      })
    })

    it('returns 500 when capacity service throws', async () => {
      mockComputeForProspect.mockRejectedValueOnce(new Error('No data'))

      const response = await request(app).get('/api/competitive/capacity/bad-id')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to compute capacity' })
    })
  })

  describe('GET /api/competitive/accelerating', () => {
    it('returns 200 with accelerating prospects', async () => {
      const mockProspects = [
        { prospectId: 'p-1', trend30d: 'accelerating', filings30d: 8 },
        { prospectId: 'p-2', trend30d: 'accelerating', filings30d: 5 }
      ]
      mockDetectAccelerating.mockResolvedValueOnce(mockProspects)

      const response = await request(app).get('/api/competitive/accelerating')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({
        prospects: expect.any(Array),
        count: 2
      })
    })

    it('filters by state when query param is provided', async () => {
      mockDetectAccelerating.mockResolvedValueOnce([])

      const response = await request(app).get('/api/competitive/accelerating?state=NY')

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ prospects: [], count: 0 })
    })

    it('returns 500 when detection throws', async () => {
      mockDetectAccelerating.mockRejectedValueOnce(new Error('DB timeout'))

      const response = await request(app).get('/api/competitive/accelerating')

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject({ error: 'Failed to detect accelerating prospects' })
    })
  })
})
