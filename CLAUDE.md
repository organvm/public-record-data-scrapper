# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UCC-MCA Intelligence Platform — AI-powered lead generation for Merchant Cash Advance providers. Analyzes Uniform Commercial Code (UCC) filings to identify businesses with active financing and predict MCA likelihood. Features an autonomous agentic system for self-improving analytics.

## Commands

```bash
# Development
npm run dev                    # Frontend only (Vite on port 5173)
npm run dev:server             # API server only (Express on port 3000)
npm run dev:worker             # BullMQ worker process only
npm run dev:full               # All three concurrently (web + api + worker)

# Building
npm run build                  # TypeScript check + Vite build → dist/
npm run build:render           # Frontend build + bundled API server for Render/production
npm start                      # Run bundled production API server (dist/server.cjs)

# Testing — Frontend (Vitest + jsdom)
npm test                       # All frontend tests (watch mode)
npm test -- AgenticEngine      # Run focused test by name
npm run test:ui                # Vitest UI dashboard
npm run test:coverage          # Coverage report

# Testing — Server (Vitest + Node)
npm run test:server            # Server tests (single fork, 10s timeout)
npm run test:server:strict     # Enforce 80% coverage thresholds
npm run test:server:coverage   # Server coverage report

# Testing — E2E (Playwright)
npm run test:e2e               # Headless (5 browsers: Chrome, Firefox, Safari, Mobile Chrome/Safari)
npm run test:e2e:headed        # Visible browser
npm run test:e2e:ui            # Interactive Playwright UI
npm run test:e2e:debug         # Playwright debugger

# Testing — Scrapers (Puppeteer)
npm run test:scrapers          # All state scrapers
npm run test:scrapers:ca       # Single state (also :tx, :fl, :ny)
npm run test:scrapers:headed   # Visible browser

# Database
npm run db:migrate             # Run migrations
npm run db:test                # Test connection
npm run db:test:start          # Start test Postgres container
npm run db:test:stop           # Stop test Postgres container
npm run seed                   # Seed database

# CLI Scraper
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o results.json

# Docker (local full-stack)
docker-compose up -d           # App (3000) + Postgres (5432) + Redis (6379) + Worker
docker-compose --profile development up -d  # Above + Vite frontend (5000)

# Linting
npm run lint                   # ESLint (ts-eslint + react-hooks + react-refresh)
```

## Architecture

### Monorepo Structure (npm workspaces)

```
apps/
  web/       → React 19 + Vite 7 SPA (primary dashboard)
  desktop/   → Tauri + React 19 native desktop client
  mobile/    → Expo + React Native
packages/
  core/      → @public-records/core — canonical database client, identity, types
  ui/        → @public-records/ui — 60+ ShadCN/Radix component exports
server/      → Express.js REST API + BullMQ queue workers
database/    → PostgreSQL schema (uuid-ossp, pg_trgm, btree_gin extensions)
terraform/   → AWS infrastructure (VPC, RDS, ElastiCache)
```

**Path alias trap**: `@` resolves to different roots depending on context:

- Frontend (vite.config.ts): `@` → `apps/web/src/`
- Server tests (vitest.config.server.ts): `@` → `server/`
- tsconfig.json also maps `@public-records/core` and `@public-records/ui` to `packages/`

### Frontend (`apps/web/src/`)

**Entry point**: `App.tsx` orchestrates dashboard tabs (Prospects, Portfolio, Intelligence, Analytics, Requalification, Agentic). View state persists via `useKV` — keep KV keys stable.

**Agentic System** (`lib/agentic/`):

- `AgenticEngine.ts` — Autonomous loop with safety gates: `autonomousExecutionEnabled` defaults to `false`, `safetyThreshold: 80`, categories like `security` and `data-quality` always require manual review
- `AgenticCouncil.ts` — Sequences agents: DataAnalyzer → Optimizer → Security → UXEnhancer
- `BaseAgent.ts` — Extend this and push suggestions into the handoff to add new agents
- React bridge: `hooks/use-agentic-engine.ts` — Caches engine, persists improvements via `useKV`. Always call `setImprovements(engine.getImprovements())` after mutating engine state

**Data Flow**:

- Types: `lib/types.ts` is canonical — update before UI changes
- Mock data: `lib/mockData.ts` (shapes match types.ts, toggle via `VITE_USE_MOCK_DATA`)
- Filtering: `filteredAndSortedProspects` memo in `App.tsx`
- User events: Route through `trackAction()` for agentic analytics
- Batch ops: `selectedProspectIds` syncs with `BatchOperations` + checkbox overlay in `ProspectCard`

