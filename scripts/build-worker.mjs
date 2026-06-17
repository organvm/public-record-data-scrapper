import { bundleBackend } from './build-backend.mjs'

// Bundle the BullMQ worker process into a single CommonJS file for production,
// giving the worker the same `node`-runtime parity as the API server (no `tsx`
// in production — avoids the init-time memory spike tracked in IRF-APP-003).
// Run via `npm run build:worker` (also part of `build:render` / `build:all`).
await bundleBackend({ entry: 'server/worker.ts', outfile: 'dist/worker.cjs' })
