/**
 * Verifies the Vercel serverless wiring: the exported `getServerlessApp()`
 * returns a real Express app that serves `/api/*` (the live deployment defect
 * was that every `/api/*` path 404'd), protected routes stay guarded, and the
 * `/_spark/*` fallback degrades gracefully. Also exercises the actual Vercel
 * entrypoint (`api/index.ts`) end-to-end, including its path normalization.
 *
 * No database is required: these routes are either DB-free (liveness) or fail at
 * the auth boundary before touching the database.
 */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import type { IncomingMessage, ServerResponse } from 'http'
import { getServerlessApp } from '../index'
import apiHandler from '../../api/index'
import sparkFallback from '../../api/spark-fallback'

describe('serverless app wiring', () => {
  it('serves the DB-free liveness route under /api (not a 404)', async () => {
    const app = await getServerlessApp()
    const res = await request(app).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.body.alive).toBe(true)
  })

  it('keeps protected routes guarded (401, not 404) when unauthenticated', async () => {
    const app = await getServerlessApp()
    const res = await request(app).get('/api/prospects')
    // The router is mounted and the auth middleware rejects — proving the
    // backend is live and protected, not missing.
    expect(res.status).toBe(401)
  })

  it('keeps API keys route protected (401, not 404)', async () => {
    const app = await getServerlessApp()
    const res = await request(app).get('/api/keys')
    // /api/keys must be mounted — a 404 here means the paying-customer key management route was accidentally dropped from server/index.ts again.
    expect(res.status).toBe(401)
  })

  it('returns the API 404 handler for unknown /api paths', async () => {
    const app = await getServerlessApp()
    const res = await request(app).get('/api/this-route-does-not-exist')
    expect(res.status).toBe(404)
    // Express notFoundHandler responds with JSON, proving our app handled it.
    expect(res.headers['content-type']).toMatch(/json/)
  })

  it('forwards through the Vercel api/index entrypoint to the live app', async () => {
    const listener = (req: IncomingMessage, res: ServerResponse) => {
      void apiHandler(req, res)
    }
    const res = await request(listener).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.body.alive).toBe(true)
  })

  it('spark fallback returns a benign 200 instead of a 404', async () => {
    const captured: { status?: number; body?: string; headers: Record<string, string> } = {
      headers: {}
    }
    const fakeReq = { url: '/_spark/kv/some-key' } as IncomingMessage
    const fakeRes = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        captured.headers[name] = value
      },
      end(body?: string) {
        captured.status = this.statusCode
        captured.body = body
      }
    } as unknown as ServerResponse

    sparkFallback(fakeReq, fakeRes)

    expect(captured.status).toBe(200)
    expect(captured.body).toBe('{}')
    expect(captured.headers['X-Spark-Fallback']).toBe('stub')
  })
})
