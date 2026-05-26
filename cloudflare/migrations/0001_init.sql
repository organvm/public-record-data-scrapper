-- ============================================================================
-- ucc-mca-edge — D1 (SQLite) initial schema
-- ----------------------------------------------------------------------------
-- A faithful-but-MINIMAL starter that ports the security-critical core of
-- database/schema.sql (PostgreSQL) to D1. Deliberate edge translations:
--   * UUID PKs            → TEXT PKs (app generates crypto.randomUUID()).
--   * JSONB raw_data      → TEXT + the SQLite json1 extension (built into D1).
--   * pg_trgm fuzzy search → FTS5 virtual table (see prospects_fts below).
--   * NO row-level security → tenant isolation lives in the query layer; every
--     tenant table carries org_id and every query MUST filter on it (telos #3).
--
-- The full 30-table port from database/schema.sql is tracked in praxis §B and
-- lands incrementally as routes are migrated (0002_..., 0003_..., etc.).
-- ============================================================================

-- Tenants. subscription_tier supports the $0 floor (free) → paid upgrade path.
CREATE TABLE IF NOT EXISTS organizations (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prospects — org-scoped tenant data.
CREATE TABLE IF NOT EXISTS prospects (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL REFERENCES organizations(id),
  company_name          TEXT,
  priority_score        INTEGER CHECK (priority_score BETWEEN 0 AND 100),
  status                TEXT,
  enrichment_confidence REAL CHECK (enrichment_confidence BETWEEN 0 AND 1),
  raw_data              TEXT, -- json1: store original payload as JSON text
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The tenant-isolation index: every prospect read is `WHERE org_id = ?`.
CREATE INDEX IF NOT EXISTS idx_prospects_org ON prospects(org_id);
-- Supports the canonical list ordering within an org.
CREATE INDEX IF NOT EXISTS idx_prospects_org_priority ON prospects(org_id, priority_score DESC);

-- The $0 async pipeline backlog (drained by the Cron handler — see scheduled.ts).
CREATE TABLE IF NOT EXISTS jobs (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  payload    TEXT,                          -- json1
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  org_id     TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);

-- ----------------------------------------------------------------------------
-- FTS5 fuzzy entity search (replaces Postgres pg_trgm on company_name).
-- `content=` makes this an external-content index over prospects; triggers keep
-- it synced. Query via: SELECT rowid FROM prospects_fts WHERE prospects_fts MATCH ?
-- and JOIN back to prospects (always re-applying `WHERE org_id = ?`).
-- ----------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS prospects_fts USING fts5(
  company_name,
  content='prospects',
  content_rowid='rowid'
);

-- Keep the FTS index in sync with the base table.
CREATE TRIGGER IF NOT EXISTS prospects_ai AFTER INSERT ON prospects BEGIN
  INSERT INTO prospects_fts(rowid, company_name) VALUES (new.rowid, new.company_name);
END;

CREATE TRIGGER IF NOT EXISTS prospects_ad AFTER DELETE ON prospects BEGIN
  INSERT INTO prospects_fts(prospects_fts, rowid, company_name) VALUES ('delete', old.rowid, old.company_name);
END;

CREATE TRIGGER IF NOT EXISTS prospects_au AFTER UPDATE ON prospects BEGIN
  INSERT INTO prospects_fts(prospects_fts, rowid, company_name) VALUES ('delete', old.rowid, old.company_name);
  INSERT INTO prospects_fts(rowid, company_name) VALUES (new.rowid, new.company_name);
END;
