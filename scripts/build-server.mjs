import { bundleBackend } from './build-backend.mjs'

// Bundle the Express API server into a single CommonJS file for production.
// Run via `npm run build:server` (also part of `build:render` / `build:all`).
await bundleBackend({ entry: 'server/index.ts', outfile: 'dist/server.cjs' })
