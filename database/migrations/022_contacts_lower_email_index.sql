-- ============================================================================
-- Migration 022: functional index on contacts(LOWER(email))
--
-- Two hot lookups match contacts by case-insensitive email:
--
--   (1) server/routes/webhooks.ts (inbound email parse):
--         SELECT id, org_id FROM contacts WHERE LOWER(email) = $1
--       — fires once per inbound message, cross-org by design.
--
--   (2) server/services/ContactsService.ts findByEmail:
--         SELECT * FROM contacts WHERE LOWER(email) = LOWER($1)
--           AND org_id = $2 AND is_active = true
--
-- The only email index on contacts is the plain b-tree idx_contacts_email
-- (migration 005) on the raw column, which a LOWER(email) predicate cannot use
-- — every inbound mail forced a sequential scan over contacts. This adds the
-- matching functional index so both predicates become index lookups.
--
-- Migration style: the runner (scripts/migrate.ts) executes each file as one
-- pool.query(), which runs the whole file in a single (implicit/explicit)
-- transaction. CREATE INDEX CONCURRENTLY cannot run inside a transaction block,
-- and no migration in this repo uses CONCURRENTLY — so this mirrors the repo's
-- transactional, plain-CREATE-INDEX convention rather than introducing a
-- non-transactional concurrent build.
-- ============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_contacts_lower_email ON contacts (LOWER(email));

COMMENT ON INDEX idx_contacts_lower_email IS
    'Functional index supporting case-insensitive email lookups (inbound-email contact match in webhooks.ts and ContactsService.findByEmail). Complements the raw-column idx_contacts_email from migration 005.';

COMMIT;
