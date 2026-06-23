import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { requestLogger } from '../../middleware/requestLogger'

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-correlation-id'
}))

describe('requestLogger middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>
  let finishCallback: (() => void) | undefined

  beforeEach(() => {
    mockReq = {
      method: 'GET',
      path: '/api/test',
      query: {},
      body: {},
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent'
      }
    }
    mockRes = {
      statusCode: 200,
      setHeader: vi.fn(),
      on: vi.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishCallback = callback
        }
      })
    }
    mockNext = vi.fn()
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
    finishCallback = undefined
  })

  function findLogContext(message: string): Record<string, unknown> {
    const call = consoleInfoSpy.mock.calls.find((current) => String(current[0]).includes(message))
    expect(call).toBeDefined()

    const serialized = String(call![0])
    const jsonStart = serialized.indexOf('{')
    expect(jsonStart).toBeGreaterThanOrEqual(0)
    return JSON.parse(serialized.slice(jsonStart))
  }

  it('adds correlation ID to request', () => {
    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    expect((mockReq as Request & { correlationId: string }).correlationId).toBe(
      'mock-correlation-id'
    )
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'mock-correlation-id')
  })

  it('accepts valid caller-provided correlation ID', () => {
    mockReq.headers = {
      'x-correlation-id': 'external-request-123',
      'user-agent': 'test-agent'
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    expect((mockReq as Request & { correlationId: string }).correlationId).toBe(
      'external-request-123'
    )
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Correlation-ID', 'external-request-123')
  })

  it('rejects invalid caller-provided correlation ID', () => {
    mockReq.headers = {
      'x-correlation-id': 'bad id with spaces',
      'user-agent': 'test-agent'
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    expect((mockReq as Request & { correlationId: string }).correlationId).toBe(
      'mock-correlation-id'
    )
    expect(findLogContext('HTTP request received')).toMatchObject({
      requestIdSource: 'generated',
      rejectedRequestIdHeader: true
    })
  })

  it('calls next', () => {
    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalled()
  })

  it('logs incoming request with details', () => {
    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    expect(findLogContext('HTTP request received')).toMatchObject({
      event: 'http.request',
      method: 'GET',
      path: '/api/test',
      ip: '127.0.0.1',
      userAgent: 'test-agent',
      requestIdSource: 'generated'
    })
  })

  it('logs response on finish', () => {
    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    // Simulate response finish
    if (finishCallback) {
      finishCallback()
    }

    const logData = findLogContext('HTTP response completed')
    expect(logData).toMatchObject({
      event: 'http.response',
      method: 'GET',
      path: '/api/test',
      statusCode: 200
    })
  })

  it('redacts sensitive query parameters', () => {
    mockReq.query = {
      page: '1',
      token: 'secret-token',
      api_key: 'my-api-key',
      password: 'mypassword',
      search: 'normal-value'
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')

    expect(logData.query).toEqual({
      page: '1',
      token: '[REDACTED]',
      api_key: '[REDACTED]',
      password: '[REDACTED]',
      search: 'normal-value'
    })
  })

  it('redacts authorization-related parameters', () => {
    mockReq.query = {
      authorization: 'Bearer xyz',
      auth: 'some-auth',
      jwt: 'eyJhbGciOiJIUzI1NiJ9',
      bearer: 'token',
      access_token: 'access-123',
      refresh_token: 'refresh-456'
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')

    expect(logData.query).toEqual({
      authorization: '[REDACTED]',
      auth: '[REDACTED]',
      jwt: '[REDACTED]',
      bearer: '[REDACTED]',
      access_token: '[REDACTED]',
      refresh_token: '[REDACTED]'
    })
  })

  it('handles empty query object', () => {
    mockReq.query = {}

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')

    expect(logData.query).toEqual({})
  })

  it('includes duration in response log', () => {
    vi.useFakeTimers()

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    // Advance time by 100ms
    vi.advanceTimersByTime(100)

    if (finishCallback) {
      finishCallback()
    }

    const logData = findLogContext('HTTP response completed')
    expect(logData.durationMs).toBeGreaterThanOrEqual(0)

    vi.useRealTimers()
  })

  it('redacts sensitive body fields', () => {
    mockReq.body = {
      username: 'testuser',
      password: 'secret123',
      apiKey: 'key-12345',
      data: 'normal-data'
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')
    const body = JSON.parse(logData.body as string)

    expect(body).toEqual({
      username: 'testuser',
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
      data: 'normal-data'
    })
  })

  it('redacts nested sensitive body fields', () => {
    mockReq.body = {
      user: {
        email: 'test@example.com',
        credentials: {
          password: 'nested-secret'
        }
      }
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')
    const body = JSON.parse(logData.body as string)

    expect(body.user.credentials.password).toBe('[REDACTED]')
    expect(body.user.email).toBe('test@example.com')
  })

  it('does not include body when empty', () => {
    mockReq.body = {}

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')

    expect(logData.body).toBeUndefined()
  })

  it('summarizes raw Buffer bodies without logging contents', () => {
    mockReq.body = Buffer.from('{"secret":"payload"}')

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')
    expect(JSON.parse(logData.body as string)).toEqual({
      type: 'Buffer',
      length: 20
    })
  })

  it('truncates large body payloads', () => {
    mockReq.body = {
      data: 'x'.repeat(2000)
    }

    requestLogger(mockReq as Request, mockRes as Response, mockNext)

    const logData = findLogContext('HTTP request received')

    expect((logData.body as string).endsWith('...[TRUNCATED]')).toBe(true)
  })
})
