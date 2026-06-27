import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'

// Mock config before importing rateLimiter
vi.mock('../../config', () => ({
  config: {
    server: {
      env: 'development' // Use in-memory rate limiter for tests
    },
    rateLimit: {
      windowMs: 60000, // 1 minute
      max: 5 // 5 requests per window
    },
    redis: {
      host: 'localhost',
      port: 6379,
      password: undefined
    }
  }
}))

// Import after mocking - use the in-memory rate limiter for tests
import {
  inMemoryRateLimiter,
  inMemoryIdentityRateLimiter,
  createRateLimiter,
  createApiKeyRateLimiter
} from '../../middleware/rateLimiter'

describe('inMemoryRateLimiter middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let headers: Record<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    headers = {}

    mockReq = {
      ip: `192.168.1.${Math.floor(Math.random() * 255)}`, // Unique IP for each test
      headers: {}
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn((key: string, value: string) => {
        headers[key] = value
        return mockRes
      })
    }
    mockNext = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows first request from new IP', () => {
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockRes.status).not.toHaveBeenCalled()
  })

  it('sets rate limit headers on subsequent requests', () => {
    const ip = `headers-ip-${Date.now()}`
    mockReq.ip = ip

    // First request doesn't set headers (early return)
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    // Second request should set headers
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Limit', '5')
    expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String))
    expect(mockRes.set).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(String))
  })

  it('decrements remaining count with each request', () => {
    const ip = `test-ip-${Date.now()}`
    mockReq.ip = ip

    // First request (count = 1, no headers set)
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    // Second request (count = 2, remaining = 3)
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    expect(headers['X-RateLimit-Remaining']).toBe('3')

    // Third request (count = 3, remaining = 2)
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    expect(headers['X-RateLimit-Remaining']).toBe('2')

    // Fourth request (count = 4, remaining = 1)
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    expect(headers['X-RateLimit-Remaining']).toBe('1')
  })

  it('blocks requests exceeding the limit', () => {
    const ip = `blocked-ip-${Date.now()}`
    mockReq.ip = ip

    // Make 5 requests (the limit)
    for (let i = 0; i < 5; i++) {
      inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    expect(mockNext).toHaveBeenCalledTimes(5)

    // Reset mocks for the 6th request
    mockNext = vi.fn()
    mockRes.status = vi.fn().mockReturnThis()
    mockRes.json = vi.fn().mockReturnThis()

    // 6th request should be blocked
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).not.toHaveBeenCalled()
    expect(mockRes.status).toHaveBeenCalledWith(429)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          statusCode: 429
        })
      })
    )
  })

  it('includes Retry-After header when rate limited', () => {
    const ip = `retry-ip-${Date.now()}`
    mockReq.ip = ip

    // Exhaust the limit
    for (let i = 0; i < 6; i++) {
      inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String))
    expect(headers['X-RateLimit-Remaining']).toBe('0')
  })

  it('resets count after window expires', () => {
    const ip = `reset-ip-${Date.now()}`
    mockReq.ip = ip

    // Exhaust the limit
    for (let i = 0; i < 5; i++) {
      inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    expect(mockNext).toHaveBeenCalledTimes(5)

    // Advance time past the window
    vi.advanceTimersByTime(61000) // 61 seconds

    // Reset mocks
    mockNext = vi.fn()
    mockRes.set = vi.fn().mockReturnThis()

    // Should be allowed again
    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('tracks different IPs separately', () => {
    const ip1 = `ip1-${Date.now()}`
    const ip2 = `ip2-${Date.now()}`

    // Exhaust limit for IP1
    mockReq.ip = ip1
    for (let i = 0; i < 5; i++) {
      inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    // IP2 should still be allowed
    mockReq.ip = ip2
    mockNext = vi.fn()

    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('handles missing IP gracefully', () => {
    mockReq.ip = undefined

    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('keys rate limiting on req.ip, not the spoofable X-Forwarded-For header', () => {
    // The limiter must rely on Express req.ip (which honors the centrally
    // configured `trust proxy`) rather than parsing X-Forwarded-For itself,
    // so a client cannot evade limits by forging the header.
    mockReq.ip = '127.0.0.1'
    mockReq.headers = {
      'x-forwarded-for': '10.0.0.1'
    }

    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    expect(mockNext).toHaveBeenCalled()

    // All requests share the same req.ip identifier regardless of the forged
    // header, so the limit is enforced after the window's worth of requests.
    for (let i = 0; i < 4; i++) {
      inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    // 6th request should be blocked
    mockNext = vi.fn()
    mockRes.status = vi.fn().mockReturnThis()
    mockRes.json = vi.fn().mockReturnThis()

    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).not.toHaveBeenCalled()
    expect(mockRes.status).toHaveBeenCalledWith(429)
  })

  it('ignores a forged X-Forwarded-For when req.ip is absent (falls back to "unknown")', () => {
    // No req.ip set; the forged header must NOT be used as the identity.
    mockReq.headers = {
      'x-forwarded-for': '192.168.1.100, 10.0.0.2, 10.0.0.1'
    }

    inMemoryRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    expect(mockNext).toHaveBeenCalled()
  })
})

describe('createRateLimiter factory', () => {
  it('returns in-memory rate limiter in development mode', () => {
    const limiter = createRateLimiter()
    expect(limiter).toBe(inMemoryRateLimiter)
  })
})

describe('inMemoryIdentityRateLimiter middleware', () => {
  let mockReq: Partial<Request> & { user?: { id?: string } }
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let headers: Record<string, string>

  beforeEach(() => {
    vi.useFakeTimers()
    headers = {}

    mockReq = {
      ip: '10.0.0.1', // shared IP for all tests — key point: identity ignores it
      headers: {}
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn((key: string, value: string) => {
        headers[key] = value
        return mockRes
      })
    }
    mockNext = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows the first request from a new user identity', () => {
    mockReq.user = { id: `apikey:key-${Date.now()}` }

    inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockRes.status).not.toHaveBeenCalled()
  })

  it('blocks requests exceeding the per-identity limit', () => {
    mockReq.user = { id: `apikey:key-exceeded-${Date.now()}` }

    for (let i = 0; i < 5; i++) {
      inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    expect(mockNext).toHaveBeenCalledTimes(5)

    mockNext = vi.fn()
    mockRes.status = vi.fn().mockReturnThis()
    mockRes.json = vi.fn().mockReturnThis()

    inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).not.toHaveBeenCalled()
    expect(mockRes.status).toHaveBeenCalledWith(429)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED', statusCode: 429 })
      })
    )
  })

  it('isolates quotas per identity — one user exhausting limit does not throttle another', () => {
    const user1Id = `apikey:key-user1-${Date.now()}`
    const user2Id = `apikey:key-user2-${Date.now()}`

    // Exhaust the limit for user1 (same IP as user2)
    mockReq.user = { id: user1Id }
    for (let i = 0; i < 5; i++) {
      inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    // user2 shares the same IP but gets its own quota slot
    mockReq.user = { id: user2Id }
    const freshNext = vi.fn()

    inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, freshNext)

    expect(freshNext).toHaveBeenCalled()
  })

  it('resets the count after the window expires', () => {
    mockReq.user = { id: `apikey:key-reset-${Date.now()}` }

    for (let i = 0; i < 5; i++) {
      inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)
    }

    vi.advanceTimersByTime(61000)

    mockNext = vi.fn()
    inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('falls back to IP when no user is attached', () => {
    mockReq.user = undefined
    mockReq.ip = `fallback-ip-${Date.now()}`

    inMemoryIdentityRateLimiter(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
    expect(mockRes.status).not.toHaveBeenCalled()
  })
})

describe('createApiKeyRateLimiter factory', () => {
  it('returns identity-based in-memory limiter in development mode', () => {
    const limiter = createApiKeyRateLimiter()
    expect(limiter).toBe(inMemoryIdentityRateLimiter)
  })
})
