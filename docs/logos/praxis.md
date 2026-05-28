# Praxis — Remediation Plan & Carry-Forward (the vacuums)

_Last updated: 2026-05-28. The N/A / MISSING / VACUUM signals are logged here so
nothing is silently dropped. "A vacuum where something should be" → research,
plan, log._

## A. Carry-forward: external-index propagation (COULD NOT be done from this container)

The audit-remediation work is committed local+remote (PR #234), but the
following **universal-registry propagations are PENDING** because this execution
environment cannot reach the meta-workspace:

- `organvm` CLI is **not installed** here.
- `meta-organvm/` (and `INST-INDEX-RERUM-FACIENDARUM.md`) is **not on this
  filesystem**.
- The GitHub integration is **scoped to `a-organvm/public-record-data-scrapper`
  only** — external repos/indices are unreachable.

**TODO (run from a context with meta-organvm + `organvm` CLI access):**
1. **IRF** — register completed items (security hardening, multi-tenant
   isolation, RLS, webhook verification) and any newly-discovered items; move to
   `## Completed`; update statistics.
2. **GitHub issues** — close any issues covered by PR #234.
3. **omega scorecard** — assess impact of the security/compliance fixes.
4. **inquiry-log.yaml** — update if this counts as SGO work.
5. **seed.yaml** — capabilities changed (Auth0 org-claim, RLS, jose webhook
   verification) → reflect.
6. **CLAUDE.md** — architecture changed (org-scoped auth, RLS GUC, `config.stripe`,
   billing route, jose dep) → reflect.
7. **concordance** — new IDs introduced (migrations 014–019) → register.

## B. Repo vacuums (this repo)

- **Logos tetrad partially filled**: `telos.md`, `pragma.md`, and this
  `praxis.md` now exist (authored 2026-05-28); `receptio.md` (reception) and
  `alchemical-io.md` remain **vacuums** — left for the maintainer rather than
  fabricated. Symmetry will stay <1.0 until authored.
- **Missing files referenced by CLAUDE.md**: `.conductor/active-handoff.md`
  (conditional), `inquiry-log.yaml` (absent).

## C. Open `TODO(security)` left by the remediation (intentional, documented)

_Updated 2026-05-25 end-of-session: items addressed in round 2 marked ✅._

- ✅ **Plaid ES256 / JWK verification** — implemented with `jose` (createRemoteJWKSet + jwtVerify), JWKS cached, fail-closed; the HS256 interim is gone.
- ✅ **dataTier real entitlement** — resolves from a verified `tier` claim or `organizations.subscription_tier` (TTL-cached), header ignored, fail-closed.
- ✅ **Per-tenant job scoping** — BullMQ jobs now carry `orgId`; read/list/delete are org-filtered (admin sees all; 404 on cross-org to avoid existence leaks).
- **Auth0 must issue an `org_id` claim in production** — the IDOR fix derives org
  from the token; without the claim, org-scoped endpoints fail closed (403). The
  middleware already accepts namespaced Auth0 claims. **Pending external config.**
- **RLS requires a non-owner DB role** — policies are not `FORCE`d; the table
  owner bypasses them. Deploy the app under a dedicated non-owner role for
  tenant isolation to actually bite. The per-request `app.current_org_id` GUC is
  wired via `orgContextMiddleware`. **Pending deploy-time config.**

Under the Cloudflare-E target (see `telos.md`), the Auth0 prerequisite dissolves
into Cloudflare Access (the `org_id` arrives in the Access JWT); RLS is replaced
by the query-layer org-scoping invariant (telos #3) since D1 has no row-level
security.

## D. Stale meta-metrics (NOT true vacuums — data staleness)

- Ontologia reports `test_files: 0`, `repos_with_tests: 0`, `code_files: 0` —
  but this repo has **142 test files** and a full TS codebase. These are stale
  counters in the meta-system, not real vacuums. **Action:** refresh the
  Ontologia collector against this repo.

## E. Pre-existing debt surfaced by the audit (out of the remediation's scope)

- **Frontend type errors**: 357 remain (228 in test fixtures). `recharts@3` /
  `react-resizable-panels@4` major-version API drift in `packages/ui`;
  `databaseService`/`queries.ts` contract drift (~20 errors).
- **Missing deps**: `papaparse` (+`@types/papaparse`) and `winston` are imported
  by `apps/web` but not installed — `TS2307`. Add or remove the imports.
- **`index.ts` auto-starts on import** (no `require.main`/`import.meta` guard) →
  importing it for tests/tooling boots the server + connects to the DB. Add a
  main-module guard.
