# Project Wrap Plan

Last updated: 2026-01-31

## Goal

Bring the repository to a stable, shippable state with clear data-tier routing (OSS base, paid secondary), reliable multi-state scraping, clean test/lint baselines, and a production-ready deployment path.

## Current Status Summary

- Tests/lint: green after recent fixes (unit + e2e).
- Tier routing: server routes `x-data-tier` to free/starter; tiered envs wired.
- Scrapers: FL/NY stable; TX requires SOSDirect client ID; CA blocked by portal anti-bot gate.
- Deployments: Docker build OK; K8s dry-run OK; Terraform + Vercel CLI not validated locally.

## Definition of Done (Launch-Ready)

- All state access terms reviewed and compliant for automated access.
- TX + CA access solved (credentials and/or allowed automation path).
- Full test suite green (unit + e2e + scrapers).
- Infrastructure applied in target env; monitoring + budgets configured.
- Demo and production checklists complete.

## AI Agent Team

- ai-agent:platform - monorepo structure, shared core, API contracts
- ai-agent:mobile - Expo app and mobile UX
- ai-agent:desktop - Tauri app and desktop UX
- ai-agent:infra - CI/CD, deployments, budgets, environments
- ai-agent:observability - monitoring, alerts, performance
- ai-agent:scrapers - selector stability, scraper reliability
- ai-agent:compliance - portal access, terms, legal review
- ai-agent:qa - test matrix and verification
- ai-agent:security - dependency and secret scanning
- ai-agent:release - checklists and store readiness

## TODO Tracker (Owners + Timelines)

### Phase 1 (T+0 to T+7 days) - Access + Scraper Stability

- [ ] TX SOSDirect access verified (client ID + password). Owner: ai-agent:compliance. ETA: 2026-02-02.
- [ ] CA portal access path approved (legal/allowed automation). Owner: ai-agent:compliance. ETA: 2026-02-05.
- [ ] CA/TX selectors stabilized + strict failures re-enabled. Owner: ai-agent:scrapers. ETA: 2026-02-07.
- [ ] All scraper failures emit DOM + screenshot artifacts by default. Owner: ai-agent:scrapers. ETA: 2026-02-03.

### Phase 2 (T+7 to T+14 days) - Infra + Observability

- [ ] Terraform + AWS CLI validated; baseline infra applied. Owner: ai-agent:infra. ETA: 2026-02-10.
- [ ] Vercel CLI deploy validation (or chosen hosting). Owner: ai-agent:infra. ETA: 2026-02-10.
- [ ] Monitoring + alerting for workers/queues/API latency. Owner: ai-agent:observability. ETA: 2026-02-14.
- [ ] Budget alerts for paid APIs + infra. Owner: ai-agent:infra. ETA: 2026-02-14.

### Phase 3 (T+14 to T+21 days) - Release Readiness

- [ ] Full test suite re-run (unit + e2e + scrapers). Owner: ai-agent:qa. ETA: 2026-02-17.
- [ ] Security checks (dependency + secret scan) signed off. Owner: ai-agent:security. ETA: 2026-02-18.
- [ ] Demo and production checklists completed. Owner: ai-agent:release. ETA: 2026-02-21.

## Cost Guardrails

- Infra budget: $600/month cap, alert at 80% and 95%.
- API cost per 1,000 enrichments (target ceilings):
  - Free/OSS: $0
  - Starter: <= $400
  - Professional: <= $3,000
  - Enterprise: <= $8,000
- Hard stop switches:
  - Enrichment tier downgrade to OSS when budget threshold exceeded.
  - Per-provider request caps (daily + monthly) and rate limit alerts.

## Cost vs Potential Income (per 1,000 enrichments)

Assumptions: API costs from `docs/API_INTEGRATIONS.md`. Revenue scenarios shown at $1, $3, and $5 per enrichment. Infra cost not included here; amortize separately based on volume.

| Tier         | API Cost / 1k | Revenue @ $1 | Margin @ $1 | Revenue @ $3 | Margin @ $3 | Revenue @ $5 | Margin @ $5 |
| ------------ | ------------- | ------------ | ----------- | ------------ | ----------- | ------------ | ----------- |
| Free/OSS     | $0            | $1,000       | $1,000      | $3,000       | $3,000      | $5,000       | $5,000      |
| Starter      | $370          | $1,000       | $630        | $3,000       | $2,630      | $5,000       | $4,630      |
| Professional | $2,870        | $1,000       | -$1,870     | $3,000       | $130        | $5,000       | $2,130      |
| Enterprise   | $7,870        | $1,000       | -$6,870     | $3,000       | -$4,870     | $5,000       | -$2,870     |

Note: At low prices, professional and enterprise tiers require higher ARPU or upsell to remain profitable.

## All-State Compliance and Coverage (Public Record Access)

Requirement: verify that automated access is permitted for each state portal and UCC filings. Mark each as Allowed / Restricted / TBD with links to terms.

