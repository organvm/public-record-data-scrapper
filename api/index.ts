/**
 * Vercel serverless entrypoint for the Express API.
 *
 * `vercel.json` rewrites every `/api/*` request to this function. We import the
 * already-built Express app (no port binding, no background workers — see
 * `getServerlessApp`) and hand the raw Node request/response to it.
 *
 * Path normalization: depending on Vercel's rewrite handling the incoming
 * `req.url` may arrive with or without the `/api` prefix. The Express app mounts
 * its routers under `/api/*`, so we ensure the prefix is present exactly once.
 *
 * Typed with Node's `http` types (what Vercel passes) to avoid a hard dependency
 * on `@vercel/node`; the Express application is callable with these directly.
 */
import type { IncomingMessage, ServerResponse } from 'http'
import { getServerlessApp } from '../server/index'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getServerlessApp()

  if (req.url && !req.url.startsWith('/api/') && req.url !== '/api') {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : `/${req.url}`)
  }

  // The Express application instance is itself a (req, res) request listener.
  ;(app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res)
}
