-- ============================================================================
-- UCC-MCA Intelligence Platform - Database Schema
-- PostgreSQL 14+
-- ============================================================================
--
-- CANONICAL SOURCE OF TRUTH FOR A *FRESH* DATABASE BOOTSTRAP.
--
-- This file is the single, full-snapshot bootstrap used by docker-compose
-- (mounted at /docker-entrypoint-initdb.d) and any "create from scratch" flow.
-- The incremental files under database/migrations/ are the source of truth for
-- *evolving an existing* database via `npm run migrate`.
--
-- IMPORTANT — avoiding drift / double-apply:
--   * The tables for migrations 010 (ingestion telemetry), 011 (competitive
--     intelligence), and 012 (outreach sequences) are reproduced below using
--     IF NOT EXISTS so a fresh bootstrap has them. They are intentionally
--     duplicated from database/migrations/0{10,11,12}_*.sql.
--   * Do NOT run schema.sql AND then `migrate up` against the same database
--     unless schema_migrations has been seeded; the migration runner now uses
--     `INSERT ... ON CONFLICT (version) DO NOTHING`, and these blocks use
--     IF NOT EXISTS, so a re-apply is a no-op rather than an error.
--   * The matching down-migrations (010/011/012_down.sql) DROP tables that this
--     bootstrap also "owns". Treat those rollbacks as destructive (see the
--     WARNING headers in those files) and never run them against a database
--     that was bootstrapped from schema.sql expecting the tables to persist.
-- ============================================================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gin"; -- For composite indexes

-- ============================================================================
-- Tables
-- ============================================================================

-- UCC Filings Table
CREATE TABLE ucc_filings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id VARCHAR(255) UNIQUE NOT NULL, -- Original filing ID from source
    filing_date DATE NOT NULL,
    debtor_name VARCHAR(500) NOT NULL,
    debtor_name_normalized VARCHAR(500) NOT NULL, -- Lowercased, trimmed for search
    secured_party VARCHAR(500) NOT NULL,
    secured_party_normalized VARCHAR(500) NOT NULL,
    state CHAR(2) NOT NULL,
    lien_amount DECIMAL(15, 2),
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'terminated', 'lapsed')),
    filing_type VARCHAR(10) NOT NULL CHECK (filing_type IN ('UCC-1', 'UCC-3')),
    source VARCHAR(100) NOT NULL, -- 'ny-portal', 'api', etc.
    raw_data JSONB, -- Store original data for reference
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Indexes
    CONSTRAINT filing_date_check CHECK (filing_date <= CURRENT_DATE)
);

CREATE INDEX idx_ucc_filing_date ON ucc_filings(filing_date DESC);
CREATE INDEX idx_ucc_debtor_name ON ucc_filings USING gin(debtor_name_normalized gin_trgm_ops);
CREATE INDEX idx_ucc_secured_party ON ucc_filings USING gin(secured_party_normalized gin_trgm_ops);
CREATE INDEX idx_ucc_state ON ucc_filings(state);
CREATE INDEX idx_ucc_status ON ucc_filings(status);
CREATE INDEX idx_ucc_lapsed ON ucc_filings(filing_date, status) WHERE status = 'lapsed';

-- Prospects Table
CREATE TABLE prospects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(500) NOT NULL,
    company_name_normalized VARCHAR(500) NOT NULL,
    industry VARCHAR(50) NOT NULL CHECK (industry IN (
        'restaurant', 'retail', 'construction', 'healthcare',
        'manufacturing', 'services', 'technology'
    )),
    state CHAR(2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'claimed', 'contacted', 'qualified', 'dead',
        'closed-won', 'closed-lost', 'unclaimed'
    )),
    priority_score INTEGER NOT NULL CHECK (priority_score >= 0 AND priority_score <= 100),
    default_date DATE NOT NULL,
    time_since_default INTEGER NOT NULL, -- Days since default
    last_filing_date DATE,
    narrative TEXT,
    estimated_revenue DECIMAL(15, 2),
    claimed_by VARCHAR(200),
    claimed_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_enriched_at TIMESTAMP WITH TIME ZONE,
    enrichment_confidence DECIMAL(3, 2), -- 0.00 to 1.00

    CONSTRAINT default_date_check CHECK (default_date <= CURRENT_DATE),
    CONSTRAINT time_since_default_check CHECK (time_since_default >= 0)
);

