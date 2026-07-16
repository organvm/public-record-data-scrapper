-- ============================================================================
-- Migration 023: API keys for programmatic access
--
-- First-paying-customer revenue path: the on-demand UCC scrape endpoints
-- (server/routes/scrape.ts) are the data-as-a-service product, but they sat
-- behind JWT-only auth. A JWT requires an interactive IdP/login flow, so there
-- was no credential an operator could hand a paying stranger to call the API.
--
-- This grants long-lived, revocable API keys scoped to an organization. The
-- secret itself is NEVER stored — only a SHA-256 hash (for lookup) and a short
-- non-secret prefix (for display, e.g. "prk_AbC12…"). A presented key is
-- hashed and matched against key_hash; the row carries the org_id and role that
-- populate the request's auth context, so the existing org-scoping / RLS and
-- requireRole machinery work unchanged.
--
-- IMPORTANT (#346): migration 004 ALREADY created api_keys in an older shape
-- (scopes/is_active, key_prefix VARCHAR(10), no role/revoked_at). The original
-- version of this file did CREATE TABLE IF NOT EXISTS, which silently no-oped
-- against the 004 table and then failed on the revoked_at partial index —
-- breaking the migration chain on every database. This version EVOLVES the
-- 004 table in place to the shape ApiKeyService reads:
--   * role, revoked_at added (what the service selects and gates on)
--   * key_prefix widened to VARCHAR(16) — the service stores a 12-char display
--     prefix (DISPLAY_PREFIX_LENGTH), which overflowed 004's VARCHAR(10)
--   * rows soft-disabled under 004's is_active=false become revoked, so the
--     new revocation predicate honors historical disables
-- key_hash stays VARCHAR(255) (a SHA-256 hex digest fits; 004 already indexes
-- it UNIQUE). org_id stays nullable and created_by keeps 004's FK action —
-- neither is read by the service, and tightening them could fail on legacy
-- rows; they are cleanup for a later migration if ever needed.
--
-- Migration style: the runner (scripts/migrate.ts) executes each file as one
-- pool.query() inside a transaction; this mirrors the repo's transactional,
-- plain-CREATE convention (no CONCURRENTLY).
-- ============================================================================

BEGIN;

-- Role granted to requests authenticated with this key. Mirrors the role
-- vocabulary the scrape routes gate on via requireRole().
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user';

-- Named CHECK added idempotently (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_role_check CHECK (role IN ('user', 'admin'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Soft revocation; set to disable a key without losing its audit trail.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP WITH TIME ZONE;

-- The service's display prefix is 12 chars ("prk_" + 8); 004 allowed only 10.
ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(16);

-- Honor 004-era soft disables under the new revocation predicate.
UPDATE api_keys SET revoked_at = NOW() WHERE is_active = false AND revoked_at IS NULL;

-- Unique on the hash: verification is a single point lookup by hashed key
-- (004 already enforces UNIQUE via its column constraint; this keeps the
-- 023-named index for fresh shapes and no-ops where one exists).
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- List/manage keys for an org; partial index keeps the common "active keys"
-- listing cheap.
CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_org_active
    ON api_keys(org_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE api_keys IS 'Org-scoped programmatic API keys for the data-as-a-service scrape endpoints. Stores a SHA-256 hash of the secret, never the plaintext.';
COMMENT ON COLUMN api_keys.key_hash IS 'SHA-256 hex digest of the full key; the plaintext is returned once at creation and never stored.';
COMMENT ON COLUMN api_keys.key_prefix IS 'Non-secret display prefix (e.g. prk_AbC12) for identifying a key without exposing the secret.';
COMMENT ON COLUMN api_keys.last_used_at IS 'Updated on successful verification; basis for per-key usage metering.';

COMMIT;
