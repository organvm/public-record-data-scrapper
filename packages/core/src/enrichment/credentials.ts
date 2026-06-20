/**
 * Credential helpers for enrichment data sources (shared).
 *
 * Commercial enrichment sources (D&B, Clearbit, ZoomInfo) and the rate-limited
 * SAM.gov entity API are key-gated. These helpers let a source read its key from
 * the environment in a way that is safe in BOTH the Node server and the browser
 * bundle (where `process` may be undefined), and produce a consistent
 * fail-closed `DataSourceResponse` when a source is not configured.
 *
 * Framework-free on purpose — no Node-only imports — so the same source classes
 * run in apps/web and the Express server.
 */

import type { DataSourceResponse } from './base-source'

/**
 * Read an environment variable without assuming `process` exists.
 *
 * In the browser, `process` is typically undefined unless the bundler injects
 * it; we guard defensively and return an empty string so callers treat the
 * source as "not configured" rather than throwing at module-construction time.
 */
export function readEnv(name: string): string {
  try {
    if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
      return process.env[name] as string
    }
  } catch {
    // `process` not defined in this runtime — treat as unset.
  }
  return ''
}

/**
 * Build the standard fail-closed response a source returns when its required
 * credential is absent. Mirrors the `DataSourceResponse` error contract so the
 * EnrichmentService records a *named* reason and never fabricates data.
 */
export function notConfiguredResponse(source: string, reason: string): DataSourceResponse {
  return {
    success: false,
    error: reason,
    source,
    timestamp: new Date().toISOString(),
    responseTime: 0
  }
}