CREATE INDEX idx_prospects_priority ON prospects(priority_score DESC);
CREATE INDEX idx_prospects_industry ON prospects(industry);
CREATE INDEX idx_prospects_state ON prospects(state);
CREATE INDEX idx_prospects_status ON prospects(status);
CREATE INDEX idx_prospects_company_name ON prospects USING gin(company_name_normalized gin_trgm_ops);
CREATE INDEX idx_prospects_default_date ON prospects(default_date DESC);
CREATE INDEX idx_prospects_claimed ON prospects(claimed_by, claimed_date) WHERE claimed_by IS NOT NULL;

-- Prospect UCC Filings Junction Table
CREATE TABLE prospect_ucc_filings (
    prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
    ucc_filing_id UUID REFERENCES ucc_filings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (prospect_id, ucc_filing_id)
);

CREATE INDEX idx_prospect_ucc_prospect ON prospect_ucc_filings(prospect_id);
CREATE INDEX idx_prospect_ucc_filing ON prospect_ucc_filings(ucc_filing_id);

-- Growth Signals Table
CREATE TABLE growth_signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN (
        'hiring', 'permit', 'contract', 'expansion', 'equipment'
    )),
    description TEXT NOT NULL,
    detected_date DATE NOT NULL,
    source_url TEXT,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    confidence DECIMAL(3, 2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    raw_data JSONB, -- Store original signal data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT detected_date_check CHECK (detected_date <= CURRENT_DATE)
);

CREATE INDEX idx_signals_prospect ON growth_signals(prospect_id);
CREATE INDEX idx_signals_type ON growth_signals(type);
CREATE INDEX idx_signals_detected_date ON growth_signals(detected_date DESC);
CREATE INDEX idx_signals_score ON growth_signals(score DESC);

-- Health Scores Table
CREATE TABLE health_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
    grade CHAR(1) NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    sentiment_trend VARCHAR(20) NOT NULL CHECK (sentiment_trend IN (
        'improving', 'stable', 'declining'
    )),
    review_count INTEGER NOT NULL CHECK (review_count >= 0),
    avg_sentiment DECIMAL(3, 2) NOT NULL CHECK (avg_sentiment >= 0 AND avg_sentiment <= 1),
    violation_count INTEGER NOT NULL CHECK (violation_count >= 0),
    recorded_date DATE NOT NULL,
    raw_data JSONB, -- Store detailed health metrics
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT recorded_date_check CHECK (recorded_date <= CURRENT_DATE)
);

CREATE INDEX idx_health_prospect ON health_scores(prospect_id);
CREATE INDEX idx_health_grade ON health_scores(grade);
CREATE INDEX idx_health_recorded_date ON health_scores(recorded_date DESC);
CREATE UNIQUE INDEX idx_health_prospect_date ON health_scores(prospect_id, recorded_date);

-- Competitor Data Table
CREATE TABLE competitors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lender_name VARCHAR(500) NOT NULL UNIQUE,
    lender_name_normalized VARCHAR(500) NOT NULL,
    filing_count INTEGER NOT NULL DEFAULT 0,
    avg_deal_size DECIMAL(15, 2),
    market_share DECIMAL(5, 2), -- Percentage
    industries VARCHAR(50)[], -- Array of industries
    top_state CHAR(2),
    monthly_trend DECIMAL(5, 2), -- Percentage change
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_competitors_filing_count ON competitors(filing_count DESC);
CREATE INDEX idx_competitors_market_share ON competitors(market_share DESC);
CREATE INDEX idx_competitors_name ON competitors USING gin(lender_name_normalized gin_trgm_ops);

-- Portfolio Companies Table
CREATE TABLE portfolio_companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(500) NOT NULL,
    company_name_normalized VARCHAR(500) NOT NULL,
    funding_date DATE NOT NULL,
    funding_amount DECIMAL(15, 2) NOT NULL,
    current_status VARCHAR(20) NOT NULL CHECK (current_status IN (
        'performing', 'watch', 'at-risk', 'default'
    )),
    last_alert_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_portfolio_status ON portfolio_companies(current_status);
