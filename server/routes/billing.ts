/**
 * Billing routes — Stripe checkout and webhook handling.
 *
 * POST /api/billing/checkout — create a checkout session
 * POST /api/billing/webhook  — handle Stripe webhook events
 * GET  /api/billing/status   — check if billing is configured
 *
 * NOTE: This router is mounted with `express.raw` so the webhook handler
 * receives the raw request body as a Buffer (required for Stripe signature
 * verification). Do not assume `req.body` is parsed JSON here.
 */

import { Router, Request, Response } from 'express'
import type Stripe from 'stripe'
import { asyncHandler } from '../middleware/errorHandler'
import { config } from '../config'
import {
  createCheckoutSession,
  constructWebhookEvent,
  isStripeConfigured,
  mapPriceToTier
} from '../integrations/stripe'
import { database } from '../database/connection'

const router = Router()

/**
 * Stripe ids on an object can be either an expanded object or a bare id string.
 * Normalize to the id string (or null).
 */
function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

/**
 * Resolve the org_id a Stripe event belongs to. Preference order:
 *   1. The org already linked to this Stripe customer id.
 *   2. A checkout session's client_reference_id / metadata.orgId (first link).
 * Returns null when no org can be associated (event is logged + ignored).
 */
async function resolveOrgId(
  customerId: string | null,
  hints?: { clientReferenceId?: string | null; metadataOrgId?: string | null }
): Promise<string | null> {
  if (customerId) {
    const rows = await database.query<{ id: string }>(
      'SELECT id FROM organizations WHERE stripe_customer_id = $1 LIMIT 1',
      [customerId]
    )
    if (rows.length > 0) {
      return rows[0].id
    }
  }

  const candidate = hints?.clientReferenceId || hints?.metadataOrgId
  if (candidate) {
    const rows = await database.query<{ id: string }>(
      'SELECT id FROM organizations WHERE id = $1 LIMIT 1',
      [candidate]
    )
    if (rows.length > 0) {
      return rows[0].id
    }
  }

  return null
}

/**
 * Persist Stripe subscription state onto an organization row. Maps the price to
 * a subscription_tier when possible; fails closed (raw price stored, tier left
 * unchanged) and logs when the price is unmapped.
 */
async function persistSubscriptionState(
  orgId: string,
  fields: {
    customerId: string | null
    subscriptionId: string | null
    status: string | null
    priceId: string | null
    currentPeriodEnd: number | null
  }
): Promise<void> {
  const tier = mapPriceToTier(fields.priceId)
  if (fields.priceId && tier === null) {
    console.warn(
      `[billing] Unmapped Stripe price "${fields.priceId}" for org ${orgId}; ` +
        `storing raw price id and leaving subscription_tier unchanged (fail-closed). ` +
        `Set STRIPE_PRICE_STARTER/PROFESSIONAL/ENTERPRISE to map it.`
    )
  }

  const periodEnd =
    fields.currentPeriodEnd != null ? new Date(fields.currentPeriodEnd * 1000).toISOString() : null

  // Only overwrite subscription_tier when we have a confident mapping. COALESCE
  // keeps existing column values when a given field is absent on this event.
  await database.query(
    `UPDATE organizations
       SET stripe_customer_id = COALESCE($2, stripe_customer_id),
           stripe_subscription_id = COALESCE($3, stripe_subscription_id),
           subscription_status = COALESCE($4, subscription_status),
           stripe_price_id = COALESCE($5, stripe_price_id),
           subscription_current_period_end = COALESCE($6, subscription_current_period_end),
           subscription_tier = COALESCE($7, subscription_tier),
           updated_at = NOW()
     WHERE id = $1`,
    [
      orgId,
      fields.customerId,
      fields.subscriptionId,
      fields.status,
      fields.priceId,
      periodEnd,
      tier
    ]
  )
}

/**
 * Mark an org's subscription as cancelled and drop entitlement back to 'free'.
 */
async function persistSubscriptionCancelled(
  orgId: string,
  subscriptionId: string | null
): Promise<void> {
  await database.query(
    `UPDATE organizations
       SET subscription_status = 'canceled',
           subscription_tier = 'free',
           stripe_subscription_id = COALESCE($2, stripe_subscription_id),
           updated_at = NOW()
     WHERE id = $1`,
    [orgId, subscriptionId]
  )
}

/**
 * Extract the first subscription-item price id from a Stripe.Subscription.
 */
function priceIdFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0]
  return idOf(item?.price as { id: string } | string | undefined)
}

/**
 * Dispatch a verified Stripe event to the appropriate persistence handler.
 * Returns true if the event was handled (org resolved + persisted).
 */
