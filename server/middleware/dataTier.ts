import type { Request, Response, NextFunction } from 'express'
import { database } from '../database/connection'

export type RequestedDataTier = 'oss' | 'paid' | 'unknown'
export type ResolvedDataTier = 'free-tier' | 'starter-tier'

export interface DataTierContext {
  requested: RequestedDataTier
  resolved: ResolvedDataTier
}

export interface DataTierRequest extends Request {
  dataTier?: DataTierContext
  // Populated by authMiddleware; used as the trusted entitlement source.
  user?: { id: string; email?: string; role?: string; orgId?: string; tier?: string }
}

const OSS_ALIASES = new Set(['oss', 'open', 'free', 'free-tier', 'community', 'base'])

const PAID_ALIASES = new Set(['paid', 'starter', 'starter-tier', 'pro', 'premium'])

// The most restrictive tier — used as the fail-safe default so a client cannot
// escalate its entitlement by sending a header or omitting authentication.
const DEFAULT_RESOLVED_TIER: ResolvedDataTier = 'free-tier'

// In-process cache of resolved entitlement keyed by org id, with a short TTL to
// avoid a DB round-trip on every request while still picking up plan changes
// within a minute. Bounded implicitly by the number of active orgs.
const ENTITLEMENT_CACHE_TTL_MS = 60_000
interface CacheEntry {
  tier: ResolvedDataTier
  expiresAt: number
}
const entitlementCache = new Map<string, CacheEntry>()

/**
 * Map a billing `subscription_tier` (database source of truth — see
 * 004_multitenancy.sql: free | starter | professional | enterprise) onto the
 * application's coarse data tier. Anything other than 'free' (or unknown)
 * grants the paid 'starter-tier'. Unknown/missing values fail closed.
 */
export function mapSubscriptionTierToDataTier(
  subscriptionTier: string | null | undefined
): ResolvedDataTier {
  const normalized = (subscriptionTier ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'starter':
    case 'professional':
    case 'enterprise':
      return 'starter-tier'
    case 'free':
    default:
      // Unknown or 'free' → most restrictive tier (fail closed).
      return DEFAULT_RESOLVED_TIER
  }
}

/**
 * Map a tier value carried in a verified JWT claim. The claim may use either the
 * billing vocabulary (free/starter/professional/enterprise) or the app's own
 * data-tier vocabulary (free-tier/starter-tier/paid/oss). Unknown values fail
 * closed to the most restrictive tier.
 */
function mapClaimTierToDataTier(claimTier: string): ResolvedDataTier {
  const normalized = claimTier.trim().toLowerCase()
  if (normalized === 'oss' || normalized === 'free' || normalized === 'free-tier') {
    return DEFAULT_RESOLVED_TIER
  }
  if (
    PAID_ALIASES.has(normalized) ||
    normalized === 'professional' ||
    normalized === 'enterprise'
  ) {
    return 'starter-tier'
  }
  // Defer to the billing-vocabulary mapping for anything else; it fails closed.
  return mapSubscriptionTierToDataTier(normalized)
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (!value) return ''
  const raw = Array.isArray(value) ? value[0] : value
  return raw.trim().toLowerCase()
}

/**
 * Classify the *requested* tier expressed by the client.
 *
 * NOTE: this is advisory/diagnostic only. It is NEVER used to grant access —
 * the resolved tier is derived from a trusted server-side source (see
 * resolveServerSideTier). Retained for telemetry and signature stability.
 */
export function resolveRequestedDataTier(
  headerValue: string | string[] | undefined
): RequestedDataTier {
  const normalized = normalizeHeaderValue(headerValue)
  if (!normalized) return 'oss'
  if (OSS_ALIASES.has(normalized)) return 'oss'
  if (PAID_ALIASES.has(normalized)) return 'paid'
  return 'unknown'
}

/**
 * Look up an org's entitlement from the `organizations` table, with a short
 * in-process TTL cache. Fails closed (most restrictive tier) on any error or
 * missing row.
 */
