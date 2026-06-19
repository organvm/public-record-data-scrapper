import type { NextFunction, Request, Response } from 'express'
import { database } from '../database/connection'
import type { AuthenticatedRequest } from './authMiddleware'
import {
  getResolvedDataTier,
  mapSubscriptionTierToDataTier,
  type ResolvedDataTier
} from './dataTier'

export const FREE_TIER_PROSPECT_LIMIT = 10

type TierGateReason = 'free_quota_exhausted' | 'full_enrichment_requires_paid'

interface TierGateContext {
  reason: TierGateReason
  currentProspects?: number
}

const FREE_TIER_ALIASES = new Set(['free', 'free-tier', 'oss', 'open', 'community', 'base'])

const PAID_TIER_ALIASES = new Set([
  'paid',
  'starter',
  'starter-tier',
  'pro',
  'professional',
  'enterprise',
  'premium'
])

const OSS_SOURCE_ALIASES = new Set([
  'oss',
  'open',
  'free',
  'public',
  'public-records',
  'state-ucc',
  'ucc',
  'sec-edgar',
  'osha',
  'uspto',
  'census',
  'sam-gov',
  'sam.gov'
])

const FULL_ENRICHMENT_VALUES = new Set([
  'full',
  'full-enriched',
  'full_enriched',
  'enriched',
  'paid',
  'starter',
  'starter-tier',
  'pro',
  'professional',
  'enterprise',
  'premium',
  'commercial'
])

const ENRICHMENT_MODE_FIELDS = [
  'dataTier',
  'data_tier',
  'tier',
  'sourceTier',
  'source_tier',
  'enrichmentTier',
  'enrichment_tier',
  'enrichmentMode',
  'enrichment_mode',
  'mode',
  'type',
  'level',
  'plan'
] as const

const BOOLEAN_FULL_ENRICHMENT_FIELDS = [
  'enrich',
  'enriched',
  'fullEnrichment',
  'full_enrichment',
  'full',
  'deepEnrichment',
  'deep_enrichment',
  'requireEnrichment',
  'require_enrichment',
  'requiresEnrichment',
  'requires_enrichment'
] as const

const SOURCE_LIST_FIELDS = ['sources', 'dataSources', 'data_sources'] as const

function normalizePlanValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : undefined
}

function mapTierValue(value: unknown): ResolvedDataTier | undefined {
  const normalized = normalizePlanValue(value)
  if (!normalized) return undefined
  if (FREE_TIER_ALIASES.has(normalized)) return 'free-tier'
  if (PAID_TIER_ALIASES.has(normalized)) return 'starter-tier'
  return mapSubscriptionTierToDataTier(normalized)
}

function getAuthenticatedUser(req: Request): AuthenticatedRequest['user'] {
  return (req as AuthenticatedRequest).user
}

async function resolveTierForGate(req: Request): Promise<ResolvedDataTier> {
  const user = getAuthenticatedUser(req)
  const claimTier = mapTierValue(user?.tier)
  if (claimTier) return claimTier

  if (user?.orgId) {
    const rows = await database.query<{ subscription_tier: string | null }>(
      'SELECT subscription_tier FROM organizations WHERE id = $1',
      [user.orgId]
    )
    return mapSubscriptionTierToDataTier(rows[0]?.subscription_tier)
  }

  return getResolvedDataTier(req)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requestsPaidSource(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = normalizePlanValue(value)
    if (!normalized) return false
    return !OSS_SOURCE_ALIASES.has(normalized)
  }

  if (Array.isArray(value)) {
    return value.some((source) => requestsPaidSource(source))
  }

  if (isPlainObject(value)) {
    return ['name', 'source', 'id', 'slug'].some((field) => requestsPaidSource(value[field]))
  }

  return false
}

function requestsFullEnrichmentValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = normalizePlanValue(value)
    return normalized ? FULL_ENRICHMENT_VALUES.has(normalized) : false
  }

  if (Array.isArray(value)) {
    return value.some((item) => requestsFullEnrichmentValue(item) || requestsPaidSource(item))
  }

  if (!isPlainObject(value)) return false

  for (const field of ENRICHMENT_MODE_FIELDS) {
    if (requestsFullEnrichmentValue(value[field])) return true
  }

  for (const field of BOOLEAN_FULL_ENRICHMENT_FIELDS) {
    if (value[field] === true) return true
  }

  for (const field of SOURCE_LIST_FIELDS) {
    if (requestsPaidSource(value[field])) return true
  }

  return false
}

export function requestsFullEnrichedProspect(body: unknown): boolean {
  if (!isPlainObject(body)) return false

  for (const field of ENRICHMENT_MODE_FIELDS) {
    if (requestsFullEnrichmentValue(body[field])) return true
  }

  for (const field of BOOLEAN_FULL_ENRICHMENT_FIELDS) {
    if (body[field] === true) return true
  }

  for (const field of SOURCE_LIST_FIELDS) {
    if (requestsPaidSource(body[field])) return true
  }

  const enrichment = body.enrichment
  if (requestsFullEnrichmentValue(enrichment)) return true

  return false
}

async function countOrgProspects(orgId: string): Promise<number> {
  const rows = await database.query<{ count: string | number }>(
    'SELECT COUNT(*)::int AS count FROM prospects WHERE org_id = $1',
    [orgId]
  )
  return Number(rows[0]?.count ?? 0)
}

function buildUpsellPayload(context: TierGateContext) {
  return {
    error: {
      message:
        'Free tier includes up to 10 OSS-only prospects. Upgrade to Starter or Pro for full enriched prospects.',
      code: 'TIER_UPGRADE_REQUIRED',
      statusCode: 402,
      details: {
        reason: context.reason,
        currentTier: 'free',
        requiredTier: 'starter',
        upgradeTiers: ['starter', 'pro'],
        freeTier: {
          prospectLimit: FREE_TIER_PROSPECT_LIMIT,
          dataAccess: 'oss-only',
          ...(context.currentProspects !== undefined && {
            currentProspects: context.currentProspects
          })
        },
        cta: {
          action: 'upgrade_plan',
          label: 'Upgrade to Starter',
          href: '/pricing',
          headline: 'Unlock full enriched prospects',
          description:
            'Starter and Pro include full enriched prospect creation beyond the free 10-prospect OSS cap.'
        }
      }
    }
  }
}

function sendUpsell(res: Response, context: TierGateContext): Response {
  return res.status(402).json(buildUpsellPayload(context))
}

export async function tierGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resolvedTier = await resolveTierForGate(req)
    if (resolvedTier !== 'free-tier') {
      next()
      return
    }

    if (requestsFullEnrichedProspect(req.body)) {
      sendUpsell(res, { reason: 'full_enrichment_requires_paid' })
      return
    }

    const orgId = getAuthenticatedUser(req)?.orgId
    if (!orgId) {
      sendUpsell(res, {
        reason: 'free_quota_exhausted',
        currentProspects: FREE_TIER_PROSPECT_LIMIT
      })
      return
    }

    const currentProspects = await countOrgProspects(orgId)
    if (currentProspects >= FREE_TIER_PROSPECT_LIMIT) {
      sendUpsell(res, { reason: 'free_quota_exhausted', currentProspects })
      return
    }

    next()
  } catch (error) {
    next(error)
  }
}
