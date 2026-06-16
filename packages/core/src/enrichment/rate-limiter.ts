/**
 * Rate Limiter (shared)
 *
 * Token-bucket rate limiting for external data-source requests. Framework-free
 * (no browser/Vite dependencies) so it can be consumed by both the web app and
 * the Express server via @public-records/core/enrichment.
 */

export interface RateLimitConfig {
  maxTokens: number
  refillRate: number // tokens per refill interval
  refillInterval: number // milliseconds
}

export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private config: RateLimitConfig

  constructor(config: RateLimitConfig) {
    this.config = config
    this.tokens = config.maxTokens
    this.lastRefill = Date.now()
  }

  /**
   * Attempt to consume tokens.
   * @returns true if tokens were consumed, false if the rate limit is exceeded.
   */
  tryConsume(tokensNeeded: number = 1): boolean {
    this.refillTokens()

    if (this.tokens >= tokensNeeded) {
      this.tokens -= tokensNeeded
      return true
    }

    return false
  }

  /**
   * Wait until the requested tokens are available, then consume them.
   */
  async waitForTokens(tokensNeeded: number = 1): Promise<void> {
    while (!this.tryConsume(tokensNeeded)) {
      const tokensShortage = tokensNeeded - this.tokens
      const waitTime = (tokensShortage / this.config.refillRate) * 1000
      await this.sleep(Math.ceil(waitTime))
    }
  }

  private refillTokens(): void {
    const now = Date.now()
    const timeSinceLastRefill = now - this.lastRefill

    if (timeSinceLastRefill >= this.config.refillInterval) {
      const intervalsElapsed = Math.floor(timeSinceLastRefill / this.config.refillInterval)
      const tokensToAdd = intervalsElapsed * this.config.refillRate

      this.tokens = Math.min(this.config.maxTokens, this.tokens + tokensToAdd)
      this.lastRefill = now
    }
  }

  getAvailableTokens(): number {
    this.refillTokens()
    return this.tokens
  }

  reset(): void {
    this.tokens = this.config.maxTokens
    this.lastRefill = Date.now()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Rate-limiter manager keyed by data-source name.
 */
export class RateLimiterManager {
  private limiters: Map<string, RateLimiter> = new Map()

  getLimiter(sourceName: string): RateLimiter {
    if (!this.limiters.has(sourceName)) {
      const config = this.getConfigForSource(sourceName)
      this.limiters.set(sourceName, new RateLimiter(config))
    }
    return this.limiters.get(sourceName)!
  }

  tryConsume(sourceName: string, tokensNeeded: number = 1): boolean {
    const limiter = this.getLimiter(sourceName)
    return limiter.tryConsume(tokensNeeded)
  }

  async waitForTokens(sourceName: string, tokensNeeded: number = 1): Promise<void> {
    const limiter = this.getLimiter(sourceName)
    await limiter.waitForTokens(tokensNeeded)
  }

  private getConfigForSource(sourceName: string): RateLimitConfig {
    const configs: Record<string, RateLimitConfig> = {
      'sec-edgar': { maxTokens: 10, refillRate: 10, refillInterval: 1000 }, // 10 req/sec
      osha: { maxTokens: 5, refillRate: 1, refillInterval: 1000 }, // 1 req/sec
      uspto: { maxTokens: 5, refillRate: 1, refillInterval: 1000 }, // 1 req/sec
      census: { maxTokens: 5, refillRate: 1, refillInterval: 1000 }, // 1 req/sec
      'sam-gov': { maxTokens: 5, refillRate: 1, refillInterval: 1000 }, // 1 req/sec (keyed)
      dnb: { maxTokens: 10, refillRate: 2, refillInterval: 1000 }, // 2 req/sec
      'google-places': { maxTokens: 50, refillRate: 10, refillInterval: 1000 }, // 10 req/sec
      clearbit: { maxTokens: 10, refillRate: 1, refillInterval: 1000 }, // 1 req/sec
      zoominfo: { maxTokens: 10, refillRate: 1, refillInterval: 1000 }, // 1 req/sec
      'scraper-ca': { maxTokens: 5, refillRate: 5, refillInterval: 60000 }, // 5 req/min
      'scraper-tx': { maxTokens: 5, refillRate: 5, refillInterval: 60000 }, // 5 req/min
      'scraper-fl': { maxTokens: 5, refillRate: 5, refillInterval: 60000 } // 5 req/min
    }

    return configs[sourceName] || { maxTokens: 5, refillRate: 1, refillInterval: 1000 }
  }

  resetAll(): void {
    this.limiters.forEach((limiter) => limiter.reset())
  }
}

// Global singleton instance shared across all consumers.
export const rateLimiterManager = new RateLimiterManager()
