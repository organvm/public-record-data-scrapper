# Deployment & Release Guide

This guide covers how to ship the UCC-MCA Intelligence Platform safely: the
production prerequisites that must be in place, the release/deploy flow, how to
smoke-test a running instance, and the release-discipline guardrails.

It consolidates the operational requirements tracked in **issue #235** (deploy
prerequisites) and the release-discipline items from the **#239 deployment
evolution epic**.

---

## 1. Components

The platform runs as three deployable surfaces:

| Surface        | Build output            | Run command            | Hosting (current)        |
| -------------- | ----------------------- | ---------------------- | ------------------------ |
| API server     | `dist/server.cjs`       | `node dist/server.cjs` | Render (`ucc-mca-api`)   |
| Queue worker   | `dist/worker.cjs`       | `node dist/worker.cjs` | Render / container       |
| Web dashboard  | `apps/web/dist/`        | static hosting         | GitHub Pages / Vercel    |

Build everything with `npm run build:render` (web + server + worker).

---

## 2. Production prerequisites (issue #235)

`main` is live-deployed, and the security-hardening work (PR #234) is
**fail-closed by design**: missing configuration causes a hard failure rather
than an insecure fallback. Put all of the following in place **before** deploying.

### 2.1 Configuration that blocks boot

`validateConfig()` (`server/config/index.ts`) throws on startup — the server
will not boot — if any of these are missing:

- [ ] **`JWT_SECRET`** — required in *every* environment. The insecure dev
      fallback was removed; an empty/missing secret aborts boot.
- [ ] **`DATABASE_URL`** — required in production.
- [ ] **`CORS_ORIGIN`** — required in production; must be non-empty and cannot be
      `*` (or empty) when credentials are enabled.
- [ ] **`STRIPE_WEBHOOK_SECRET`**
- [ ] **`TWILIO_AUTH_TOKEN`**
- [ ] **`PLAID_WEBHOOK_SECRET`**
- [ ] **`SENDGRID_WEBHOOK_VERIFICATION_KEY`**

  The four webhook verifiers **fail closed (HTTP 401)** when their secret is
  unset (previously fail-open). Production boot requires all four so webhooks
  are never silently rejected at runtime.

### 2.2 Auth0 / IdP — org claim

- [ ] **Issue an `org_id` claim on access tokens.** The multi-tenant IDOR fix
      derives the tenant from this JWT claim, not from request headers. Without
      it, `/api/deals` and `/api/contacts` return **403 for every user**
      (fail-closed). Namespaced custom claims (`https://<app>/org_id`) work;
      override the claim name with `JWT_ORG_CLAIM` if needed.
- [ ] *(Optional)* Issue a `tier` claim → drives data-tier entitlement. The
      `x-data-tier` request header is ignored. Map
      `organizations.subscription_tier` to the intended product tier.

### 2.3 Database & migrations

- [ ] **Run the app under a non-owner Postgres role** so row-level security
      (migration `018`) is enforced — a table owner bypasses non-`FORCE`d
      policies. The per-request `app.current_org_id` GUC is set by
      `orgContextMiddleware`.
- [ ] **Apply migrations `014`–`019` in order.** `014` sets
      `prospects.org_id NOT NULL` and backfills existing rows to a default
      "Unassigned" org — coordinate this with the cutover.
- [ ] **Apply `013_ingestion_telemetry_available_strategies.sql`** in any
      environment created before that migration (reliability fix IRF-APP-003,
      issue #230).
- [ ] Run with `npm run db:migrate`.

### 2.4 Runtime knobs (optional)

- `INGESTION_TELEMETRY_SKIP_HYDRATION=true` — bypass startup telemetry hydration
  in constrained environments.
- `INGESTION_TELEMETRY_HISTORY_LIMIT=<n>` — cap per-state history loaded at boot
  (default `50`).
- `METRICS_TOKEN=<token>` — bearer token alternative to JWT for `/api/metrics`.

See [`.env.example`](../.env.example) for the annotated variable list.

---

## 3. Release flow

### 3.1 Versioned release artifacts

Push a semver tag to publish checksummed artifacts to a GitHub Release
(`.github/workflows/release.yml`):

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Produces:

- `ucc-mca-server-<tag>.tar.gz` — server + worker bundles + `package.json`
- `ucc-mca-web-<tag>.tar.gz` — compiled web dashboard
- `SHA256SUMS.txt`

### 3.2 Web dashboard → GitHub Pages

`.github/workflows/pages.yml` builds `apps/web` and deploys to GitHub Pages on
every push to `main`. One-time setup: **Settings → Pages → Source = "GitHub
Actions."** The build sets `VITE_BASE=/<repo>/` so assets resolve under the
project subpath.

### 3.3 Edge (Cloudflare Workers)

`.github/workflows/deploy-cloudflare.yml` deploys the `cloudflare/` Worker:
push to `main` → staging; manual `workflow_dispatch` with `confirm=DEPLOY` →
production.

---

## 4. Smoke test

After a deploy, confirm the runner is live:

```bash
npm run smoke                                   # http://localhost:3000
SMOKE_URL=https://api.your-domain.com npm run smoke
curl -fsS https://api.your-domain.com/api/health
```

Healthy response:

```json
{ "status": "ok", "timestamp": "2026-06-15T09:00:00.000Z", "uptime": 12.34 }
```

Kubernetes/Render probes:

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready` (503 until the database answers)
- 50-state coverage: `GET /api/health/coverage`

---

## 5. Release discipline & guardrails (issue #239, P0)

Recommended environment promotion path:

```
local → PR preview → staging → production
```

- **Merge ≠ release.** `main` should auto-deploy to **staging**; production is a
  **manual promote** (already the model for the Cloudflare prod job and the
  release tag flow).
- **Branch protection on `main`** (configure in repo Settings → Branches). Mark
  these existing checks **required** so breaking changes can't merge unreviewed:
  - `TypeScript/Node.js CI` (`ci.yml`)
  - `backend-tests`
  - `validate-dependencies`
  - `CodeQL` / secret-scan security checks
  - Require a review approval; require branches up to date before merge.
- **Per-environment secrets** — never share one secret set across envs.
- **Feature-flag breaking changes** and use expand-contract migrations so the
  old and new code paths both work during a rollout.
- **Observability** — wire Sentry (`SENTRY_DSN`) and keep the health probes
  above on the platform's health checks.

---

## 6. Platform direction (issue #239 — decision pending)

The infrastructure currently spans Vercel + Render + Terraform/AWS + k8s, which
is a lot of surface for a solo operator. The epic proposes consolidating.

**Recommendation: Cloudflare-hybrid now → full-Cloudflare later.**

- **Now:** Cloudflare Pages for the SPA + Cloudflare edge in front of a
  Render/Fly Node backend that keeps Express + BullMQ + Redis + Postgres. The
  account already runs Workers/D1/R2, so the edge is an existing strength.
- **Later:** strangler-migrate the API → Workers, BullMQ → Queues/Cron, Redis →
  Durable Objects/Upstash, Postgres via Hyperdrive. Retire `terraform/` and
  `k8s/` only after the replacement is proven.

This is a **product/ops decision for the maintainer** — this document records the
recommendation; it does not execute the migration or remove existing infra.
