function parseBooleanFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true'
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Parse the `trust proxy` setting from the environment.
 * Express accepts a boolean, a number (number of hops), or a string.
 * We support boolean-ish values and a positive integer hop count. Defaults to
 * `false` (do not trust proxy headers) — callers must opt in when running
 * behind a known reverse proxy (ALB/Nginx) so X-Forwarded-* headers can be
 * trusted for req.ip / req.secure.
 */
function parseTrustProxy(value: string | undefined): boolean | number {
  if (value === undefined || value === '') return false
  const lowered = value.toLowerCase()
  if (lowered === 'true' || lowered === '1') return true
  if (lowered === 'false' || lowered === '0') return false
  const asNumber = Number.parseInt(value, 10)
  if (Number.isFinite(asNumber) && asNumber >= 0) return asNumber
  // Unknown value — fail safe to not trusting the proxy.
  return false
}

/**
 * Parse a required-finite positive integer from an env var, rejecting NaN and
 * non-positive values by falling back to the provided default.
 */
function parsePositiveIntRadix10(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Parse Redis URL into components
function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname || 'localhost',
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined
    }
  } catch {
    return { host: 'localhost', port: 6379 }
  }
}

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
const parsedRedis = parseRedisUrl(redisUrl)

const isProduction = process.env.NODE_ENV === 'production'

// JWT_SECRET is required in ALL environments. No hardcoded dev fallback and no
// empty-string prod fallback — verifying with an empty/known secret would let
// an attacker forge tokens. We keep the raw value here (may be undefined) and
// enforce presence in validateConfig(), which throws before the server boots.
// Importing this module must not throw (tests import config directly), so the
// guard lives in validateConfig() rather than at module load.
const jwtSecret = process.env.JWT_SECRET || ''

// Parse CORS origins, filtering out empty entries so an empty CORS_ORIGIN env
// var (''.split(',') === ['']) does not silently whitelist the empty origin.
const corsOriginFromEnv = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0)

export const config = {
  server: {
    port: parsePositiveIntRadix10(process.env.PORT, 3000),
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || undefined
  },
  app: {
    // Whether Express should trust X-Forwarded-* headers. Default false in dev.
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    // Canonical public URL used to build absolute URLs for redirects / webhook
    // signature verification, avoiding reliance on the attacker-controlled Host
    // header. Falls back to undefined when not configured.
    publicUrl: process.env.PUBLIC_URL || process.env.APP_URL || undefined
  },
  database: {
    url:
      process.env.DATABASE_URL ||
      process.env.TEST_DATABASE_URL ||
      'postgresql://localhost:5432/ucc_intelligence',
    maxConnections: parsePositiveIntRadix10(process.env.DB_MAX_CONNECTIONS, 20),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  },
  cors: {
    origin:
      corsOriginFromEnv.length > 0
        ? corsOriginFromEnv
        : isProduction
          ? []
          : ['http://localhost:5173', 'http://localhost:5000'],
    credentials: true
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window
    // Fail CLOSED by default: if the rate-limit backend (Redis) errors, deny
    // the request rather than allow unbounded traffic. Operators can opt into
    // fail-open with RATE_LIMIT_FAIL_OPEN=true if availability is preferred.
    failOpen: parseBooleanFlag(process.env.RATE_LIMIT_FAIL_OPEN)
  },
  jwt: {
    secret: jwtSecret,
    issuer: process.env.JWT_ISSUER || undefined,
    audience: process.env.JWT_AUDIENCE || undefined,
    expiresIn: '1h',
    refreshExpiresIn: '7d',
    // Name of the custom claim carrying the organization id. Auth0 namespaces
    // custom claims (e.g. https://<app>/org_id); the resolver also accepts any
    // claim key ending in /org_id or /orgId. Default 'org_id'.
    orgClaim: process.env.JWT_ORG_CLAIM || 'org_id',
    // Name of the optional custom claim carrying the subscription/plan tier.
    // Namespaced variants ending in /tier or /plan are also accepted. When
    // present it is authoritative and avoids a DB lookup. Default 'tier'.
    tierClaim: process.env.JWT_TIER_CLAIM || 'tier'
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },
  auth0: {
    domain: process.env.AUTH0_DOMAIN || '',
    clientId: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
    audience: process.env.AUTH0_AUDIENCE || ''
  },
  redis: {
    url: redisUrl,
    host: parsedRedis.host,
    port: parsedRedis.port,
    password: parsedRedis.password,
    maxRetriesPerRequest: 3
  },
  telemetry: {
    skipHydration: parseBooleanFlag(process.env.INGESTION_TELEMETRY_SKIP_HYDRATION),
    hydrateHistoryLimit: parsePositiveInt(process.env.INGESTION_TELEMETRY_HISTORY_LIMIT, 50)
  }
}

/**
 * Validates that required configuration is present for production.
 * Call this at server startup.
 * @throws Error if required config is missing in production
 */
export function validateConfig(): void {
  const errors: string[] = []

  // JWT_SECRET is required in ALL environments — never verify with an empty
  // or fallback secret.
  if (!config.jwt.secret) {
    errors.push('JWT_SECRET is required (set it in every environment)')
  }

  // PORT / DB_MAX_CONNECTIONS must parse to finite positive numbers. They were
  // parsed with radix 10 above and fall back to defaults on NaN; surface an
  // explicit error if the operator provided a non-numeric/invalid value.
  if (process.env.PORT !== undefined && process.env.PORT !== '') {
    const port = Number.parseInt(process.env.PORT, 10)
    if (!Number.isFinite(port) || port <= 0) {
      errors.push(`PORT must be a finite positive integer (got "${process.env.PORT}")`)
    }
  }
  if (process.env.DB_MAX_CONNECTIONS !== undefined && process.env.DB_MAX_CONNECTIONS !== '') {
    const maxConn = Number.parseInt(process.env.DB_MAX_CONNECTIONS, 10)
    if (!Number.isFinite(maxConn) || maxConn <= 0) {
      errors.push(
        `DB_MAX_CONNECTIONS must be a finite positive integer (got "${process.env.DB_MAX_CONNECTIONS}")`
      )
    }
  }

  if (isProduction) {
    if (!process.env.DATABASE_URL) {
      errors.push('DATABASE_URL is required in production')
    }
    if (config.cors.origin.length === 0) {
      errors.push('CORS_ORIGIN is required in production')
    }
    // CORS with credentials must never allow the wildcard or an empty origin.
    if (config.cors.credentials && Array.isArray(config.cors.origin)) {
      if (config.cors.origin.some((o) => o === '*' || o === '')) {
        errors.push("CORS_ORIGIN cannot include '*' or an empty origin when credentials are enabled")
      }
    }

    // Webhook integrations are configured to FAIL CLOSED when their secret is
    // missing. To avoid a production boot where every webhook is silently
    // rejected, require the secrets to be present in production.
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      errors.push('STRIPE_WEBHOOK_SECRET is required in production')
    }
    if (!process.env.TWILIO_AUTH_TOKEN) {
      errors.push('TWILIO_AUTH_TOKEN is required in production')
    }
    if (!process.env.PLAID_WEBHOOK_SECRET) {
      errors.push('PLAID_WEBHOOK_SECRET is required in production')
    }
    if (!process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY) {
      errors.push('SENDGRID_WEBHOOK_VERIFICATION_KEY is required in production')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n  - ${errors.join('\n  - ')}`)
  }
}