CREATE INDEX idx_portfolio_funding_date ON portfolio_companies(funding_date DESC);
CREATE INDEX idx_portfolio_at_risk ON portfolio_companies(current_status)
    WHERE current_status IN ('at-risk', 'default');

-- Portfolio Health Scores Junction
CREATE TABLE portfolio_health_scores (
    portfolio_company_id UUID REFERENCES portfolio_companies(id) ON DELETE CASCADE,
    health_score_id UUID REFERENCES health_scores(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (portfolio_company_id, health_score_id)
);

-- Data Ingestion Logs Table
CREATE TABLE ingestion_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
    records_found INTEGER NOT NULL DEFAULT 0,
    records_processed INTEGER NOT NULL DEFAULT 0,
    errors JSONB, -- Array of error messages
    processing_time_ms INTEGER,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB -- Additional context
);

CREATE INDEX idx_ingestion_source ON ingestion_logs(source);
CREATE INDEX idx_ingestion_status ON ingestion_logs(status);
CREATE INDEX idx_ingestion_started ON ingestion_logs(started_at DESC);

-- Enrichment Logs Table
CREATE TABLE enrichment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prospect_id UUID REFERENCES prospects(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
    enriched_fields VARCHAR(100)[],
    errors JSONB,
    confidence DECIMAL(3, 2),
    processing_time_ms INTEGER,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB
);

CREATE INDEX idx_enrichment_prospect ON enrichment_logs(prospect_id);
CREATE INDEX idx_enrichment_status ON enrichment_logs(status);
CREATE INDEX idx_enrichment_started ON enrichment_logs(started_at DESC);

-- ============================================================================
-- Views
-- ============================================================================

-- Latest Health Score per Prospect
CREATE VIEW latest_health_scores AS
SELECT DISTINCT ON (prospect_id)
    id,
    prospect_id,
    grade,
    score,
    sentiment_trend,
    review_count,
    avg_sentiment,
    violation_count,
    recorded_date
FROM health_scores
ORDER BY prospect_id, recorded_date DESC;

-- Prospects with Latest Health
CREATE VIEW prospects_with_health AS
SELECT
    p.*,
    h.grade as health_grade,
    h.score as health_score,
    h.sentiment_trend,
    h.violation_count,
    h.recorded_date as health_last_updated
FROM prospects p
LEFT JOIN latest_health_scores h ON p.id = h.prospect_id;

-- High Priority Prospects
CREATE VIEW high_priority_prospects AS
SELECT *
FROM prospects_with_health
WHERE priority_score >= 70
    AND status IN ('new', 'claimed')
ORDER BY priority_score DESC;

-- Stale Prospects (health score > 7 days old)
CREATE VIEW stale_prospects AS
SELECT p.*
FROM prospects p
WHERE p.last_enriched_at < NOW() - INTERVAL '7 days'
    OR p.last_enriched_at IS NULL;

-- ============================================================================
-- Functions
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_ucc_filings_updated_at
    BEFORE UPDATE ON ucc_filings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_prospects_updated_at
    BEFORE UPDATE ON prospects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_portfolio_companies_updated_at
    BEFORE UPDATE ON portfolio_companies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Calculate time since default
CREATE OR REPLACE FUNCTION calculate_time_since_default()
RETURNS TRIGGER AS $$
BEGIN
    NEW.time_since_default = EXTRACT(DAY FROM (CURRENT_DATE - NEW.default_date))::INTEGER;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_prospect_time_since_default
    BEFORE INSERT OR UPDATE OF default_date ON prospects
    FOR EACH ROW
    EXECUTE FUNCTION calculate_time_since_default();

-- Normalize company names for search (with legal suffix stripping)
CREATE OR REPLACE FUNCTION normalize_company_name()
RETURNS TRIGGER AS $$
DECLARE
    normalized TEXT;
