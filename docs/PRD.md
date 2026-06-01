# UCC-MCA Intelligence Platform

A comprehensive merchant cash advance intelligence platform that transforms UCC filing data into actionable business opportunities through automated scraping, real-time health monitoring, growth signal detection, and ML-powered lead qualification.

This is a sophisticated B2B SaaS platform managing multiple data pipelines (UCC scraping, growth signals, health scores, competitor intelligence), ML model outputs, portfolio mo

## Essential Features

### 1. Prospect Dashboard

**Complexity Level**: Complex Application (advanced functionality, accounts)
This is a sophisticated B2B SaaS platform managing multiple data pipelines (UCC scraping, growth signals, health scores, competitor intelligence), ML model outputs, portfolio monitoring, and lead re-qualification workflows. It requires state management, real-time updates, and role-based access.

## Essential Features

### 1. Prospect Dashboard

- **Functionality**: Displays prioritized list of UCC default prospects with scores, growth signals, and health grades
- **Purpose**: Central hub for sales teams to identify and claim high-value "whale" opportunities
- **Trigger**: User navigates to main dashboard after login
- **Functionality**: Aggregates UCC filings by secured party to reveal lender market share, deal sizes, and industry focus
- **Trigger**: User accesses intelligence dashboard

### 5. Lead Re-qualification

- **Purpose**: Maximize ROI on past prospecting efforts by recycling leads when conditions improve
- **Progression**: Import leads → Scrape new signals → ML scoring → Net opportu

- **CAPTCHA blocks**: Log occurrence and trigger manual review queue; implement rate-limiting adjustments

- **API rate limits**: Implemen

- \*\*Foreground/Background Pair
- **Functionality**: Aggregates UCC filings by secured party to reveal lender market share, deal sizes, and industry focus
- **Purpose**: Competitive intelligence and market opportunity identification
- **Trigger**: User accesses intelligence dashboard
- **Progression**: View top lenders → Filter by industry/state → Analyze deal volume trends → Compare market share → Identify white-space opportunities
- **Success criteria**: Visualize top 20 competitors across 5 industries with monthly trend analysis

### 5. Lead Re-qualification Engine

- **Functionality**: Resurrects "dead" leads by detecting new growth/risk signals and recomputing opportunity scores
- **Purpose**: Maximize ROI on past prospecting efforts by recycling leads when conditions improve
- **Trigger**: User uploads dead lead list or system runs monthly batch job
- **Progression**: Import leads → Scrape new signals → ML scoring → Net opportunity calculation → Output revived leads with narratives
- **Success criteria**: Revive 10-15% of dead leads with actionable new intelligence; conversion rate 2x higher than cold leads

## Edge Case Handling

- **State portal outages**: Queue failed scrapes for retry with exponential backoff; alert admin after 3 failures
- **CAPTCHA blocks**: Log occurrence and trigger manual review queue; implement rate-limiting adjustments
- **Entity name variations**: Fuzzy-match algorithm clusters variations (ABC LLC, A.B.C. LLC); manual review for ambiguous cases
- **Missing data fields**: Display "N/A" gracefully; prioritize prospects with complete data; flag incomplete records
- **Stale health scores**: Show last-updated timestamp; auto-refresh if >7 days old; display warning for 30+ day staleness
- **API rate limits**: Implement adaptive throttling; pause scraping and resume after cooldown; distribute load across time windows
- **Conflicting signals**: ML ensemble weighs contradictory indicators; display confidence intervals; allow analyst override

## Design Direction

The design should evoke **trust, precision, and sophistication** – resembling Bloomberg Terminal's data density with Apple's aesthetic refinement combined with modern glassmorphic and acrylic translucent UI elements inspired by Windows 11 Mica and macOS translucency effects. It's a serious financial tool requiring **minimal, high-contrast UI** with depth through transparency that prioritizes information density while maintaining scanability through typographic hierarchy and strategic use of color to signal risk/opportunity states. **Mobile-first responsive design ensures full functionality on all device sizes.**

## Color Selection

**Triadic scheme with financial-intelligence theming**: Deep navy primary (trust, stability), warm amber accent (opportunity, attention), cool cyan secondary (data, analytics), with semantic overlays for health grades.

