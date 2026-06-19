import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextFunction, Request, Response } from 'express'
import type { AuthenticatedRequest } from '../../middleware/authMiddleware'

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn()
}))

vi.mock('../../database/connection', () => ({
  database: {
    query: mockQuery
  }
}))

import {
  FREE_TIER_PROSPECT_LIMIT,
  requestsFullEnrichedProspect,
  tierGate
} from '../../middleware/tierGate'

function makeReq(overrides: Partial<AuthenticatedRequest> = {}): Request {
  return {
    headers: {},
    body: {},
    ...overrides
  } as Request
}

type MockResponse = Partial<Response> & {
  status: ReturnType<typeof vi.fn>
  json: ReturnType<typeof vi.fn>
}

function makeRes(): MockResponse {
  const res = {} as MockResponse
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('tierGate middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('requestsFullEnrichedProspect', () => {
    it('allows minimal and OSS-only create payloads', () => {
      expect(
        requestsFullEnrichedProspect({
          company_name: 'Acme LLC',
          state: 'CA',
          industry: 'technology'
        })
      ).toBe(false)

      expect(
        requestsFullEnrichedProspect({
          company_name: 'Acme LLC',
          state: 'CA',
          industry: 'technology',
          dataTier: 'oss',
          sources: ['sec-edgar', 'state-ucc']
        })
      ).toBe(false)
    })

    it('detects paid/full enrichment intent', () => {
      expect(
        requestsFullEnrichedProspect({
          company_name: 'Acme LLC',
          state: 'CA',
          industry: 'technology',
          enrichment: { mode: 'full', sources: ['dnb'] }
        })
      ).toBe(true)

      expect(
        requestsFullEnrichedProspect({
          company_name: 'Acme LLC',
          state: 'CA',
          industry: 'technology',
          dataSources: ['clearbit']
        })
      ).toBe(true)
    })
  })

  it('allows Starter/Pro users to create full enriched prospects', async () => {
    const req = makeReq({
      body: { enrichment: { mode: 'full', sources: ['dnb'] } },
      user: { id: 'user-1', orgId: 'org-1', tier: 'professional' }
    })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await tierGate(req, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('allows free users below quota to create OSS-only prospects', async () => {
    mockQuery.mockResolvedValueOnce([{ count: FREE_TIER_PROSPECT_LIMIT - 1 }])
    const req = makeReq({
      body: { dataTier: 'oss', sources: ['sec-edgar'] },
      user: { id: 'user-1', orgId: 'org-1', tier: 'free' }
    })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await tierGate(req, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT COUNT(*)::int AS count FROM prospects WHERE org_id = $1',
      ['org-1']
    )
  })

  it('returns an upsell CTA when free users hit the prospect cap', async () => {
    mockQuery.mockResolvedValueOnce([{ count: FREE_TIER_PROSPECT_LIMIT }])
    const req = makeReq({
      body: { dataTier: 'oss' },
      user: { id: 'user-1', orgId: 'org-1', tier: 'free' }
    })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await tierGate(req, res as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'TIER_UPGRADE_REQUIRED',
          details: expect.objectContaining({
            reason: 'free_quota_exhausted',
            freeTier: expect.objectContaining({
              prospectLimit: FREE_TIER_PROSPECT_LIMIT,
              currentProspects: FREE_TIER_PROSPECT_LIMIT
            }),
            cta: expect.objectContaining({
              action: 'upgrade_plan',
              href: '/pricing'
            })
          })
        })
      })
    )
  })

  it('returns an upsell CTA when free users request full enrichment', async () => {
    const req = makeReq({
      body: { enrichmentMode: 'full' },
      user: { id: 'user-1', orgId: 'org-1', tier: 'free' }
    })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await tierGate(req, res as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(mockQuery).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          details: expect.objectContaining({
            reason: 'full_enrichment_requires_paid'
          })
        })
      })
    )
  })

  it('uses the org subscription when the JWT has no tier claim', async () => {
    mockQuery.mockResolvedValueOnce([{ subscription_tier: 'starter' }])
    const req = makeReq({
      body: { enrichmentMode: 'full' },
      user: { id: 'user-1', orgId: 'org-1' }
    })
    const res = makeRes()
    const next = vi.fn() as NextFunction

    await tierGate(req, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT subscription_tier FROM organizations WHERE id = $1',
      ['org-1']
    )
  })
})
