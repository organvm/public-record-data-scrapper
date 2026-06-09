-- ============================================================================
-- Migration 021: Communications follow-ups + inbound message support
--
-- Resolves two pre-existing schema/code mismatches that throw at runtime:
--
--   (1) CommunicationsService.scheduleFollowUp / getPendingFollowUps /
--       cancelFollowUp INSERT/SELECT/DELETE FROM `scheduled_followups`, a table
--       that never existed. Migration 007 created `follow_up_reminders` instead,
--       with an incompatible shape (title/description/priority/due_at/...), no
--       channel/template_id/scheduled_for/sent columns. We create the
--       `scheduled_followups` table the service actually targets.
--
--   (2) The inbound-SMS webhook (server/routes/webhooks.ts) INSERTs into
--       communications with status='received' and a received_at column. Neither
--       existed: the 007 CHECK constraint had no 'received' status and there was
--       no received_at column, so every inbound SMS violated the CHECK and was
--       silently lost. We add the received_at column and extend the status CHECK
--       to include 'received'.
--
-- Org-scoped tables follow the migration-018 RLS pattern (tenant_isolation
-- policy keyed on app.current_org_id, fail-closed for non-owner roles).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (1) scheduled_followups — the table CommunicationsService.scheduleFollowUp
--     and friends target. Columns mirror the service's INSERT/SELECT exactly:
--     id, org_id, contact_id, deal_id, channel, template_id, scheduled_for,
--     sent (bool default false), sent_at, created_by, created_at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_followups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,

    -- Channel for the scheduled follow-up; matches communications.channel.
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'call')),
    template_id UUID REFERENCES communication_templates(id) ON DELETE SET NULL,

    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    sent BOOLEAN NOT NULL DEFAULT false,
    sent_at TIMESTAMP WITH TIME ZONE,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_followups_org ON scheduled_followups(org_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_contact ON scheduled_followups(contact_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_deal ON scheduled_followups(deal_id);
-- Drives getPendingFollowUps (sent = false AND scheduled_for > NOW()).
CREATE INDEX IF NOT EXISTS idx_scheduled_followups_pending ON scheduled_followups(scheduled_for)
    WHERE sent = false;

COMMENT ON TABLE scheduled_followups IS
    'Channel-aware scheduled follow-up communications targeted by CommunicationsService.scheduleFollowUp (distinct from the task-style follow_up_reminders).';

-- RLS: tenant isolation keyed on the session GUC app.current_org_id, mirroring
-- migration 018. app_current_org_id() is defined there and is NULL-safe.
ALTER TABLE scheduled_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scheduled_followups;
CREATE POLICY tenant_isolation ON scheduled_followups
    USING (org_id = app_current_org_id())
    WITH CHECK (org_id = app_current_org_id());

-- ----------------------------------------------------------------------------
-- (2) communications: add received_at + extend status CHECK with 'received'
--     so inbound messages persist instead of violating the CHECK constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE communications ADD COLUMN IF NOT EXISTS received_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_status_check;
ALTER TABLE communications ADD CONSTRAINT communications_status_check CHECK (status IN (
    'pending', 'queued', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'failed', 'answered', 'no_answer', 'voicemail', 'busy',
    'received'
));

-- Index inbound receipts for the inbox's direction/received-time queries.
CREATE INDEX IF NOT EXISTS idx_communications_received ON communications(received_at DESC)
    WHERE received_at IS NOT NULL;

COMMIT;
