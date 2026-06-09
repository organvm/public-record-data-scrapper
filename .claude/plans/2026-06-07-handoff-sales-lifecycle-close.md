# Agent Handoff: sales-lifecycle campaign — engineering complete, governance closed, owner-gated from here

**From:** Session `a6b317f0` (bg job, worktree `tech-debt-review-fixes`) | **Date:** 2026-06-07 | **Phase:** Complete (campaign Phases 1+3 shipped; hall-monitor close + IRF propagation executed)
**Reciprocal to:** handoff `~/.claude/plans/2026-06-05-handoff-g1-reconcile-residue-sweep.md` (its next-action #1 — file the archiver-ordering IRF row — was cleared by this session as IRF-SYS-253, corpvs PR #434).

## Current State (verified against remotes 2026-06-07)

- **Product repo `a-organvm/public-record-data-scrapper` — 4 open PRs, merge-order-sensitive:**
  - **#248** `worktree-tech-debt-review-fixes` @ `72af965` — 10 verified code-review findings (TS-error wave). MERGEABLE.
  - **#249** `campaign-sales-lifecycle-phase-1` — lifecycle integrity: claim/batch routes, 4 tabs mounted, fail-closed fabrication paths, engines exposed, 8 workers live, Stripe webhook + alerts persistence (migration 020), key-less public-API enrichment. MERGEABLE.
  - **#250** `campaign-sales-lifecycle-phase-3` @ `97ebb47` — agent system: communications/compliance/discovery/metrics APIs (migrations 021/022), real agentic executor (`simulateExecution` deleted), reply→deal automation with CTIA suppression, NY collector, lead-discovery channels, Prometheus, `docs/DEMO_RUNBOOK.md`. 28 adversarial-review findings fixed pre-PR. **`Closes #60` keyword added 2026-06-07** (was missing). MERGEABLE.
  - **#251** `chore/organvm-auto-sync-2026-06-07` @ `d515161` — organvm refresh regen (AGENTS/CLAUDE/GEMINI auto-blocks) + `.lh/` gitignore.
- **Corpvs `a-organvm/organvm-corpvs-testamentvm` — PR #434** (`irf/sales-lifecycle-2026-06-07`): DONE-587..589 counter claim + IRF filing (IRF-III-060..062, IRF-SYS-252..253, UPDATE paragraphs III-026/APP-003, 10-index propagation log).
- **Runtime-state `4444J99/claude-runtime-state` (private):** synced to `406ad3d` — memory updates + dangling-pointer repair. Only `scratch/2026-04-29-121000-opencode-bug.txt` remains untracked, **deliberately held** (contains a session URL; owner disposition pending).
- **Worktrees:** `tech-debt-review-fixes` clean/pushed; `epic-jackson`/`modest-morse` carry only ephemeral harness artifacts (their WIP preserved in PRs #246/#247). Main checkout on clean `main`; `.lh/` untracked until #251 merges.
- **Gates at #250 head:** server 1294/0 (70 files), web 1980 pass @ byte-identical 25-failure baseline, root tsc 0, build green.

## Completed Work

- [x] Campaign Phases 1+3 (PRs #248/#249/#250) — engineering boundary reached; everything further needs owner credentials/merges
- [x] Hall-monitor audit: add-only verified, no protected files touched, {local:remote}=1:1 restored across 4 repos
- [x] IRF propagation: DONE-587..589 claimed per CLAIM-BEFORE-USE; 5 vacuum rows + 2 UPDATE paragraphs filed (corpvs PR #434)
- [x] Self-catches fixed: CLAUDE.md backend counts (`97ebb47`), missing `Closes #60` on PR #250, dangling home-MEMORY.md pointer (`406ad3d`)
- [x] Cleared prior handoff's pending action (archiver-ordering row → IRF-SYS-253)
- [ ] Phase 2 (live-data activation) — owner-gated, see Next Actions
- [ ] Phase 4 remnants: Sentry (MCP-mintable), e-sign provider, Cloudflare epic #239

## Key Decisions

| Decision                                                                                | Rationale                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch-PR filing for corpvs IRF instead of direct main push                             | Permission classifier enforced the standing "no main push on public ORGANVM repos without per-session authorization"; repo precedent (PR #432) shows branch-PR is accepted |
| IRF edits made in a clean temp worktree off `origin/main`, not the main corpvs checkout | Main checkout carries sibling sessions' LIVE uncommitted work (`data/atoms/*`, 4 IRF lines) — `git add -A` there would commit other agents' in-flight state                |
| DONE-587..589 filed though PRs are unmerged                                             | Precedent (DONE-383 et al.): committed-and-pushed suffices; rows explicitly carry "PR OPEN, owner-gated merge" caveats                                                     |
| opencode capture relocated to private repo but NOT pushed                               | Contains a live session URL; classifier required owner disposition; public product repo categorically wrong destination                                                    |
| Auto-sync drift committed (PR #251), not restored                                       | IRF-OPS-092(a) disposition: preserve, don't restore; regen output is auto-block-only, no hand-written content                                                              |
| Stats block untouched in IRF                                                            | IRF-OPS-091: derive-don't-copy; regenerate via `organvm irf stats` after parser fixes                                                                                      |

## Critical Context

- **Env-file truth (IRF-III-061):** root `.env` values for TX/Auth0/AWS/JWT are `your-*` placeholders — it's an example file in disguise. `.env.local`/`.env.sandbox` provider keys are ALL empty. `STRIPE_*` absent from every env file. Greps that match "key is set" are lying to you.
- **MCP self-service (IRF-III-062):** Sentry (`create_project`/`create_dsn`), Stripe plugin, Cloudflare Dev Platform, Neon are AUTHENTICATED session connectors — several "Phase 2 blockers" are mintable on owner go-signal. 1Password vault exists; enumeration is permission-blocked — owner must name item titles.
- **Counter race:** DONE-587..589 claimed via PR #434, not on main. If a parallel session claims those IDs from main's counter before #434 merges, reclaim per protocol step 4.
- **Global git ignore `/server/`** (`~/.config/git/ignore:91`, IRF-SYS-252): silently blocks server/ paths in EVERY repo; this repo has `!/server/` negation on the campaign branches; use `git add -f` elsewhere.
- **Husky:** main checkout has no node_modules → pre-commit ENOENT (use `--no-verify` for docs-only there); worktree hooks work; eslint has NO underscore-arg exemption — idiom is `void x`.
- **Baselines:** web suite 25 pre-existing env-dependent failures (canonical run: `cd apps/web && npx vitest run`); `server/tsconfig.json` is NOT a gate (~87 pre-existing errors); real gates: root tsc, `vitest.config.server.ts` suite, `npm run build`.
- **Demo runbook:** `docs/DEMO_RUNBOOK.md` (PR #250) maps each credential to the demo beat it unlocks — sequencing tool for the Tony pricing conversation (IRF-APP-003).

## Next Actions

1. **Owner:** merge `#248 → #249 → #250 → #251`, then corpvs `#434`; apply migrations 020/021/022 on deploy.
2. **Owner:** disposition for `~/.claude/scratch/2026-04-29-121000-opencode-bug.txt` (commit-private / delete).
3. **Owner:** Phase 2 credentials per IRF-III-060 ladder (TX/CA/FL, SendGrid/Twilio/Plaid, `NY_UCC_DEBTOR_SEEDS`, `METRICS_TOKEN`, `INBOUND_PARSE_TOKEN`, Auth0 tenant, e-sign account) — or name 1Password item titles for agent retrieval.
4. **Agent (on go-signal):** provision Sentry DSN + Stripe keys + CF #239 resources + Neon demo DB via MCP (IRF-III-062); wire into env/deploy.
5. **Agent:** draft Tony/partner reply + pricing one-pager anchored on the demo runbook (authorized-pending per owner's stated intent).
6. **Agent (post-merge):** close the loop — verify GH#60 auto-closed, re-check omega criteria, record testament events, re-verify coverage-dashboard surface before the client call.

## Risks & Warnings

- Merge order is load-bearing: #249 stacks on #248's fixes; #250 stacks on #249's migrations/routes. Out-of-order merges produce conflicts or broken migrations.
- Corpvs main checkout: NEVER `git add -A` — sibling sessions keep live state there (re-diff `INST-INDEX-PROMPTORUM.md` immediately before staging; background indexer appends between diff and stage).
- The `.env` placeholder problem WILL recur for any agent auditing "is X configured" by key presence — check value shape, not key existence (IRF-III-061 is the fix vehicle).
- 16GB RAM machine: cap concurrent heavy processes (test suites, builds) — run serially.