**UI**:

- ShadCN wrappers in `components/ui/` — reuse these, don't import raw Radix
- Theme: CSS variables in `styles/theme.css` + `theme.json`, dark mode via `next-themes` (`data-appearance` selector)
- Icons: `@phosphor-icons/react` proxied via `createIconImportProxy` in vite.config.ts — **do not remove that plugin or the Spark plugin**

### Backend (`server/`)

Express.js REST API (port 3000) with Swagger at `/api/docs`.

**Routes** (18 files): health, status, prospects, competitors, competitive, portfolio, enrichment, jobs, contacts, deals, billing, webhooks, outreach, communications, compliance, discovery, agentic, metrics. All require JWT auth except health, webhooks (signature-verified), and metrics (JWT **or** `METRICS_TOKEN`).

**Services** (30 files): ProspectsService, CompetitorsService, PortfolioService, EnrichmentService, ScoringService, StackAnalysisService, SuppressionService (TCPA/DNC), UnderwritingService, ComplianceReportService, AlertService, ContactsService, DealsService, CommunicationsService, QualificationService, NarrativeService, ConsentService, DisclosureService, AuditService, DisclosureCalculator, ReplyHandlingService, LeadDiscoveryService (+ discovery-channels: SEC EDGAR, Socrata permits, SBA loans), ImprovementExecutor, OutreachSequenceService, and supporting modules under `server/services/`.

**Integrations** (7): ACH payments, AWS (S3/SQS/CloudWatch), Plaid (bank linking), SendGrid (email), Stripe (payments + webhooks), Twilio (SMS/voice).

**Queue** (BullMQ + Redis): 3 queues — `ucc-ingestion` (daily 2AM, concurrency 2), `data-enrichment` (every 6h, concurrency 5), `health-scores` (every 12h, concurrency 3). Worker runs as separate process (`server/worker.ts`) with graceful 30s shutdown.

**Startup telemetry hydration**: Production startup hydrates persisted ingestion telemetry before queue boot. Use `INGESTION_TELEMETRY_SKIP_HYDRATION=true` to bypass it in constrained environments, or `INGESTION_TELEMETRY_HISTORY_LIMIT=<n>` to cap per-state history loaded at boot (default `50`).

### Data Collection (`apps/web/src/lib/collectors/`)

- `StateCollectorFactory.ts` — Factory pattern, selects by state code
- Collectors: CA (state portal), NY (state portal), TX (bulk download), FL (CSC/CT Corp vendor)
- `RateLimiter.ts` — Rate limiting for external APIs

### Database (`database/schema.sql`)

PostgreSQL 14+ with extensions: `uuid-ossp`, `pg_trgm` (fuzzy text search), `btree_gin`.

Core tables: `ucc_filings` (UUID PK, filing data, debtor/secured party, JSONB raw_data), `prospects` (priority_score 0-100, status enum, enrichment_confidence 0-1), `prospect_ucc_filings` (junction), `growth_signals`.

## Testing Notes

- Frontend: 526 tests, Vitest + jsdom, setup in `apps/web/src/test/setup.ts`
- Server: Vitest + Node, setup in `server/__tests__/setup.ts`, 80% coverage thresholds in CI
- E2E: Playwright, 5 browser projects, base URL `http://127.0.0.1:5173`
- Agentic tests: `apps/web/src/lib/agentic/AgenticEngine.test.ts` — assert safety thresholds and feedback loops

## Git Workflow

- Build skips diagnostics (`tsc -b --noCheck`); rely on IDE type checking
- Merge sibling branches before opening PRs
- Stage only files you touched
- Husky + lint-staged runs ESLint fix + Prettier on staged `.{js,jsx,ts,tsx}` files

## ⚡ Conductor OS Integration

This repository is a managed component of the ORGANVM meta-workspace.

- **Orchestration:** Use `conductor patch` for system status and work queue.
- **Lifecycle:** Follow the `FRAME -> SHAPE -> BUILD -> PROVE` workflow.
- **Governance:** Promotions are managed via `conductor wip promote`.
- **Intelligence:** Conductor MCP tools are available for routing and mission synthesis.

<!-- ORGANVM:AUTO:START -->

## System Context (auto-generated — do not edit)

**Organ:** ORGAN-III (Commerce) | **Tier:** flagship | **Status:** GRADUATED
**Org:** `organvm-iii-ergon` | **Repo:** `public-record-data-scrapper`

### Edges

- **Produces** → `organvm-v-logos/public-process`: dependency

### Siblings in Commerce

