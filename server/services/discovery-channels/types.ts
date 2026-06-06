/**
 * Lead-discovery channel contract (top-of-funnel, beyond UCC).
 *
 * A discovery channel is a pluggable adapter over a single PUBLIC, key-less
 * data source that surfaces businesses exhibiting a growth/financing signal
 * (new SEC registrants, building-permit pullers, recent SBA borrowers, ...).
 * The {@link LeadDiscoveryService} fans across every configured channel,
 * dedupes the union against existing prospects, and persists the NEW
 * candidates.
 *
 * Fail-closed discipline (constitutional): a channel that is unconfigured or
 * unreachable, or whose upstream payload no longer matches the documented
 * shape, throws a NAMED error — it NEVER returns invented or partial-but-
 * fabricated data. The service captures that error per-channel and continues
 * with the channels that did answer; if EVERY channel fails, nothing is
 * inserted.
 *
 * @module server/services/discovery-channels/types
 */

/**
 * The growth-signal taxonomy a discovery candidate can carry. This is the
 * SAME closed set enforced by the `growth_signals.type` CHECK constraint
 * (see database/schema.sql) so a candidate maps 1:1 onto a persisted
 * `growth_signals` row without translation.
 */
export type DiscoverySignalType = 'hiring' | 'permit' | 'contract' | 'expansion' | 'equipment'

/**
 * A single business surfaced by a channel. Channels return these; the service
 * dedupes and persists them. `raw` carries the upstream payload verbatim for
 * auditability — `prospects` has NO raw_data column, so the full payload is
 * stored on the companion `growth_signals.raw_data` (JSONB) row, with a concise
 * human-readable provenance note on `prospects.narrative`.
 */
export interface DiscoveryCandidate {
  /** Business legal/common name exactly as the source reports it. */
  company_name: string
  /** Two-letter USPS state code (uppercased). */
  state: string
  /**
   * Mapped prospects.industry enum value when the source provides enough to
   * classify; omitted when unknown (we do NOT guess — fail-closed).
   */
  industry?: string
  /** Which growth signal this candidate represents. */
  signal_type: DiscoverySignalType
  /** 0-100 strength of the signal (channel-defined heuristic). */
  signal_strength: number
  /** Stable channel name (matches DiscoveryChannel.name). */
  source: string
  /** The upstream record, verbatim, for audit + later re-scoring. */
  raw: Record<string, unknown>
}

/** Parameters a caller can pass through to every channel's discover(). */
export interface DiscoveryParams {
  /** Restrict discovery to a single state (two-letter code). */
  state?: string
  /** Soft cap on candidates a single channel should return. */
  limit?: number
}

/**
 * A pluggable discovery channel. Implementations wrap exactly one public,
 * key-less data source.
 */
export interface DiscoveryChannel {
  /** Stable, lowercase, hyphenated identifier (e.g. 'sec-edgar-registrants'). */
  readonly name: string

  /**
   * Whether this channel can run right now. Key-less channels are always
   * configured; a channel that needs an env value (none currently do) returns
   * false until that value is present. The service skips unconfigured channels
   * and reports them rather than calling discover().
   */
  isConfigured(): boolean

  /**
   * Query the upstream source and return candidate leads.
   *
   * @throws {DiscoveryChannelError} on unreachable upstream, non-2xx response,
   *   or a payload whose documented shape changed. NEVER returns fabricated
   *   data in lieu of throwing.
   */
  discover(params: DiscoveryParams): Promise<DiscoveryCandidate[]>
}

/**
 * Named error thrown by channels on any fail-closed condition. The service
 * records `${channel}: ${message}` in its per-channel error map and surfaces
 * it to the caller; it is never swallowed into invented data.
 */
export class DiscoveryChannelError extends Error {
  public readonly channel: string

  constructor(channel: string, message: string) {
    super(message)
    this.name = 'DiscoveryChannelError'
    this.channel = channel
  }
}
