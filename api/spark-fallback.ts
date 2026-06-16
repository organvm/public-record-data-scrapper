/**
 * Graceful fallback for `@github/spark` runtime endpoints (`/_spark/*`).
 *
 * Spark's KV / LLM / user endpoints are served by the Spark dev plugin during
 * local development only; they do not exist in a production deployment. The SPA
 * already degrades gracefully (its `use-safe-kv` hook falls back to
 * localStorage), but unhandled `/_spark/*` requests would otherwise return 404s
 * and add console noise. This stub returns benign, empty 200 responses so the
 * client's optional Spark calls resolve quietly.
 *
 * HONEST NOTE: this is a stub, not a Spark implementation. Real KV persistence
 * and LLM features are NOT provided by the production backend — they are a
 * development convenience. The product's actual data lives behind `/api/*`.
 */
import type { IncomingMessage, ServerResponse } from 'http'

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? ''
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Spark-Fallback', 'stub')

  // `/_spark/user` is read as a value; everything else is treated as an empty
  // key-value namespace. Always 200 so the SPA's optional calls don't error.
  const body = url.includes('/_spark/user') ? 'null' : '{}'
  res.statusCode = 200
  res.end(body)
}
