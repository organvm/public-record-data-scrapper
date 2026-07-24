-- 025_down.sql
--
-- Reverses migration 025. Names longer than the migration-004 limit are
-- truncated deliberately so the rollback cannot fail midway.

BEGIN;

ALTER TABLE api_keys
    ALTER COLUMN name TYPE VARCHAR(100) USING left(name, 100);

COMMENT ON COLUMN api_keys.name IS NULL;

COMMIT;