| State          | Portal URL                                                                                          | Status     | Notes                                            |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------ |
| Alabama        | https://www.sos.alabama.gov/government-records/ucc-records                                          | TBD        | Terms not reviewed                               |
| Alaska         | http://dnr.alaska.gov/ssd/recoff/ucc                                                                | TBD        | Terms not reviewed                               |
| Arizona        | https://azsos.gov/business/uniform-commercial-code-ucc                                              | TBD        | Terms not reviewed                               |
| Arkansas       | https://www.ark.org/sos/ucc/index.php                                                               | TBD        | Terms not reviewed                               |
| California     | https://bizfileonline.sos.ca.gov/search/ucc                                                         | Restricted | Imperva/anti-bot gating; legal approval required |
| Colorado       | https://www.coloradosos.gov/ucc/                                                                    | TBD        | Terms not reviewed                               |
| Connecticut    | https://portal.ct.gov/SOTS/Business-Services/BSD                                                    | TBD        | Terms not reviewed                               |
| Delaware       | https://corp.delaware.gov/tag/ucc-filings/                                                          | TBD        | Terms not reviewed                               |
| Florida        | https://www.floridaucc.com/uccweb/SearchDisclaimer.aspx                                             | TBD        | Scraper tests passing; terms review pending      |
| Georgia        | https://search.gsccca.org/UCC_Search/                                                               | TBD        | Terms not reviewed                               |
| Hawaii         | https://bocdataext.hi.wcicloud.com/login.aspx?ReturnUrl=/                                           | TBD        | Terms not reviewed                               |
| Idaho          | https://sos.idaho.gov/uniform-commercial-code/                                                      | TBD        | Terms not reviewed                               |
| Illinois       | https://apps.ilsos.gov/uccsearch/                                                                   | TBD        | Terms not reviewed                               |
| Indiana        | https://inbiz.in.gov/business-filings/ucc                                                           | TBD        | Terms not reviewed                               |
| Iowa           | https://sos.iowa.gov/search/UCCsearch.html?ucc                                                      | TBD        | Terms not reviewed                               |
| Kansas         | https://sos.ks.gov/general-services/ucc-filing-information.html                                     | TBD        | Terms not reviewed                               |
| Kentucky       | https://www.sos.ky.gov/bus/UCC/Pages/Online-Services.aspx                                           | TBD        | Terms not reviewed                               |
| Louisiana      | https://www.sos.la.gov/BusinessServices/UniformCommercialCode/Pages/default.aspx                    | TBD        | Terms not reviewed                               |
| Maine          | https://www.maine.gov/sos/cec/ucc/index.html                                                        | TBD        | Terms not reviewed                               |
| Maryland       | https://egov.maryland.gov/SDAT/UCCFiling/UCCMainPage.aspx                                           | TBD        | Terms not reviewed                               |
| Massachusetts  | https://www.sec.state.ma.us/cor/corpweb/corucc/uccmain.htm                                          | TBD        | Terms not reviewed                               |
| Michigan       | https://www.michigan.gov/sos/industry-services/ucc                                                  | TBD        | Terms not reviewed                               |
| Minnesota      | https://mblsportal.sos.state.mn.us/Secured/SearchUCC                                                | TBD        | Terms not reviewed                               |
| Mississippi    | https://business.sos.ms.gov/star/portal/msbsd/portal.aspx                                           | TBD        | Terms not reviewed                               |
| Missouri       | https://www.sos.mo.gov/ucc                                                                          | TBD        | Terms not reviewed                               |
| Montana        | https://biz.sosmt.gov/                                                                              | TBD        | Terms not reviewed                               |
| Nebraska       | https://sos.nebraska.gov/business-services/uccefs-search-and-filing-center                          | TBD        | Terms not reviewed                               |
| Nevada         | https://www.nvsos.gov/sos/businesses/ucc                                                            | TBD        | Terms not reviewed                               |
| New Hampshire  | https://sos.nh.gov/corporation-ucc-securities/ucc/uniform-commercial-code-ucc/                      | TBD        | Terms not reviewed                               |
| New Jersey     | https://www.njportal.com/ucc/                                                                       | TBD        | Terms not reviewed                               |
| New Mexico     | https://www.sos.state.nm.us/commercial-services/ucc-filings/ucc-searches/                           | TBD        | Terms not reviewed                               |
| New York       | https://appext20.dos.ny.gov/pls/ucc_public/web_search.main_frame                                    | TBD        | Scraper tests passing; terms review pending      |
| North Carolina | https://www.sosnc.gov/divisions/uniform_commercial_code                                             | TBD        | Terms not reviewed                               |
| North Dakota   | https://sos.nd.gov/central-indexing-ucc                                                             | TBD        | Terms not reviewed                               |
| Ohio           | https://ucc.ohiosos.gov/dashboard                                                                   | TBD        | Terms not reviewed                               |
| Oklahoma       | https://www.okcc.online/                                                                            | TBD        | Terms not reviewed                               |
| Oregon         | https://secure.sos.state.or.us/ucc/home.action                                                      | TBD        | Terms not reviewed                               |
| Pennsylvania   | https://file.dos.pa.gov/                                                                            | TBD        | Terms not reviewed                               |
| Rhode Island   | https://www.sos.ri.gov/divisions/business-services/ucc                                              | TBD        | Terms not reviewed                               |
| South Carolina | https://ucconline.sc.gov/UCCFiling/                                                                 | TBD        | Terms not reviewed                               |
| South Dakota   | https://sdsos.gov/Business-Services/uniform-commercial-code/ucc-efs-information/default.aspx        | TBD        | Terms not reviewed                               |
| Tennessee      | https://tnbear.tn.gov/UCC/ecommerce/default.aspx                                                    | TBD        | Terms not reviewed                               |
| Texas          | https://www.sos.state.tx.us/ucc/                                                                    | Restricted | SOSDirect client ID required                     |
| Utah           | https://corporations.utah.gov/uniform-commercial-code/                                              | TBD        | Terms not reviewed                               |
| Vermont        | https://sos.vermont.gov/corporations/ucc-lien-services/                                             | TBD        | Terms not reviewed                               |
| Virginia       | https://cis.scc.virginia.gov/UCCOnlineSearch/UCCSearch                                              | TBD        | Terms not reviewed                               |
| Washington     | https://dol.wa.gov/professional-licenses/uniform-commercial-code-ucc/ucc-online-filing-and-searches | TBD        | Terms not reviewed                               |
| West Virginia  | https://apps.wv.gov/SOS/UCC/                                                                        | TBD        | Terms not reviewed                               |
| Wisconsin      | https://www.wdfi.org/ucc/                                                                           | TBD        | Terms not reviewed                               |
| Wyoming        | https://sos.wyo.gov/business/default.aspx                                                           | TBD        | Terms not reviewed                               |

