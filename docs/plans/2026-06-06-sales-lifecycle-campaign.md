# Sales-Lifecycle Campaign — Make the Whole Product Demonstrably Real

**Date:** 2026-06-06 · **Trigger:** prospective client engagement (inbound re-contact); the
product itself must justify premium pricing. **Standard:** no mock, fake, placeholder, or
simulated data anywhere a client can see; every lifecycle stage demonstrably live.

## Ground truth (from the 2026-06-06 three-track audit)

**Real today:** JWT auth with no dev bypass · org-scoped multitenancy + Postgres RLS ·
UCC ingestion worker (CA/TX/FL collectors, upserts, quality checks, circuit breakers) ·
health-score worker (12h cadence, persisted) · live API client (prod build cannot render
mock data) · TCPA/DNC/consent gating in CommunicationsService · DealsService /
DisclosureService / ContactsService fully implemented server-side · Stripe checkout.

**Broken or unreal today:**

1. `POST /prospects/:id/claim`, `/unclaim`, `/batch/claim`, `DELETE /batch` — called by the
   UI, not implemented by the server (live 404s on the funnel's core gesture).
2. Deals, Communications, Compliance, Contacts UI components exist but are mounted in no
   App.tsx tab — four backend-wired stages invisible.
3. `EnrichmentService.enrichProspect` throws unconditionally ("not wired to live
   providers"); enrichment worker fails every job by design.
4. ScoringService (612 ln), QualificationService (789 ln), UnderwritingService (800 ln):
   real logic, zero routes, zero worker callers — unreachable.
5. `server/worker.ts` starts 3 of 8 workers; outreach/coverage-digest/termination/velocity/
   portal-probe queues fill and never drain. `processOutreachJob` stub-marks `sent`.
6. Stripe webhook handlers are console.logs; subscription state never persisted.
7. AlertService has no backing table — alerts computed then dropped.
8. Agentic `executeImprovement` = `simulateExecution` (setTimeout + fabricated metrics).
9. Client-side `DataEnrichmentService` fabricates revenue/health/sentiment via
   `Math.random()` (dormant, but one render away from a demo disaster).
10. `ScraperFactory` defaults to `'mock'` implementation; `AgentOrchestrator` emits
    simulated collection counts into agent metrics.
11. NY has a real scraper but no ingestion collector; IL is placeholder-only.
12. Top-of-funnel lead sourcing beyond UCC filings (#60) was never designed or built.
13. Observability (metrics/tracing/Sentry) requested in #35/#75/#239, never delivered.

## Phases

### Phase 1 — Close the integrity gaps (no external credentials required) ← THIS PHASE

1. Implement claim/unclaim/batch prospect routes against ProspectsService (+tests).
2. Mount Deals, Communications, Compliance, Contacts tabs in App.tsx.
3. Defuse fake-data landmines: DataEnrichmentService → honest fail-closed gate (server
   pattern); ScraperFactory default `'real'` outside test; AgentOrchestrator stops writing
   simulated counts into metrics.
4. Wire ScoringService into `POST /api/prospects/:id/score` + ingestion/health worker so
   `priority_score` is computed, not inherited. Expose QualificationService and
   UnderwritingService routes.
5. Register all 8 workers in worker.ts; make outreachWorker call CommunicationsService
   (which already enforces TCPA/DNC/consent) instead of stub-marking sent.
6. Persist Stripe webhook events → organizations/subscription state; alerts table +
   migration; AlertService persistence wired into healthWorker.
7. Wire EnrichmentService to the existing tiered data-source layer (free tier: SEC EDGAR,
   Census, OSHA, USPTO — no keys needed) so enrichment jobs succeed with real public data.

### Phase 2 — Live-data activation (NEEDS OWNER INPUT: credentials/contracts)

- TX: `TX_UCC_USERNAME`/`TX_UCC_PASSWORD` or SOSDirect API key — works once provided.
- CA: `CA_SOS_API_KEY` + `CA_SOS_UCC_KEY` (portal is WAF-blocked; API path is the way).
- FL: vendor (Image API) contract + `FL_VENDOR_*` config.
- NY: build the incremental ingestion collector around the existing scraper.
- Stripe/SendGrid/Twilio/Plaid production keys; webhook secrets (fail-closed verifiers
  already in place from #234).
- Auth0 org_id claim or Cloudflare Access config (#235/#239).

### Phase 3 — The agent system for sales (the differentiator)

- Real agentic executor: approved Improvements map to concrete actions (re-score, re-enrich,
  sequence-start, alert) through the server API; backend consumer for AgentCallbackPayload.
- Outreach sequencing E2E: filing detected → enrich → score → qualify → sequence →
  TCPA-gated send → reply detection → deal creation.
- Pre-call briefing + narrative generation surfaced in the UI.
- Top-of-funnel expansion (#60): design + implement non-UCC lead channels.

### Phase 4 — Proof & polish for the pricing conversation

- Observability: Sentry + structured metrics so reliability is demonstrable, not asserted.
- Live demo script: fresh org → real TX/CA ingestion → enrichment → scoring → claim →
  sequence → deal → disclosure → (sandbox) payment. Zero seeded rows.
- E-sign provider integration (DocuSign/Dropbox Sign) for the closing stage.
- Cloudflare epic (#239) staging/prod promotion discipline.

## Working agreements

- Every phase lands as PR(s) with tsc clean, tests ≥ baseline, build green.
- No new mock paths; anything unimplementable fails closed with a named reason.
- External-dependency asks are batched in Phase 2 so engineering never blocks on them.

## Closure status (2026-06-07)

- **Phase 1 — EXECUTED** (DONE-588, PR #249). **Phase 3 — EXECUTED** (DONE-589, PR #250;
  28 adversarial-review findings fixed pre-PR). Tech-debt prerequisite — EXECUTED
  (DONE-587, PR #248). Merge order #248 → #249 → #250, owner-gated.
- **Phase 2 — OPEN** under IRF-III-060 (credential ladder) + IRF-III-061 (env-truth
  hazard) + IRF-III-062 (MCP-mintable: Sentry/Stripe/Cloudflare/Neon).
- **Phase 4 — PARTIAL**: Prometheus + DEMO_RUNBOOK shipped (PR #250); Sentry DSN
  (IRF-III-062), e-sign provider, Cloudflare epic #239 remain.
- IRF filing: corpvs PR #434 (DONE-587..589 + IRF-III-060..062 + IRF-SYS-252..253).
  Session handoff: `.claude/plans/2026-06-07-handoff-sales-lifecycle-close.md`.