BEGIN
    -- Start with basic normalization
    normalized = LOWER(TRIM(NEW.company_name));

    -- Collapse whitespace
    normalized = regexp_replace(normalized, '\s+', ' ', 'g');

    -- Strip common legal suffixes (LLC, Inc, Corp, etc.)
    normalized = regexp_replace(normalized,
        '\s*(,?\s*)?(llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|lp|l\.p\.|llp|l\.l\.p\.|co\.?|company|pllc|p\.l\.l\.c\.)$',
        '', 'i');

    NEW.company_name_normalized = TRIM(normalized);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Normalize debtor name for UCC filings
CREATE OR REPLACE FUNCTION normalize_debtor_name()
RETURNS TRIGGER AS $$
BEGIN
    NEW.debtor_name_normalized = LOWER(TRIM(
        regexp_replace(
            regexp_replace(NEW.debtor_name, '\s+', ' ', 'g'),  -- Collapse whitespace
            '[^\w\s]', '', 'g'  -- Remove special characters
        )
    ));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Normalize secured party name for UCC filings
CREATE OR REPLACE FUNCTION normalize_secured_party()
RETURNS TRIGGER AS $$
BEGIN
    NEW.secured_party_normalized = LOWER(TRIM(
        regexp_replace(
            regexp_replace(NEW.secured_party, '\s+', ' ', 'g'),  -- Collapse whitespace
            '[^\w\s]', '', 'g'  -- Remove special characters
        )
    ));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalize_prospect_company_name
    BEFORE INSERT OR UPDATE OF company_name ON prospects
    FOR EACH ROW
    EXECUTE FUNCTION normalize_company_name();

CREATE TRIGGER normalize_ucc_debtor_name
    BEFORE INSERT OR UPDATE OF debtor_name ON ucc_filings
    FOR EACH ROW
    EXECUTE FUNCTION normalize_debtor_name();

CREATE TRIGGER normalize_ucc_secured_party
    BEFORE INSERT OR UPDATE OF secured_party ON ucc_filings
    FOR EACH ROW
    EXECUTE FUNCTION normalize_secured_party();

-- ============================================================================
-- Indexes for Full-Text Search
-- ============================================================================

-- Add full-text search columns
ALTER TABLE prospects ADD COLUMN search_vector tsvector;
ALTER TABLE ucc_filings ADD COLUMN search_vector tsvector;

