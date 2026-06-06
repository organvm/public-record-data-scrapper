# Redesign 2027 — The Signal Command Deck

> **Status:** Active build (multi-week). Supersedes `DASHBOARD_REDESIGN.md` and `UI_CHANGES.md`
> as the canonical design direction.
> **Authored:** 2026-05-29 · **Owner:** redesign initiative on branch `claude/modest-morse-cd9309`

---

## 1. The reframe

This is **not a public-record scraper**. It is a **sales suite and prediction agency** for the
Merchant Cash Advance market. The scraper is one input. The product is the intelligence: which
businesses are about to need capital, why, how confident we are, and what the rep should do next.

The current interface fails because it presents a **living, reasoning system as a static
spreadsheet** — tabs of tables on a purple gradient, most of them empty because the data pipe is
severed (see §7). The redesign's thesis:

> **Make the intelligence visible.** The frontend is a window into an agentic core — agents you
> watch reason, predictions you watch form, a pipeline that breathes — not a CRUD shell on top of a
> database.

Two systems already in the workspace define the "from within" sources we merge:

- **The AI Council** (`apps/web/src/lib/agentic/`) — a 5-agent advisory council
  (DataAnalyzer → Optimizer → Security → UXEnhancer → Competitor) with a full reasoning/safety
  lifecycle (`CouncilReview`, `AgentAnalysis`, `Finding`, `Improvement`). Today the UI discards the
  richest 80% of it.
- **agentic-titan** (`/Users/4jp/Code/organvm/agentic-titan`) — a mature orchestration engine
  exposing a CORS-enabled FastAPI + WebSocket, a persona council (Scope/Logic/Mythos/Bridge/Meta/
  Pattern), live topology visualization, dialectic (thesis→antithesis→synthesis) verdicts, and
  "epistemic signature" radar charts. Its entire design philosophy is **live, streamed agent state**.

The merge: surface that agentic reasoning _as the product_.

---

## 2. Design language — "Signal Command Deck"

A precision instrument for a financial-intelligence operator. Dark-first, depth-rich, alive.

### 2.1 Principles

1. **Depth over decoration.** Elevation is communicated by luminosity and layering on a near-black
   void, not by gradients-for-gradients'-sake. Every surface sits at a defined z-elevation.
2. **The interface is alive.** Streaming data, agents that pulse while reasoning, numbers that tick,
   spring physics. Motion is _meaning_ (something happened), never ornament.
3. **Data is the hero.** Monospace tabular figures, dense-but-legible tables, charts that read at a
   glance. Chrome recedes; the numbers and the reasoning advance.
4. **Calm by default, loud on signal.** The canvas is quiet greys; color is reserved for _signal_ —
   a live agent, a hot lead, money, a risk. Color means something every time it appears.
5. **Confidence is a first-class citizen.** Every prediction shows its confidence and its reasoning.
   A prediction agency that hides its uncertainty is not trustworthy.

### 2.2 Palette (OKLCH, dark-first)

Three signal hues on a 12-step neutral "void" ramp. (Light theme is a derived inversion, Phase 2.)

| Role                              | Token                            | Meaning                                                                                                         |
| --------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Void** (bg ramp)                | `--void-0 … --void-11`           | Near-black → elevated surfaces. Cool, slightly blue-grey.                                                       |
| **Signal** (primary)              | mint-teal `oklch(0.78 0.15 175)` | "The system is alive / go." Echoes agentic-titan's ORGAN-IV green. Live agents, primary actions, active states. |
| **Intelligence** (accent)         | indigo `oklch(0.70 0.16 275)`    | AI reasoning, predictions, the Council. The "thinking" color.                                                   |
| **Opportunity** (gold)            | amber `oklch(0.80 0.14 75)`      | Money, hot leads, growth signals, revenue.                                                                      |
| Success / Warning / Danger / Info | semantic ramp                    | Health grades, statuses, alerts.                                                                                |

Health grades map to a continuous spectrum (A+ signal-green → D danger-red), never flat chips.

### 2.3 Typography

- **UI / display:** `Inter` (variable) — tight tracking on headings (`-0.02em`), generous line-height
  on body. Timeless, elevated, universally legible.
- **Data / numerics / agent logs:** `JetBrains Mono` — all tabular figures, scores, currency, IDs,
  and the agent/event streams. This is the "instrument / terminal" texture that ties the product to
  the agentic core.
- Scale: a fluid type ramp (clamp-based) so the deck holds from 13" laptop to wall display.

### 2.4 Surfaces & depth

