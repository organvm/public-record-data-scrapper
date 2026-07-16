# Web App

This directory hosts the web client (Vite + React).

Common commands (from repo root):

- `npm run dev` (web dev server)
- `npm run build` (web build)
- `npm run test` (web unit tests)

## GitHub Pages public-data mode

GitHub Pages has no same-origin Express API. The Pages workflow therefore sets
`VITE_PUBLIC_DEMO_RECEIPT_URL=data/austin-building-permits.receipt.json` and renders a read-only
public-data surface instead of allowing the authenticated dashboard to send doomed `/api` requests.
The tracked receipt selects four non-contact fields from City of Austin dataset `3syk-w9eu`; the
deployment gate verifies the live metadata, JSON endpoint, and Pages-readable CORS before building.
Other deployments remain on the normal dashboard/API path unless they explicitly set this variable.

Focused verification from the repository root:

```bash
node --test scripts/verify-pages-public-demo.test.mjs
node scripts/verify-pages-public-demo.mjs apps/web/public/data/austin-building-permits.receipt.json
VITE_PUBLIC_DEMO_RECEIPT_URL=data/austin-building-permits.receipt.json npm --workspace apps/web run build -- --base=/public-record-data-scrapper/
npx --no-install playwright test --config playwright.pages-demo.config.ts
```