async function handleStripeEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const customerId = idOf(session.customer)
      const orgId = await resolveOrgId(customerId, {
        clientReferenceId: session.client_reference_id,
        metadataOrgId: (session.metadata?.orgId as string | undefined) ?? null
      })
      if (!orgId) {
        console.warn(
          `[billing] checkout.session.completed ${event.id}: could not resolve an org ` +
            `(customer=${customerId ?? 'none'}); not persisted.`
        )
        return false
      }
      await persistSubscriptionState(orgId, {
        customerId,
        subscriptionId: idOf(session.subscription),
        status: session.payment_status === 'paid' ? 'active' : (session.status ?? null),
        priceId: null, // checkout.session does not carry the line price; subscription.* events do
        currentPeriodEnd: null
      })
      return true
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = idOf(sub.customer)
      const orgId = await resolveOrgId(customerId)
      if (!orgId) {
        console.warn(
          `[billing] ${event.type} ${event.id}: could not resolve an org ` +
            `(customer=${customerId ?? 'none'}); not persisted.`
        )
        return false
      }
      await persistSubscriptionState(orgId, {
        customerId,
        subscriptionId: sub.id,
        status: sub.status,
        priceId: priceIdFromSubscription(sub),
        currentPeriodEnd:
          (sub as unknown as { current_period_end?: number }).current_period_end ?? null
      })
      return true
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = idOf(sub.customer)
      const orgId = await resolveOrgId(customerId)
      if (!orgId) {
        console.warn(
          `[billing] customer.subscription.deleted ${event.id}: could not resolve an org ` +
            `(customer=${customerId ?? 'none'}); not persisted.`
        )
        return false
      }
      await persistSubscriptionCancelled(orgId, sub.id)
      return true
    }

    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = idOf(invoice.customer)
      const orgId = await resolveOrgId(customerId)
      if (!orgId) {
        console.warn(
          `[billing] ${event.type} ${event.id}: could not resolve an org ` +
            `(customer=${customerId ?? 'none'}); not persisted.`
        )
        return false
      }
      // Reflect the payment outcome onto subscription_status. A failed payment
      // moves the org to 'past_due'; a success restores 'active'. Tier is left
      // to the authoritative subscription.* events.
      const status = event.type === 'invoice.payment_failed' ? 'past_due' : 'active'
      const subscriptionId = idOf(
        (invoice as unknown as { subscription?: string | { id: string } | null }).subscription
      )
      await persistSubscriptionState(orgId, {
        customerId,
        subscriptionId,
        status,
        priceId: null,
        currentPeriodEnd: null
      })
      return true
    }

    default:
      console.log(`[billing] Unhandled event: ${event.type}`)
      return false
  }
}

/**
 * Validates a request Origin against the configured CORS allowlist and returns
 * a safe base URL for building checkout redirect URLs. Falls back to the first
 * configured origin (or BILLING_BASE_URL) when the Origin is missing or not
 * allowlisted, preventing open-redirect / host-injection via the Origin header.
 */
function resolveCheckoutBaseUrl(req: Request): string | null {
  const allowedOrigins = config.cors.origin
  const origin = req.headers.origin

  if (origin && allowedOrigins.includes(origin)) {
    return origin
  }

  // Prefer an explicitly configured base URL, else the first allowlisted origin.
  const configuredBase =
    process.env.BILLING_BASE_URL || (allowedOrigins.length > 0 ? allowedOrigins[0] : undefined)

  return configuredBase ?? null
}

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    configured: isStripeConfigured(),
    provider: 'stripe'
  })
})

router.post(
  '/checkout',
  asyncHandler(async (req: Request, res: Response) => {
    if (!isStripeConfigured()) {
      res.status(503).json({ error: 'Billing not configured' })
      return
    }

    const priceId = process.env.STRIPE_PRICE_ID
    if (!priceId) {
      res.status(503).json({ error: 'No price configured' })
      return
    }

    // Build redirect URLs from a validated base — never trust the raw Origin
    // header, which a caller can spoof to redirect users to an attacker host.
    const baseUrl = resolveCheckoutBaseUrl(req)
    if (!baseUrl) {
      res.status(500).json({ error: 'No allowed origin configured for checkout' })
      return
    }

    const session = await createCheckoutSession({
      priceId,
      successUrl: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/billing/cancel`,
      metadata: {
        source: 'public-record-data-scrapper'
      }
    })

    res.json({ url: session.url })
  })
)

router.post(
  '/webhook',
  asyncHandler(async (req: Request, res: Response) => {
    if (!config.stripe.webhookSecret) {
      // Fail closed: without a configured signing secret we cannot trust any
      // payload, so reject rather than process unverified events.
      console.error('[billing] STRIPE_WEBHOOK_SECRET is not configured; rejecting webhook')
      res.status(503).json({ error: 'Webhook signing secret not configured' })
      return
    }

    const signature = req.headers['stripe-signature']
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' })
      return
    }

    // req.body is the raw Buffer (router mounted with express.raw). Verify the
    // signature before doing anything with the payload.
    let event
    try {
      event = await constructWebhookEvent(req.body as Buffer, signature)
    } catch (err) {
      console.error(
        '[billing] Webhook signature verification failed:',
        err instanceof Error ? err.message : err
      )
      res.status(400).json({ error: 'Invalid signature' })
      return
    }

    try {
      const handled = await handleStripeEvent(event)
      res.json({ received: true, handled })
    } catch (err) {
      // Persistence failed after a valid signature. Return 500 so Stripe retries
      // the delivery rather than silently dropping the subscription state change.
      console.error(
        `[billing] Failed to persist webhook event ${event.id} (${event.type}):`,
        err instanceof Error ? err.message : err
      )
      res.status(500).json({ error: 'Failed to process webhook' })
    }
  })
)

export default router
