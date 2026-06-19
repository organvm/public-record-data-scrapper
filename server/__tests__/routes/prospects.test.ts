import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createTestApp, createAuthHeader } from '../helpers/testApp'
import type { Express } from 'express'
import { NotFoundError } from '../../errors'

// Use vi.hoisted to ensure mocks are available when vi.mock runs
const { mockList, mockGetById, mockCreate, mockUpdate, mockDelete, mockQuery } = vi.hoisted(
  () => ({
    mockList: vi.fn(),
    mockGetById: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockQuery: vi.fn()
  })
)

vi.mock('../../database/connection', () => ({
  database: {
    query: mockQuery
  }
}))

// Mock the ProspectsService
vi.mock('../../services/ProspectsService', () => ({
  ProspectsService: class MockProspectsService {
    list = mockList
    getById = mockGetById
    create = mockCreate
    update = mockUpdate
    delete = mockDelete
  }
}))

describe('Prospects API', () => {
  let app: Express
  let authHeader: string

  beforeEach(() => {
    vi.clearAllMocks()
    app = createTestApp()
    authHeader = createAuthHeader('test-user-123', { tier: 'professional' })
  })

  describe('GET /api/prospects', () => {
    it('should return paginated list of prospects', async () => {
      const mockProspects = [
        { id: '1', company_name: 'Company A', state: 'NY', priority_score: 80 },
        { id: '2', company_name: 'Company B', state: 'CA', priority_score: 75 }
      ]

      mockList.mockResolvedValueOnce({
        prospects: mockProspects,
        page: 1,
        limit: 20,
        total: 2
      })

      const response = await request(app).get('/api/prospects').set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('prospects')
      expect(response.body).toHaveProperty('pagination')
      expect(response.body.prospects).toBeInstanceOf(Array)
      expect(response.body.prospects.length).toBe(2)
      expect(response.body.pagination.total).toBe(2)
    })

    it('should filter by state query parameter', async () => {
      const mockProspects = [
        { id: '1', company_name: 'NY Company 1', state: 'NY' },
        { id: '2', company_name: 'NY Company 2', state: 'NY' }
      ]

      mockList.mockResolvedValueOnce({
        prospects: mockProspects,
        page: 1,
        limit: 20,
        total: 2
      })

      const response = await request(app)
        .get('/api/prospects?state=NY')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.prospects.length).toBe(2)

      // Verify service was called with state filter
      expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ state: 'NY' }))
    })

    it('should handle pagination parameters', async () => {
      mockList.mockResolvedValueOnce({
        prospects: Array(10).fill({ id: '1', company_name: 'Test' }),
        page: 2,
        limit: 10,
        total: 25
      })

      const response = await request(app)
        .get('/api/prospects?page=2&limit=10')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.prospects.length).toBe(10)
      expect(response.body.pagination.page).toBe(2)
      expect(response.body.pagination.limit).toBe(10)
      expect(response.body.pagination.total).toBe(25)
    })

    it('should validate pagination parameters', async () => {
      const response = await request(app)
        .get('/api/prospects?page=invalid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })

    it('should support sorting', async () => {
      mockList.mockResolvedValueOnce({
        prospects: [
          { id: '1', company_name: 'High Score', priority_score: 90 },
          { id: '2', company_name: 'Low Score', priority_score: 50 }
        ],
        page: 1,
        limit: 20,
        total: 2
      })

      const response = await request(app)
        .get('/api/prospects?sort_by=priority_score&sort_order=desc')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)

      // Verify service was called with sort params
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          sort_by: 'priority_score',
          sort_order: 'desc'
        })
      )
    })

    it('should filter by score range', async () => {
      mockList.mockResolvedValueOnce({
        prospects: [{ id: '1', priority_score: 75 }],
        page: 1,
        limit: 20,
        total: 1
      })

      const response = await request(app)
        .get('/api/prospects?min_score=60&max_score=85')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)

      // Verify service was called with score filters (query params are transformed to numbers by Zod)
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          min_score: expect.anything(),
          max_score: expect.anything()
        })
      )
    })

    it('should require authentication', async () => {
      const response = await request(app).get('/api/prospects')

      expect(response.status).toBe(401)
    })
  })

  describe('GET /api/prospects/:id', () => {
    it('should return prospect by id', async () => {
      const mockProspect = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        company_name: 'Test Company',
        state: 'NY',
        priority_score: 85
      }

      mockGetById.mockResolvedValueOnce(mockProspect)

      const response = await request(app)
        .get('/api/prospects/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader)

      expect(response.status).toBe(200)
      expect(response.body.id).toBe('550e8400-e29b-41d4-a716-446655440000')
      expect(response.body.company_name).toBe('Test Company')
      expect(response.body.state).toBe('NY')
    })

    it('should return 404 for non-existent prospect', async () => {
      mockGetById.mockResolvedValueOnce(null)

      const response = await request(app)
        .get('/api/prospects/00000000-0000-0000-0000-000000000000')
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error).toBeDefined()
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should validate UUID format', async () => {
      const response = await request(app)
        .get('/api/prospects/invalid-uuid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })
  })

  describe('POST /api/prospects', () => {
    it('should create a new prospect', async () => {
      const prospectData = {
        company_name: 'New Test Company',
        state: 'CA',
        industry: 'technology',
        lien_amount: 750000
      }

      const mockCreated = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        ...prospectData,
        status: 'unclaimed',
        created_at: new Date().toISOString()
      }

      mockCreate.mockResolvedValueOnce(mockCreated)

      const response = await request(app)
        .post('/api/prospects')
        .set('Authorization', authHeader)
        .send(prospectData)

      expect(response.status).toBe(201)
      expect(response.body.id).toBeDefined()
      expect(response.body.company_name).toBe(prospectData.company_name)
      expect(response.body.state).toBe(prospectData.state)
      expect(response.body.industry).toBe(prospectData.industry)
    })

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/prospects')
        .set('Authorization', authHeader)
        .send({
          state: 'CA'
          // missing company_name
        })

      expect(response.status).toBe(400)
      expect(response.body.error).toBeDefined()
    })

    it('should validate state format', async () => {
      const response = await request(app)
        .post('/api/prospects')
        .set('Authorization', authHeader)
        .send({
          company_name: 'Test',
          state: 'INVALID', // should be 2 letters
          industry: 'technology'
        })

      expect(response.status).toBe(400)
    })

    it('should validate industry enum', async () => {
      const response = await request(app)
        .post('/api/prospects')
        .set('Authorization', authHeader)
        .send({
          company_name: 'Test',
          state: 'NY',
          industry: 'invalid_industry'
        })

      expect(response.status).toBe(400)
    })

    it('should return an upsell CTA for free users at the prospect cap', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 10 }])
      const freeAuthHeader = createAuthHeader('free-user', { orgId: 'free-org', tier: 'free' })

      const response = await request(app)
        .post('/api/prospects')
        .set('Authorization', freeAuthHeader)
        .send({
          company_name: 'Test',
          state: 'NY',
          industry: 'technology'
        })

      expect(response.status).toBe(402)
      expect(response.body.error.code).toBe('TIER_UPGRADE_REQUIRED')
      expect(response.body.error.details).toEqual(
        expect.objectContaining({
          reason: 'free_quota_exhausted',
          cta: expect.objectContaining({
            action: 'upgrade_plan',
            href: '/pricing'
          })
        })
      )
      expect(mockCreate).not.toHaveBeenCalled()
    })
  })

  describe('PATCH /api/prospects/:id', () => {
    it('should update prospect fields', async () => {
      const mockUpdated = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        company_name: 'Updated Name',
        state: 'NY',
        priority_score: 85
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .patch('/api/prospects/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader)
        .send({
          company_name: 'Updated Name'
        })

      expect(response.status).toBe(200)
      expect(response.body.company_name).toBe('Updated Name')
    })

    it('should return 404 for non-existent prospect', async () => {
      mockUpdate.mockRejectedValueOnce(
        new NotFoundError('Prospect', '00000000-0000-0000-0000-000000000000')
      )

      const response = await request(app)
        .patch('/api/prospects/00000000-0000-0000-0000-000000000000')
        .set('Authorization', authHeader)
        .send({
          company_name: 'Test'
        })

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should validate update data', async () => {
      const response = await request(app)
        .patch('/api/prospects/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader)
        .send({
          state: 'INVALID' // should be 2 letters
        })

      expect(response.status).toBe(400)
    })

    it('should allow partial updates', async () => {
      const mockUpdated = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        company_name: 'Test Company',
        state: 'NY',
        industry: 'technology'
      }

      mockUpdate.mockResolvedValueOnce(mockUpdated)

      const response = await request(app)
        .patch('/api/prospects/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader)
        .send({
          industry: 'technology'
        })

      expect(response.status).toBe(200)
      expect(response.body.company_name).toBe('Test Company')
      expect(response.body.industry).toBe('technology')
    })
  })

  describe('DELETE /api/prospects/:id', () => {
    it('should delete a prospect', async () => {
      mockDelete.mockResolvedValueOnce(true)

      const response = await request(app)
        .delete('/api/prospects/550e8400-e29b-41d4-a716-446655440000')
        .set('Authorization', authHeader)

      expect(response.status).toBe(204)
    })

    it('should return 404 for non-existent prospect', async () => {
      mockDelete.mockRejectedValueOnce(
        new NotFoundError('Prospect', '00000000-0000-0000-0000-000000000000')
      )

      const response = await request(app)
        .delete('/api/prospects/00000000-0000-0000-0000-000000000000')
        .set('Authorization', authHeader)

      expect(response.status).toBe(404)
      expect(response.body.error.code).toBe('NOT_FOUND')
    })

    it('should validate UUID format', async () => {
      const response = await request(app)
        .delete('/api/prospects/invalid-uuid')
        .set('Authorization', authHeader)

      expect(response.status).toBe(400)
    })
  })
})
