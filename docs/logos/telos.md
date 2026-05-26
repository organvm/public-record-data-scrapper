# Telos — The Idealized Form

_The dream and its theoretical grounding. What this system is evolving **toward**,
unconstrained by today's accidents of hosting. Authored 2026-05-25._

> Pragma is the honest present; Praxis is the road; **Telos is the destination.**

## The form in one breath

**A single-vendor, edge-native, AI-augmented, $0-to-start platform** where the
UCC→MCA intelligence pipeline runs as close to the data and the user as
physically possible, scales on usage rather than on a monthly bill, and carries
its own release discipline (preview → staging → production, instant rollback) as
a property of the platform — not a pipeline we maintain.

Cloudflare is not a hosting choice here; it is the **substrate**. Everything is
one mental model, one CLI (`wrangler`), one identity plane.

## The ideal stack (every concern → its ideal primitive)

| Concern | Ideal primitive | Why it is the ideal, not merely adequate |
|---|---|---|
| SPA delivery | **Pages** | global edge, immutable deploys, per-branch previews — free |
| API | **Workers + Hono** | runs in every datacenter; cold-start ≈ 0; Express-shaped |
| System of record | **D1** (SQLite + FTS5) | colocated with compute; FTS5 replaces `pg_trgm`; `json1` replaces JSONB; zero connection pool to manage |
| Async pipeline | **Queues** (Cron + a D1 drain at the $0 floor) | durable, at-least-once; Cron Triggers own the scheduled scrapes |
| Stateful coordination | **Durable Objects** | the agentic council's loop state, per-tenant rate limits, and real-time progress become *single-threaded objects at the edge* — no Redis, no races |
| MCA-likelihood scoring | **Workers AI + Vectorize** | the "AI-powered" promise made literal: inference + embedding similarity at the edge, per request |
| Cache / config / flags | **KV** | feature-flag the fail-closed switches; edge-read config |
| Artifacts / exports / raw scrapes | **R2** | zero egress; already in use (`cronus-assets`) |
| Identity | **Cloudflare Access (Zero Trust)** | the `org_id` the IDOR fix needs arrives *in the Access JWT* — auth stops being our code |
| IaC + CD | **`wrangler.toml` + GitHub Actions** | environments and rollback are declared, not operated |

## How the domain lands on it

- **Ingestion** (50-state UCC scraping): **Cron Triggers** fire per-state Workers;
  results stream to **D1**; large payloads to **R2**; failures re-enqueued via the
  **Queue/drain**.
- **Scoring** (MCA likelihood, health): **Workers AI** inference + **Vectorize**
  similarity over prior filings — replaces hand-rolled heuristics with edge ML.
- **Agentic council** (DataAnalyzer → Optimizer → Security → UX): each cycle is a
  **Durable Object** holding loop state and the safety gates — the autonomy
  invariants from `AgenticEngine` become DO-enforced, not in-memory-hopeful.
- **Search/dedup**: **D1 FTS5** for fuzzy entity matching; **Vectorize** for
  semantic "businesses like this one."

## Invariants the ideal form must always satisfy

1. **$0 floor.** It must run, end to end, on free tiers. Cost grows only with
   real usage. (Queues/Durable Objects may want the $5 Workers plan; the floor
   degrades gracefully to Cron + a D1 jobs table until then.)
2. **One vendor, one CLI, one identity plane.** No second dashboard.
3. **Security is carried, not re-derived.** Every control from #234 ports forward:
   org-scoped access, fail-closed webhooks, role checks, input validation. Because
   D1/SQLite has no RLS, **tenant isolation lives in the query layer** and is
   non-negotiable — every query is org-scoped or it does not ship.
4. **Release discipline is a platform property.** Preview per PR, `[env.staging]`
   auto, `[env.production]` promoted, version rollback one command.
5. **Observability is default-on.** Workers logs + Logpush/Sentry; health checks;
   no silent failure (the audit's recurring sin).

## Accepted tradeoffs to reach the ideal (eyes open)

- **D1 over Postgres**: we surrender `pg_trgm`/JSONB-GIN/btree_gin and accept a
  data-layer rewrite (→ FTS5 + `json1`) and a one-time data migration. This is
  the deliberate cost of single-vendor purity. Pragma/Praxis track the bridge.
- **Express → Hono**: a framework rewrite; the *logic* (esp. #234) is preserved,
  the glue is replaced.
- **No always-on process**: the BullMQ mental model is abandoned for
  Cron + Queues + Durable Objects — a more correct edge model, but a re-think.

## Symmetry

This document raises the Logos layer from VACUUM toward form. Its counterparts:
`pragma.md` (what is), `praxis.md` (how we cross), `receptio.md` (still a vacuum —
the reception, to be authored as the polis forms).
