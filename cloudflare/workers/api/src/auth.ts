/**
 * Cloudflare Access (Zero Trust) JWT verification — the higher-order auth from
 * telos: "the org_id the IDOR fix needs arrives in the Access JWT — auth stops
 * being our code."
 *
 * Access puts a signed JWT on every request in the `Cf-Access-Jwt-Assertion`
 * header. We verify it against the team JWKS and extract the tenant (org_id).
 *
 * FAIL CLOSED everywhere: missing header, bad signature, wrong audience, or a
 * token without an org all yield 401 (or 403 for org mismatch). This ports the
 * #234 isolation logic (see server/routes/deals.ts `resolveOrgId`) to the edge.
 */
import { createMiddleware } from 'hono/factory'
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { AppBindings, Identity } from './types'

const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion'

/**
 * JWKS sets are keyed by team domain and cached for the lifetime of the
 * isolate. `createRemoteJWKSet` itself caches keys and only refetches on an
 * unknown `kid`, so this avoids a network round-trip per request.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(teamDomain)
  if (!jwks) {
    const certsUrl = new URL(`https://${teamDomain}/cdn-cgi/access/certs`)
    jwks = createRemoteJWKSet(certsUrl)
    jwksCache.set(teamDomain, jwks)
  }
  return jwks
}

/**
 * Pull the tenant id out of the verified payload. Cloudflare Access emits
 * custom claims either flat (`org_id`) or namespaced (e.g.
 * `https://<team>/org_id`); accept any claim whose key is `org_id` or ends in
 * `/org_id`. Must be a non-empty string.
 */
function extractOrgId(payload: JWTPayload): string | undefined {
  for (const [key, value] of Object.entries(payload)) {
    if ((key === 'org_id' || key.endsWith('/org_id')) && typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

function extractRole(payload: JWTPayload): string | undefined {
  for (const [key, value] of Object.entries(payload)) {
    if ((key === 'role' || key.endsWith('/role')) && typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return undefined
}

/**
 * Verify the Access JWT and return the caller identity, or `null` if the token
 * is missing/invalid/untenanted (the caller maps null → 401).
 */
export async function verifyAccessJwt(
  token: string | undefined,
  teamDomain: string,
  audience: string
): Promise<Identity | null> {
  if (!token || token.length === 0) return null
  if (!teamDomain || !audience) {
    // Misconfigured Worker: refuse rather than accept anything. Fail closed.
    return null
  }

  let payload: JWTPayload
  try {
    const result = await jwtVerify(token, getJwks(teamDomain), {
      issuer: `https://${teamDomain}`,
      audience,
    })
    payload = result.payload
  } catch {
    // Bad signature, expired, wrong audience/issuer — all fail closed.
    return null
  }

  const orgId = extractOrgId(payload)
  if (!orgId) return null

  const email = typeof payload.email === 'string' ? payload.email : undefined
  const role = extractRole(payload)

  return { orgId, email, role }
}

/**
 * Hono middleware: enforce a valid Access JWT and stash the identity.
 * On success: `c.set('identity', identity)`. On any failure: 401, fail closed.
 */
export const accessAuth = createMiddleware<AppBindings>(async (c, next) => {
  const token = c.req.header(ACCESS_HEADER)
  const identity = await verifyAccessJwt(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD)

  if (!identity) {
    return c.json(
      { error: { message: 'Unauthorized', code: 'UNAUTHORIZED', statusCode: 401 } },
      401
    )
  }

  c.set('identity', identity)
  await next()
})

/**
 * Read a client-supplied org_id from query string or JSON body without
 * consuming the body for downstream handlers.
 */
async function readSuppliedOrgId(c: Parameters<Parameters<typeof createMiddleware<AppBindings>>[0]>[0]): Promise<string | undefined> {
  const fromQuery = c.req.query('org_id')
  if (fromQuery !== undefined) return fromQuery

  const contentType = c.req.header('Content-Type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      // Hono caches the parsed body, so downstream `c.req.json()` is unaffected.
      const body = (await c.req.json()) as unknown
      if (body && typeof body === 'object' && 'org_id' in body) {
        const value = (body as Record<string, unknown>).org_id
        if (typeof value === 'string') return value
      }
    } catch {
      // Unparseable body — nothing supplied, let validation handle it later.
      return undefined
    }
  }
  return undefined
}

/**
 * Hono middleware: port of #234 `resolveOrgId` cross-check. The tenant is
 * ALWAYS the token's org. If the client also supplies an `org_id` (query or
 * body) it MUST equal the token's org, or the request is rejected (403).
 *
 * Run AFTER `accessAuth`. Because no-org tokens are already rejected at 401,
 * here we only need the supplied-value cross-check.
 */
export const orgScope = createMiddleware<AppBindings>(async (c, next) => {
  const identity = c.get('identity')

  // Defensive: should never happen if accessAuth ran first. Fail closed.
  if (!identity?.orgId) {
    return c.json(
      { error: { message: 'No organization associated with this account', code: 'FORBIDDEN', statusCode: 403 } },
      403
    )
  }

  const supplied = await readSuppliedOrgId(c)
  if (supplied !== undefined && supplied !== identity.orgId) {
    return c.json(
      { error: { message: 'org_id does not match authenticated organization', code: 'FORBIDDEN', statusCode: 403 } },
      403
    )
  }

  await next()
})
