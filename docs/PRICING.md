# MCA Lead Data — Pricing & Product One-Pager

**UCC-MCA Intelligence Platform** turns daily Uniform Commercial Code (UCC) filings into
ranked, contact-ready Merchant Cash Advance leads. Every business that takes on
secured financing files a UCC-1 — we capture those filings the day they post, match
them to live businesses, enrich them with contact data, and score MCA likelihood so
your team works the hottest opportunities first.

> Public-record sourced. No reselling of third-party lists. Suppression against
> TCPA/DNC built in before any record ships.

---

## What You Get

Each lead is delivered as a structured record (CSV, JSON, or pushed to your CRM).
Fields below are standard on every record unless noted.

### Filing & business identity
| Field | Description |
| --- | --- |
| `debtor_name` | Business name on the UCC filing (normalized + raw) |
| `secured_party` | Existing lender / funder on file |
| `filing_date` | Date the UCC-1 was recorded |
| `state` | Filing jurisdiction (CA, TX, FL, NY today — more on request) |
| `status` | Filing status (active / lapsed / terminated) |
| `industry` | Classified vertical (restaurant, retail, construction, healthcare, manufacturing, services, technology) |
| `estimated_revenue` | Modeled annual revenue band |

### Scoring & intelligence
| Field | Description |
| --- | --- |
| `priority_score` | 0–100 MCA-likelihood / opportunity score |
| `default_date` / `time_since_default` | Default event and days elapsed (recency drives conversion) |
| `growth_signals` | Detected expansion / distress signals attached to the business |
| `narrative` | Plain-English "why this lead, why now" summary for reps |
| `enrichment_confidence` | 0.00–1.00 confidence on the appended contact/firmographic data |

### Contact enrichment *(Enriched / Verified tiers)*
| Field | Description |
| --- | --- |
| Owner / principal name | Decision-maker where available |
| Phone | Business phone, suppression-checked against DNC |
| Email | Business email where available |
| Website / address | Firmographic completion |

---

## Delivery & Cadence

- **Fresh filings ingested daily** (overnight batch) across covered states.
- **Enrichment refreshed every 6 hours**; health/opportunity scores recomputed on a
  12-hour cycle so a lead's score reflects current conditions, not its capture date.
- **Delivery formats:** CSV / JSON export, S3 drop, or direct push to your CRM via
  webhook/API.
- **Cadence options:** daily drip, weekly batch, or real-time API pull.
- **Coverage today:** California, Texas, Florida, New York. Additional states
  onboarded on request (typ. 2–4 weeks per state).

---

## Volume Tiers & Example Pricing

Pricing is per qualified lead and steps down with volume. "Qualified" = a deduped,
suppression-cleared record meeting your filters (state, industry, score floor,
recency). Illustrative rate card — final pricing set on the order form.

| Tier | Monthly volume | Standard (filing + score) | Enriched (+ contact data) | Verified (+ phone/email QA) |
| --- | --- | --- | --- | --- |
| **Starter** | up to 500 leads | $4.00 / lead | $7.00 / lead | $11.00 / lead |
| **Growth** | 500–2,500 | $3.00 / lead | $5.50 / lead | $9.00 / lead |
| **Scale** | 2,500–10,000 | $2.25 / lead | $4.25 / lead | $7.00 / lead |
| **Enterprise** | 10,000+ | Custom | Custom | Custom |

**Example orders**

- *Starter — Enriched:* 500 FL restaurant leads, score ≥ 70, weekly batch →
  **$3,500 / mo**.
- *Growth — Verified:* 2,000 multi-state leads (CA + TX), score ≥ 60, daily drip with
  phone/email QA → **~$18,000 / mo**.
- *Scale — Standard:* 8,000 leads/mo via API, all covered states → **$18,000 / mo**.

**Add-ons**

- Real-time API access & webhooks — included on Growth and above; +$500/mo on Starter.
- Custom state onboarding — quoted per state.
- Dedupe against your existing book / exclusivity windows — available, quoted.
- One-time historical backfill (past filings) — priced per record, volume-discounted.

> **Pilot:** First-time buyers can start with a one-time 100-lead sample at the
> Starter rate to validate fit before committing to a monthly volume.

---

## Why It Converts

- **Recency-driven:** leads scored on days-since-filing, the strongest MCA timing signal.
- **Pre-suppressed:** TCPA/DNC checks run before delivery — you call clean lists.
- **Ranked, not raw:** a 0–100 score and a narrative per lead, so reps work top-down.
- **Public-record provenance:** sourced from state filings, defensibly compliant.

---

## Order / Contact

1. **Tell us your filters** — states, industries, monthly volume, score floor, format.
2. **We send a sample + order form** — 100-lead pilot or a tailored quote within 1 business day.
3. **Go live** — first delivery within 2–3 business days of a signed order.

**Contact:** padavano.anthony@gmail.com — subject line `MCA Lead Order`.
Include your target states, monthly volume, and preferred delivery format and we'll
return a quote and sample.

---

*Rates on this page are illustrative and subject to a signed order form. Volume,
exclusivity, and enrichment depth affect final pricing. All data is sourced from
public UCC records and delivered subject to applicable TCPA/DNC suppression.*
