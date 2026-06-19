import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mapPriceToTier,
  mapTierToPrice,
  normalizeCheckoutTier
} from '../../integrations/stripe'

const PRICE_ENV = [
  'STRIPE_PRICE_ID',
  'STRIPE_PRICE_STARTER',
  'STRIPE_PRICE_PROFESSIONAL',
  'STRIPE_PRICE_ENTERPRISE'
] as const

describe('normalizeCheckoutTier', () => {
  it('maps canonical tier names', () => {
    expect(normalizeCheckoutTier('starter')).toBe('starter')
    expect(normalizeCheckoutTier('professional')).toBe('professional')
    expect(normalizeCheckoutTier('enterprise')).toBe('enterprise')
  })

  it('is case- and whitespace-insensitive and resolves common aliases', () => {
    expect(normalizeCheckoutTier('  Pro ')).toBe('professional')
    expect(normalizeCheckoutTier('GROWTH')).toBe('professional')
    expect(normalizeCheckoutTier('Scale')).toBe('enterprise')
    expect(normalizeCheckoutTier('Basic')).toBe('starter')
  })

  it('returns null for unknown or non-string values', () => {
    expect(normalizeCheckoutTier('platinum')).toBeNull()
    expect(normalizeCheckoutTier('')).toBeNull()
    expect(normalizeCheckoutTier(undefined)).toBeNull()
    expect(normalizeCheckoutTier(42)).toBeNull()
    expect(normalizeCheckoutTier(['starter'])).toBeNull()
  })
})

describe('mapTierToPrice', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of PRICE_ENV) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of PRICE_ENV) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('resolves each tier to its dedicated price env var', () => {
    process.env.STRIPE_PRICE_STARTER = 'price_s'
    process.env.STRIPE_PRICE_PROFESSIONAL = 'price_p'
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_e'

    expect(mapTierToPrice('starter')).toBe('price_s')
    expect(mapTierToPrice('professional')).toBe('price_p')
    expect(mapTierToPrice('enterprise')).toBe('price_e')
  })

  it('falls back to STRIPE_PRICE_ID for starter when no starter price is set', () => {
    process.env.STRIPE_PRICE_ID = 'price_legacy'
    expect(mapTierToPrice('starter')).toBe('price_legacy')
  })

  it('returns null when a tier has no configured price', () => {
    expect(mapTierToPrice('professional')).toBeNull()
    expect(mapTierToPrice('enterprise')).toBeNull()
    expect(mapTierToPrice('starter')).toBeNull()
  })

  it('round-trips with mapPriceToTier so buy and webhook sides agree', () => {
    process.env.STRIPE_PRICE_STARTER = 'price_s'
    process.env.STRIPE_PRICE_PROFESSIONAL = 'price_p'
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_e'

    expect(mapPriceToTier(mapTierToPrice('starter'))).toBe('starter')
    expect(mapPriceToTier(mapTierToPrice('professional'))).toBe('professional')
    expect(mapPriceToTier(mapTierToPrice('enterprise'))).toBe('enterprise')
  })
})
