import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('@/queue/queues', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/queue/queues')>()
  return {
    ...actual,
    getIngestionCoverageTelemetry: vi.fn(() => [])
  }
})

import { Server } from '@/index'

describe('public route data-tier contract', () => {
  let app: ReturnType<Server['getApp']>

  beforeEach(() => {
    app = new Server().getApp()
  })

  it.each([
    ['root', '/', 200],
    ['status', '/status', 200],
    ['health', '/api/health', 200],
    ['OpenAPI document', '/api/docs/openapi.json', 200],
    ['metrics rejection', '/api/metrics', 401],
    ['billing status', '/api/billing/status', 200]
  ])('advertises the resolved free tier on %s', async (_label, path, expectedStatus) => {
    const response = await request(app).get(path)

    expect(response.status).toBe(expectedStatus)
    expect(response.headers['x-data-tier-resolved']).toBe('free-tier')
  })

  it('advertises the resolved free tier before a webhook rejection', async () => {
    const response = await request(app)
      .post('/api/webhooks/sendgrid/events')
      .set('content-type', 'application/json')
      .send('[]')

    expect(response.status).not.toBe(404)
    expect(response.headers['x-data-tier-resolved']).toBe('free-tier')
  })
})
