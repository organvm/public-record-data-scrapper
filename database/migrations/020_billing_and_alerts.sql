-- ============================================================================
-- Migration 020: Billing persistence + DEWS alert storage
--
-- Two concerns, bundled because both are additive and share no objects with the
-- in-flight migrations:
--
--   (A) Stripe billing persistence — extend `organizations` (migration 004) with
--       the Stripe customer / subscription identifiers and lifecycle status so a
--       webhook event can durably record subscription state. The existing
--       `subscription_tier` column (004) remains the authoritative entitlement
--       source read by the dataTier middleware; these columns are the Stripe-side
--       provenance behind it.
--
--   (B) DEWS alert storage — add `alert_rules` and `alerts` tables so the
--       AlertService (Distressed Early Warning System) can persist threshold
--       breaches instead of logging "NOT PERSISTED" and returning []. Shapes
--       mirror the in-memory AlertRule / Alert interfaces in
--       server/services/AlertService.ts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) Billing columns on organizations
-- ----------------------------------------------------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMP WITH TIME ZONE;

-- One Stripe customer maps to at most one org; partial unique index ignores NULLs
-- so unbilled orgs don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer
    ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_subscription
    ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe Customer id (cus_...) — set on first checkout/subscription webhook';
COMMENT ON COLUMN organizations.stripe_subscription_id IS 'Stripe Subscription id (sub_...) for the current subscription';
COMMENT ON COLUMN organizations.stripe_price_id IS 'Stripe Price id (price_...) of the active subscription item; raw value retained even when unmapped to a tier';
COMMENT ON COLUMN organizations.subscription_status IS 'Stripe subscription status: active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired, paused';

-- ----------------------------------------------------------------------------
-- (B) DEWS alert rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN (
        'health_drop', 'new_ucc', 'payment_missed', 'score_critical', 'trend_declining'
    )),
    threshold NUMERIC(10, 2) NOT NULL DEFAULT 0,
    action VARCHAR(20) NOT NULL CHECK (action IN ('email', 'sms', 'webhook', 'in_app')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    enabled BOOLEAN NOT NULL DEFAULT true,
    -- Optional scoping: only apply to specific prospects (NULL/empty = all)
    prospect_ids UUID[],
    webhook_url TEXT,
    config JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_org_enabled
    ON alert_rules(org_id, enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules(type);

-- ----------------------------------------------------------------------------
-- (B) DEWS alerts (triggered warnings)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES alert_rules(id) ON DELETE SET NULL,
    prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN (
        'health_drop', 'new_ucc', 'payment_missed', 'score_critical', 'trend_declining'
    )),
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN (
        'low', 'medium', 'high', 'critical'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'acknowledged', 'resolved', 'dismissed'
    )),
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_org_status ON alerts(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_prospect ON alerts(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active
    ON alerts(org_id, severity, created_at DESC) WHERE status = 'active';

COMMENT ON TABLE alert_rules IS 'DEWS alert rules: per-org threshold definitions evaluated against prospect health';
COMMENT ON TABLE alerts IS 'DEWS triggered alerts: durable record of threshold breaches with ack/resolve lifecycle';
