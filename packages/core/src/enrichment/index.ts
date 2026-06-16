/**
 * Shared enrichment data-source layer.
 *
 * Free public-data sources (SEC EDGAR, OSHA, USPTO, Census) and the key-gated
 * SAM.gov entity source, plus key-gated commercial adapters (D&B, Clearbit,
 * ZoomInfo). All commercial/keyed sources are fail-closed: with no credential
 * they return a named "not configured" error and the service skips them.
 * Consumed by both the web app (apps/web re-exports these) and the Express
 * server (EnrichmentService).
 */

export * from './rate-limiter'
export * from './base-source'
export * from './credentials'
export * from './free-tier'
export * from './commercial-tier'
