# Live Demo Runbook

**Audience:** a sales engineer driving a live demo of the UCC-MCA Intelligence Platform for a
prospective paying client.

**Standard:** zero fabricated data. Every figure on screen comes from a real public source or from
the client's own inputs. Where a beat cannot run — because a credential is absent or a provider is
unreachable — it fails closed with a named reason. That failure is not a defect to hide; in this
phase it is the most honest thing in the room. A platform that refuses to invent a revenue figure
when it has no data is the differentiator. Show the closed door and name the key that opens it.

This runbook covers what is demonstrably real **today** (campaign Phase 1 + Wave A, no external
credentials). Beats that need keys are catalogued in the Credential Ladder (§3) and map to the
campaign plan's Phase 2 list (`docs/plans/2026-06-06-sales-lifecycle-campaign.md`).

A note on scope, said plainly: the authenticated product surface is the **REST API**. The React
dashboard is real and renders live data, but it has **no built-in login** as of this phase and does
not attach an `Authorization` header to its API calls. The lifecycle below is therefore driven over
`curl` with a hand-minted token; the UI's role in the demo is honest narration of the same data, not
the authentication path. This is stated again, in context, at the relevant beats. Do not pretend the
dashboard logs anyone in — it does not, yet.

---

## 1. Fresh start

### 1.1 Prerequisites

- Docker + Docker Compose.
- Node 20+ and `npm` (the migration and token-minting steps run on the host).
- `curl` and `jq` (the script below uses `jq`; if you would rather not, every `jq` filter has an
  obvious manual equivalent).
- A terminal at the repository root.

### 1.2 Bring up Postgres and Redis only

The application container is **not** started yet — we want to control migrations and the token before
anything serves traffic.

```bash
docker-compose up -d db redis
docker-compose ps
```

`db` listens on `5432` (Postgres 15, database `ucc_mca`, user `postgres`, password `postgres` per
`docker-compose.yml`). `redis` listens on `6379`. Wait until both report healthy before proceeding.

### 1.3 Point the host at the containerised Postgres

The migration runner (`scripts/migrate.ts`) reads **discrete** connection variables, not a single
`DATABASE_URL`: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (defaults `localhost`,
`5432`, `ucc_mca`, `postgres`, empty). The compose Postgres uses password `postgres`, so set it
explicitly for the migration shell:

```bash
export DB_HOST=localhost DB_PORT=5432 DB_NAME=ucc_mca DB_USER=postgres DB_PASSWORD=postgres
```