Replace the six half-baked themes + animated purple gradient with **one deep, coherent system**:

- `surface/0` — the void (page).
- `surface/1` — panels (cards, the default container).
- `surface/2` — elevated (popovers, active cards, the command rail).
- `surface/overlay` — modals, sheets — with a real, restrained glass (blur + saturate + 1px inner
  light edge), tuned per elevation, not copy-pasted six times.
- Borders are hairline luminous (`oklch(... / 0.08–0.14)`), never hard lines.

### 2.5 Motion

`framer-motion` (already installed) + a small motion-token set:

- **Entrance:** staggered fade-rise, 24ms stagger, spring (`stiffness 260, damping 30`).
- **Live:** agent "thinking" pulse, value tick-up (count animation), streaming log auto-scroll,
  topology node breathing.
- **Interaction:** card hover lift (`y: -2, scale: 1.01`), press scale `0.98`.
- Honors `prefers-reduced-motion` — all ambient motion disables.

---

## 3. Information architecture

From "tabs of tables" → a **command center**. Primary navigation (left rail, collapsible):

| Surface               | Purpose                                                                                                                                                                                              | Replaces                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Command Deck**      | The agency's live state: pipeline value, today's predictions, active agents, top signals, alerts. The home you keep open.                                                                            | (new — was the implicit "prospects first" landing) |
| **Prospects**         | Lead discovery & triage. The prioritized whale list, filters, claim flow.                                                                                                                            | Prospects tab                                      |
| **Prediction Engine** | **Flagship.** Open a lead → watch the Council reason about MCA likelihood live: agent-by-agent findings, the dialectic (pursue vs. risk), the epistemic signature, the verdict + recommended action. | (new — the "prediction agency" experience)         |
| **Pipeline**          | The sales suite: deals across stages, outreach, contacts, communications.                                                                                                                            | Deals/Contacts (today buried)                      |
| **Portfolio**         | Monitor funded/claimed accounts; health trends; at-risk alerts.                                                                                                                                      | Portfolio tab                                      |
| **Intelligence**      | Competitive landscape: lender market share, white-space, stack analysis.                                                                                                                             | Intelligence tab                                   |
| **The Council**       | The agentic control room: live agent roster, council deliberation history, topology, safety/autonomy governance.                                                                                     | Agentic ("Agentic Forces") tab                     |
| **Coverage**          | State-by-state ingestion coverage & data freshness.                                                                                                                                                  | Coverage tab                                       |

A persistent **top bar** carries: global search (command palette, `⌘K`), data-freshness indicator,
ingestion/agent live status, and account.

---

## 4. The agentic merge (the differentiator)

Concrete surfaces that turn the invisible council into the product:

1. **Live Council Deliberation timeline** — persist the full `CouncilReview` (today discarded);
   render the 5 agents as a horizontal handoff pipeline, each node animating active→done, red on
   `analysis.error`. Surface the per-agent `findings[]` + `evidence` (the _reasoning_).
2. **Agent roster / "council members"** — bind to `Agent.name` + `capabilities[]`; each shows its
   latest contribution. Five invisible classes become the visible intelligent core.
3. **Prediction reasoning drill-down** — for a given lead, show _why_ the MCA-likelihood score is
   what it is: the findings, the weighted signals, the confidence.
4. **Dialectic verdict** — frame lead qualification as Thesis (pursue) vs. Antithesis
   (risk / TCPA / DNC / underwriting) → Synthesis (recommended action), with contradictions as a
   risk panel. Maps onto the existing Suppression/Underwriting services and (later) agentic-titan's
   `/api/analysis/dialectic/synthesize`.
5. **Safety / autonomy control center** — bind to `AgenticConfig`: master autonomy toggle,
   `safetyThreshold` slider, daily cap, the always-review category list, and a per-improvement
   "gate trace" explaining why an item is pending.
6. **(Phase 3) agentic-titan bridge** — optional: drive a live inquiry via its FastAPI/WS and stream
   each persona "thinking," culminating in the epistemic-signature radar. Topology viz as a hero.

**Reconnection work:** the council reads real prospect data but fakes execution; the _real_
execution agents (scrapers, enrichment via `EnrichmentOrchestratorAgent`) are orphaned from the UI.
The redesign rejoins them and replaces the hardcoded `performanceMetrics` with live telemetry.

---

## 5. Component system

Built on the existing ShadCN/Radix + Tailwind v4 + `framer-motion` foundation, re-skinned to the
token system and extended with composed primitives:

- **Tokens** (`apps/web/src/styles/tokens.css`) — the single source of truth (§2.2–2.5).
- **Primitives** — re-themed `Card`, `Button`, `Badge`, `Input`, `Table`, `Tabs`, `Dialog`, `Sheet`.
- **Composed** — `StatTile` (KPI w/ trend + sparkline), `AgentNode`, `CouncilTimeline`,
  `ConfidenceMeter`, `HealthGrade`, `SignalBadge`, `PredictionCard`, `StreamLog`, `TopologyCanvas`
  (d3/SVG), `EpistemicRadar` (recharts), `EmptyState`, `SkeletonDeck`, `CommandPalette`.
- Every data surface ships **loading (skeleton), empty (actionable), and error** states — the
  current "empty everywhere" look is eliminated by design.

---

## 6. Execution plan (phased, multi-week)

Each phase ends in a **verifiable, runnable** state (build green, dev server renders, screenshot).

### Phase 0 — Foundation (data flows + design tokens) ← in progress

- [ ] Install deps; add missing `papaparse`/`winston`; resolve `recharts@3`/`react-resizable-panels@4`
      API drift (issue #236 build blockers).
- [ ] **Fix the data flow** end-to-end so every surface shows data:
      Vite `/api` proxy · unwrap API responses (`{prospects}`→`prospects`) · fix the
      `/api/user-actions` `Promise.all` sink · pragmatic local/demo auth · robust mock/seed fallback
      that works in _all_ build modes.
- [ ] Backend: create the missing `data_ingestion_logs` table (or rename worker INSERTs) ·
      add a filings→prospects derivation step.
- [ ] Land the **token system** (`tokens.css`), fonts (Inter + JetBrains Mono), motion tokens.
      Collapse the 6-theme sprawl into the Signal dark theme (+ a derived light, Phase 2).

### Phase 1 — The Shell

- [ ] Command-center layout: collapsible left rail, top bar, `⌘K` command palette.
- [ ] Re-themed primitives + the composed component set (§5) with full loading/empty/error states.
- [ ] Ambient "alive" chrome: live status, data-freshness, motion system wired.

### Phase 2 — The Surfaces

- [ ] Command Deck (home) · Prospects · Pipeline · Portfolio · Intelligence · Coverage —
      each redesigned, populated, responsive. Derived light theme.

### Phase 3 — The Merge (agentic core, the flagship)

- [ ] Prediction Engine surface · Live Council Deliberation · Agent roster · Dialectic verdict ·
      Safety control center. Reconnect real execution agents + live telemetry.
- [ ] Optional agentic-titan FastAPI/WS bridge: streamed inquiry, epistemic radar, topology canvas.

### Phase 4 — Features & hardening

- [ ] Remaining roadmap features (outreach sequences, saved searches, exports, reports).
- [ ] Deploy hardening (issues #235, #230); finish issue #236; perf (virtualized tables, query
      caching); a11y pass (WCAG AA); E2E coverage of the new surfaces.
- [ ] Infra track (issue #239): release discipline + Cloudflare consolidation (parallel, lower-risk).

---

## 7. The data-flow root cause (reference)

The "data doesn't flow" complaint is four independent breaks on the live path, all fatal:

1. **No Vite dev proxy** — SPA calls `/api/*` on :5173, gets `index.html` back (`apps/web/vite.config.ts`).
2. **JWT gate with no token** — every data route 401s; the SPA has no auth flow
   (`server/index.ts:145`, `authMiddleware.ts:125`).
3. **Response-shape mismatch** — client expects bare arrays; server returns `{prospects,pagination}`
   etc. (`lib/api/prospects.ts:9` vs `server/routes/prospects.ts:95`).
4. **`/api/user-actions` 404 inside a shared `Promise.all`** — sinks the whole batch even when the
   other three succeed (`hooks/useDataFetching.ts:85`).

…and the mock fallback is dev-only + flag-gated, so production never falls back → empty everywhere.
Backend latent bug: ingestion writes to a nonexistent `data_ingestion_logs` table
(`server/queue/workers/ingestionWorker.ts:90`).

---

## 8. Open decisions / risks

- **Theme consolidation** ripples into `ThemeProvider` / `ThemeToggle` / `SettingsMenu` — handled in
  Phase 0/1; keep the build green throughout.
- **Auth for demo vs. prod** — Phase 0 uses a pragmatic local path (optional-auth or a dev token) so
  the deck is reviewable; real Auth0 `org_id` wiring (issue #235) lands in the infra track.
- **agentic-titan coupling** — kept optional and behind a flag; the in-repo Council is the primary
  agentic surface so the product stands alone.
