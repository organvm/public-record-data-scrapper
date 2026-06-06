-- 020_down.sql
--
-- WARNING (DESTRUCTIVE): The alert_rules / alerts tables and the billing columns
-- on organizations added by migration 020 are ALSO reproduced (IF NOT EXISTS) in
-- the canonical database/schema.sql fresh-install bootstrap. Running this
-- rollback against a database created from schema.sql will drop objects the
-- bootstrap considers "owned". Only run this to fully remove the migration-020
-- feature set. (The migration runner wraps this in a transaction.)

DROP TABLE IF EXISTS alerts;
DROP TABLE IF EXISTS alert_rules;

DROP INDEX IF EXISTS idx_organizations_stripe_customer;
DROP INDEX IF EXISTS idx_organizations_stripe_subscription;

ALTER TABLE organizations DROP COLUMN IF EXISTS subscription_current_period_end;
ALTER TABLE organizations DROP COLUMN IF EXISTS subscription_status;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_price_id;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_subscription_id;
ALTER TABLE organizations DROP COLUMN IF EXISTS stripe_customer_id;