async function lookupOrgTier(orgId: string): Promise<ResolvedDataTier> {
  const now = Date.now()
  const cached = entitlementCache.get(orgId)
  if (cached && cached.expiresAt > now) {
    return cached.tier
  }

  let resolved: ResolvedDataTier = DEFAULT_RESOLVED_TIER
  try {
    const rows = await database.query<{ subscription_tier: string | null }>(
      'SELECT subscription_tier FROM organizations WHERE id = $1',
      [orgId]
    )
    if (rows.length > 0) {
      resolved = mapSubscriptionTierToDataTier(rows[0]?.subscription_tier)
    } else {
      // Org not found → fail closed.
      resolved = DEFAULT_RESOLVED_TIER
    }
  } catch {
    // DB error → fail closed. Do not cache the failure for long; use a short
    // window so a transient outage doesn't pin everyone to free for 60s longer
    // than necessary, but still avoids hammering a failing DB.
    entitlementCache.set(orgId, { tier: DEFAULT_RESOLVED_TIER, expiresAt: now + 5_000 })
    return DEFAULT_RESOLVED_TIER
  }

  entitlementCache.set(orgId, { tier: resolved, expiresAt: now + ENTITLEMENT_CACHE_TTL_MS })
  return resolved
}

/**
 * Test/operational seam: clear the in-process entitlement cache.
 */
export function __clearEntitlementCache(): void {
  entitlementCache.clear()
}

/**
 * Resolve the entitlement tier from a TRUSTED server-side source.
 *
 * The client-supplied `x-data-tier` header is intentionally ignored here to
 * prevent paywall bypass. Resolution order:
 *   1. A verified `tier` claim on req.user (authoritative & fast — no DB hit).
 *   2. The org's `subscription_tier` from the `organizations` table, keyed by
 *      req.user.orgId, with a short-TTL in-process cache.
 *   3. Fail closed to the most restrictive tier when no orgId is present, the
 *      org isn't found, or the lookup throws.
 */
async function resolveServerSideTier(req: Request): Promise<ResolvedDataTier> {
  const user = (req as DataTierRequest).user

  // (1) Prefer an authoritative tier claim from the verified token.
  if (user?.tier) {
    return mapClaimTierToDataTier(user.tier)
  }

  // (2) Fall back to the DB-backed entitlement for the authenticated org.
  const orgId = user?.orgId
  if (!orgId) {
    // Unauthenticated / no org → fail closed.
    return DEFAULT_RESOLVED_TIER
  }

  // (3) lookupOrgTier already fails closed on any error or missing row.
  return lookupOrgTier(orgId)
}

/**
 * Resolve the effective data tier. Signature kept stable for callers/tests, but
 * the header argument is now IGNORED — the tier is derived server-side and
 * defaults to the most restrictive value when no request context is available.
 */
export function resolveDataTier(headerValue?: string | string[] | undefined): ResolvedDataTier {
  void headerValue
  return DEFAULT_RESOLVED_TIER
}

/**
 * Synchronous accessor used by route handlers. Returns the resolved tier that
 * `dataTierRouter` already computed and cached on the request. If the router
 * has not run (e.g. a route mounted without the middleware), fails closed.
 */
export function getResolvedDataTier(req: Request): ResolvedDataTier {
  const cached = (req as DataTierRequest).dataTier?.resolved
  return cached ?? DEFAULT_RESOLVED_TIER
}

/**
 * Compute the full data-tier context for a request, performing the trusted
 * server-side entitlement resolution (async, may hit the DB / cache).
 */
export async function getDataTierContext(req: Request): Promise<DataTierContext> {
  const cached = (req as DataTierRequest).dataTier
  if (cached) return cached
  // `requested` reflects what the client asked for (advisory only); `resolved`
  // is the trusted, server-derived entitlement.
  const requested = resolveRequestedDataTier(req.headers['x-data-tier'])
  const resolved = await resolveServerSideTier(req)
  return { requested, resolved }
}

export const dataTierRouter = (req: Request, res: Response, next: NextFunction): void => {
  getDataTierContext(req)
    .then((context) => {
      ;(req as DataTierRequest).dataTier = context
      res.setHeader('x-data-tier-resolved', context.resolved)
      next()
    })
    .catch(() => {
      // Resolution failed unexpectedly — fail closed and continue so the
      // request is served at the most restrictive tier rather than erroring.
      const context: DataTierContext = {
        requested: resolveRequestedDataTier(req.headers['x-data-tier']),
        resolved: DEFAULT_RESOLVED_TIER
      }
      ;(req as DataTierRequest).dataTier = context
      res.setHeader('x-data-tier-resolved', context.resolved)
      next()
    })
}
