# ucc-mca-edge — Cloudflare edge foundation

The strangler-pattern base for migrating this platform (Express + BullMQ + Redis
+ Postgres + Vite SPA) to an all-Cloudflare, $0-floor, edge-native architecture.
The ideal-form target is in [`../docs/logos/telos.md`](../docs/logos/telos.md).

Everything here is **self-contained** under `cloudflare/` (plus one GitHub
Actions workflow). It does not touch the root `package.json`, `server/`,
`apps/`, or `packages/`.

```
cloudflare/
  package.json            # self-contained deps + scripts
  wrangler.toml           # bindings, crons, [env.staging] / [env.production]
  README.md               # this file
  migrations/
    0001_init.sql         # D1 starter schema (orgs, prospects, jobs, FTS5)
  workers/api/
    tsconfig.json
    src/
      index.ts            # Hono app: /health, /api/prospects; default { fetch, scheduled }
      types.ts            # Env (bindings + secrets) + Identity
      auth.ts             # Cloudflare Access JWT verify + orgScope (#234 logic)
      db.ts               # typed D1 helpers (all/first/run)
      scheduled.ts        # Cron handler + D1 jobs drain ($0 queue)
```

## One-time setup

```bash
cd cloudflare
npm install
npx wrangler login

# 1. Create D1, paste the printed database_id into wrangler.toml (all 3 places:
#    top-level, [env.staging], [env.production] — or create separate DBs).
npx wrangler d1 create ucc-mca

# 2. Create the KV namespace, paste the printed id into wrangler.toml.
npx wrangler kv namespace create KV

# 3. Ensure the R2 bucket exists (telos already references `cronus-assets`).
npx wrangler r2 bucket create cronus-assets         # if not already created
# npx wrangler r2 bucket create cronus-assets-staging  # for the staging env

# 4. Apply the schema.
npm run db:migrate:staging      # wrangler d1 migrations apply ucc-mca --env staging
# npm run db:migrate:production  # when promoting

# 5. Set secrets (NOT in wrangler.toml). Repeat with --env production.
npx wrangler secret put JWT_SECRET --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
# ...any other ported-service secrets (SENDGRID_API_KEY, TWILIO_*, etc.)
```

### Cloudflare Access (identity plane)

Auth is carried by Cloudflare Access, not by our code (telos). Create a Zero
Trust **Access application** in front of this Worker's route, then:

1. Copy the **team domain** (e.g. `your-team.cloudflareaccess.com`) into the
   `ACCESS_TEAM_DOMAIN` var in `wrangler.toml`.
2. Copy the application **Audience (AUD) tag** into the `ACCESS_AUD` var.
3. Add an `org_id` field to the JWT — via a SAML/OIDC IdP claim mapping or an
   Access **custom claim**. The verifier accepts both flat `org_id` and
   namespaced `https://<team>/org_id`. A token without an org is rejected (401).

`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` are non-secret config, so they live in
`[vars]` (one set per environment).

## Local dev & deploy

```bash
npm run dev                 # wrangler dev (local Worker + miniflare D1/KV/R2)
npm run deploy:staging      # wrangler deploy --env staging
npm run deploy:production    # wrangler deploy --env production
npm run typecheck           # tsc --noEmit against the worker tsconfig
```

CI (`../.github/workflows/deploy-cloudflare.yml`):
push to `main` → auto-deploy **staging**; `workflow_dispatch` with `confirm=DEPLOY`
→ deploy **production**. Requires repo secrets `CLOUDFLARE_API_TOKEN`
(least-privilege) and `CLOUDFLARE_ACCOUNT_ID`.

## The strangler plan (how we cross)

1. **Foundation (this directory).** Access auth + org scoping + one real
   org-scoped read (`GET /api/prospects`) + Cron-drained D1 jobs queue. Once the
   placeholder IDs/secrets are filled, this `wrangler deploy`s.
2. **Port endpoints from `server/routes/*` into `workers/api/src`, one at a
   time — security logic first.** Re-derive nothing: every #234 control
   (org-scoped access, fail-closed webhooks, role checks, input validation)
   ports forward. Every D1 query is `WHERE org_id = ?` or it does not ship.
3. **Grow the schema.** Port `database/schema.sql` table-by-table under new
   numbered migrations (`0002_…`), translating JSONB→json1 and pg_trgm→FTS5.
   Run a one-time Postgres→D1 data migration when a table reaches parity.
4. **Flip the SPA.** Build `apps/web` and serve it from Pages
   (`wrangler pages deploy dist`); wire the API route to this Worker.
5. **Retire the old plane.** When parity is reached, decommission Render/Vercel
   and the Terraform/RDS/ElastiCache stack. One vendor, one CLI, one identity
   plane.

## Invariant reminders (telos)

- **$0 floor.** Cron + D1 jobs drain stands in for Queues/Durable Objects until
  the Workers Paid plan is worth it.
- **Tenant isolation lives in the query layer.** D1/SQLite has no RLS — see the
  banner in `src/db.ts`. No org-scope, no ship.
- **Fail closed.** Missing/invalid Access JWT → 401; org mismatch → 403; the
  error handler never leaks internals.
