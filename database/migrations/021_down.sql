-- 021_down.sql
--
-- Reverses migration 021: drops the scheduled_followups table and removes the
-- communications.received_at column, restoring the original 007 status CHECK
-- (without 'received').
--
-- WARNING (DESTRUCTIVE): dropping scheduled_followups deletes all scheduled
-- follow-up rows; removing received_at drops inbound-receipt timestamps. The
-- migration runner wraps this in a transaction.
--
-- NOTE: after this rollback, CommunicationsService.scheduleFollowUp and the
-- inbound-SMS webhook will once again fail at runtime (the very bugs migration
-- 021 fixed). Only run this to fully remove the migration-021 feature set.

BEGIN;

-- (1) scheduled_followups
DROP INDEX IF EXISTS idx_scheduled_followups_pending;
DROP INDEX IF EXISTS idx_scheduled_followups_deal;
DROP INDEX IF EXISTS idx_scheduled_followups_contact;
DROP INDEX IF EXISTS idx_scheduled_followups_org;
DROP TABLE IF EXISTS scheduled_followups;

-- (2) communications: drop received_at + index, restore the original status CHECK.
DROP INDEX IF EXISTS idx_communications_received;
ALTER TABLE communications DROP COLUMN IF EXISTS received_at;

-- The original (pre-021) status CHECK has no 'received' value. Migration 021
-- added it so inbound messages could persist; any inbound row written since then
-- carries status='received'. Re-adding the old constraint while such rows exist
-- would fail validation (CHECK applies to existing rows). Reclassify those rows
-- to 'delivered' — the closest retained terminal inbound-receipt status — before
-- restoring the constraint. (DESTRUCTIVE: the inbound/outbound distinction these
-- rows carried via status is lost on rollback, consistent with this migration
-- removing inbound support entirely.)
UPDATE communications SET status = 'delivered' WHERE status = 'received';

ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_status_check;
ALTER TABLE communications ADD CONSTRAINT communications_status_check CHECK (status IN (
    'pending', 'queued', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'failed', 'answered', 'no_answer', 'voicemail', 'busy'
));

COMMIT;
