# Public Record Data Scraper — Deploy-Ready Build

**Status:** ✅ DEPLOYMENT READY  
**Build Date:** 2026-06-23  
**Latest Commit:** 477dfc4 "Drive Public Record Data Scraper to deploy-ready (#305)"

## Build Artifacts

### Frontend (`dist/`)

- **Vite SPA Bundle:** 1.98 MB minified (438.93 KB gzipped)
  - `dist/index.html` — Entry point
  - `dist/assets/index-*.js` — Main application bundle (1.55 MB min)
  - `dist/assets/index-*.css` — Styles (327.64 KB)
  - `dist/assets/spark-*.js` — React components (4.2 KB)
  - `dist/proxy.js` — Icon proxy (1.57 MB, non-critical development artifact)
  - `dist/package.json` — Manifest

### Backend Bundles (`dist/`)

- **`dist/server.cjs`** — Express.js API server (esbuild-bundled, Node 20+)
  - Handles: REST endpoints, authentication, BullMQ queue integration, webhooks
  - Size: ~5-8 MB (varies by optimization)
- **`dist/worker.cjs`** — BullMQ queue worker (esbuild-bundled, Node 20+)
  - Handles: UCC ingestion, data enrichment, health scoring, async jobs

Both bundles include source maps for production debugging.

## Test Coverage

### Server Tests

```
Test Files:   85 passed
Tests:        1406 passed | 6 skipped
Coverage:     71.49% statements
Duration:     26.10s
```

**Key Modules Tested:**

- ✅ Middleware: Error handling, request validation, auth, rate limiting, org context
- ✅ Routes: All 18 API endpoints (prospects, competitors, portfolio, enrichment, billing, compliance, etc.)
- ✅ Services: 30+ business logic services with high coverage (>80% in core services)
- ✅ Queue: BullMQ job scheduling and worker execution
- ✅ Security: Webhook verification, data tier mapping, RLS policies

### Frontend Tests

- Web app tests configured; run with `npm test` (requires Puppeteer browser)
- 526+ tests covering dashboard, agentic engine, data filtering, UI components

## Critical Path — What's Required for Deployment

### Environment Setup

Required environment variables (validated by `npm run deploy:verify`):

- `JWT_SECRET` (≥32 characters)
- `DATABASE_URL` (PostgreSQL 14+)
- `CORS_ORIGIN` (frontend domain)
- `STRIPE_WEBHOOK_SECRET` (Stripe integration)
- `TWILIO_AUTH_TOKEN` (SMS/voice)
- `SENDGRID_WEBHOOK_VERIFICATION_KEY` (email)
- `PLAID_CLIENT_ID`, `PLAID_SECRET` (bank linking)

### Database Prerequisites

1. **Migrations:** Hardening migrations 014–019 must be applied (RLS setup, org isolation)

   ```bash
   npm run db:migrate
   ```

2. **Row-Level Security (RLS):** Required on 11 org-scoped tables:
   - `prospects`, `contacts`, `deals`, `communications`, `consent_records`, `deal_stages`, `lenders`, `communication_templates`, `follow_up_reminders`, `disclosures`, `dnc_list`, `compliance_alerts`, `api_keys`
   - Each table requires `tenant_isolation` RLS policy
   - `app_current_org_id()` function must exist

3. **Application Role:** DATABASE_URL must connect as non-superuser, non-BYPASSRLS role

### Infrastructure

- **PostgreSQL:** 14+ (with extensions: uuid-ossp, pg_trgm, btree_gin)
- **Redis:** 7+ (for BullMQ queue state)
- **Node.js:** 20.10+ (esbuild bundles target node20)
- **Memory:** ≥512 MB (API), ≥256 MB (worker)
- **CPU:** 1+ core recommended

### Startup Sequence

```bash
# 1. Set environment variables (see above)
# 2. Start database + Redis (Docker or managed service)
docker-compose up -d db redis

# 3. Run migrations
npm run db:migrate

# 4. Verify prerequisites
npm run deploy:verify

# 5. Start API server
node dist/server.cjs

# 6. Start worker (separate process or same container)
node dist/worker.cjs
```

### Deployment Platforms

The application is deployment-ready for:

- **Vercel** (frontend static + serverless API)
- **Render** (bundled server/worker on shared container)
- **Fly.io**, **Railway** (containerized API + worker)
- **AWS ECS/Lambda** (with custom build steps for RLS validation)
- **Self-hosted** (Docker Compose or Kubernetes)

## What's Completed (PR #305)

- ✅ Status Dashboard component with live system health
- ✅ Subscription tier gating
- ✅ Enhanced CLI scraper with async job queue support
- ✅ Error handling middleware (structured errors, logging)
- ✅ Request validation middleware
- ✅ Mobile/desktop navigation UX improvements
- ✅ E2E test infrastructure
- ✅ 71.5% test coverage (backend)

## Known Limitations & Backlog

### Non-Blocking for Deployment

1. **Mobile & Desktop Apps** — Implemented (React Native/Tauri), not in this release
2. **Dashboards (PR #291)** — Mergeable, non-critical for MVP
3. **Billing Module (PR #288)** — Partially implemented, billing is hardened + secured
4. **StaleOldPRs** — 8 older PRs (#298, #297, #294, #292, #290, #282, #280) have merge conflicts; these are superseded by newer work

### Future Enhancements

- Expand state collectors (currently 4: CA, TX, FL, NY)
- Advanced agentic intelligence loops
- ML model tuning for scoring
- Additional enrichment data sources

## Quick Validation

### Health Check

```bash
curl -f http://localhost:3000/api/health
# Expects: HTTP 200 + {"status":"ok","timestamp":"..."}

curl -f http://localhost:3000/api/health/detailed
# Expects: DB + Redis connection status
```

### CLI Validation

```bash
npm run scrape -- list-states
# Should list: CA, TX, FL, NY

npm run scrape -- scrape-ucc -c "Apple Inc" -s CA -o test.json
# Should produce valid UCC filing results
```

### Web Dashboard

```bash
npm run dev
# Frontend: http://localhost:5000 or 5173
# API: http://localhost:3000
# Should load: login → dashboard → prospects/pipeline/compliance tabs
```

## Post-Deployment Checklist

- [ ] All environment variables set and validated
- [ ] Database migrations applied (verify with `SELECT version FROM schema_migrations`)
- [ ] RLS policies enabled on org-scoped tables
- [ ] Application role configured (non-super, non-BYPASSRLS)
- [ ] Health check endpoints responding
- [ ] CLI scraper working (at least one state)
- [ ] Dashboard loads and authenticates
- [ ] Queue worker is running and processing jobs
- [ ] Logs are collected (CloudWatch, Datadog, etc.)
- [ ] Monitoring alerts configured (latency, error rate, DB connection pool)
- [ ] Backup strategy in place for database

## Support & Rollback

- **Rollback:** Previous release is tag `v0.1.0` (commit 918c036, PR #304)
- **Logs:** Check `server/utils/logger.ts` for structured JSON logging
- **Queue Status:** Health check includes Redis + BullMQ queue depth
- **RLS Debugging:** Query `pg_policies` table if isolation issues arise

---

**For production deployment:** Follow `scripts/verify-deploy-prereqs.ts` checklist before go-live.
