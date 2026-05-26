# Evolution Plan — Deployment Architecture & Release Discipline

_Authored 2026-05-25. Status: PROPOSAL (awaiting platform decision). Persisted
local+remote so it survives container death._

This plan (a) inventories the current state, (b) accounts for **every open issue
and PR**, (c) lays out **all theoretical deployment options** including
Cloudflare, and (d) sequences a phased evolution. It does not change any infra
until you pick a platform direction (§3 decision).

---

## 1. Current state (the sprawl)

**App shape (this dictates everything):** React 19 + Vite **SPA**; an **Express
REST API**; an **always-on BullMQ worker** (scheduled 50-state scraping); **Redis**
(queues); **Postgres 14+** (uses `pg_trgm`, `btree_gin`, JSONB — *not* trivially
portable to SQLite/D1); plus integrations (Stripe/Plaid/Twilio/SendGrid/AWS).

**Where it runs today — fragmented across 4+ targets:**
- **Vercel** — frontend SPA (`vercel.json`).
- **Render** — API service `ucc-mca-api` (`build:render`, `dist/server.cjs`; see #230).
- **Terraform/AWS** (`terraform/`: VPC, RDS, ElastiCache) — partially defined, ops-heavy.
- **k8s + docker-compose** — manifests present, unclear if used.
- **Cloudflare account** `ivviiviivvi` — already hosts 9 Workers, 3 D1 DBs, 1 R2
  bucket (your existing pattern; this repo not yet on it).

**Core problem:** `main` == production with no gate; releasing == merging;
breaking-without-config changes (e.g. PR #234) become live incidents; and the
4-platform spread is too much surface for a solo operator.

## 2. Open issues & PRs (all accounted for)

| # | Type | What | Lands in phase |
|---|------|------|----------------|
| **#234** | PR | Audit remediation (security/compliance/correctness) — green, breaking-without-config | P1 (config-gated merge) |
| **#233** | PR | Dependabot: `ip-address` 10.1→10.2 | P1 (dep hygiene) |
| **#229** | PR | Dependabot: npm group, 10 updates (review for majors) | P1 (dep hygiene) |
| **#235** | issue | Deploy prerequisites for #234 (Auth0 claim, secrets, RLS role, migrations) | P1 gate |
| **#230** | issue | IRF-APP-003 Render reliability (tsx→node, telemetry bounds, migration 013) | P2 (platform) |
| **#237** | issue | `index.ts` auto-starts on import — add main-module guard | P1 (small) |
| **#236** | issue | Frontend TS debt (~357), missing deps, recharts/resizable drift | P3 (debt) |
| **#238** | issue | Propagate completions to meta-organvm indices (IRF/omega/seed) | P4 (meta) |

## 3. Theoretical deployment options (pick one direction)

Legend: **Rewrite** = backend code change required; **Ops** = ongoing operational burden.

| Opt | Shape | Rewrite | Ops | Cost | Fit notes |
|-----|-------|---------|-----|------|-----------|
| **A. Consolidate on Render** | Render: web (API) + background worker + managed Postgres + managed Redis; SPA as Render static site or Vercel | ~none | low | $ | Smallest move from today; native always-on worker + Redis; built-in preview envs; one dashboard. |
| **B. Consolidate on Railway** | Railway project: API + worker + PG + Redis + static SPA | ~none | low | $ | Most beginner-friendly; PR preview envs; trivial rollback; single dashboard. |
| **C. Vercel + Render (cleaned up)** | Vercel SPA + Render backend; add staging | ~none | med | $$ | Best frontend DX, but two dashboards + you already hit Vercel's serverless limits for the worker. |
| **D. Cloudflare hybrid (RECOMMENDED start)** | **CF Pages** (SPA) + **CF** in front (DNS/CDN/WAF/Access) → **Render/Fly** Node backend (API + BullMQ worker + Redis + Postgres) | ~none | low–med | $ | Uses your CF strength for edge/SPA/security; keeps the stateful Node backend where it actually works. Retires Vercel + Terraform/k8s. |
| **E. Full Cloudflare (target, later)** | **Pages** (SPA) + **Workers** (API, ported Express→Hono or `nodejs_compat`) + **Queues**+**Cron Triggers**+**Durable Objects** (replace BullMQ/Redis) + **Hyperdrive**→external Postgres (Neon/Supabase) or **D1** (SQLite rewrite) + **R2** | **high** | low | ¢ | Matches your 9-Worker muscle; cheapest, fastest edge, best previews. But BullMQ/Redis/Express all need re-architecting. Do via strangler pattern, endpoint by endpoint. |
| **F. Self-host AWS (Terraform)** | ECS/Fargate + RDS + ElastiCache via existing `terraform/` | low | **high** | $$$ | Most control; far too much ops for a solo operator. Recommend **retiring** this path. |

**My expert recommendation:** **D now, E later.**
- **D (start):** lowest risk, immediate guardrails, leverages Cloudflare for what
  it's best at, and lets you delete the Vercel + Terraform + k8s sprawl. The
  Node backend (Express + BullMQ + Redis + Postgres) stays on a real always-on
  host (Render or Fly) where it already works — no rewrite to merge #234 safely.
- **E (target):** once D is stable, *incrementally* port the API to Workers and
  swap BullMQ→Queues + Cron, Redis→Durable Objects/Upstash, Postgres-via-Hyperdrive
  (keep Postgres; **avoid D1** here — you rely on `pg_trgm`/JSONB GIN). Move one
  endpoint/job at a time behind the CF router; never a big-bang.

**Decision needed from you:** confirm **D→E**, or pick A/B/C instead. Everything
below assumes D→E but the release discipline (§4) is identical for any option.

## 4. Release discipline (platform-independent — the real fix)

1. **Merge ≠ release.** `main` auto-deploys to **staging** only; production is a
   manual promotion (button/tag/approved Action).
2. **Environments:** local → PR **preview** (ephemeral) → **staging** → **production**.
3. **Branch protection on `main`:** require full CI (typecheck + server tests +
   build) green + 1 review before merge. (Today only secret-scan + validate-deps run.)
4. **Config/secrets per environment** in the platform's secret store; `JWT_SECRET`
   and all webhook secrets set in *every* env (#235).
5. **Feature-flag breaking changes** → ship dark, flip on after prerequisites are
   verified per-environment. This converts #235 from "merge blocker" to "runtime toggle."
6. **Expand-contract DB migrations**, run as their own step, backward-compatible,
   backup first (directly addresses #230 + migrations 014–019 in #234).
7. **Observability:** wire **Sentry** (already available) + health checks +
   structured logs; define rollback = redeploy previous release.

## 5. Phased evolution (sequencing every issue/PR)

### Phase 0 — Guardrails (no infra change, ~1 sitting)
- Add branch protection on `main`; make CI run + require typecheck/server-tests/build.
- Stand up a **staging** target on the chosen platform; point `main`→staging.
- Exit: a merge to `main` deploys to staging, not prod.

### Phase 1 — Safe-merge the backlog
- Review+merge **#233**, then **#229** (watch for major bumps).
- Land **#237** (index.ts main-module guard — tiny, unblocks clean imports/tests).
- Put #234's risky switches behind flags (org-scoping fail-open→closed, webhook
  enforcement) → merge **#234** to staging; tick **#235** prereqs per-env; flip flags.
- Exit: #234/#233/#229 merged; #237 closed; prod still safe (flags off until ready).

### Phase 2 — Platform consolidation (Option D)
- CF **Pages** for the SPA (retire Vercel); CF DNS/WAF/Access in front.
- Backend (API + worker + Redis + Postgres) on **Render or Fly** with staging+prod;
  resolve/supersede **#230** here (bundled `node dist/server.cjs`, telemetry bounds).
- **Delete** `terraform/` + `k8s/` sprawl (or archive) — close that ops vacuum.
- Exit: 2 platforms (CF + one backend host), staging→prod promotion working.

### Phase 3 — Debt & hardening
- Burn down **#236** (frontend TS errors, missing deps, recharts/resizable drift).
- Raise test gates; add Sentry; smoke tests post-deploy.

### Phase 4 — Meta propagation
- From a meta-organvm-capable context, complete **#238** (IRF/omega/seed/concordance,
  refresh stale Ontologia counters).

### Phase 5 — (optional) Full Cloudflare (Option E)
- Strangler-migrate API→Workers/Hono; BullMQ→Queues+Cron; Redis→Durable Objects/Upstash;
  Postgres via Hyperdrive. One endpoint/job at a time, behind the CF router.

## 6. Risks & rollback
- **Biggest risk:** flipping #234's fail-closed switches before prereqs (#235) in a
  given env → mass 401/403. Mitigation: per-env flags, staging-first, smoke test.
- **Migration risk:** 014–019 (esp. `org_id NOT NULL` backfill). Mitigation:
  expand-contract, backup, run on staging first.
- **Rollback:** every platform in A/B/D supports one-click redeploy of the prior
  release; keep flags as the fast off-switch.
