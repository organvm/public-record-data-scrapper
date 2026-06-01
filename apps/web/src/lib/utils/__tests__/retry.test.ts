/**
 * Tests for Retry Utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  retry,
  retryIf,
  isRetryableError,
  sleep,
  CircuitBreaker,
  processBatch,
  RetryError,
  type RetryOptions
} from '../retry'

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('basic retry functionality', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success')
      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 1000
      }

      const promise = retry(fn, options)
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1 failed'))
        .mockRejectedValueOnce(new Error('Attempt 2 failed'))
        .mockResolvedValue('success')

      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 1000
      }

      const promise = retry(fn, options)
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result).toBe('success')
      expect(fn).toHaveBeenCalledTimes(3)
    })

    it('should fail after max attempts', async () => {
      const error = new Error('Persistent failure')
      const fn = vi.fn().mockRejectedValue(error)

      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 1000
      }

      const promise = retry(fn, options)

      // Catch the rejection to prevent unhandled rejection
      let caughtError: RetryError | null = null
      promise.catch((e) => {
        caughtError = e as RetryError
      })

      await vi.runAllTimersAsync()

      // Wait for the promise to settle
      await vi.waitFor(() => expect(caughtError).not.toBeNull())

      expect(caughtError).toBeInstanceOf(RetryError)
      expect((caughtError as unknown as RetryError).attempts).toBe(3)
      expect((caughtError as unknown as RetryError).lastError).toBe(error)
      expect(fn).toHaveBeenCalledTimes(3)
    })
  })

  describe('exponential backoff', () => {
    it('should use exponential backoff by default', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success')

      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 1000,
        exponentialBackoff: true
      }

      const promise = retry(fn, options)

      // First attempt - immediate
      await vi.advanceTimersByTimeAsync(0)
      expect(fn).toHaveBeenCalledTimes(1)

      // Second attempt - ~1000ms + jitter
      await vi.advanceTimersByTimeAsync(2000)
      expect(fn).toHaveBeenCalledTimes(2)

      // Third attempt - ~2000ms + jitter
      await vi.advanceTimersByTimeAsync(3000)
      expect(fn).toHaveBeenCalledTimes(3)

      await promise
    })

    it('should use fixed delay when exponentialBackoff is false', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success')

      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 1000,
        exponentialBackoff: false
      }

      const promise = retry(fn, options)

      await vi.advanceTimersByTimeAsync(0)
      expect(fn).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(2000)
      expect(fn).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(2000)
      expect(fn).toHaveBeenCalledTimes(3)

      await promise
    })

    it('should respect maxDelay cap', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('Fail')).mockResolvedValue('success')

      const options: RetryOptions = {
        maxAttempts: 10,
        baseDelay: 1000,
        maxDelay: 5000,
        exponentialBackoff: true
      }

      const promise = retry(fn, options)

      // Even with exponential backoff, should not exceed maxDelay
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(6000) // max 5000 + jitter

      await promise
      expect(fn).toHaveBeenCalledTimes(2)
    })
  })

  describe('onRetry callback', () => {
    it('should call onRetry callback on each retry', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success')

      const onRetry = vi.fn()

      const options: RetryOptions = {
        maxAttempts: 3,
        baseDelay: 100,
        onRetry
      }

      const promise = retry(fn, options)
      await vi.runAllTimersAsync()
      await promise

      expect(onRetry).toHaveBeenCalledTimes(2) // Called on first 2 failures
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error))
      expect(onRetry).toHaveBeenCalledWith(2, expect.any(Error))
    })
  })
})

describe('retryIf', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry only if shouldRetry returns true', async () => {
    const retryableError = new Error('HTTP error! status: 500')
    const nonRetryableError = new Error('Bad Request')

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockRejectedValueOnce(nonRetryableError)

    const shouldRetry = (error: Error) => error.message.includes('500')

    const options: RetryOptions = {
      maxAttempts: 3,
      baseDelay: 1000
    }

    const promise = retryIf(fn, shouldRetry, options)

    // Catch the rejection to prevent unhandled rejection
    let caughtError: Error | null = null
    promise.catch((e) => {
      caughtError = e as Error
    })

    // Run timers to advance through retries
    await vi.runAllTimersAsync()

    // Wait for the promise to settle
    await vi.waitFor(() => expect(caughtError).not.toBeNull())

    expect((caughtError as unknown as Error).message).toBe('Bad Request')
    expect(fn).toHaveBeenCalledTimes(2) // Retried once, then failed
  })

  it('should not retry if shouldRetry returns false', async () => {
    const error = new Error('Non-retryable error')
    const fn = vi.fn().mockRejectedValue(error)
    const shouldRetry = () => false

    const options: RetryOptions = {
      maxAttempts: 3,
      baseDelay: 1000
    }

    const promise = retryIf(fn, shouldRetry, options)

    // Should fail immediately without retries
    await expect(promise).rejects.toThrow('Non-retryable error')

    expect(fn).toHaveBeenCalledTimes(1) // No retries
  })
})

describe('isRetryableError', () => {
  it('should identify network errors as retryable', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true)
    expect(isRetryableError(new Error('network error'))).toBe(true)
  })

  it('should identify 5xx HTTP errors as retryable', () => {
    expect(isRetryableError(new Error('HTTP error! status: 500'))).toBe(true)
    expect(isRetryableError(new Error('HTTP error! status: 502'))).toBe(true)
    expect(isRetryableError(new Error('HTTP error! status: 503'))).toBe(true)
  })

  it('should identify rate limit errors as retryable', () => {
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true)
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true)
  })

  it('should identify timeout errors as retryable', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true)
    expect(isRetryableError(new Error('timeout exceeded'))).toBe(true)
  })

  it('should not identify 4xx errors (except 429) as retryable', () => {
    expect(isRetryableError(new Error('HTTP error! status: 400'))).toBe(false)
    expect(isRetryableError(new Error('HTTP error! status: 404'))).toBe(false)
  })

  it('should not identify general errors as retryable', () => {
    expect(isRetryableError(new Error('Invalid input'))).toBe(false)
    expect(isRetryableError(new Error('Permission denied'))).toBe(false)
  })
})

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should sleep for specified duration', async () => {
    const promise = sleep(1000)

    await vi.advanceTimersByTimeAsync(999)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(1)
    await promise

    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('CircuitBreaker', () => {
  it('should start in closed state', () => {
    const breaker = new CircuitBreaker(5, 60000)
    expect(breaker.getState()).toBe('closed')
  })

  it('should execute successfully when closed', async () => {
    const breaker = new CircuitBreaker(5, 60000)
    const fn = vi.fn().mockResolvedValue('success')

    const result = await breaker.execute(fn)

    expect(result).toBe('success')
    expect(breaker.getState()).toBe('closed')
  })

  it('should open after threshold failures', async () => {
    const breaker = new CircuitBreaker(3, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))

    // Fail 3 times to hit threshold
    for (let i = 0; i < 3; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    expect(breaker.getState()).toBe('open')
  })

  it('should reject immediately when open', async () => {
    const breaker = new CircuitBreaker(2, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    // Should reject immediately without calling fn
    const callCount = fn.mock.calls.length
    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open')
    expect(fn).toHaveBeenCalledTimes(callCount) // No new calls
  })

  it('should transition to half-open after timeout', async () => {
    vi.useFakeTimers()
    const breaker = new CircuitBreaker(2, 5000)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success')

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }
    expect(breaker.getState()).toBe('open')

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(5001)

    // Should now be half-open and allow execution
    const result = await breaker.execute(fn)
    expect(result).toBe('success')
    expect(breaker.getState()).toBe('closed')

    vi.useRealTimers()
  })

  it('should reset to closed on successful execution in half-open state', async () => {
    vi.useFakeTimers()
    const breaker = new CircuitBreaker(2, 5000)
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValue('success')

    // Open circuit
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.execute(fn)
      } catch {
        // Expected
      }
    }

    // Advance to half-open
    await vi.advanceTimersByTimeAsync(5001)

    // Successful execution should close circuit
    await breaker.execute(fn)
    expect(breaker.getState()).toBe('closed')

    vi.useRealTimers()
  })

  it('should reset failures on manual reset', async () => {
    const breaker = new CircuitBreaker(2, 60000)
    const fn = vi.fn().mockRejectedValue(new Error('Failure'))

    // Fail once
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }

    breaker.reset()

    // Should need 2 more failures to open, not 1
    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }
    expect(breaker.getState()).toBe('closed')

    try {
      await breaker.execute(fn)
    } catch {
      // Expected
    }
    expect(breaker.getState()).toBe('open')
  })
})

describe('processBatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should process all items successfully', async () => {
    const items = [1, 2, 3, 4, 5]
    const processor = vi.fn((item: number) => Promise.resolve(item * 2))

    const promise = processBatch(items, processor, { batchSize: 2 })
    await vi.runAllTimersAsync()
    const { results, errors } = await promise

    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(errors).toHaveLength(0)
  })

  it('should collect errors without stopping processing', async () => {
    const items = [1, 2, 3, 4, 5]
    const processor = vi.fn((item: number) => {
      if (item === 3) {
        return Promise.reject(new Error('Item 3 failed'))
      }
      return Promise.resolve(item * 2)
    })

    const promise = processBatch(items, processor, { batchSize: 2 })
    await vi.runAllTimersAsync()
    const { results, errors } = await promise

    expect(results).toEqual([2, 4, 8, 10])
    expect(errors).toHaveLength(1)
    expect(errors[0].item).toBe(3)
    expect(errors[0].error.message).toBe('Item 3 failed')
  })

  it('should call onError for failed items', async () => {
    const items = [1, 2, 3]
    const processor = vi.fn((item: number) => {
      if (item === 2) {
        return Promise.reject(new Error('Fail'))
      }
      return Promise.resolve(item)
    })

    const onError = vi.fn()

    const promise = processBatch(items, processor, {
      batchSize: 2,
      onError
    })
    await vi.runAllTimersAsync()
    await promise

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(2, expect.any(Error))
  })

  // Note: The concurrency option is defined but not enforced in processBatch.
  // All items in a batch are processed concurrently. This test documents that behavior.
  it('should process all items in batch concurrently', async () => {
    vi.useRealTimers()

    const items = [1, 2, 3, 4, 5, 6]
    let concurrent = 0
    let maxConcurrent = 0

    const processor = vi.fn(async (item: number) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise((resolve) => setTimeout(resolve, 5))
      concurrent--
      return item
    })

    const { results } = await processBatch(items, processor, {
      batchSize: 10,
      concurrency: 2
    })

    expect(results).toHaveLength(6)
    // With batchSize: 10, all 6 items are processed in one batch concurrently
    expect(maxConcurrent).toBe(6)

    vi.useFakeTimers()
  })

  it('should retry failed items when retryOptions provided', async () => {
    const items = [1, 2, 3]
    const processor = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(20)
      .mockResolvedValueOnce(30)

    const promise = processBatch(items, processor, {
      batchSize: 2,
      retryOptions: {
        maxAttempts: 2,
        baseDelay: 100
      }
    })
    await vi.runAllTimersAsync()
    const { results, errors } = await promise

    expect(results).toHaveLength(3)
    expect(errors).toHaveLength(0)
  })

  it('should add delay between batches', async () => {
    const items = [1, 2, 3, 4]
    const processor = vi.fn((item: number) => Promise.resolve(item))
    const promise = processBatch(items, processor, { batchSize: 2 })

    // Process first batch
    await vi.advanceTimersByTimeAsync(0)

    // Should wait 1000ms before second batch
    await vi.advanceTimersByTimeAsync(1000)

    await promise

    expect(processor).toHaveBeenCalledTimes(4)
  })
})
