import { Request, Response, NextFunction } from 'express'
import { Redis } from 'ioredis'
import { config } from '../config'

// Redis client for rate limiting (separate from queue Redis)
let redisClient: Redis | null = null

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      }
    })

    redisClient.on('error', (error) => {
      console.error('[RateLimiter] Redis error:', error.message)
    })
  }
  return redisClient
}

/**
 * Extract client IP address.
 *
 * Relies on Express `req.ip`, which is derived from the socket address and,
 * when `app.set('trust proxy', ...)` is configured, the left-most untrusted
 * address in X-Forwarded-For. We do NOT parse X-Forwarded-For / X-Real-IP
 * ourselves: blindly trusting those attacker-controlled headers lets a client
 * spoof its identity and evade (or poison) rate limiting. Trust-proxy is
 * configured centrally in server/index.ts.
 */
function getClientIp(req: Request): string {
  return req.ip || 'unknown'
}

/**
 * Redis-based sliding window rate limiter
 *
 * Uses sorted sets for accurate sliding window tracking.
 * This works correctly across multiple server instances.
 */
export const rateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const identifier = getClientIp(req)
  const key = `ratelimit:${identifier}`
  const now = Date.now()
  const windowStart = now - config.rateLimit.windowMs

  try {
    const redis = getRedisClient()

    // Use Redis multi/exec for atomicity
    const pipeline = redis.multi()

    // Remove expired entries
    pipeline.zremrangebyscore(key, 0, windowStart)

    // Count requests in current window
    pipeline.zcard(key)

    // Add current request
    pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`)

    // Set expiration on the key
    pipeline.expire(key, Math.ceil(config.rateLimit.windowMs / 1000))

    const results = await pipeline.exec()

    if (!results) {
      // Redis transaction failed. Behavior is governed by config.rateLimit.failOpen
      // which defaults to FAIL CLOSED for safety.
      return handleLimiterBackendError(
        res,
        next,
        new Error('Redis transaction returned no results')
      )
    }

    // zcard result is at index 1 (after zremrangebyscore)
    const count = (results[1]?.[1] as number) || 0

    // Check if over limit
    if (count >= config.rateLimit.max) {
      // Get the oldest timestamp to calculate retry-after
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES')
      const oldestTimestamp = oldest.length >= 2 ? parseInt(oldest[1], 10) : now
      const retryAfter = Math.ceil((oldestTimestamp + config.rateLimit.windowMs - now) / 1000)

      res.set('Retry-After', Math.max(1, retryAfter).toString())
      res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
      res.set('X-RateLimit-Remaining', '0')
      res.set(
        'X-RateLimit-Reset',
        new Date(oldestTimestamp + config.rateLimit.windowMs).toISOString()
      )

      res.status(429).json({
        error: {
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429,
          retryAfter: Math.max(1, retryAfter)
        }
      })
      return
    }

    // Add rate limit headers
    res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
    res.set('X-RateLimit-Remaining', Math.max(0, config.rateLimit.max - count - 1).toString())
    res.set('X-RateLimit-Reset', new Date(now + config.rateLimit.windowMs).toISOString())

    next()
  } catch (error) {
    // Redis backend error. Default behavior is FAIL CLOSED (deny with 503).
    // Operators may opt into fail-open via RATE_LIMIT_FAIL_OPEN=true.
    return handleLimiterBackendError(res, next, error)
  }
}

/**
 * Handle a rate-limiter backend (Redis) error.
 *
 * Default: FAIL CLOSED — respond 503 so a Redis outage cannot be exploited to
 * bypass rate limits (e.g. credential stuffing / scraping floods). Operators
 * who prefer availability over this protection can set RATE_LIMIT_FAIL_OPEN=true
 * (config.rateLimit.failOpen), in which case we allow the request through.
 * Either way we log loudly.
 */
function handleLimiterBackendError(res: Response, next: NextFunction, error: unknown): void {
  if (config.rateLimit.failOpen) {
    console.error(
      '[RateLimiter] Backend error — failing OPEN (RATE_LIMIT_FAIL_OPEN=true), allowing request:',
      error
    )
    return next()
  }

  console.error('[RateLimiter] Backend error — failing CLOSED, denying request:', error)
  res.set('Retry-After', '5')
  res.status(503).json({
    error: {
      message: 'Rate limiting temporarily unavailable. Please retry shortly.',
      code: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
      statusCode: 503,
      retryAfter: 5
    }
  })
}

/**
 * In-memory fallback rate limiter for development/testing
 * when Redis is not available
 */
interface InMemoryStore {
  [key: string]: {
    count: number
    resetTime: number
  }
}

const inMemoryStore: InMemoryStore = {}

// Cleanup timer for the in-memory store. Lazily started only when the in-memory
// limiter is actually used so we don't leave a dangling interval (and keep the
// event loop alive) in deployments that use the Redis limiter exclusively.
let inMemoryCleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureInMemoryCleanupTimer(): void {
  if (inMemoryCleanupTimer) return
  inMemoryCleanupTimer = setInterval(
    () => {
      const now = Date.now()
      Object.keys(inMemoryStore).forEach((key) => {
        if (now > inMemoryStore[key].resetTime) {
          delete inMemoryStore[key]
        }
      })
    },
    60 * 60 * 1000
  )
  // Do not keep the process alive solely for this cleanup timer.
  inMemoryCleanupTimer.unref?.()
}

export const inMemoryRateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  ensureInMemoryCleanupTimer()
  const identifier = getClientIp(req)
  const now = Date.now()

  if (!inMemoryStore[identifier]) {
    inMemoryStore[identifier] = {
      count: 1,
      resetTime: now + config.rateLimit.windowMs
    }
    return next()
  }

  const record = inMemoryStore[identifier]

  // Reset if window expired
  if (now > record.resetTime) {
    record.count = 1
    record.resetTime = now + config.rateLimit.windowMs
    return next()
  }

  // Increment count
  record.count++

  // Check limit
  if (record.count > config.rateLimit.max) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000)

    res.set('Retry-After', retryAfter.toString())
    res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
    res.set('X-RateLimit-Remaining', '0')
    res.set('X-RateLimit-Reset', new Date(record.resetTime).toISOString())

    res.status(429).json({
      error: {
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429,
        retryAfter
      }
    })
    return
  }

  // Add rate limit headers
  res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
  res.set('X-RateLimit-Remaining', (config.rateLimit.max - record.count).toString())
  res.set('X-RateLimit-Reset', new Date(record.resetTime).toISOString())

  next()
}

/**
 * Stop the in-memory cleanup timer (for graceful shutdown / test teardown).
 */
export function stopInMemoryCleanupTimer(): void {
  if (inMemoryCleanupTimer) {
    clearInterval(inMemoryCleanupTimer)
    inMemoryCleanupTimer = null
  }
}

/**
 * Create rate limiter middleware based on environment
 * Uses Redis in production, in-memory in development
 */
export function createRateLimiter(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void> {
  if (config.server.env === 'production' || process.env.USE_REDIS_RATE_LIMIT === 'true') {
    console.log('[RateLimiter] Using Redis-based rate limiting')
    return rateLimiter
  }
  console.log('[RateLimiter] Using in-memory rate limiting (development mode)')
  return inMemoryRateLimiter
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRateLimiterConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    console.log('[RateLimiter] Redis connection closed')
  }
}

// ---------------------------------------------------------------------------
// Per-identity rate limiter
//
// Keyed on the authenticated user identity (req.user.id) rather than the
// client IP. Run AFTER auth middleware so req.user is already populated.
//
// For API-key callers req.user.id = `apikey:<keyId>`, giving each paying
// customer an independent quota — two customers behind the same NAT/VPN no
// longer compete for the same slot.
// For JWT callers req.user.id = the user UUID.
// Falls back to IP for unauthenticated requests (shouldn't happen on the
// protected scrape routes, but avoids a crash if it does).
// ---------------------------------------------------------------------------

function getUserIdentity(req: Request): string {
  const user = (req as Request & { user?: { id?: string } }).user
  return user?.id ?? getClientIp(req)
}

export const identityRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const identifier = getUserIdentity(req)
  const key = `ratelimit:user:${identifier}`
  const now = Date.now()
  const windowStart = now - config.rateLimit.windowMs

  try {
    const redis = getRedisClient()
    const pipeline = redis.multi()
    pipeline.zremrangebyscore(key, 0, windowStart)
    pipeline.zcard(key)
    pipeline.zadd(key, now, `${now}-${Math.random().toString(36).slice(2)}`)
    pipeline.expire(key, Math.ceil(config.rateLimit.windowMs / 1000))
    const results = await pipeline.exec()

    if (!results) {
      return handleLimiterBackendError(
        res,
        next,
        new Error('Redis transaction returned no results')
      )
    }

    const count = (results[1]?.[1] as number) || 0

    if (count >= config.rateLimit.max) {
      const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES')
      const oldestTimestamp = oldest.length >= 2 ? parseInt(oldest[1], 10) : now
      const retryAfter = Math.ceil((oldestTimestamp + config.rateLimit.windowMs - now) / 1000)

      res.set('Retry-After', Math.max(1, retryAfter).toString())
      res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
      res.set('X-RateLimit-Remaining', '0')
      res.set(
        'X-RateLimit-Reset',
        new Date(oldestTimestamp + config.rateLimit.windowMs).toISOString()
      )

      res.status(429).json({
        error: {
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429,
          retryAfter: Math.max(1, retryAfter)
        }
      })
      return
    }

    res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
    res.set('X-RateLimit-Remaining', Math.max(0, config.rateLimit.max - count - 1).toString())
    res.set('X-RateLimit-Reset', new Date(now + config.rateLimit.windowMs).toISOString())

    next()
  } catch (error) {
    return handleLimiterBackendError(res, next, error)
  }
}

const inMemoryIdentityStore: InMemoryStore = {}
let inMemoryIdentityCleanupTimer: ReturnType<typeof setInterval> | null = null

function ensureInMemoryIdentityCleanupTimer(): void {
  if (inMemoryIdentityCleanupTimer) return
  inMemoryIdentityCleanupTimer = setInterval(
    () => {
      const now = Date.now()
      Object.keys(inMemoryIdentityStore).forEach((key) => {
        if (now > inMemoryIdentityStore[key].resetTime) {
          delete inMemoryIdentityStore[key]
        }
      })
    },
    60 * 60 * 1000
  )
  inMemoryIdentityCleanupTimer.unref?.()
}

export const inMemoryIdentityRateLimiter = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  ensureInMemoryIdentityCleanupTimer()
  const identifier = getUserIdentity(req)
  const now = Date.now()

  if (!inMemoryIdentityStore[identifier]) {
    inMemoryIdentityStore[identifier] = {
      count: 1,
      resetTime: now + config.rateLimit.windowMs
    }
    return next()
  }

  const record = inMemoryIdentityStore[identifier]

  if (now > record.resetTime) {
    record.count = 1
    record.resetTime = now + config.rateLimit.windowMs
    return next()
  }

  record.count++

  if (record.count > config.rateLimit.max) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000)

    res.set('Retry-After', retryAfter.toString())
    res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
    res.set('X-RateLimit-Remaining', '0')
    res.set('X-RateLimit-Reset', new Date(record.resetTime).toISOString())

    res.status(429).json({
      error: {
        message: 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        statusCode: 429,
        retryAfter
      }
    })
    return
  }

  res.set('X-RateLimit-Limit', config.rateLimit.max.toString())
  res.set('X-RateLimit-Remaining', (config.rateLimit.max - record.count).toString())
  res.set('X-RateLimit-Reset', new Date(record.resetTime).toISOString())

  next()
}

export function stopInMemoryIdentityCleanupTimer(): void {
  if (inMemoryIdentityCleanupTimer) {
    clearInterval(inMemoryIdentityCleanupTimer)
    inMemoryIdentityCleanupTimer = null
  }
}

export function createApiKeyRateLimiter(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void | Promise<void> {
  if (config.server.env === 'production' || process.env.USE_REDIS_RATE_LIMIT === 'true') {
    return identityRateLimiter
  }
  return inMemoryIdentityRateLimiter
}