`classroom-rpg-aetheria`, `gamified-coach-interface`, `trade-perpetual-future`, `fetch-familiar-friends`, `sovereign-ecosystem--real-estate-luxury`, `search-local--happy-hour`, `multi-camera--livestream--framework`, `universal-mail--automation`, `mirror-mirror`, `the-invisible-ledger`, `enterprise-plugin`, `virgil-training-overlay`, `tab-bookmark-manager`, `a-i-chat--exporter`, `.github` ... and 16 more

### Governance

- Strictly unidirectional flow: I→II→III. No dependencies on Theory (I).

_Last synced: 2026-04-14T21:31:54Z_

## Active Handoff Protocol

If `.conductor/active-handoff.md` exists, **READ IT FIRST** before doing any work.
It contains constraints, locked files, conventions, and completed work from the
originating agent. You MUST honor all constraints listed there.

If the handoff says "CROSS-VERIFICATION REQUIRED", your self-assessment will
NOT be trusted. A different agent will verify your output against these constraints.

## Session Review Protocol

At the end of each session that produces or modifies files:

1. Run `organvm session review --latest` to get a session summary
2. Check for unimplemented plans: `organvm session plans --project .`
3. Export significant sessions: `organvm session export <id> --slug <slug>`
4. Run `organvm prompts distill --dry-run` to detect uncovered operational patterns

Transcripts are on-demand (never committed):

- `organvm session transcript <id>` — conversation summary
- `organvm session transcript <id> --unabridged` — full audit trail
- `organvm session prompts <id>` — human prompts only

## System Library

Plans: 269 indexed | Chains: 5 available | SOPs: 121 active
Discover: `organvm plans search <query>` | `organvm chains list` | `organvm sop lifecycle`
Library: `meta-organvm/praxis-perpetua/library/`

## Active Directives

