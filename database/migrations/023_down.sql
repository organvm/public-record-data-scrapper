-- 023_down.sql
--
-- Reverses migration 023 — the evolve-in-place of the 004-created api_keys
-- table. The table itself belongs to migration 004 and is NOT dropped here;
-- only the 023 additions are removed, and key_prefix is narrowed back to
-- 004's VARCHAR(10) (truncating any 023-era 12-char display prefixes).
--
-- Destructive to 023-era data: role assignments and revocation timestamps are
-- lost. Keys revoked via revoked_at (rather than is_active=false) become
-- active again under the 004 predicate — review before running in anger.

BEGIN;

DROP INDEX IF EXISTS idx_api_keys_org_active;
DROP INDEX IF EXISTS idx_api_keys_hash;

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_role_check;
ALTER TABLE api_keys DROP COLUMN IF EXISTS role;
ALTER TABLE api_keys DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE api_keys ALTER COLUMN key_prefix TYPE VARCHAR(10) USING left(key_prefix, 10);

COMMIT;
