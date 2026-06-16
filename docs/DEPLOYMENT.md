# Deployment — Real Backend on Vercel (serverless)

This guide stands up a **real** backend for the hosted app. Previously the Vercel
deployment served only the static SPA, so every `/api/*` and `/_spark/*` request
returned 404. The repo now ships Vercel serverless functions that run the actual
Express API.

## What's wired

| File                    | Role                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api/index.ts`          | Vercel function that forwards every `/api/*` request to the Express app (`getServerlessApp()` in `server/index.ts`). No port binding, no background workers. |
| `api/spark-fallback.ts` | Benign 200 stub for `@github/spark` `/_spark/*` calls (dev-only endpoints).                                                                                  |
| `vercel.json`           | Builds the SPA to `dist/`, routes `/api/*` → the API function, `/_spark/*` → the fallback, and everything else → the SPA (`index.html`).                     |

`getServerlessApp()` makes a single best-effort database connection per warm
container when `DATABASE_URL` is set; it does **not** start the BullMQ workers or
the cron scheduler (those run in a separate long-lived process — see below).

## Honest constraints (read before deploying)

- **The API code runs, but DB-backed routes need a database.** Without
  `DATABASE_URL`, routes like `/api/prospects` fail closed (controlled error),
  not silently. Stateless routes (`/api/health/live`, docs) work with no env.
- **Background work is not serverless.** UCC ingestion, enrichment, and digests
  run on BullMQ workers (`server/worker.ts`) that need Redis and a persistent
  host. A Vercel function cannot run them. Deploy the worker separately
  (Render/Fly/a small VM) pointed at the same Postgres + Redis.
- **This was verified locally, not deployed.** `server/__tests__/serverlessApp.test.ts`
  proves the function serves `/api/health/live` (200), guards `/api/prospects`
  (401, not 404), returns the API's own 404 for unknown paths, forwards through
  `api/index.ts`, and that the Spark fallback returns 200. A live deployment
  additionally requires your Vercel project + the secrets below.

## Required environment variables (set in the Vercel dashboard)

Minimum for an authenticated, data-backed API:

```
JWT_SECRET=<32+ char secret>          # required in every environment
DATABASE_URL=postgresql://user:pass@host:5432/db
NODE_ENV=production
```

Optional (enable when you have them — all fail closed if unset):

```
# Background worker host (NOT the Vercel function):
REDIS_URL=redis://host:6379

# Commercial enrichment (key-gated, fail-closed):
SAM_GOV_API_KEY=...                   # free api.data.gov key
DNB_API_KEY=...
CLEARBIT_API_KEY=...
ZOOMINFO_API_KEY=...

# State collection (fail-closed if unset):
CA_SOS_API_KEY=...                    # California
TX_SOSDIRECT_API_KEY=...              # Texas (+ account id)
NY_UCC_DEBTOR_SEEDS=Acme Corp,Example LLC   # New York portal scraper
```

See `.env.example` for the full list.

## Deploy steps

1. `vercel link` (or import the repo in the Vercel dashboard).
2. Add the environment variables above (Project → Settings → Environment Variables).
3. Provision Postgres (e.g. Neon/Supabase/RDS) and run the migrations in
   `server/database/migrations` against it. See the **Production deployment gate**
   below for the migration/RLS sequence the security hardening requires.
4. Deploy. `vercel.json`'s `buildCommand` builds the SPA; Vercel builds the
   `api/*` functions automatically.
5. Deploy the **worker** separately (`npm run build:server && node dist/worker.cjs`
   or `tsx server/worker.ts`) on a host with Redis access, using the same
   `DATABASE_URL` / `REDIS_URL`.

## Local verification

```bash
# Unit-level proof the serverless app is wired (no DB needed):
npm run test:server -- serverlessApp

# Full local stack (API + workers + DB + Redis) for a true end-to-end demo:
#   1. start Postgres + Redis
#   2. set DATABASE_URL / REDIS_URL / JWT_SECRET
#   3. npm run dev   (or build:all then run dist/server.cjs + dist/worker.cjs)
```

---

## Production deployment gate (security prerequisites)

This checklist covers the security-hardening prerequisites from PR #234 / issue #235.
Run it before promoting a production deploy.

### Required sequence

1. Provision production secrets in the deployment secret store:
   - `JWT_SECRET`
   - `DATABASE_URL`
   - `CORS_ORIGIN`
   - `STRIPE_WEBHOOK_SECRET`
   - `TWILIO_AUTH_TOKEN`
   - `SENDGRID_WEBHOOK_VERIFICATION_KEY`
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET`
2. Configure Auth0/access-token issuance so tokens include an `org_id` claim.
   Namespaced claims ending in `/org_id` or `/orgId` are supported. Set
   `JWT_ORG_CLAIM` only when the direct claim name differs from `org_id`.
3. Confirm the product mapping from `organizations.subscription_tier` to the app
   data tier. Current code maps `free` to `free-tier`; `starter`,
   `professional`, and `enterprise` map to `starter-tier`.
4. Run database migrations `014` through `019` with a migration/owner role:

   ```bash
   DATABASE_URL="$MIGRATION_DATABASE_URL" npm run db:migrate
   ```

5. Run the app with a dedicated non-owner Postgres role. RLS from migration
   `018` only protects tenant rows when the app role is not the table owner and
   does not have `BYPASSRLS`.
6. Verify the deploy gate with the app role's production environment:

   ```bash
   JWT_ORG_CLAIM_CONFIRMED=true \
   DATA_TIER_MAPPING_CONFIRMED=true \
   DATABASE_URL="$APP_DATABASE_URL" \
   npm run deploy:verify
   ```

   Instead of `JWT_ORG_CLAIM_CONFIRMED=true`, you may provide
   `DEPLOY_PREREQ_ACCESS_TOKEN` containing a representative access token; the
   verifier decodes it and checks for an `org_id`/`orgId` claim shape.

### Notes

- `PLAID_WEBHOOK_SECRET` is intentionally not required. Plaid webhooks are
  verified with ES256 JWT signatures by fetching JWKs through `PLAID_CLIENT_ID`
  and `PLAID_SECRET`.
- Run `deploy:verify` after migrations, because it checks the database state:
  hardening migrations, RLS helper/policies, and whether the app DB role would
  bypass RLS as an owner, superuser, or `BYPASSRLS` role.
- `TRUST_PROXY=1` means trust one proxy hop. Avoid `TRUST_PROXY=true` unless the
  network path is fully controlled.