| Scope   | Phase | Name                                                     | Description                                                                  |
| ------- | ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| system  | any   | atomic-clock                                             | The Atomic Clock                                                             |
| system  | any   | execution-sequence                                       | Execution Sequence                                                           |
| system  | any   | multi-agent-dispatch                                     | Multi-Agent Dispatch                                                         |
| system  | any   | session-handoff-avalanche                                | Session Handoff Avalanche                                                    |
| system  | any   | system-loops                                             | System Loops                                                                 |
| system  | any   | prompting-standards                                      | Prompting Standards                                                          |
| system  | any   | research-standards-bibliography                          | APPENDIX: Research Standards Bibliography                                    |
| system  | any   | phase-closing-and-forward-plan                           | METADOC: Phase-Closing Commemoration & Forward Attack Plan                   |
| system  | any   | research-standards                                       | METADOC: Architectural Typology & Research Standards                         |
| system  | any   | sop-ecosystem                                            | METADOC: SOP Ecosystem — Taxonomy, Inventory & Coverage                      |
| system  | any   | autonomous-content-syndication                           | SOP: Autonomous Content Syndication (The Broadcast Protocol)                 |
| system  | any   | autopoietic-systems-diagnostics                          | SOP: Autopoietic Systems Diagnostics (The Mirror of Eternity)                |
| system  | any   | background-task-resilience                               | background-task-resilience                                                   |
| system  | any   | cicd-resilience-and-recovery                             | SOP: CI/CD Pipeline Resilience & Recovery                                    |
| system  | any   | community-event-facilitation                             | SOP: Community Event Facilitation (The Dialectic Crucible)                   |
| system  | any   | context-window-conservation                              | context-window-conservation                                                  |
| system  | any   | conversation-to-content-pipeline                         | SOP — Conversation-to-Content Pipeline                                       |
| system  | any   | cross-agent-handoff                                      | SOP: Cross-Agent Session Handoff                                             |
| system  | any   | cross-channel-publishing-metrics                         | SOP: Cross-Channel Publishing Metrics (The Echo Protocol)                    |
| system  | any   | data-migration-and-backup                                | SOP: Data Migration and Backup Protocol (The Memory Vault)                   |
| system  | any   | document-audit-feature-extraction                        | SOP: Document Audit & Feature Extraction                                     |
| system  | any   | dynamic-lens-assembly                                    | SOP: Dynamic Lens Assembly                                                   |
| system  | any   | essay-publishing-and-distribution                        | SOP: Essay Publishing & Distribution                                         |
| system  | any   | formal-methods-applied-protocols                         | SOP: Formal Methods Applied Protocols                                        |
| system  | any   | formal-methods-master-taxonomy                           | SOP: Formal Methods Master Taxonomy (The Blueprint of Proof)                 |
| system  | any   | formal-methods-tla-pluscal                               | SOP: Formal Methods — TLA+ and PlusCal Verification (The Blueprint Verifier) |
| system  | any   | generative-art-deployment                                | SOP: Generative Art Deployment (The Gallery Protocol)                        |
| system  | any   | market-gap-analysis                                      | SOP: Full-Breath Market-Gap Analysis & Defensive Parrying                    |
| system  | any   | mcp-server-fleet-management                              | SOP: MCP Server Fleet Management (The Server Protocol)                       |
| system  | any   | multi-agent-swarm-orchestration                          | SOP: Multi-Agent Swarm Orchestration (The Polymorphic Swarm)                 |
| system  | any   | network-testament-protocol                               | SOP: Network Testament Protocol (The Mirror Protocol)                        |
| system  | any   | open-source-licensing-and-ip                             | SOP: Open Source Licensing and IP (The Commons Protocol)                     |
| system  | any   | performance-interface-design                             | SOP: Performance Interface Design (The Stage Protocol)                       |
| system  | any   | pitch-deck-rollout                                       | SOP: Pitch Deck Generation & Rollout                                         |
| system  | any   | polymorphic-agent-testing                                | SOP: Polymorphic Agent Testing (The Adversarial Protocol)                    |
| system  | any   | promotion-and-state-transitions                          | SOP: Promotion & State Transitions                                           |
| system  | any   | recursive-study-feedback                                 | SOP: Recursive Study & Feedback Loop (The Ouroboros)                         |
| system  | any   | repo-onboarding-and-habitat-creation                     | SOP: Repo Onboarding & Habitat Creation                                      |
| system  | any   | research-to-implementation-pipeline                      | SOP: Research-to-Implementation Pipeline (The Gold Path)                     |
| system  | any   | security-and-accessibility-audit                         | SOP: Security & Accessibility Audit                                          |
| system  | any   | session-self-critique                                    | session-self-critique                                                        |
| system  | any   | smart-contract-audit-and-legal-wrap                      | SOP: Smart Contract Audit and Legal Wrap (The Ledger Protocol)               |
| system  | any   | source-evaluation-and-bibliography                       | SOP: Source Evaluation & Annotated Bibliography (The Refinery)               |
| system  | any   | stranger-test-protocol                                   | SOP: Stranger Test Protocol                                                  |
| system  | any   | strategic-foresight-and-futures                          | SOP: Strategic Foresight & Futures (The Telescope)                           |
| system  | any   | styx-pipeline-traversal                                  | SOP: Styx Pipeline Traversal (The 7-Organ Transmutation)                     |
| system  | any   | system-dashboard-telemetry                               | SOP: System Dashboard Telemetry (The Panopticon Protocol)                    |
| system  | any   | the-descent-protocol                                     | the-descent-protocol                                                         |
| system  | any   | the-membrane-protocol                                    | the-membrane-protocol                                                        |
| system  | any   | theoretical-concept-versioning                           | SOP: Theoretical Concept Versioning (The Epistemic Protocol)                 |
| system  | any   | theory-to-concrete-gate                                  | theory-to-concrete-gate                                                      |
| system  | any   | typological-hermeneutic-analysis                         | SOP: Typological & Hermeneutic Analysis (The Archaeology)                    |
| unknown | any   | SOP-SS-ATM-001_001-atomic-decomposition                  | SOP-SS-ATM-001_001: Atomic Decomposition & Coverage Proof                    |
| unknown | any   | SOP-SS-CLT-001_001-ontology_client_decisions             | SOP-SS-CLT-001_001-ontology_client_decisions                                 |
| unknown | any   | SOP-SS-CNT-001_001-content-extraction-and-node-injection | SOP-SS-CNT-001_001: Content Extraction & Node Injection                      |
| unknown | any   | SOP-SS-ISS-001-001-ontology-issue-specification          | SOP-SS-ISS-001-001-ontology-issue-specification                              |
| unknown | any   | SOP-SS-PRC-001_001-ontology_meta_process                 | SOP-SS-PRC-001-001-ontology-meta-process                                     |
| unknown | any   | SOP-SS-QAB-001_001-project-board-qa                      | SOP-SS-QAB-001_001-project-board-qa                                          |
| unknown | any   | SOP-SS-TRK-001_001-ontology_issue_tracking               | SOP-SS-TRK-001_001-ontology_issue_tracking                                   |
| unknown | any   | registry                                                 | SOP Registry — Sovereign Systems                                             |

