import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiRequest, ApiError, TimeoutError, DEFAULT_TIMEOUT_MS, LONG_TIMEOUT_MS } from '../client'

describe('apiRequest', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful requests', () => {
    it('makes GET request to resolved URL', async () => {
      const mockResponse = { data: 'test' }
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await apiRequest('/test')

      expect(result).toEqual(mockResponse)
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/test'),
        expect.objectContaining({
          headers: expect.any(Headers)
        })
      )
    })

    it('makes POST request with JSON body', async () => {
      const requestBody = { name: 'test' }
      const mockResponse = { id: 1 }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      } as Response)

      const result = await apiRequest('/test', {
        method: 'POST',
        body: requestBody
      })

      expect(result).toEqual(mockResponse)
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody)
        })
      )
    })

    it('handles 204 No Content response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers()
      } as Response)

      const result = await apiRequest('/test', { method: 'DELETE' })

      expect(result).toBeNull()
    })

    it('handles non-JSON response', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('plain text response')
      } as Response)

      const result = await apiRequest('/test')

      expect(result).toBe('plain text response')
    })
  })

  describe('error handling', () => {
    it('throws ApiError on 4xx responses', async () => {
      const errorBody = { message: 'Not Found', code: 'NOT_FOUND' }

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(errorBody)
      } as Response)

      await expect(apiRequest('/test')).rejects.toThrow(ApiError)

      // Test again for the match object
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(errorBody)
      } as Response)

      try {
        await apiRequest('/test')
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        const err = e as ApiError
        expect(err.status).toBe(404)
        expect(err.message).toBe('Not Found')
      }
    })

    it('throws ApiError on 5xx responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ message: 'Server Error' })
      } as Response)

      await expect(apiRequest('/test')).rejects.toThrow(ApiError)
    })

    it('throws ApiError on network failure', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      try {
        await apiRequest('/test')
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError)
        const err = e as ApiError
        expect(err.status).toBe(0)
        expect(err.message).toBe('Network error')
      }
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 30 seconds', () => {
      expect(DEFAULT_TIMEOUT_MS).toBe(30000)
    })

    it('provides long timeout constant of 2 minutes', () => {
      expect(LONG_TIMEOUT_MS).toBe(120000)
    })

    it('throws TimeoutError when request exceeds timeout', async () => {
      vi.useFakeTimers()

      // Create a fetch that never resolves until aborted
      vi.mocked(fetch).mockImplementationOnce((_, options) => {
        return new Promise((_, reject) => {
          const signal = options?.signal as AbortSignal | undefined
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      // Attach catch handler immediately to avoid unhandled rejection
      const promise = apiRequest('/test', { timeout: 100 }).catch((e) => e)

      // Advance time past the timeout
      await vi.advanceTimersByTimeAsync(150)

      const error = (await promise) as Error
      expect(error).toBeInstanceOf(TimeoutError)
      expect(error.message).toContain('Request timed out')

      vi.useRealTimers()
    })

    it('completes request before timeout', { timeout: 1000 }, async () => {
      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  status: 200,
                  headers: new Headers({ 'content-type': 'application/json' }),
                  json: () => Promise.resolve({ data: 'success' })
                } as Response),
              50 // Quick response
            )
          })
      )

      // Use a longer timeout that won't expire
      const result = await apiRequest('/test', { timeout: 500 })
      expect(result).toEqual({ data: 'success' })
    })

    it('clears timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' })
      } as Response)

      await apiRequest('/test')

      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('clears timeout on error response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      await expect(apiRequest('/test')).rejects.toThrow()
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })
  })

  describe('abort signal handling', () => {
    it('respects external abort signal', async () => {
      const controller = new AbortController()

      // Create a fetch that waits for abort
      vi.mocked(fetch).mockImplementationOnce((_, options) => {
        return new Promise((_, reject) => {
          const signal = options?.signal
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })

      const promise = apiRequest('/test', { signal: controller.signal })

      // Abort immediately
      controller.abort()

      await expect(promise).rejects.toThrow(DOMException)
    })
  })

  describe('headers', () => {
    it('sets Accept header to application/json', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({})
      } as Response)

      await apiRequest('/test')

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = callArgs[1]?.headers as Headers
      expect(headers.get('Accept')).toBe('application/json')
    })

    it('sets Content-Type for JSON body', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({})
      } as Response)

      await apiRequest('/test', {
        method: 'POST',
        body: { data: 'test' }
      })

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = callArgs[1]?.headers as Headers
      expect(headers.get('Content-Type')).toBe('application/json')
    })

    it('preserves custom headers', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({})
      } as Response)

      await apiRequest('/test', {
        headers: {
          Authorization: 'Bearer token123'
        }
      })

      const callArgs = vi.mocked(fetch).mock.calls[0]
      const headers = callArgs[1]?.headers as Headers
      expect(headers.get('Authorization')).toBe('Bearer token123')
    })
  })

  describe('URL resolution', () => {
    it('prepends API base URL to relative paths', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({})
      } as Response)

      await apiRequest('/test/endpoint')

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test/endpoint'),
        expect.any(Object)
      )
    })

    it('does not modify absolute URLs', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({})
      } as Response)

      const absoluteUrl = 'https://external-api.com/endpoint'
      await apiRequest(absoluteUrl)

      expect(fetch).toHaveBeenCalledWith(absoluteUrl, expect.any(Object))
    })
  })
})

describe('ApiError', () => {
  it('has correct name', () => {
    const error = new ApiError('Test error', 400, null)
    expect(error.name).toBe('ApiError')
  })

  it('stores status and body', () => {
    const body = { code: 'TEST_ERROR' }
    const error = new ApiError('Test error', 400, body)

    expect(error.status).toBe(400)
    expect(error.body).toBe(body)
    expect(error.message).toBe('Test error')
  })
})

describe('TimeoutError', () => {
  it('has correct name', () => {
    const error = new TimeoutError()
    expect(error.name).toBe('TimeoutError')
  })

  it('has default message', () => {
    const error = new TimeoutError()
    expect(error.message).toBe('Request timed out')
  })

  it('accepts custom message', () => {
    const error = new TimeoutError('Custom timeout message')
    expect(error.message).toBe('Custom timeout message')
  })
})
