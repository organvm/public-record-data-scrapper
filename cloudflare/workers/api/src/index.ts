/**
 * ucc-mca-edge API Worker (Hono).
 *
 * The Express-shaped edge API from telos. Routes are ported from server/routes/*
 * one at a time — security logic first. Today: a public health check and one
 * real org-scoped read (`GET /api/prospects`) demonstrating the full chain:
 * Cloudflare Access JWT → identity → org cross-check → org-scoped D1 query.
 */
import { Hono } from 'hono'
import { accessAuth, orgScope } from './auth'
import { all } from './db'
import { scheduled } from './scheduled'
import type { AppBindings } from './types'

const app = new Hono<AppBindings>()

/** Public liveness probe (no auth — telos invariant #5: observability default-on). */
app.get('/health', (c) => {
  return c.json({ ok: true, env: c.env.ENVIRONMENT })
})

interface ProspectRow {
  id: string
  company_name: string | null
  priority_score: number | null
  status: string | null
}

/**
 * GET /api/prospects — org-scoped prospect list.
 * accessAuth: requires a valid Access JWT with an org_id (else 401).
 * orgScope:  any client-supplied org_id must match the token (else 403).
 * Query is org-scoped at the SQL layer (telos invariant #3).
 */
app.get('/api/prospects', accessAuth, orgScope, async (c) => {
  const { orgId } = c.get('identity')

  // Clamp limit defensively; never trust client pagination as-is.
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '50', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50

  const rows = await all<ProspectRow>(
    c.env,
    `SELECT id, company_name, priority_score, status
       FROM prospects
      WHERE org_id = ?
      ORDER BY priority_score DESC
      LIMIT ?`,
    orgId,
    limit
  )

  return c.json({ prospects: rows })
})

/**
 * Fail-closed error handler. Never leak internals (telos invariant #5: no
 * silent failure, but also no stack traces to clients). Log server-side; return
 * a generic shape matching the Express API.
 */
app.onError((err, c) => {
  console.error('[api] unhandled error', err)
  return c.json(
    { error: { message: 'Internal Server Error', code: 'INTERNAL', statusCode: 500 } },
    500
  )
})

/** 404 fallback in the same envelope as the rest of the API. */
app.notFound((c) => {
  return c.json(
    { error: { message: 'Not Found', code: 'NOT_FOUND', statusCode: 404 } },
    404
  )
})

export default {
  fetch: app.fetch,
  scheduled,
}