Linked skills: cicd-resilience-and-recovery, continuous-learning-agent, evaluation-to-growth, genesis-dna, multi-agent-workforce-planner, promotion-and-state-transitions, quality-gate-baseline-calibration, repo-onboarding-and-habitat-creation, structural-integrity-audit

**Prompting (Anthropic)**: context 200K tokens, format: XML tags, thinking: extended thinking (budget_tokens)

## Ecosystem Status

- **delivery**: 0/2 live, 0 planned
- **revenue**: 0/1 live, 1 planned
- **marketing**: 0/2 live, 1 planned
- **community**: 0/1 live, 0 planned
- **content**: 0/2 live, 1 planned
- **listings**: 0/1 live, 1 planned

Run: `organvm ecosystem show public-record-data-scrapper` | `organvm ecosystem validate --organ III`

## External Mirrors (Network Testament)

- **technical** (7): facebook/react, eslint/eslint, prettier/prettier, tailwindlabs/tailwindcss, microsoft/TypeScript +2 more

Convergences: 20 | Run: `organvm network map --repo public-record-data-scrapper` | `organvm network suggest`

## Entity Identity (Ontologia)

**UID:** `ent_repo_01KKKX3RVM84W1V9XGANHNW54G` | **Matched by:** primary_name

Resolve: `organvm ontologia resolve public-record-data-scrapper` | History: `organvm ontologia history ent_repo_01KKKX3RVM84W1V9XGANHNW54G`

## Live System Variables (Ontologia)

| Variable                | Value | Scope  | Updated    |
| ----------------------- | ----- | ------ | ---------- |
| `active_repos`          | 89    | global | 2026-04-14 |
| `archived_repos`        | 54    | global | 2026-04-14 |
| `ci_workflows`          | 107   | global | 2026-04-14 |
| `code_files`            | 0     | global | 2026-04-14 |
| `dependency_edges`      | 60    | global | 2026-04-14 |
| `operational_organs`    | 10    | global | 2026-04-14 |
| `published_essays`      | 29    | global | 2026-04-14 |
| `repos_with_tests`      | 0     | global | 2026-04-14 |
| `sprints_completed`     | 33    | global | 2026-04-14 |
| `test_files`            | 0     | global | 2026-04-14 |
| `total_organs`          | 10    | global | 2026-04-14 |
| `total_repos`           | 145   | global | 2026-04-14 |
| `total_words_formatted` | 0     | global | 2026-04-14 |
| `total_words_numeric`   | 0     | global | 2026-04-14 |
| `total_words_short`     | 0K+   | global | 2026-04-14 |

Metrics: 9 registered | Observations: 32128 recorded
Resolve: `organvm ontologia status` | Refresh: `organvm refresh`

## System Density (auto-generated)

AMMOI: 58% | Edges: 42 | Tensions: 33 | Clusters: 5 | Adv: 23 | Events(24h): 32336
Structure: 8 organs / 145 repos / 1654 components (depth 17) | Inference: 98% | Organs: META-ORGANVM:65%, ORGAN-I:53%, ORGAN-II:48%, ORGAN-III:54% +5 more
Last pulse: 2026-04-14T21:31:36 | Δ24h: -1.0% | Δ7d: n/a

## Dialect Identity (Trivium)

**Dialect:** EXECUTABLE_ALGORITHM | **Classical Parallel:** Arithmetic | **Translation Role:** The Engineering — proves that proofs compute

Strongest translations: I (formal), II (structural), VII (structural)

Scan: `organvm trivium scan III <OTHER>` | Matrix: `organvm trivium matrix` | Synthesize: `organvm trivium synthesize`

## Logos Documentation Layer

**Status:** MISSING | **Symmetry:** 0.0 (VACUUM)

Nature demands a documentation counterpart. This formation maintains its narrative record in `docs/logos/`.

### The Tetradic Counterpart

- **[Telos (Idealized Form)](../docs/logos/telos.md)** — The dream and theoretical grounding.
- **[Pragma (Concrete State)](../docs/logos/pragma.md)** — The honest account of what exists.
- **[Praxis (Remediation Plan)](../docs/logos/praxis.md)** — The attack vectors for evolution.
- **[Receptio (Reception)](../docs/logos/receptio.md)** — The account of the constructed polis.

### Alchemical I/O

- **[Source & Transmutation](../docs/logos/alchemical-io.md)** — Narrative of inputs, process, and returns.

- **[Public Essay](https://organvm-v-logos.github.io/public-process/)** — System-wide narrative entry.

_Compliance: Formation is currently void._

<!-- ORGANVM:AUTO:END -->
