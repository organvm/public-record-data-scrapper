import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express, { Express } from 'express'

// Hoist mock functions before module imports so they are initialized before
// apiKeys.ts constructs its module-level ApiKeyService instance.
const { mockCreate, mockList, mockRevoke } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
  mockRevoke: vi.fn()
}))

vi.mock('../../services/ApiKeyService', () => ({
  ApiKeyService: class {
    create(...args: unknown[]) { return mockCreate(...args) }
    list(...args: unknown[]) { return mockList(...args) }
    revoke(...args: unknown[]) { return mockRevoke(...args) }
  }
}))

import apiKeysRouter from '../../routes/apiKeys'

const TEST_ORG = 'org-uuid-1111'
const TEST_KEY_ID = '550e8400-e29b-41d4-a716-446655440001'

function buildTestApp(role = 'admin'): Express {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as { user: { id: string; orgId: string; role: string } }).user = {
      id: 'user-1',
      orgId: TEST_ORG,
      role
    }
    next()
  })
  app.use('/api/keys', apiKeysRouter)
  return app
}

describe('POST /api/keys', () => {
  let app: Express

  beforeEach(() => {
    mockCreate.mockReset()
    app = buildTestApp()
  })

  it('creates a key and returns it with 201', async () => {
    mockCreate.mockResolvedValue({
      id: TEST_KEY_ID,
      orgId: TEST_ORG,
      name: 'prod-integration',
      keyPrefix: 'prk_AAAAAAAA',
      role: 'user',
      key: 'prk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-06-28T00:00:00Z'
    })

    const res = await request(app)
      .post('/api/keys')
      .send({ name: 'prod-integration' })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.data.id).toBe(TEST_KEY_ID)
    expect(res.body.data.key).toMatch(/^prk_/)
    expect(res.body.meta.notice).toContain('shown only once')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: TEST_ORG, name: 'prod-integration' })
    )
  })

  it('returns 400 for missing name', async () => {
    const res = await request(app).post('/api/keys').send({})
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects a name longer than 120 characters', async () => {
    const res = await request(app)
      .post('/api/keys')
      .send({ name: 'x'.repeat(121) })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 when the session has no orgId', async () => {
    const noOrgApp = express()
    noOrgApp.use(express.json())
    noOrgApp.use((req, _res, next) => {
      ;(req as { user: { id: string; role: string } }).user = { id: 'user-1', role: 'admin' }
      next()
    })
    noOrgApp.use('/api/keys', apiKeysRouter)

    const res = await request(noOrgApp).post('/api/keys').send({ name: 'test' })
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('accepts an optional ISO-8601 expiry', async () => {
    mockCreate.mockResolvedValue({
      id: TEST_KEY_ID,
      orgId: TEST_ORG,
      name: 'temp-key',
      keyPrefix: 'prk_BBBBBBBB',
      role: 'user',
      key: 'prk_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBbbbb',
      lastUsedAt: null,
      expiresAt: '2027-01-01T00:00:00Z',
      revokedAt: null,
      createdAt: '2026-06-28T00:00:00Z'
    })

    const res = await request(app)
      .post('/api/keys')
      .send({ name: 'temp-key', expires_at: '2027-01-01T00:00:00Z' })

    expect(res.status).toBe(201)
    expect(res.body.data.expiresAt).toBe('2027-01-01T00:00:00Z')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: new Date('2027-01-01T00:00:00Z') })
    )
  })
})

describe('GET /api/keys', () => {
  let app: Express

  beforeEach(() => {
    mockList.mockReset()
    app = buildTestApp()
  })

  it('returns the org keys list', async () => {
    mockList.mockResolvedValue([
      {
        id: TEST_KEY_ID,
        orgId: TEST_ORG,
        name: 'prod',
        keyPrefix: 'prk_AAAAAAAA',
        role: 'user',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-06-28T00:00:00Z'
      }
    ])

    const res = await request(app).get('/api/keys')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe(TEST_KEY_ID)
    expect(mockList).toHaveBeenCalledWith(TEST_ORG)
  })

  it('returns empty list when org has no keys', async () => {
    mockList.mockResolvedValue([])
    const res = await request(app).get('/api/keys')
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
  })

  it('returns 400 when the session has no orgId', async () => {
    const noOrgApp = express()
    noOrgApp.use(express.json())
    noOrgApp.use((req, _res, next) => {
      ;(req as { user: { id: string; role: string } }).user = { id: 'user-1', role: 'admin' }
      next()
    })
    noOrgApp.use('/api/keys', apiKeysRouter)

    const res = await request(noOrgApp).get('/api/keys')
    expect(res.status).toBe(400)
    expect(mockList).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/keys/:id', () => {
  let app: Express

  beforeEach(() => {
    mockRevoke.mockReset()
    app = buildTestApp()
  })

  it('revokes an existing key and returns 200', async () => {
    mockRevoke.mockResolvedValue(true)

    const res = await request(app).delete(`/api/keys/${TEST_KEY_ID}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data).toMatchObject({ id: TEST_KEY_ID, revoked: true })
    expect(mockRevoke).toHaveBeenCalledWith(TEST_ORG, TEST_KEY_ID)
  })

  it('returns 404 when the key is not found or belongs to another org', async () => {
    mockRevoke.mockResolvedValue(false)

    const res = await request(app).delete(`/api/keys/${TEST_KEY_ID}`)

    expect(res.status).toBe(404)
    expect(res.body.error).toBe('NotFound')
  })

  it('returns 400 for a non-UUID id', async () => {
    const res = await request(app).delete('/api/keys/not-a-uuid')
    expect(res.status).toBe(400)
    expect(mockRevoke).not.toHaveBeenCalled()
  })

  it('returns 400 when the session has no orgId', async () => {
    const noOrgApp = express()
    noOrgApp.use(express.json())
    noOrgApp.use((req, _res, next) => {
      ;(req as { user: { id: string; role: string } }).user = { id: 'user-1', role: 'admin' }
      next()
    })
    noOrgApp.use('/api/keys', apiKeysRouter)

    const res = await request(noOrgApp).delete(`/api/keys/${TEST_KEY_ID}`)
    expect(res.status).toBe(400)
    expect(mockRevoke).not.toHaveBeenCalled()
  })
})
