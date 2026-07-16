import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

// Mock the database module so entitlement lookups are controllable.
vi.mock('../../database/connection', () => ({
  database: {
    query: vi.fn()
  }
}))

// Config mock for the real authMiddleware used by the mount-order regression
// tests below (dataTier.ts itself never reads config — inert elsewhere).
vi.mock('../../config', () => ({
  config: {
    jwt: {
      secret: 'test-secret',
      orgClaim: 'org_id',
      tierClaim: 'tier'
    }
  }
}))

import { authMiddleware } from '../../middleware/authMiddleware'

import { database } from '../../database/connection'
import {
  dataTierRouter,
  getResolvedDataTier,
  getDataTierContext,
  resolveRequestedDataTier,
  mapSubscriptionTierToDataTier,
  __clearEntitlementCache,
  type DataTierRequest,
  type ResolvedDataTier
} from '../../middleware/dataTier'

const mockQuery = vi.mocked(database.query)

interface MockReq extends Partial<DataTierRequest> {
  headers: Record<string, string | string[] | undefined>
}

function makeReq(overrides: Partial<DataTierRequest> = {}): MockReq {
  return {
    headers: {},
    ...overrides
  } as MockReq
}

function makeRes(): Partial<Response> & { setHeader: ReturnType<typeof vi.fn> } {
  return {
    setHeader: vi.fn()
  }
}

