import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'
import scrapeRouter from '../../routes/scrape'

const mockSearch = vi.fn()
const mockGetStateReadiness = vi.fn()

vi.mock('../../services/UCCSearchService', () => ({
  UCCSearchService: vi.fn(function () {
    return {
      search: mockSearch,
      getStateReadiness: mockGetStateReadiness
    }
  })
}))

describe('POST /api/scrape/ucc', () => {
  let app: Express

  const buildTestApp = () => {
    const testApp = express()
    testApp.use(express.json())

    testApp.use((req, _res, next) => {
      ;(req as { user: { orgId: string; role: string } }).user = {
        orgId: 'test-org',
        role: 'user'
      }
      ;(req as unknown as { dataTier: { resolved: string } }).dataTier = { resolved: 'starter-tier' }
      next()
    })

    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  beforeEach(() => {
    mockSearch.mockReset()
    mockGetStateReadiness.mockReset()
    mockGetStateReadiness.mockReturnValue({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    app = buildTestApp()
  })

  it('returns 400 for missing required body fields', async () => {
    const response = await request(app).post('/api/scrape/ucc').send({ state: 'CA' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns an explicit unavailable-state error before searching', async () => {
    mockGetStateReadiness.mockReturnValue({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })

    const response = await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'XX'
    })

    expect(response.status).toBe(400)
    expect(response.body.success).toBe(false)
    expect(response.body.error.code).toBe('UCC_STATE_UNAVAILABLE')
    expect(response.body.error.details).toMatchObject({ state: 'XX' })
    expect(response.body.error.details.readinessEndpoint).toBe('/api/scrape/readiness/XX')
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('returns success for supported state requests', async () => {
    mockSearch.mockResolvedValue({
      filings: [],
      total: 0,
      state: 'CA',
      companyName: 'Test Corp',
      timestamp: '2026-06-24T00:00:00.000Z'
    })

    const response = await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'ca',
      limit: 50
    })

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data.state).toBe('CA')
    expect(mockSearch).toHaveBeenCalledWith({
      companyName: 'Test Corp',
      state: 'CA',
      limit: 50
    })
  })

  it('enforces state normalization before calling service methods', async () => {
    mockSearch.mockResolvedValue({
      filings: [],
      total: 0,
      state: 'CA',
      companyName: 'Test Corp',
      timestamp: '2026-06-24T00:00:00.000Z'
    })

    await request(app).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'ca'
    })

    expect(mockGetStateReadiness).toHaveBeenCalledWith('CA')
    expect(mockSearch).toHaveBeenCalledWith({
      companyName: 'Test Corp',
      state: 'CA',
      limit: 100
    })
  })

  it('returns 402 when on free-tier', async () => {
    const freeTierApp = express()
    freeTierApp.use(express.json())
    freeTierApp.use((req, _res, next) => {
      ;(req as unknown as { user: { orgId: string; role: string } }).user = { orgId: 'test-org', role: 'user' }
      ;(req as unknown as { dataTier: { resolved: string } }).dataTier = { resolved: 'free-tier' }
      next()
    })
    freeTierApp.use('/api/scrape', scrapeRouter)

    const response = await request(freeTierApp).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'CA'
    })

    expect(response.status).toBe(402)
    expect(response.body.error.code).toBe('TIER_UPGRADE_REQUIRED')
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp).post('/api/scrape/ucc').send({
      company_name: 'Test Corp',
      state: 'CA'
    })

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
    expect(mockGetStateReadiness).not.toHaveBeenCalled()
    expect(mockSearch).not.toHaveBeenCalled()
  })
})

describe('GET /api/scrape/readiness/:stateCode', () => {
  let app: Express

  const buildTestApp = () => {
    const testApp = express()
    testApp.use(express.json())

    testApp.use((req, _res, next) => {
      ;(req as { user: { orgId: string; role: string } }).user = {
        orgId: 'test-org',
        role: 'user'
      }
      ;(req as any).dataTier = { resolved: 'starter-tier' }
      next()
    })

    testApp.use('/api/scrape', scrapeRouter)
    return testApp
  }

  beforeEach(() => {
    mockGetStateReadiness.mockReset()
    mockGetStateReadiness.mockReturnValue({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    app = buildTestApp()
  })

  it('returns availability for a supported state', async () => {
    const response = await request(app).get('/api/scrape/readiness/ca')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      state: 'CA',
      canSearch: true,
      reason: 'Collector ready for state: CA'
    })
    expect(mockGetStateReadiness).toHaveBeenCalledWith('CA')
  })

  it('returns blocked status for unavailable states', async () => {
    mockGetStateReadiness.mockReturnValue({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })

    const response = await request(app).get('/api/scrape/readiness/xx')

    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
    expect(response.body.data).toMatchObject({
      state: 'XX',
      canSearch: false,
      reason: 'No UCC data available for state: XX'
    })
    expect(mockGetStateReadiness).toHaveBeenCalledWith('XX')
  })

  it('returns 400 for invalid state payload', async () => {
    const response = await request(app).get('/api/scrape/readiness/ABC')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('returns 401 when auth is missing', async () => {
    const noAuthApp = express()
    noAuthApp.use(express.json())
    noAuthApp.use('/api/scrape', scrapeRouter)

    const response = await request(noAuthApp).get('/api/scrape/readiness/ca')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
    expect(mockGetStateReadiness).not.toHaveBeenCalled()
  })
})
