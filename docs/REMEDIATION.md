# Remediation Report — Full Heal of Audit Findings

This documents the code-level remediation of the six defects surfaced by the
α→ω inspection. Every claim below is reproducible with the listed command. No
data sources, customers, or compliance posture were invented; where a real fix
required credentials we don't have, the implementation is **key-gated and
fail-closed** and labeled as such.

Verification baseline (run from repo root):

```bash
npm test                                         # web   → 2,005 passing / 83 files
npm run test:server                              # server → 1,316 passing / 73 files (+6 skipped)
npm run build && npm run build:server            # web SPA + server bundle
npm audit                                        # 0 critical / 0 high (17 moderate, mobile-only)
```

Totals: **3,321 tests across 156 files, zero failures; 0 critical / 0 high CVEs.**

---

## 1. Test suite — config-glob bug + jsdom regression → green & truthfully counted

**Was:** the standard web run exited 1 (231 failures): `apps/web/vitest.config.ts`
had no `include`/`root`, so a root-level run swept the node-environment server
suite into jsdom; and 21 `use-agentic-engine` tests threw in `beforeEach`
because jsdom 27 + vitest 4 no longer expose `window.localStorage`. The
"2,055 tests / 91 files" badge was inaccurate.

**Fix:**

- `apps/web/vitest.config.ts` — added `root: __dirname` + `include: ['src/**/*.{test,spec}.{ts,tsx}']`.
- `apps/web/src/test/setup.ts` — added a spec-compliant `MemoryStorage` polyfill installed for `localStorage`/`sessionStorage` when absent.
- README badge + testing section corrected to the real, reproducible counts.

**Evidence:** `npm test` → 2,005 passing / 0 failing; `npm run test:server` → 1,316 passing.

## 2. Dependencies — 5 critical + 8 high → 0 critical / 0 high

**Fix:**

- `npm audit fix` (non-breaking) for the simple advisories (axios, ws, form-data, minimatch, vitest, tsx, vite, …).
- `concurrently` bumped `^9 → ^10.0.3` (dev tool) to clear the `shell-quote` critical.
- `overrides.esbuild = "0.28.1"` to force vite's transitive esbuild off the vulnerable `<0.28.1` range.

**Evidence:** `npm audit` → `critical=0 high=0`. The remaining **17 moderate** are
confined to the `apps/mobile` Expo/React-Native toolchain and require major
framework upgrades (expo 56 / react-native 0.86) — a separate migration, called
out here rather than forced.

## 3. State coverage — NY re-enabled; "50 states" corrected to the real 4

**Was:** NY was disabled in `apps/web/src/lib/collectors/StateCollectorFactory.ts`
(empty `accessMethods`, stub `createScraperCollector`, excluded from
`getImplementedStates()`) even though a real NY portal scraper + collector +
worker case + strategy profile already existed.

**Fix:** wired NY in the factory (registers `createNYScraperCollector`, FL-style
`isReady()` gate on `NY_UCC_DEBTOR_SEEDS`, added to `getImplementedStates()`),
updated the factory tests, and corrected every "50 states / 60+ agents" overclaim
in `README.md`, `DEPLOYMENT_READY.md`, and `apps/web/public/access.html` to the
real **4 implemented collectors (CA, TX, FL, NY)** with FL/NY credential-gated.

**Evidence:** `StateCollectorFactory.test.ts` (43 tests) asserts NY is implemented
and fail-closed without seeds.

## 4. Scoring — added a real, trainable ML model (honestly labeled); rules stay default

**Was:** "ML-based scoring" was a rules engine with zero ML.

**Fix:** added a genuine, dependency-free logistic-regression model
(`server/services/MLScoringModel.ts`) trained by gradient descent on binary
cross-entropy, a domain strategy (`server/services/MLScoringStrategy.ts`) with a
reproducible synthetic dataset, a training script (`npm run train:ml-model`), and
a committed weights artifact (`server/models/ml-scoring-weights.json`). It is
wired into `ScoringService.scoreProspect` as an **opt-in** supplement
(`includeMl`), computed from the same fetched signals.

**Honesty:** the model is trained on **synthetic seed data**, returns low
confidence (0.3) and an explicit warning, and the **transparent rules-based
composite remains the authoritative score**. README relabeled accordingly.

**Evidence:** `MLScoringModel.test.ts` (7 tests) proves it learns a separable
pattern (~95% train accuracy), round-trips weights, and ranks a strong prospect
above a weak one.

## 5. Enrichment — SAM.gov + D&B/Clearbit/ZoomInfo wired, fail-closed & key-gated

**Was:** these were env stubs, not wired into the enrichment pipeline.

**Fix:** updated `SAMGovSource` to use `SAM_GOV_API_KEY`; added real adapters
`DnBSource` / `ClearbitSource` / `ZoomInfoSource`
(`packages/core/src/enrichment/commercial-tier.ts`) following the existing
`BaseDataSource` contract; registered them in
`server/services/EnrichmentService.ts` so a source is queried **only when its key
is configured** (unconfigured sources are skipped, never dragging confidence
down). Each makes a real HTTP request when keyed and returns a **named error,
never fabricated data**, when unkeyed or on failure.

**Honesty:** the commercial adapters follow each vendor's published REST shape
but cannot be end-to-end verified without paid accounts; this is stated in-code
and they fail closed by default.

**Evidence:** `commercialSources.test.ts` (8 tests) — fail-closed when unkeyed,
correct mapping when keyed; `EnrichmentService.test.ts` (15 tests) — a configured
keyed source is queried and contributes; unconfigured sources don't affect
confidence.

## 6. Live backend — real serverless `/api` + Spark fallback (was: every path 404)

**Was:** the Vercel deployment served only the static SPA; every `/api/*` and
`/_spark/*` returned 404.

**Fix:**

- `server/index.ts` exports `getServerlessApp()` (builds the Express app, best-effort DB connect, no port/worker/cron).
- `api/index.ts` — Vercel function forwarding `/api/*` to the app (path-normalized).
- `api/spark-fallback.ts` — benign 200 stub for `/_spark/*`.
- `vercel.json` — routes `/api/*` → the function, `/_spark/*` → the fallback, everything else → the SPA; `outputDirectory: apps/web/dist` (the real build output).
- `docs/DEPLOYMENT.md` — honest deploy guide (DB/Redis/secrets required; workers run separately).

**Honesty:** verified **locally**, not deployed — a live deployment additionally
needs the owner's Vercel project + Postgres/Redis + secrets. DB-backed routes
fail closed without `DATABASE_URL`.

**Evidence:** `server/__tests__/serverlessApp.test.ts` (5 tests) — `/api/health/live`
→ 200, `/api/prospects` → 401 (guarded, not 404), unknown `/api/*` → Express 404
JSON, the `api/index` entrypoint forwards, and the Spark fallback returns 200.