The API server (`server/config/index.ts`) is configured separately and reads `DATABASE_URL` plus a
required `JWT_SECRET`. Set those for the run below:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ucc_mca
export REDIS_URL=redis://localhost:6379
export JWT_SECRET="demo-secret-please-rotate-$(openssl rand -hex 16)"
export NODE_ENV=development
```

`JWT_SECRET` is mandatory in **every** environment — the config has no dev fallback and the server
exits at startup if it is unset (`validateConfig` in `server/config/index.ts`). The same secret must
be used to mint the demo token in §1.6, or the API will reject it.

### 1.4 Run migrations through 024

```bash
npm run db:migrate
```

This applies every pending `database/migrations/NNN_*.sql` in order and records them in
`schema_migrations`. The latest is `024_scrape_jobs.sql`. Confirm the tail of
the output shows migration `024` completed and "All migrations completed successfully". Migration
`018` installs row-level security keyed on the `app.current_org_id` GUC; this is why the org-binding
in §1.5 matters.

### 1.5 Create an organisation and a user — the actual auth flow

There is **no signup or login endpoint** in this server. Authentication is verify-only: the API
trusts any `Bearer` JWT signed with `JWT_SECRET` (HS256, pinned — see `server/middleware/authMiddleware.ts`)
and reads the tenant from the token's `org_id` claim. Issuing tokens is the identity provider's job
(Auth0 is the documented Phase-2 path); for a local demo we mint the token ourselves and create the
matching tenant row by hand.

Because RLS (`app_current_org_id()`) and the discovery insert path both bind to a real
`organizations.id`, the org row must exist before the token can do anything useful. Create one and
capture its id:

```bash
ORG_ID=$(docker-compose exec -T db psql -U postgres -d ucc_mca -tA -c \
  "INSERT INTO organizations (name, slug, subscription_tier, is_active)
   VALUES ('Demo Brokerage', 'demo-brokerage', 'professional', true)
   RETURNING id;")
echo "ORG_ID=$ORG_ID"
```

`organizations` (migration `004`) requires `name` and a unique `slug`; everything else has a default.
Optionally create a user row for realism (the API does not require it — authorisation is entirely
claim-based — but it makes the demo data coherent):

```bash
docker-compose exec -T db psql -U postgres -d ucc_mca -c \
  "INSERT INTO users (org_id, email, role, is_active)
   VALUES ('$ORG_ID', 'se@demo-brokerage.test', 'admin', true);"
```

### 1.6 Mint the demo JWT

The server expects an HS256 token whose `sub` is the user id and whose `org_id` claim matches the
tenant. The org-claim name is configurable (`JWT_ORG_CLAIM`, default `org_id`) and the algorithm is
pinned to HS256. Mint one with the same `JWT_SECRET` exported above:

```bash
TOKEN=$(node -e '
  const jwt = require("jsonwebtoken");
  const t = jwt.sign(
    { sub: "se-demo-user", email: "se@demo-brokerage.test", role: "admin", org_id: process.env.ORG_ID },
    process.env.JWT_SECRET,
    { algorithm: "HS256", expiresIn: "8h" }
  );
  process.stdout.write(t);
')
echo "$TOKEN"
export AUTH="Authorization: Bearer $TOKEN"
```

`role: "admin"` satisfies the `requireRole('user','admin')` guard on `POST /api/discovery/run`; a
`role: "user"` token works for everything else. The token is valid for 8 hours — long enough for a
demo, short enough not to leak into a long-lived artefact.

This `node -e` call is the documented dev token path. The same construction is what the server's own
test helper does (`server/__tests__/helpers/testApp.ts` → `generateTestToken`), using `jwt.sign` with
`config.jwt.secret`. There is no first-party CLI for minting; this is it.

### 1.7 Start the API and worker

```bash
npm run dev:server   # Express on :3000 (one terminal)
npm run dev:worker   # BullMQ worker, all 8 queues (a second terminal)
```

The worker process (`server/worker.ts`) registers all eight workers — ingestion, enrichment,
health-scores, outreach, coverage-digest, termination-detection, velocity-analysis, portal-probe —
and drains them on a 30s graceful shutdown. The API logs its routes on boot. Sanity check:

```bash
curl -s http://localhost:3000/api/health | jq .
```

`/api/health` is public (no auth). A `200` with a status body means the server is up and the database
is reachable.

### 1.8 Do NOT run `npm run seed`

`npm run seed` executes `scripts/seed-database.ts`, which **clears existing tables and loads
`database/seed.sql`** — sample organisations, users, contacts, prospects and deals. That is exactly
the fabricated data this demo exists to avoid. Seeding would put invented companies and invented
scores in front of the client and silently undermine every "this is real" claim you make. Leave it
unrun. Every prospect the client sees in this demo is sourced live in §2.1.

If someone has already seeded the database on this machine, start from a clean one
(`docker-compose down -v` removes the `postgres-data` volume) and re-run §1.2–§1.7. An empty
prospect table at the start of the demo is the point, not a problem.

---

## 2. Stage-by-stage lifecycle

Every command below carries the `$AUTH` header from §1.6. All `/api/*` routes except `/api/health`
and the Stripe/Twilio/SendGrid webhooks require a valid JWT; the protected routers additionally bind
the org context for RLS. Run them in sequence — later stages consume the prospect id produced earlier.

### 2.1 Discovery — top-of-funnel, real public data

```bash
curl -s -X POST http://localhost:3000/api/discovery/run \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"state":"CA","limit":25}' | jq .
```

`POST /api/discovery/run` fans across three key-less channels (`server/services/discovery-channels/`):

- `sec-edgar-registrants` — SEC EDGAR full-text search for recent S-1 / 8-K registrants (financing
  activity). Requires only a descriptive User-Agent, no key.
- `socrata-building-permits` — public Socrata open-data building-permit datasets (expansion signal).
- `sba-7a-loans` — recent SBA 7(a) borrowers from the SBA CKAN FOIA dataset (confirmed financing).

All three report `configured: true` unconditionally — they need no credentials. The response shows
`candidates_found`, `inserted`, `duplicates`, and a `per_channel` breakdown. New candidates are
written to `prospects` with `status: 'new'`, an explicit "Unscored discovery seed" narrative, and a
linked `growth_signals` row. The org is taken from your token, never the request body; supplying a
mismatched `org_id` is rejected with `403`.

If a channel's upstream is unreachable or changes shape, that channel contributes a **named error** to
`per_channel` (e.g. `sec-edgar-registrants: SEC EDGAR unreachable: ...`) and the run proceeds with the
channels that answered. If every requested channel fails, nothing is inserted — by design. Talk the
client through the `per_channel` map: this is the system telling the truth about its own sourcing.

List the prospects discovery just created and capture one id:

```bash
curl -s -H "$AUTH" "http://localhost:3000/api/prospects?limit=5" | jq '.prospects[] | {id, company_name, status, priority_score}'
PROSPECT_ID=$(curl -s -H "$AUTH" "http://localhost:3000/api/prospects?limit=1" | jq -r '.prospects[0].id')
echo "PROSPECT_ID=$PROSPECT_ID"
```

> If discovery returns zero candidates (upstream rate-limit, or no permit data for the chosen state),
> pick a different `state` or drop the `state` filter to run all channels nationally. Do not fall back
> to seeded data.

### 2.2 Enrichment — real key-less public signals

```bash
curl -s -X POST http://localhost:3000/api/enrichment/prospect \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"prospect_id\":\"$PROSPECT_ID\"}" | jq .
```

`POST /api/enrichment/prospect` runs `EnrichmentService.enrichProspect`, which queries four real
public sources with no API key (`server/services/EnrichmentService.ts`): SEC EDGAR (public filings →
contract/expansion signal), OSHA enforcement (workplace-safety violations → health-score input), USPTO
(trademark activity → expansion signal), and Census Business Patterns (industry statistics → revenue
estimate). It persists only what the sources actually return.

Fail-closed behaviour to demonstrate deliberately: if **every** source fails for a prospect, the
service records a `failed` enrichment log and **throws** with the aggregated reasons
(`Enrichment failed for prospect <id>: <source: reason>; ...`) — it does not write a fabricated
profile. Partial success (some sources answered, some did not) persists a `partial` enrichment with
the failed sources named in the result's error list. A prospect with no company name or an unknown
state will name exactly that as the missing input. This is the anti-`Math.random()` posture: no data,
no number.

`/api/enrichment/batch` does the same across up to 100 prospect ids and returns per-prospect
success/failure. The scheduled `data-enrichment` queue runs the same path every 6 hours via the worker.

### 2.3 Scoring

```bash
curl -s -X POST "http://localhost:3000/api/prospects/$PROSPECT_ID/score" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{}' | jq '{composite: .scoring.compositeScore, grade: .scoring.grade, confidence: .scoring.confidence, narrative: .prospect.narrative}'
```

`POST /api/prospects/:id/score` runs `ScoringService.scoreProspect`, which reads the prospect's linked
`ucc_filings` (status, recency, volume) and latest `health_scores` row, derives intent/health/position
sub-scores, applies industry and state modifiers, and returns a composite 0-100 score with a grade,
confidence, factors, narrative, and recommendation. The composite is persisted as the canonical
`priority_score` (the column the dashboard sorts on) along with the generated narrative. Optional
`industry` / `state` in the body override the modifiers.

For a prospect freshly discovered in §2.1 with no UCC filings yet, the score reflects exactly that —
a low-confidence score driven by the discovery signal alone. That is honest: the number moves once
real filing data lands. Do not pre-load filings to inflate it.

### 2.4 Claim — in the UI, with a caveat said out loud

The funnel's core gesture is claiming a prospect. The API is live:

```bash
curl -s -X POST "http://localhost:3000/api/prospects/$PROSPECT_ID/claim" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"user":"se@demo-brokerage.test"}' | jq '{id, status, claimed_by, claimed_date}'
```

This sets `status='claimed'`, `claimed_by`, `claimed_date` via an atomic conditional update. Claiming
an already-claimed prospect returns `409`; an unknown id returns `404`. `POST .../unclaim` reverses it;
`POST /api/prospects/batch/claim` and `DELETE /api/prospects/batch` handle bulk gestures (the literal
`batch` segment is routed ahead of `:id`).

About the UI: start the dashboard with `npm run dev` (Vite on :5173) pointed at the API
(`VITE_API_BASE_URL=http://localhost:3000/api`). It renders the Prospects, Portfolio, Intelligence,
Analytics, Requalification, Agentic, Deals, Contacts, Communications and Compliance tabs, and the
claim/unclaim controls wire to the routes above. The honest caveat to say aloud: **the dashboard has
no login and does not attach the `Bearer` token to its requests in this phase**, so against the
JWT-protected API its data calls return `401`. Use the UI to walk the client through the structure,
the tabs, and the live status banner; drive the authenticated lifecycle itself over `curl` as above.
In-app authentication is a Phase-2 item (Auth0 / Cloudflare Access). Do not claim the dashboard logs
the client in — it does not yet, and the client will respect you more for saying so.

### 2.5 Briefing tab — pre-call briefing and narrative

```bash
curl -s -H "$AUTH" "http://localhost:3000/api/outreach/briefing/$PROSPECT_ID" | jq .
curl -s -H "$AUTH" "http://localhost:3000/api/outreach/narrative/$PROSPECT_ID" | jq .
```

`GET /api/outreach/briefing/:prospectId` returns a cached briefing if one exists, otherwise generates
one from the prospect's real record (`PreCallBriefingService`). `GET /api/outreach/narrative/:prospectId`
generates the sales narrative (`NarrativeService`). An unknown prospect returns `404` with the
not-found reason. Both are built from persisted prospect/filing/signal data — there is no synthetic
filler.

### 2.6 Outreach sequence — the honest fail-closed beat

```bash
curl -s -X POST "http://localhost:3000/api/outreach/trigger/$PROSPECT_ID" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"triggerType":"termination"}' | jq .
```

`POST /api/outreach/trigger/:prospectId` checks eligibility (`OutreachSequenceService.isEligible`) and,
if eligible, creates a sequence (`201` with a `sequenceId`); if not eligible it returns `409` with a
named `reason`. `GET /api/outreach/sequences/:prospectId` lists active sequences;
`POST /api/outreach/sequences/:id/cancel` cancels one.

Here is the beat to lean into. The outreach worker (registered and running) hands actual sends to
`CommunicationsService`, which enforces TCPA / DNC / consent gating **and then** calls SendGrid (email)
or Twilio (SMS/voice). In this phase those providers are **unconfigured**, so the sends fail closed
with named provider errors:

- Email: `SendGrid` external-service error — the underlying client refuses with
  `SendGrid client is not configured` because `SENDGRID_API_KEY` is unset.
- SMS / voice: `Twilio` external-service error — the client refuses with `Twilio client is not
configured` because `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` are unset.

You can show the gate directly:

```bash
curl -s -X POST http://localhost:3000/api/communications/send-email \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"prospect_id\":\"$PROSPECT_ID\",\"sent_by\":\"se-demo-user\",\"to_address\":\"lead@example.test\",\"subject\":\"Intro\",\"body\":\"Hello\"}" | jq .
```

Before it ever reaches SendGrid, this passes through the compliance gate: a suppressed/DNC recipient or
absent consent is rejected with a `403` (`Recipient is on the Do-Not-Call (DNC) suppression list`,
`No active consent on file for email to this contact`) and recorded as a `failed` communication with a
compliance-block reason. If compliance permits, the send then fails at the provider with the SendGrid
"not configured" error above. Either way: **no message is sent and nothing is marked sent that was
not**. The previous implementation stub-marked outreach as `sent`; that landmine is gone. Frame this to
the client as the feature it is — the platform will not claim contact it did not make, and it will not
contact anyone it is not legally cleared to contact. The keys that light up real sends are in §3.

### 2.7 Deals tab

```bash
curl -s -H "$AUTH" "http://localhost:3000/api/deals?limit=10" | jq '.'
```

`GET /api/deals` lists the org's deals; `POST /api/deals` creates one (org taken from the token);
`GET /api/deals/:id`, `PUT`, `PATCH` and `DELETE` manage the lifecycle. On a fresh demo this list is
legitimately empty until you create a deal — show the create flow rather than pre-populating it.

### 2.8 Compliance tab

```bash
curl -s -H "$AUTH" "http://localhost:3000/api/compliance/disclosures?limit=10" | jq '.'
curl -s -H "$AUTH" "http://localhost:3000/api/compliance/consents/stats" | jq '.'
curl -s -H "$AUTH" "http://localhost:3000/api/compliance/audit?limit=10" | jq '.'
```

`GET /api/compliance/disclosures` lists disclosures for the org; `POST /api/compliance/disclosures`
generates a state-specific disclosure for a deal (`deal_id` + two-letter `state` required);
`/consents` and `/consents/stats` cover consent records; `/audit` and `/audit/export` expose the audit
trail (also written automatically by `auditMiddleware` on every request). Everything here is
org-scoped — a tenant cannot read another tenant's disclosures even by deal id.

### 2.9 Metrics endpoint scrape

```bash
curl -s -H "$AUTH" http://localhost:3000/api/metrics
```

`GET /api/metrics` returns Prometheus text-exposition format: process uptime/memory, per-queue job
counts across all eight BullMQ queues (waiting/active/completed/failed/delayed), and per-state
ingestion success/failure/consecutive-failure counters. It is self-protecting and fails closed — it
authorises a **valid JWT** or the configured `METRICS_TOKEN` (via `Authorization: Bearer <token>` or
the `X-Metrics-Token` header) and returns `401` when neither is present. There is no "public when
unconfigured" path. A queue that is uninitialised or whose Redis is unreachable is **omitted** and
surfaced as a `# queue "<name>" unavailable: <reason>` comment line — never reported as a fabricated
zero. If a queue is missing from the output, the comment line tells the client exactly why.

---

## 3. Credential ladder

Each row names the environment variable(s) that unlock an additional demo beat, the beat itself, and
the campaign Phase-2 line item it corresponds to. Variable names are taken from the code that reads
them — not invented. Set a variable, restart the API/worker, and the corresponding beat changes from
fail-closed to live.

| Env var(s)                                                                    | Read by                                                                                                    | Unlocks                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase-2 item                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `TX_UCC_USERNAME`, `TX_UCC_PASSWORD`                                          | `scripts/scrapers/auth-config.ts`                                                                          | Live Texas SOSDirect **portal scraper** runs (`npm run test:scrapers:tx`, CLI scrape).                                                                                                                                                                                                                                                                                                                                              | TX live UCC ingestion                   |
| `TX_SOSDIRECT_API_KEY`, `TX_SOSDIRECT_ACCOUNT_ID`                             | `server/routes/health.ts` (TX blueprint)                                                                   | Flips TX coverage from `blocked` to `operational` in `/api/health/coverage`; enables the scheduled TX **bulk** collector.                                                                                                                                                                                                                                                                                                           | TX live UCC ingestion                   |
| `CA_SOS_API_KEY`, `CA_SOS_UCC_KEY`                                            | `apps/web/src/lib/collectors/state-collectors/CAApiCollector.ts`; `server/routes/health.ts` (CA blueprint) | Flips CA coverage to `operational`; enables the real CA API collector (the portal is WAF-blocked, so the API path is the only one).                                                                                                                                                                                                                                                                                                 | CA live UCC ingestion                   |
| `FL_VENDOR_API_KEY`, `FL_VENDOR_API_SECRET`, `FL_VENDOR_CONTRACT_ACTIVE=true` | `server/routes/health.ts` (FL blueprint)                                                                   | Flips FL coverage to `operational`; enables the contract-backed Florida vendor feed.                                                                                                                                                                                                                                                                                                                                                | FL vendor contract                      |
| `SENDGRID_API_KEY` (+ `SENDGRID_FROM_EMAIL`)                                  | `server/integrations/sendgrid/client.ts`                                                                   | Real outbound **email** through `/api/communications/send-email` and the outreach sequence — replaces the "SendGrid client is not configured" failure.                                                                                                                                                                                                                                                                              | SendGrid production keys                |
| `SENDGRID_WEBHOOK_VERIFICATION_KEY`                                           | `server/middleware/webhookAuth.ts`                                                                         | Verified inbound SendGrid events (delivery/open/inbound-parse) at `/api/webhooks`; without it those webhooks fail closed.                                                                                                                                                                                                                                                                                                           | SendGrid webhook secret                 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`              | `server/integrations/twilio/client.ts`                                                                     | Real outbound **SMS / voice** through `/api/communications/send-sms` and `/initiate-call` — replaces the "Twilio client is not configured" failure. (`TWILIO_AUTH_TOKEN` also verifies inbound Twilio webhooks.)                                                                                                                                                                                                                    | Twilio production keys                  |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                  | `server/config/index.ts` (stripe block)                                                                    | Live billing via `/api/billing`; verified Stripe webhooks persisting subscription state (raw-body signature verification).                                                                                                                                                                                                                                                                                                          | Stripe production keys + webhook secret |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` (`PLAID_ENV`)                               | `server/integrations/plaid/client.ts`, `server/middleware/webhookAuth.ts`                                  | Real bank-data extraction for `POST /api/prospects/:id/underwrite` (Plaid `accessToken`) and verified Plaid webhooks via ES256/JWK lookup. Without these, underwriting and Plaid webhook verification fail closed.                                                                                                                                                                                                                  | Plaid production keys                   |
| `METRICS_TOKEN`                                                               | `server/routes/metrics.ts`                                                                                 | A non-JWT scrape path for `/api/metrics` (Prometheus pull via `X-Metrics-Token`) — otherwise the endpoint accepts only a valid JWT.                                                                                                                                                                                                                                                                                                 | Observability (#35/#75/#239)            |
| `INBOUND_PARSE_TOKEN`                                                         | `server/routes/webhooks.ts` (inbound-parse endpoint)                                                       | Gates `POST /api/webhooks/sendgrid/inbound?token=...` — SendGrid Inbound Parse has no signature mechanism, so the route is protected by this shared-secret query token. FAIL CLOSED: when the env var is unset (or the request's `?token=` is missing/mismatched) the endpoint rejects with `401` and no inbound email is persisted. Set it to enable inbound-email ingestion (reply attach + opt-out suppression + positive→deal). | SendGrid webhook secret                 |

Production-only guard: when `NODE_ENV=production`, `validateConfig` (`server/config/index.ts`) hard-fails
startup unless `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `SENDGRID_WEBHOOK_VERIFICATION_KEY`,
`PLAID_CLIENT_ID`, and `PLAID_SECRET` are present. The local demo runs as `development`, so these are
optional — their absence simply keeps the corresponding sends/webhooks fail-closed. `PLAID_WEBHOOK_SECRET`
is no longer used; Plaid webhooks are verified with ES256 signatures and JWKs fetched through the Plaid
client credentials.

---

## 4. Troubleshooting — named fail-closed errors a driver will see

These are the failures you should expect, and what each one means. None of them are bugs; most are the
platform refusing to fabricate. If you see one not on this list, stop and investigate before showing it.

| Symptom / error                                                                                                     | Meaning                                                                                                                                    | Action                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Server exits at boot: `JWT_SECRET is required (set it in every environment)`                                        | `JWT_SECRET` is unset — there is no dev fallback by design.                                                                                | Export `JWT_SECRET` (§1.3) and restart. Use the **same** value you minted the token with.                                        |
| `401 Unauthorized` / `No authorization header provided` on every `/api/*` call                                      | The `$AUTH` header is missing, or the token was signed with a different secret.                                                            | Re-run §1.6 with the current `JWT_SECRET`; confirm `echo "$AUTH"` shows a Bearer token.                                          |
| `401 Unauthorized` from the **dashboard** while `curl` works                                                        | Expected. The UI has no login and does not send the token in this phase (§2.4).                                                            | Drive the lifecycle over `curl`; use the UI for narration. Do not "fix" by enabling mock data.                                   |
| `403 FORBIDDEN` / `No organization associated with this account` on discovery/compliance                            | The token has no `org_id` claim.                                                                                                           | Re-mint the token with `org_id` set to your `$ORG_ID` (§1.6).                                                                    |
| `403` / `org_id does not match authenticated organization`                                                          | A request body/query `org_id` differs from the token's org.                                                                                | Drop the explicit `org_id` from the request — the org always comes from the token.                                               |
| Discovery `per_channel` shows `sec-edgar-registrants: SEC EDGAR unreachable: ...` (or Socrata/SBA equivalents)      | That upstream is down, rate-limited, or changed shape. The run proceeds on the channels that answered.                                     | Retry, choose another `state`, or run without `state`. Never substitute seeded data.                                             |
| Discovery `candidates_found: 0`                                                                                     | No live candidates matched (state/limit/upstream).                                                                                         | Widen the query (drop `state`) or pick a high-activity state. An empty result is honest.                                         |
| Enrichment throws `Enrichment failed for prospect <id>: sec-edgar: ...; osha: ...`                                  | Every public source failed for this prospect — fail-closed, nothing persisted.                                                             | Pick a prospect with a real company name/state; retry (upstreams are intermittent).                                              |
| Enrichment `422` naming a missing input (e.g. `unknown state`, `missing company name`)                              | The prospect lacks an input a source needs.                                                                                                | Enrich a discovery-sourced prospect that has a name and a valid two-letter state.                                                |
| Score returns a low composite / low confidence on a fresh prospect                                                  | Correct — a freshly discovered prospect has no UCC filings or health data yet.                                                             | Explain the score moves once real filing data lands. Do not inject filings to inflate it.                                        |
| Communications `ExternalServiceError: SendGrid — Failed to send email` / client `SendGrid client is not configured` | `SENDGRID_API_KEY` unset — email fails closed before any send.                                                                             | Expected in Phase 1. Set `SENDGRID_API_KEY` (§3) to enable real email.                                                           |
| Communications `ExternalServiceError: Twilio — Failed to send SMS` / client `Twilio client is not configured`       | Twilio creds unset — SMS/voice fail closed.                                                                                                | Expected in Phase 1. Set the `TWILIO_*` trio (§3) to enable real SMS/voice.                                                      |
| Communications `403` `... Do-Not-Call (DNC) suppression list` / `No active consent on file ...`                     | The compliance gate blocked the send before any provider call; recorded as a `failed` communication.                                       | This is the feature. Show it. Use a contact with recorded consent to demonstrate a permitted path.                               |
| Underwrite `422` `MISSING_UNDERWRITING_INPUTS` (`accessToken`)                                                      | No Plaid token — underwriting will not invent financials.                                                                                  | Expected without Plaid. Set `PLAID_CLIENT_ID`/`PLAID_SECRET` (§3) and supply a sandbox `accessToken`.                            |
| Qualify `422` `MISSING_QUALIFICATION_INPUTS` with a `missing` field list                                            | Required bank-data features absent; the engine fails closed naming each one.                                                               | Run `/underwrite` first (with a Plaid token) to produce the features, or pass complete `bankFeatures`.                           |
| `/api/metrics` returns `401`                                                                                        | Neither a valid JWT nor `METRICS_TOKEN` was presented.                                                                                     | Scrape with `$AUTH`, or set `METRICS_TOKEN` and use `X-Metrics-Token`.                                                           |
| `/api/metrics` shows `# queue "<name>" unavailable: ...` comment lines                                              | That queue is uninitialised or its Redis is unreachable; depth is omitted, not zeroed.                                                     | Confirm the worker is running (§1.7) and Redis is up (`docker-compose ps`).                                                      |
| `npm run db:migrate` fails to connect                                                                               | Host connection vars point at the wrong place, or `db` is not healthy yet.                                                                 | Set `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` (§1.3); wait for `docker-compose ps` to show `db` healthy.                     |
| Tenant data from another org appears in a query result                                                              | The API connected to Postgres as the table **owner** (default `postgres` role); non-FORCEd RLS policies are bypassed for owners. See §4.1. | Connect as a non-owner application role (§4.1) to enforce row-level isolation; the owner connection is expected to see all rows. |
| Demo opens with invented companies/scores already present                                                           | The database was seeded (§1.8).                                                                                                            | `docker-compose down -v`, then re-run §1.2–§1.7. Start from an empty prospect table.                                             |

### 4.1 Ops note — tenant RLS binds only for a non-owner DB role

Migration `018` installs row-level security keyed on the `app.current_org_id` GUC, and the API sets that
GUC per request from the token's `org_id`. There is a sharp caveat that decides whether isolation is
actually enforced: **a table's RLS policies are bypassed by the table's owner (and any superuser) unless
the policy is declared `FORCE`.** These policies are not `FORCE`d, so when the app connects to Postgres as
the **owning** role (the default in this compose setup, where everything runs as `postgres`), the GUC is
set but the policies do not constrain reads — every tenant's rows are visible. RLS only takes effect once
the app connects as a **separate, non-owner** application role that holds `SELECT/INSERT/UPDATE/DELETE` but
does **not** own the tables. Migrations must still run as the owner (they create/alter the tables and would
otherwise be blocked). The practical upshot for this demo: cross-tenant isolation is demonstrable by role
separation, not by the owner connection — do not claim a `postgres`-connected API is enforcing row-level
isolation when it is the table owner. (`server/database/connection.ts` carries the same note inline.)
