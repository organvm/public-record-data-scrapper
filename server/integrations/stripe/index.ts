/**
 * Stripe integration — handles checkout sessions and webhook events.
 *
 * Activation steps:
 * 1. npm install stripe
 * 2. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env
 * 3. Create a product + price in Stripe Dashboard
 * 4. Set STRIPE_PRICE_ID to the price ID
 */

import Stripe from 'stripe'
import { config } from '../../config'

let stripeClient: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = config.stripe.secretKey
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not configured')
    }
    stripeClient = new Stripe(key, { apiVersion: '2025-04-30.basil' })
  }
  return stripeClient
}

export function isStripeConfigured(): boolean {
  return !!config.stripe.secretKey
}

export interface CheckoutOptions {
  priceId: string
  customerId?: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

export async function createCheckoutSession(
  options: CheckoutOptions
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  return stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: options.priceId, quantity: 1 }],
    customer: options.customerId,
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    metadata: options.metadata
  })
}

/**
 * Subscription tiers recognized by the `organizations.subscription_tier` column
 * (see database/migrations/004_multitenancy.sql). 'free' is the unentitled
 * baseline; the rest grant the paid data tier (see middleware/dataTier.ts).
 */
export type SubscriptionTier = 'free' | 'starter' | 'professional' | 'enterprise'

/**
 * Map a Stripe Price id to an internal subscription tier.
 *
 * The mapping is configured via environment so that price ids (which differ per
 * Stripe account / mode) are never hard-coded:
 *   STRIPE_PRICE_STARTER, STRIPE_PRICE_PROFESSIONAL, STRIPE_PRICE_ENTERPRISE
 *
 * `STRIPE_PRICE_ID` (the single price used by the /checkout route) is also
 * honored as the 'starter' price when no explicit starter price is set, so a
 * minimally-configured deployment still maps its one price.
 *
 * Returns `null` when the price is unknown. Callers MUST fail closed on null:
 * persist the raw price id but leave `subscription_tier` unchanged, and log the
 * unmapped price so the gap is observable.
 */
export function mapPriceToTier(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) {
    return null
  }

  const starter = process.env.STRIPE_PRICE_STARTER || process.env.STRIPE_PRICE_ID
  const professional = process.env.STRIPE_PRICE_PROFESSIONAL
  const enterprise = process.env.STRIPE_PRICE_ENTERPRISE

  if (enterprise && priceId === enterprise) {
    return 'enterprise'
  }
  if (professional && priceId === professional) {
    return 'professional'
  }
  if (starter && priceId === starter) {
    return 'starter'
  }

  return null
}

export async function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe()
  const secret = config.stripe.webhookSecret
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  }
  return stripe.webhooks.constructEvent(payload, signature, secret)
}
