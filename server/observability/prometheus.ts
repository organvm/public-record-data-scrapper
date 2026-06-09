/**
 * Hand-rolled Prometheus text-exposition-format renderer.
 *
 * Deliberately dependency-free (no prom-client): the metric set here is small
 * and fixed, so a pure render function is cheaper than pulling in a registry.
 * The renderer is a pure function of its input so it can be unit-tested for
 * escaping and format correctness in isolation from the route/runtime.
 *
 * Format reference: Prometheus text exposition format, version 0.0.4
 * (Content-Type: text/plain; version=0.0.4; charset=utf-8).
 */

export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export type PrometheusMetricType = 'gauge' | 'counter'

export interface PrometheusSample {
  /** Label set for this sample. Values are escaped on render. */
  labels?: Record<string, string>
  value: number
}

export interface PrometheusMetric {
  /** Metric name, e.g. `process_uptime_seconds`. Must be a valid metric name. */
  name: string
  /** HELP text. Escaped (backslash + newline) on render. */
  help: string
  type: PrometheusMetricType
  samples: PrometheusSample[]
}

/**
 * Escape a HELP string per the text format: backslash and newline only.
 * (Label values use a different escape set — see escapeLabelValue.)
 */
function escapeHelp(help: string): string {
  return help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

/**
 * Escape a label value per the text format: backslash, double-quote, newline.
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

/**
 * Render a numeric value the way Prometheus expects:
 * - non-finite values become the literal tokens Prometheus accepts
 *   (`+Inf`, `-Inf`, `NaN`) so a bad upstream number never produces a
 *   syntactically invalid line.
 * - integers render without a trailing `.0`; floats render with full precision.
 */
function renderValue(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return '+Inf'
  if (value === Number.NEGATIVE_INFINITY) return '-Inf'
  return String(value)
}

function renderLabels(labels?: Record<string, string>): string {
  if (!labels) return ''
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''
  const rendered = entries.map(([key, val]) => `${key}="${escapeLabelValue(val)}"`).join(',')
  return `{${rendered}}`
}

/**
 * Render a list of metrics to the Prometheus text exposition format.
 *
 * Each metric emits a `# HELP` and `# TYPE` line followed by one line per
 * sample. A metric with zero samples emits only its HELP/TYPE header (this is
 * how the route signals "this queue exists conceptually but is unavailable" —
 * see the route's comment-line omission below; in practice the route omits the
 * whole metric rather than emitting an empty body, but the renderer tolerates
 * either). Output always ends with a trailing newline.
 */
export function renderPrometheus(metrics: PrometheusMetric[]): string {
  const lines: string[] = []

  for (const metric of metrics) {
    lines.push(`# HELP ${metric.name} ${escapeHelp(metric.help)}`)
    lines.push(`# TYPE ${metric.name} ${metric.type}`)
    for (const sample of metric.samples) {
      lines.push(`${metric.name}${renderLabels(sample.labels)} ${renderValue(sample.value)}`)
    }
  }

  // Text format requires a trailing newline.
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}