## Deployment Validation Gap

- Terraform CLI missing locally; Vercel CLI missing locally.
- After tooling is installed: run `terraform init/plan/apply` and `vercel deploy --prod` (or chosen platform).

## Mobile + Desktop Refactor Roadmap (Proposed)

### Stack Decision (Proposed)

- Mobile: Expo (managed) + React Native + TypeScript.
- Desktop: Tauri (Rust) + Vite + React (reuse existing web UI where feasible).
- Shared: `packages/core` (API client, types, tier logic, validation) + `packages/ui` (shared components).
- Data: React Query for caching + request dedupe; Zod for runtime validation.

### CI/CD (Proposed)

- GitHub Actions:
  - `ci.yml`: lint + unit + server tests on PRs.
  - `e2e.yml`: Playwright on main/nightly.
  - `mobile.yml`: Expo EAS build (preview on PR, production on tag).
  - `desktop.yml`: Tauri build + signed artifacts on tag.
- Secrets: `EAS_TOKEN`, signing keys, API envs, and tiered provider secrets.
- Artifacts: upload build artifacts and Playwright reports to Actions.

### Task List (Owners + Dates)

#### Phase A (2026-02-03 to 2026-02-14) - Foundation

- [ ] Monorepo restructure: `apps/web`, `apps/mobile`, `apps/desktop`, `packages/core`, `packages/ui`. Owner: ai-agent:platform. ETA: 2026-02-05.
- [ ] Extract shared API client, tier routing, and domain types into `packages/core`. Owner: ai-agent:platform. ETA: 2026-02-08.
- [ ] Define OpenAPI schema + generate typed client. Owner: ai-agent:platform. ETA: 2026-02-10.
- [ ] Shared lint/test config (ESLint/Prettier/Vitest) across packages. Owner: ai-agent:platform. ETA: 2026-02-12.
- [ ] CI/CD workflows scaffolded for web + server. Owner: ai-agent:infra. ETA: 2026-02-14.

#### Phase B (2026-02-17 to 2026-03-06) - Mobile MVP

- [ ] Expo app scaffold + auth flows + settings. Owner: ai-agent:mobile. ETA: 2026-02-20.
- [ ] Dashboard + jobs list + detail views using shared core. Owner: ai-agent:mobile. ETA: 2026-02-27.
- [ ] Offline cache + retry policy (React Query + persistent storage). Owner: ai-agent:mobile. ETA: 2026-03-03.
- [ ] EAS build pipeline + preview builds on PR. Owner: ai-agent:infra. ETA: 2026-03-06.

#### Phase C (2026-02-17 to 2026-03-13) - Desktop MVP

- [ ] Tauri app scaffold with existing Vite UI. Owner: ai-agent:desktop. ETA: 2026-02-21.
- [ ] Desktop shell: menus, deep links, auto-update config. Owner: ai-agent:desktop. ETA: 2026-03-01.
- [ ] Tauri build pipeline + signed artifacts on tag. Owner: ai-agent:infra. ETA: 2026-03-13.

#### Phase D (2026-03-16 to 2026-03-27) - Release Readiness

- [ ] Cross-platform QA matrix (iOS/Android/macOS/Windows). Owner: ai-agent:qa. ETA: 2026-03-20.
- [ ] Performance + crash monitoring (Sentry or equivalent). Owner: ai-agent:observability. ETA: 2026-03-24.
- [ ] Store submission readiness (App Store + Play + desktop releases). Owner: ai-agent:release. ETA: 2026-03-27.
