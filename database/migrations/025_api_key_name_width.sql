-- ============================================================================
-- Migration 025: Align API-key names with the public validation contract
--
-- The API accepts names up to 120 characters (server/routes/apiKeys.ts), while
-- migration 004 created api_keys.name as VARCHAR(100). Migration 023 evolved
-- the same table but did not widen that column, so otherwise-valid requests
-- between 101 and 120 characters failed at the database boundary.
--
-- This is a new forward migration rather than an edit to 023: deployed
-- databases may already have recorded 023 and would never replay it.
-- ============================================================================

BEGIN;

ALTER TABLE api_keys ALTER COLUMN name TYPE VARCHAR(120);

COMMENT ON COLUMN api_keys.name IS
    'Operator-visible key name; bounded to the API contract maximum of 120 characters.';

COMMIT;
