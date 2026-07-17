# Samples

This directory contains a synthetic, redacted sample dataset for the MCA lead-scoring workflow.
It is intended as a sellable demo artifact: easy to load in a spreadsheet from CSV and rich enough
for UI/API demos from JSON.

## Files

- `scored-mca-leads-sample.csv` - flattened 25-row lead list for spreadsheet demos.
- `scored-mca-leads-sample.json` - the same 25 leads with nested health, scoring, and growth signal details.

## Redaction Boundary

Every row is synthetic or redacted. Company names, secured-party categories, signal text, and record IDs
are fabricated for demonstration. The files contain no contact-level PII, no credentials, and no real
public-record identifiers. Do not use these rows for underwriting, solicitation, or compliance decisions.

## CSV Schema

| Column | Description |
| --- | --- |
| `lead_id` | Stable sample identifier. |
| `company_name` | Synthetic or redacted business name. |
| `state` | Two-letter state code used by the scoring modifier. |
| `industry` | One of the platform industries: restaurant, retail, construction, healthcare, manufacturing, services, technology. |
| `status` | Demo workflow state such as new, unclaimed, contacted, qualified, claimed, or dead. |
| `synthetic` | Always `true` for this sample artifact. |
| `redaction_level` | Short description of the redaction boundary. |
| `priority_score` | Final 0-100 MCA lead score after factor weighting and modifiers. |
| `priority_grade` | Letter grade derived from `priority_score`. |
| `recommendation` | Routing bucket: `high_priority`, `moderate_priority`, `low_priority`, or `pass`. |
| `confidence` | 0-100 completeness/confidence estimate for the synthetic signals. |
| `intent_score` | UCC-driven demand signal score. |
| `health_score` | Synthetic business health score. |
| `position_score` | Estimated stack capacity score. |
| `health_grade` | Letter grade derived from `health_score`. |
| `sentiment_trend` | Synthetic health trend: improving, stable, or declining. |
| `review_count` | Synthetic count used as a health proxy. |
| `violation_count` | Synthetic count used as a health risk proxy. |
| `estimated_revenue_usd` | Synthetic annual revenue estimate. |
| `estimated_monthly_debt_service_usd` | Synthetic monthly debt-service estimate. |
| `first_seen_date` | Date the sample lead first entered the demo workflow. |
| `last_filing_date` | Most recent synthetic UCC activity date. |
| `days_since_last_filing` | Days between `last_filing_date` and the sample as-of date. |
| `total_ucc_count` | Synthetic count of related UCC filings. |
| `active_ucc_count` | Synthetic count of active UCC filings. |
| `terminated_ucc_count` | Synthetic count of terminated filings. |
| `lapsed_ucc_count` | Synthetic count of lapsed filings. |
| `known_mca_positions` | Synthetic count of MCA-style positions inferred from secured-party categories. |
| `top_secured_party_category` | Redacted secured-party type, not a lender name. |
| `latest_signal` | Latest synthetic growth signal type, or `none`. |
| `signal_count` | Number of nested JSON growth signals. |
| `funding_stack_summary` | Human-readable stack note for demos. |
| `narrative` | Demo lead explanation with redaction disclaimer. |
| `source_disclaimer` | Repeated row-level disclaimer. |

## JSON Shape

The JSON file includes top-level `metadata`, `scoring_model`, and `leads`. Each lead mirrors the CSV
fields and adds nested objects:

- `health` with grade, score, sentiment trend, review count, violation count, and last update date.
- `score_breakdown` with intent, health, position, modifiers, final score, grade, confidence, and recommendation.
- `growth_signals` with synthetic signal type, description, detected date, score, and confidence.

## Scoring

Each `priority_score` is a 0–100 composite of three proprietary sub-scores — **intent**,
**health**, and **position** — combined under a proprietary weighting and adjusted by
industry and state risk modifiers, then bucketed into an A–F grade and an outreach
recommendation.

- **Intent** captures UCC filing recency, filing volume, active/lapsed/terminated pattern, and recent trend.
- **Health** captures synthetic review/sentiment/violation proxies.
- **Position** captures active UCC count, known MCA positions, and estimated payment burden.

The exact sub-score weights, modifier tables, and grade/recommendation cutoffs are part of the
platform's calibrated scoring engine and are not published. The sample values above are produced
by that engine so the output *shape* is faithful; the calibration behind them is what the product
delivers.
