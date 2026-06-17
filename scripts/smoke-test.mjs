#!/usr/bin/env node
/**
 * Production smoke test.
 *
 * Polls the API health endpoint until it returns HTTP 200 `{ status: "ok" }`,
 * then exits 0. Exits non-zero if the server never becomes healthy within the
 * timeout. Use after `npm start` (or a deploy) to confirm the runner is live.
 *
 * Usage:
 *   npm run smoke                       # checks http://localhost:3000/api/health
 *   SMOKE_URL=https://api.example.com npm run smoke
 *   node scripts/smoke-test.mjs https://api.example.com/api/health
 *
 * Env:
 *   SMOKE_URL       Base URL or full health URL (default http://localhost:3000)
 *   SMOKE_TIMEOUT   Total seconds to keep retrying (default 30)
 *   SMOKE_INTERVAL  Seconds between attempts (default 2)
 */

const arg = process.argv[2]
const rawUrl = arg || process.env.SMOKE_URL || 'http://localhost:3000'
// Accept either a base URL or a full health URL.
const healthUrl = /\/api\/health\b/.test(rawUrl)
  ? rawUrl
  : rawUrl.replace(/\/+$/, '') + '/api/health'

const timeoutSec = Number(process.env.SMOKE_TIMEOUT || 30)
const intervalSec = Number(process.env.SMOKE_INTERVAL || 2)
const deadline = Date.now() + timeoutSec * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function attempt() {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(healthUrl, { signal: controller.signal })
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` }
    }
    const body = await res.json().catch(() => ({}))
    if (body.status === 'ok' || body.status === 'degraded') {
      return { ok: true, body }
    }
    return { ok: false, reason: `unexpected body: ${JSON.stringify(body)}` }
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'request timed out' : err.message }
  } finally {
    clearTimeout(t)
  }
}

console.log(`[smoke] checking ${healthUrl} (timeout ${timeoutSec}s)`)

let lastReason = 'no attempts made'
while (Date.now() < deadline) {
  const result = await attempt()
  if (result.ok) {
    console.log(`[smoke] ✓ healthy — status=${result.body.status} uptime=${result.body.uptime ?? 'n/a'}s`)
    process.exit(0)
  }
  lastReason = result.reason
  console.log(`[smoke] not ready (${lastReason}) — retrying in ${intervalSec}s`)
  await sleep(intervalSec * 1000)
}

console.error(`[smoke] ✗ failed — server not healthy after ${timeoutSec}s (last error: ${lastReason})`)
process.exit(1)