describe('dataTier middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __clearEntitlementCache()
  })

  describe('mapSubscriptionTierToDataTier', () => {
    it('maps paid billing tiers to starter-tier', () => {
      expect(mapSubscriptionTierToDataTier('starter')).toBe('starter-tier')
      expect(mapSubscriptionTierToDataTier('professional')).toBe('starter-tier')
      expect(mapSubscriptionTierToDataTier('enterprise')).toBe('starter-tier')
      expect(mapSubscriptionTierToDataTier('ENTERPRISE')).toBe('starter-tier')
    })

    it('fails closed for free / unknown / missing', () => {
      expect(mapSubscriptionTierToDataTier('free')).toBe('free-tier')
      expect(mapSubscriptionTierToDataTier('bogus')).toBe('free-tier')
      expect(mapSubscriptionTierToDataTier(null)).toBe('free-tier')
      expect(mapSubscriptionTierToDataTier(undefined)).toBe('free-tier')
    })
  })

  describe('resolveRequestedDataTier (advisory header parsing)', () => {
    it('classifies the client header without granting access', () => {
      expect(resolveRequestedDataTier(undefined)).toBe('oss')
      expect(resolveRequestedDataTier('free')).toBe('oss')
      expect(resolveRequestedDataTier('paid')).toBe('paid')
      expect(resolveRequestedDataTier('garbage')).toBe('unknown')
    })
  })

  describe('header is ignored for entitlement', () => {
    it('does not escalate tier from x-data-tier header alone', async () => {
      const req = makeReq({ headers: { 'x-data-tier': 'paid' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.requested).toBe('paid')
      // No auth → fail closed regardless of the requested header.
      expect(ctx.resolved).toBe('free-tier')
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe('tier resolution from JWT claim', () => {
    it('prefers a paid tier claim over any DB lookup', async () => {
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1', tier: 'professional' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('starter-tier')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('honors a free tier claim (fails closed) without a DB lookup', async () => {
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1', tier: 'free' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('maps app-vocabulary claim values too', async () => {
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1', tier: 'starter-tier' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('starter-tier')
    })
  })

  describe('tier resolution from DB', () => {
    it('resolves starter-tier for a paid org subscription', async () => {
      mockQuery.mockResolvedValueOnce([{ subscription_tier: 'enterprise' }])
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1' } })

      const ctx = await getDataTierContext(req as unknown as Request)

      expect(ctx.resolved).toBe('starter-tier')
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT subscription_tier FROM organizations WHERE id = $1',
        ['org-1']
      )
    })

    it('resolves free-tier for a free org subscription', async () => {
      mockQuery.mockResolvedValueOnce([{ subscription_tier: 'free' }])
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1' } })

      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
    })

    it('caches DB results across requests within the TTL', async () => {
      mockQuery.mockResolvedValueOnce([{ subscription_tier: 'starter' }])

      const first = await getDataTierContext(
        makeReq({ user: { id: 'u1', orgId: 'org-cache' } }) as unknown as Request
      )
      const second = await getDataTierContext(
        makeReq({ user: { id: 'u2', orgId: 'org-cache' } }) as unknown as Request
      )

      expect(first.resolved).toBe('starter-tier')
      expect(second.resolved).toBe('starter-tier')
      // Only one DB hit despite two requests for the same org.
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('fail-closed fallback', () => {
    it('fails closed when no orgId is present', async () => {
      const req = makeReq({ user: { id: 'u1' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('fails closed when the org is not found', async () => {
      mockQuery.mockResolvedValueOnce([])
      const req = makeReq({ user: { id: 'u1', orgId: 'missing-org' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
    })

    it('fails closed when the DB lookup throws', async () => {
      mockQuery.mockRejectedValueOnce(new Error('connection refused'))
      const req = makeReq({ user: { id: 'u1', orgId: 'org-err' } })
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
    })

    it('fails closed for a fully unauthenticated request', async () => {
      const req = makeReq()
      const ctx = await getDataTierContext(req as unknown as Request)
      expect(ctx.resolved).toBe('free-tier')
    })
  })

  describe('dataTierRouter', () => {
    it('populates req.dataTier, sets the response header, and calls next', async () => {
      mockQuery.mockResolvedValueOnce([{ subscription_tier: 'professional' }])
      const req = makeReq({ user: { id: 'u1', orgId: 'org-1' } })
      const res = makeRes()
      const next = vi.fn() as NextFunction

      dataTierRouter(req as unknown as Request, res as unknown as Response, next)
      // Allow the async resolution chain to settle.
      await vi.waitFor(() => expect(next).toHaveBeenCalled())

      const resolved: ResolvedDataTier = (req as DataTierRequest).dataTier!.resolved
      expect(resolved).toBe('starter-tier')
      expect(res.setHeader).toHaveBeenCalledWith('x-data-tier-resolved', 'starter-tier')
      expect(getResolvedDataTier(req as unknown as Request)).toBe('starter-tier')
    })

    it('fails closed and still calls next when resolution is unauthenticated', async () => {
      const req = makeReq()
      const res = makeRes()
      const next = vi.fn() as NextFunction

      dataTierRouter(req as unknown as Request, res as unknown as Response, next)
      await vi.waitFor(() => expect(next).toHaveBeenCalled())

      expect(res.setHeader).toHaveBeenCalledWith('x-data-tier-resolved', 'free-tier')
      expect(getResolvedDataTier(req as unknown as Request)).toBe('free-tier')
    })
  })

  describe('getResolvedDataTier (sync accessor)', () => {
    it('returns cached resolved tier set by the router', () => {
      const req = makeReq({
        dataTier: { requested: 'paid', resolved: 'starter-tier' }
      })
      expect(getResolvedDataTier(req as unknown as Request)).toBe('starter-tier')
    })

    it('fails closed when the router has not run', () => {
      const req = makeReq()
      expect(getResolvedDataTier(req as unknown as Request)).toBe('free-tier')
    })
  })

  // Mount-order regression (#348): the tier is resolved from req.user, which
  // only exists AFTER authMiddleware. A global pre-auth dataTierRouter mount
  // resolved free-tier for every caller, silently applying the free-tier
  // min-score floor to paid orgs (server/index.ts now mounts it per-route,
  // after auth). These tests pin the ordering dependency itself.
  describe('mount order vs authMiddleware (#348 regression)', () => {
    const runChain = async (order: 'auth-first' | 'tier-first', token: string) => {
      const req = makeReq({ headers: { authorization: `Bearer ${token}` } })
      const res = { ...makeRes(), status: vi.fn().mockReturnThis(), json: vi.fn() }
      const chain =
        order === 'auth-first' ? [authMiddleware, dataTierRouter] : [dataTierRouter, authMiddleware]
      for (const mw of chain) {
        const next = vi.fn() as NextFunction
        mw(req as unknown as Request, res as unknown as Response, next)
        await vi.waitFor(() => expect(next).toHaveBeenCalled())
      }
      return req
    }

    it('resolves the paid tier when mounted AFTER auth (the fixed order)', async () => {
      const token = jwt.sign(
        { sub: 'u1', role: 'admin', org_id: 'org-1', tier: 'professional' },
        'test-secret'
      )
      const req = await runChain('auth-first', token)
      expect(getResolvedDataTier(req as unknown as Request)).toBe('starter-tier')
    })

    it('resolves via the org subscription_tier DB fallback when the token has no tier claim', async () => {
      mockQuery.mockResolvedValueOnce([{ subscription_tier: 'professional' }] as never)
      const token = jwt.sign({ sub: 'u1', role: 'admin', org_id: 'org-2' }, 'test-secret')
      const req = await runChain('auth-first', token)
      expect(getResolvedDataTier(req as unknown as Request)).toBe('starter-tier')
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT subscription_tier FROM organizations WHERE id = $1',
        ['org-2']
      )
    })

    it('documents the regression: mounted BEFORE auth, a paid org still resolves free-tier', async () => {
      const token = jwt.sign(
        { sub: 'u1', role: 'admin', org_id: 'org-3', tier: 'professional' },
        'test-secret'
      )
      const req = await runChain('tier-first', token)
      expect(getResolvedDataTier(req as unknown as Request)).toBe('free-tier')
    })
  })
})
