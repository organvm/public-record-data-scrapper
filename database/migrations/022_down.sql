-- 022_down.sql
--
-- Reverses migration 022: drops the functional index on contacts(LOWER(email)).
--
-- Non-destructive: only an index is removed. Case-insensitive email lookups in
-- webhooks.ts and ContactsService.findByEmail will revert to sequential scans
-- (the raw-column idx_contacts_email from migration 005 remains). The migration
-- runner wraps this in a transaction.

BEGIN;

DROP INDEX IF EXISTS idx_contacts_lower_email;

COMMIT;
