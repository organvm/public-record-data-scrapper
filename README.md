# Public Record Data Scraper

**Extract, enrich, and score UCC filings from US state Secretary of State portals.** Turns raw public records into prioritized, outreach-ready leads for the Merchant Cash Advance industry. Four state collectors are implemented today (CA, TX, FL, NY); the remaining states are on the roadmap.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests: 3,399](https://img.shields.io/badge/tests-3%2C399%20passing-brightgreen)](https://github.com/organvm-iii-ergon/public-record-data-scrapper)
[![Deploy: Vercel](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](https://public-record-data-scrapper.vercel.app)

---

## What It Does

1. **Collects** UCC-1 filing data from state Secretary of State portals — 4 collectors implemented (CA API, TX bulk, FL vendor, NY portal scraper) with per-state strategies (API, bulk download, vendor feed, scrape) and fallback. FL and NY are credential-gated and fail closed when unconfigured.
2. **Enriches** each filing with free public data (SEC EDGAR, OSHA, USPTO, Census Bureau) plus optional, key-gated sources (SAM.gov, D&B, Clearbit, ZoomInfo) that fail closed — returning a named error, never fabricated data — when no API key is configured
3. **Scores** every prospect 0--100 on financing likelihood, assigns a health grade (A--F), and flags growth signals (hiring, permits, equipment purchases, expansion)
4. **Delivers** results through a React web dashboard, REST API, or CLI tool

### Example Output

```json
{
  "company": "Pacific Coast Distributors LLC",
  "state": "CA",
  "ucc_filings": [
    {
      "filing_number": "2024-0847291",
      "secured_party": "National Funding Inc",
      "filing_date": "2024-03-15",
      "type": "UCC-1"
    }
  ],
  "enrichment": {
    "revenue_estimate": "$2.4M",
    "employee_count": 34,
    "growth_signals": ["hiring_detected", "new_permits", "equipment_purchase"],
    "health_grade": "B+",
    "priority_score": 82,
    "industry": "Wholesale Distribution"
  },
  "recommendation": "HIGH PRIORITY - Active financing, strong growth signals, clean compliance record"
}
```

---

## Usage

```bash
git clone https://github.com/organvm-iii-ergon/public-record-data-scrapper.git
cd public-record-data-scrapper
npm install --legacy-peer-deps
```

### Development and runtime commands

```bash
npm run dev                              # Run web app only (Vite)
npm run dev:server                       # Run Express API only
npm run dev:worker                       # Run BullMQ worker only
npm run dev:full                         # Run web + API + worker together
npm run build                            # Build distributable web bundle
npm run build:server                     # Build API worker output bundle
npm run start                            # Run built API server
npm run start:worker                     # Run built worker
```

Prerequisites for full stack/API commands:

```bash
docker-compose up -d db redis             # PostgreSQL + Redis
npm run db:migrate && npm run seed        # Apply schema + seed data
```

Health checks (running API on default `3000`):

```bash
curl -fsS http://localhost:3000/api/health           # Basic liveness
curl -fsS http://localhost:3000/api/health/detailed   # Dependency status
```

### CLI tools (`npm run scrape`)

The CLI is registered in `scripts/cli-scraper.ts` and executed as:

```bash
npm run scrape -- <command> [flags]
```

See command-level help with:

```bash
npm run scrape -- --help
npm run scrape -- scrape-ucc --help
```

```bash
# Scrape UCC filings for a company
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o ./results.json
#   required: -c|--company <name>, -s|--state <code>
#   optional: -o|--output <file> (default: ./output.json), --csv
#   supported states: CA, TX, FL, NY

# Normalize one company name
npm run scrape -- normalize -n "Company Name"
#   required: -n|--name <name>

# Enrich from public sources
npm run scrape -- enrich -c "Company Name" -s CA --tier professional -o ./enriched-data.json
#   required: -c|--company <name>, -s|--state <code>
#   optional: -o|--output <file> (default: ./enriched-data.json), --tier <free|starter|professional>, --csv
#   supported states: CA, TX, FL, NY

# Batch process CSV input
npm run scrape -- batch -i ./companies.csv -o ./batch-results
#   required: -i|--input <file> (CSV header + rows company,state)
#   optional: -o|--output <dir> (default: ./batch-results), --enrich
#   max 1,000 rows and input capped at 5MB

# Export scored leads (database-backed)
npm run scrape -- lead-export --min-score 70 --max-score 95 --state CA --limit 100 --offset 0 --output-dir ./lead-export
#   optional: -o|--output-dir <dir> (default: ./lead-export)
#   optional: --format <json|csv|both> (default: both)
#   optional: --min-score <0-100> (default: 70), --max-score <0-100>
#   optional: --state <CA|TX|FL|NY>, --industry <name>, --status <status>
#   optional: --limit <1-1000> (default: 100), --offset <integer> (default: 0)

# List available states with configured UCC collectors
npm run scrape -- list-states
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React 19 + Vite (Vercel CDN)                       │
│  Dashboard · Deal Pipeline · Compliance · Inbox     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│  Express API + BullMQ Workers                       │
│  27 domain services · OpenAPI 3.0 · JWT auth        │
└───────┬──────────────┬──────────────────────────────┘
        │              │
┌───────▼──────┐ ┌─────▼───────┐ ┌────────────────────┐
│ PostgreSQL   │ │   Redis 7   │ │ Agent Orchestrator  │
│ 9 migrations │ │ cache/queue │ │ 4 state collectors  │
│ multitenancy │ │             │ │ circuit breakers     │
└──────────────┘ └─────────────┘ └─────┬──────────────┘
                                       │
                    ┌──────────────────▼────────────────┐
                    │  State SOS Collectors (4 live)      │
                    │  CA · TX · FL · NY                  │
                    │  + SEC · OSHA · USPTO · Census      │
                    │  + SAM.gov · D&B · Clearbit · Zoom  │
                    └────────────────────────────────────┘
```

### Monorepo Layout

```
public-record-data-scrapper/
├── apps/
│   ├── web/               # React 19 dashboard (Radix UI, Tailwind)
│   ├── desktop/           # Tauri desktop app
│   └── mobile/            # Mobile app target
├── server/
│   ├── services/          # 27 domain services (scoring, enrichment, compliance, ...)
│   ├── integrations/      # Twilio, SendGrid, Plaid, ACH, AWS S3
│   ├── routes/            # Express route handlers
│   └── openapi.yaml       # API specification
├── packages/
│   ├── core/              # Shared types, DB client, utilities
│   └── ui/                # Shared component library
├── database/
│   ├── schema.sql         # Full PostgreSQL schema
│   └── migrations/        # 9 versioned migrations with rollbacks
├── terraform/             # AWS infrastructure (VPC, RDS, ElastiCache, S3)
├── k8s/                   # Kubernetes manifests
├── monitoring/            # Prometheus + CloudWatch alert rules
└── tests/                 # Integration + E2E (Playwright)
```

---

## API

The Express server exposes a RESTful API documented at `/api/docs` when running.

### Scrape API — auth: API key (`X-API-Key: prk_…` or `Authorization: Bearer prk_…`) or JWT

| Method | Endpoint                             | Description                                   |
| ------ | ------------------------------------ | --------------------------------------------- |
| `GET`  | `/api/scrape/readiness/:stateCode`   | Check whether a state scraper is available    |
| `POST` | `/api/scrape/ucc`                    | Search UCC filings by company name and state; body: `company_name`, `state`, optional `limit` (1–1000, default 100) |

### Dashboard API — auth: JWT

| Method  | Endpoint                      | Description                                  |
| ------- | ----------------------------- | -------------------------------------------- |
| `GET`   | `/api/prospects`              | List prospects with filtering and pagination |
| `GET`   | `/api/prospects/export/leads` | Export scored MCA leads as JSON or CSV       |
| `GET`   | `/api/prospects/:id`          | Prospect detail with enrichment data         |
| `POST`  | `/api/prospects/:id/claim`    | Claim a prospect for outreach                |
| `POST`  | `/api/prospects/:id/score`    | Trigger re-scoring                           |
| `GET`   | `/api/deals`                  | List deals with pipeline stage filter        |
| `PATCH` | `/api/deals/:id/stage`        | Move deal to next pipeline stage             |
| `POST`  | `/api/communications/send`    | Send email or SMS                            |
| `GET`   | `/api/compliance/report`      | Generate compliance report                   |

### API key management — auth: JWT, role: admin

| Method   | Endpoint        | Description          |
| -------- | --------------- | -------------------- |
| `POST`   | `/api/keys`     | Create an API key    |
| `GET`    | `/api/keys`     | List API keys        |
| `DELETE` | `/api/keys/:id` | Revoke an API key    |

Full endpoint list: [server/openapi.yaml](server/openapi.yaml)

### Data Tiers

| Tier                    | Sources                                                           | Cost               |
| ----------------------- | ----------------------------------------------------------------- | ------------------ |
| **Free / OSS (no key)** | SEC EDGAR, OSHA, USPTO, Census                                    | $0                 |
| **Optional, key-gated** | SAM.gov, D&B, Clearbit, ZoomInfo (fail closed without an API key) | Provider-dependent |

---

## Key Features

- **Multi-state UCC collection** -- 4 implemented collectors (CA API, TX bulk, FL vendor, NY portal scraper) with per-state fallback strategies (API, bulk download, vendor feed, scrape); FL and NY are credential-gated and fail closed when unconfigured. 47 states remain on the roadmap.
- **Transparent rules-based lead scoring** -- priority score (0--100) from a weighted, inspectable formula, health grade, growth signal detection, revenue estimation. An **optional, experimental ML model** (logistic regression) can be attached per request; it is opt-in, low-confidence, and trained on synthetic seed data pending validation against real outcomes — the rules-based score stays authoritative.
- **Compliance built in** -- CA SB 1235 and NY CFDL disclosure calculators, TCPA consent tracking, suppression list management, immutable audit trail
- **Full broker workflow** -- prospect dashboard, deal pipeline (Kanban), contact CRM, unified communications inbox (email/SMS/voice), bank statement underwriting (Plaid)
- **Production infrastructure** -- Terraform-provisioned AWS (VPC, RDS, ElastiCache, S3), Vercel frontend deployment, Docker Compose for local dev, Kubernetes manifests for container orchestration

---

## Testing

3,399 passing tests across 168 files (plus 6 skipped server tests), zero failures on a clean run (verified, branch rebased onto `main`). `npm test` runs two Vitest projects; the server suite is a third:

```bash
npm test                       # Client suites:  2,029 tests / 88 files (apps/web jsdom + root)
npm run test:server            # Server (node):   1,370 tests / 80 files (+6 skipped)
npm run test:coverage          # V8 coverage report (web)
npm run test:e2e               # Playwright end-to-end (3 specs, run separately)
```

| Suite                           | Runner         | Tests     | Files   |
| ------------------------------- | -------------- | --------- | ------- |
| Web — `apps/web` (`npm test`)   | Vitest + jsdom | 2,005     | 83      |
| Web — root project (`npm test`) | Vitest         | 24        | 5       |
| Server (`test:server`)          | Vitest + node  | 1,370     | 80      |
| **Total**                       |                | **3,399** | **168** |

Counts are reproducible from the test runners above. The server suite carries one pre-existing, order-dependent flaky test (`outreach` briefing "cache warm") that passes in isolation and on re-run; it is unrelated to this branch. The web run's earlier config-glob bug + jsdom localStorage regression were fixed here.

---

## Infrastructure

### Local Development

```bash
docker-compose --profile development up -d    # Full stack
docker-compose ps                             # Verify health
```

### Production build & releases

```bash
npm run build:render      # frontend dist/ + bundled dist/server.cjs + dist/worker.cjs
npm start                 # run the API server   (node dist/server.cjs)
npm run start:worker      # run the BullMQ worker (node dist/worker.cjs)
```

Tagged releases are published automatically: pushing a `v*` tag runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
the production bundle and attaches a runnable `ucc-mca-platform-<tag>.tar.gz` to
a GitHub Release.

```bash
git tag v1.2.3 && git push origin v1.2.3   # → builds + publishes the release
```

Download and run a release artifact:

```bash
tar -xzf ucc-mca-platform-v1.2.3.tar.gz && cd package
npm ci --omit=dev && node dist/server.cjs
curl -fsS http://localhost:3000/api/health   # smoke test
```

### Production (AWS via Terraform)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars  # Configure
terraform init && terraform plan              # Review
terraform apply                               # Deploy
```

Provisions: VPC with multi-AZ subnets, RDS PostgreSQL (encrypted, Multi-AZ), ElastiCache Redis (encrypted), S3 with lifecycle policies, CloudWatch + SNS alerting, IAM with least-privilege policies.

---

## Contributing

1. Fork and create a feature branch: `git checkout -b feature/your-feature`
2. Install: `npm install --legacy-peer-deps`
3. Develop: `npm run dev:full`
4. Test: `npm test` and `npm run test:server` (all tests must pass — 3,321 across both suites)
5. Lint: `npm run lint`
6. Commit: `git commit -m "feat: description"` ([Conventional Commits](https://www.conventionalcommits.org/))
7. Open a Pull Request

### Priority Contribution Areas

- **State agent implementations** -- live implementations needed for NY, IL, OH, GA, PA
- **Enrichment sources** -- state business registries, county assessor records
- **Compliance expansion** -- additional state disclosure requirements
- **Performance** -- query optimization for large prospect datasets (10K+)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Report security issues via [SECURITY.md](SECURITY.md).

---

## Tech Stack

| Layer          | Technology                                             |
| -------------- | ------------------------------------------------------ |
| Frontend       | React 19, TypeScript 5.9, Vite, Radix UI, Tailwind CSS |
| Backend        | Express, Node.js, BullMQ, Zod                          |
| Database       | PostgreSQL 15, Redis 7                                 |
| Scraping       | Puppeteer (headless browser automation)                |
| Integrations   | Twilio, SendGrid, Plaid, ACH, AWS S3                   |
| Testing        | Vitest, Testing Library, Playwright                    |
| Infrastructure | Terraform (AWS), Docker Compose, Kubernetes            |
| CI/CD          | GitHub Actions                                         |
| Deployment     | Vercel (frontend), AWS (backend)                       |

---

## License

[MIT](LICENSE) -- [@4444J99](https://github.com/4444J99)