- **Primary Color**: Deep Navy Blue `oklch(0.25 0.06 250)` – Communicates authority, financial stability, and professional trust
- **Secondary Colors**: Cool Cyan `oklch(0.65 0.14 210)` for data visualization and analytics sections; Charcoal `oklch(0.30 0.01 270)` for supporting UI elements
- **Accent Color**: Warm Amber `oklch(0.70 0.15 60)` – Highlights opportunities, growth signals, and primary CTAs demanding attention
- **Foreground/Background Pairings**:
  - Background (Off-White `oklch(0.98 0.01 90)`): Foreground Navy `oklch(0.20 0.05 250)` – Ratio 13.2:1 ✓

  - Primary (Navy `oklch(0.25 0.06 250)`): Primary-Foreground White `oklch(1 0 0)` – Ratio 12.8:1 ✓
  - Secondary (Cyan `oklch(0.65 0.14 210)`): Secondary-Foreground Navy `oklch(0.20 0.05 250)` – Ratio 6.9:1 ✓
  - Accent (Amber `oklch(0.70 0.15 60)`): Accent-Foreground Navy `oklch(0.20 0.05 250)` – Ratio 7.2:1 ✓
  - Muted (Light Gray `oklch(0.92 0.01 90)`): Muted-Foreground Gray `oklch(0.50 0.02 270)` – Ratio 5.1:1 ✓

Typography should balance **data density with readability**, using a geometric sans-serif for UI (clarity, modernity) and tabular figures for numerical data (alignment, scanability). IBM Plex Sans provides the technical credibility required for financial software.

- **Typographic Hierarchy**:
  - H1 (Section Headers): IBM Plex Sans SemiBold / 32px / -0.02em letter-spacing / 1.2 line-height
  - H2 (Card Titles): IBM Plex Sans Medium / 20px / -0.01em letter-spacing / 1.3 line-height
  - H3 (Data Labels): IBM Plex Sans Medium / 14px / 0em letter-spacing / 1.4 line-height

  - Small (Metadata): IBM Plex Sans Regular / 13px / 0em letter-spacing / 1.4 line-height

Animations should be **subtle and purposeful**, reinforcing state changes and data updates without distracting from analysis. Think "financial terminal" – quick, precise, professional.

- **Purposeful Meaning**: Micro-animations communicate data freshness (pulse on new signals), risk state transitions (color shifts for health grade changes), and loading states (skeleton screens for data fetching)
- **Hierarchy of Movement**: Critical alerts (health score drops) use 300ms attention-drawing slide-ins; routine updates (prospect list refresh) use 150ms fades; hover states are instant (<100ms)

## Component Selection

- **Components**:
  - `Card` with `Badge` overlays for prospect tiles showing scores and health grades
  - `Table` with sortable columns for main prospect list; `DataTable` with pagination for large datasets

  - `Dialog` for detailed prospect profiles and lead claiming workflows

  - `Progress` rings for health scores and ML confidence indicators

  - `Select` and `Checkbox` groups for multi-dimensional filtering (state, industry, score range)

  - Custom `ProspectCard` component combining Card + Avatar + Badge + Button with density optimizations

  - `SignalTimeline` component showing chronological growth indicators with icons

- **States**:
  - Buttons: Default (navy), Hover (lighter navy + shadow), Active (pressed inset), Disabled (30% opacity)
  - Inputs: Default (gray border), Focus (navy ring + cyan glow), Error (red border + shake), Success (green check icon)
  - Cards: Default (white bg), Hover (subtle shadow lift), Selected (navy border), Claimed (muted bg + checkmark)
- **Icon Selection**:
  - `TrendUp` / `TrendDown` for growth signals and health trends
  - `Warning` / `WarningCircle` for DEWS alerts
  - `ChartBar` / `ChartLineUp` for analytics and intelligence
  - `ArrowClockwise` for re-qualification
  - `FunnelSimple` for filtering
  - `Export` for CRM export actions
  - `MagnifyingGlass` for search

- **Spacing**:
  - Card padding: `p-6` (24px) for comfortable data breathing room
  - Grid gaps: `gap-4` (16px) for prospect tiles; `gap-6` (24px) between major sections

  - Section margins: `mb-8` (32px) between dashboard zones

- **Mobile**:
  - Mobile-first responsive design with touch-optimized controls (minimum 44px touch targets)
  - Below 768px: Single-column card layout; tabs show icons with abbreviated text; controls stack vertically
  - Below 640px: Stats grid becomes 2 columns; prospect cards go full width; filters move to slide-out sheet
  - Touch targets expand to 44px minimum; hover states become tap highlights with visual feedback
  - Charts adapt to vertical orientation maintaining readability on small screens
  - Translucent glass effects with backdrop blur work seamlessly on mobile with performance optimization