-- Update search vectors
CREATE OR REPLACE FUNCTION prospects_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector =
        setweight(to_tsvector('english', coalesce(NEW.company_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.narrative, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prospects_search_vector_trigger
    BEFORE INSERT OR UPDATE OF company_name, narrative ON prospects
    FOR EACH ROW
    EXECUTE FUNCTION prospects_search_vector_update();

CREATE INDEX idx_prospects_search_vector ON prospects USING gin(search_vector);

-- ============================================================================
-- Sample Queries
-- ============================================================================

-- Find prospects by company name (fuzzy)
-- SELECT * FROM prospects WHERE company_name_normalized % 'acme corp';

-- Find lapsed UCC filings in last 3 years
-- SELECT * FROM ucc_filings
-- WHERE status = 'lapsed'
--   AND filing_date >= CURRENT_DATE - INTERVAL '3 years';

-- Top prospects with growth signals
-- SELECT p.*, COUNT(gs.id) as signal_count
-- FROM prospects p
-- LEFT JOIN growth_signals gs ON p.id = gs.prospect_id
-- GROUP BY p.id
-- ORDER BY p.priority_score DESC, signal_count DESC
-- LIMIT 20;

-- Competitor market analysis
-- SELECT * FROM competitors
-- ORDER BY market_share DESC
-- LIMIT 10;

-- =============================================================================
-- Migration 010: Ingestion Telemetry + Coverage Monitoring
-- =============================================================================

CREATE TABLE IF NOT EXISTS ingestion_telemetry (
  state_code VARCHAR(2) PRIMARY KEY,
  current_status VARCHAR(20) NOT NULL DEFAULT 'idle',
  last_job_id VARCHAR(100),
  last_queued_at TIMESTAMPTZ,
  last_started_at TIMESTAMPTZ,
  last_successful_pull TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_error TEXT,
  last_records_processed INTEGER,
  data_tier VARCHAR(20),
  ucc_provider VARCHAR(50),
  queued_by VARCHAR(20),
  current_strategy VARCHAR(20),
  available_strategies TEXT NOT NULL DEFAULT '[]',
  circuit_state VARCHAR(20) NOT NULL DEFAULT 'closed',
  circuit_opened_at TIMESTAMPTZ,
  circuit_backoff_until TIMESTAMPTZ,
  circuit_trip_count INTEGER NOT NULL DEFAULT 0,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  last_escalated_at TIMESTAMPTZ,
  last_escalation_reason TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_successes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  completed_at TIMESTAMPTZ NOT NULL,
  records_processed INTEGER NOT NULL,
  strategy VARCHAR(20),
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  failed_at TIMESTAMPTZ NOT NULL,
  error TEXT NOT NULL,
  strategy VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_fallbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL REFERENCES ingestion_telemetry(state_code),
  escalated_at TIMESTAMPTZ NOT NULL,
  from_strategy VARCHAR(20) NOT NULL,
  to_strategy VARCHAR(20),
  reason TEXT NOT NULL,
  delay_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_probe_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  probe_timestamp TIMESTAMPTZ NOT NULL,
  reachable BOOLEAN NOT NULL,
  response_time_ms INTEGER,
  http_status INTEGER,
  schema_valid BOOLEAN NOT NULL DEFAULT true,
  anti_bot_detected BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code VARCHAR(2) NOT NULL,
  job_id VARCHAR(100) NOT NULL,
  records_ingested INTEGER NOT NULL,
  volume_in_range BOOLEAN NOT NULL,
  field_completeness NUMERIC(5,2) NOT NULL,
  deduplication_rate NUMERIC(5,2) NOT NULL,
  filing_date_recency BOOLEAN NOT NULL,
  party_name_present NUMERIC(5,2) NOT NULL,
  passed BOOLEAN NOT NULL,
  warnings TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coverage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(50) NOT NULL,
  state_code VARCHAR(2),
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  message TEXT NOT NULL,
  details JSONB,
  emailed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_successes_state_date ON ingestion_successes(state_code, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_failures_state_date ON ingestion_failures(state_code, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fallbacks_state_date ON ingestion_fallbacks(state_code, escalated_at DESC);
CREATE INDEX IF NOT EXISTS idx_probes_state_date ON portal_probe_results(state_code, probe_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_dq_state_date ON data_quality_reports(state_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type_date ON coverage_alerts(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON coverage_alerts(state_code, created_at DESC);

-- Seed all 50 states + DC into ingestion_telemetry
INSERT INTO ingestion_telemetry (state_code) VALUES
  ('AL'),('AK'),('AZ'),('AR'),('CA'),('CO'),('CT'),('DE'),('FL'),('GA'),
  ('HI'),('ID'),('IL'),('IN'),('IA'),('KS'),('KY'),('LA'),('ME'),('MD'),
  ('MA'),('MI'),('MN'),('MS'),('MO'),('MT'),('NE'),('NV'),('NH'),('NJ'),
  ('NM'),('NY'),('NC'),('ND'),('OH'),('OK'),('OR'),('PA'),('RI'),('SC'),
  ('SD'),('TN'),('TX'),('UT'),('VT'),('VA'),('WA'),('WV'),('WI'),('WY'),
  ('DC')
ON CONFLICT (state_code) DO NOTHING;

-- =============================================================================
-- Migration 011: Competitive Intelligence
-- =============================================================================

-- Extend ucc_filings with termination/expiration tracking
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS termination_date DATE;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS amendment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ucc_filings ADD COLUMN IF NOT EXISTS last_amendment_date DATE;

CREATE INDEX IF NOT EXISTS idx_ucc_expiration ON ucc_filings(expiration_date) WHERE expiration_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ucc_termination ON ucc_filings(termination_date) WHERE termination_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ucc_status_updated ON ucc_filings(status, updated_at DESC);

-- Amendment history
CREATE TABLE IF NOT EXISTS ucc_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES ucc_filings(id) ON DELETE CASCADE,
  external_id VARCHAR(200) UNIQUE,
  amendment_type VARCHAR(20) NOT NULL CHECK (amendment_type IN ('continuation', 'assignment', 'termination', 'amendment')),
  amendment_date DATE NOT NULL,
  description TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_amendments_filing ON ucc_amendments(filing_id, amendment_date DESC);

-- Filing events (terminations, new filings, expirations)
CREATE TABLE IF NOT EXISTS filing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL CHECK (event_type IN ('termination', 'new_filing', 'expiration_approaching', 'amendment', 'status_change')),
  filing_id UUID REFERENCES ucc_filings(id) ON DELETE SET NULL,
  event_date DATE NOT NULL,
  metadata JSONB,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_prospect ON filing_events(prospect_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_type_date ON filing_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON filing_events(processed) WHERE processed = false;

-- Filing velocity metrics (pre-computed per prospect per window)
CREATE TABLE IF NOT EXISTS filing_velocity_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  window_days INTEGER NOT NULL,
  filings_in_window INTEGER NOT NULL DEFAULT 0,
  avg_filings_per_month NUMERIC(8,2) NOT NULL DEFAULT 0,
  trend VARCHAR(20) NOT NULL CHECK (trend IN ('accelerating', 'stable', 'decelerating')) DEFAULT 'stable',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(prospect_id, window_days)
);
CREATE INDEX IF NOT EXISTS idx_velocity_trend ON filing_velocity_metrics(trend, computed_at DESC);

-- Competitor market position snapshots
CREATE TABLE IF NOT EXISTS competitor_market_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  funder_name VARCHAR(500) NOT NULL,
  funder_normalized VARCHAR(500) NOT NULL,
  funder_type VARCHAR(20),
  funder_tier VARCHAR(2),
  state VARCHAR(2) NOT NULL,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  filing_count INTEGER NOT NULL DEFAULT 0,
  active_filing_count INTEGER NOT NULL DEFAULT 0,
  unique_debtors INTEGER NOT NULL DEFAULT 0,
  market_share_pct NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(funder_normalized, state, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_competitor_state ON competitor_market_positions(state, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_funder ON competitor_market_positions(funder_normalized, snapshot_date DESC);

-- ============================================
-- Migration 012: Outreach sequences
-- ============================================

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  filing_event_id UUID REFERENCES filing_events(id) ON DELETE SET NULL,
  trigger_type VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled', 'failed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  fresh_capacity_score INTEGER,
  metadata JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sequences_prospect ON outreach_sequences(prospect_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sequences_status ON outreach_sequences(status) WHERE status IN ('pending', 'active');

CREATE TABLE IF NOT EXISTS outreach_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'sms', 'call', 'briefing')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'sent', 'delivered', 'failed', 'skipped')),
  template_key VARCHAR(100),
  subject TEXT,
  body TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  external_id VARCHAR(200),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_sequence ON outreach_steps(sequence_id, step_number);
CREATE INDEX IF NOT EXISTS idx_steps_scheduled ON outreach_steps(scheduled_for) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS pre_call_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  UNIQUE(prospect_id)
);
CREATE INDEX IF NOT EXISTS idx_briefings_prospect ON pre_call_briefings(prospect_id);

-- ============================================================================
-- Migration 020: Billing persistence + DEWS alert storage
--
-- NOTE on bootstrap ordering: the objects below depend on `organizations`
-- (migration 004) and `prospects`. Neither the `organizations`/`users`
-- multi-tenancy tables (004) nor `portfolio_health_history` (009) are
-- reproduced in this schema.sql snapshot — they are migration-only. To keep a
-- pure `schema.sql` bootstrap (which has no `organizations` table) from
-- erroring, the entire block is guarded by a DO that runs only when both
-- `organizations` and `prospects` already exist. On a database evolved via
-- `npm run migrate` the migration-020 objects are created idempotently; this
-- mirror is a no-op there (IF NOT EXISTS).
-- ============================================================================
DO $migration_020$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'prospects') THEN

    -- (A) Billing columns on organizations
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(30);
    ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMP WITH TIME ZONE;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer
        ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_subscription
        ON organizations(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

    -- (B) DEWS alert rules
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
        prospect_ids UUID[],
        webhook_url TEXT,
        config JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_org_enabled
        ON alert_rules(org_id, enabled) WHERE enabled = true;
    CREATE INDEX IF NOT EXISTS idx_alert_rules_type ON alert_rules(type);

    -- (B) DEWS alerts
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

  END IF;
END
$migration_020$;
