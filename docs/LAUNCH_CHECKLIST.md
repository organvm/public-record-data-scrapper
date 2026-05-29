# Launch Checklist

Last updated: 2026-01-31

## Demo Rollout (Mock + Limited Live)

- [ ] Set `VITE_USE_MOCK_DATA=true` in demo env.
- [ ] Confirm Settings menu tier switch updates `x-data-tier` header.
- [ ] Verify demo routes load: `/`, `/analytics`, `/prospects`.
- [ ] Run smoke tests:
  - [ ] `npm run test:e2e`
  - [ ] `npx vitest src/components/__tests__/AnalyticsDashboard.test.tsx`
- [ ] Disable paid API keys in demo env.
- [ ] Validate UI accessibility (headings, roles, tab labels).
- [ ] Confirm demo data caps (OSS tier) are enforced in API responses.
- [ ] Publish demo URL and status page.

## Production Rollout (Live + Tiered APIs)

- [ ] All-state compliance matrix completed and approved.
- [ ] TX SOSDirect credentials validated; CA portal access path approved.
- [ ] Full test suite green (unit + e2e + scrapers).
- [ ] Infrastructure applied (Postgres, Redis, S3, logging, alerts).
- [ ] Workers deployed separately from API.
- [ ] Budget alerts enabled for infra + paid APIs.
- [ ] Tiered API envs set (FREE*TIER*_ and STARTER*TIER*_).
- [ ] UCC ingestion provider per tier verified in `/api/jobs/:jobId`.
- [ ] Backup + restore runbook validated.
- [ ] Incident response checklist ready (on-call, rollback, status updates).
- [ ] Launch comms prepared (user docs, API docs, release notes).

## Cutover Validation

- [ ] Run production smoke tests against live stack.
- [ ] Verify queue throughput and retry behavior.
- [ ] Validate sample enrichments by tier (free vs starter).
- [ ] Confirm monitoring dashboards and alert noise levels.
