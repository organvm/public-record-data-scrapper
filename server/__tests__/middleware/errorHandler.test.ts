import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import {
  errorHandler,
  notFoundHandler,
  HttpError,
  asyncHandler
} from '../../middleware/errorHandler'
import { ServiceError, NotFoundError, ValidationError } from '../../errors'

// Mock config
vi.mock('../../config', () => ({
  config: {
    server: {
      env: 'test'
    }
  }
}))

describe('errorHandler middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockReq = {
      path: '/test',
      method: 'GET',
      correlationId: 'test-correlation-id'
    } as Partial<Request>
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    mockNext = vi.fn()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('handles generic errors with 500 status', () => {
    const error = new Error('Test error')

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(500)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Test error',
          code: 'INTERNAL_ERROR',
          statusCode: 500
        })
      })
    )
  })

  it('handles HttpError with custom status code', () => {
    const error = new HttpError(400, 'Bad request', 'BAD_REQUEST')

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Bad request',
          code: 'BAD_REQUEST',
          statusCode: 400
        })
      })
    )
  })

  it('handles ServiceError with details', () => {
    const error = new ServiceError('Service failed', 500, 'SERVICE_ERROR', { reason: 'timeout' })

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(500)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Service failed',
          code: 'SERVICE_ERROR',
          statusCode: 500,
          details: { reason: 'timeout' }
        })
      })
    )
  })

  it('handles NotFoundError', () => {
    const error = new NotFoundError('User', '123')

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(404)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "User with id '123' not found",
          code: 'NOT_FOUND',
          statusCode: 404
        })
      })
    )
  })

  it('handles ValidationError', () => {
    const error = new ValidationError('Invalid input', { email: ['Invalid email format'] })

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Invalid input',
          code: 'VALIDATION_ERROR',
          statusCode: 400
        })
      })
    )
  })

  it('includes correlation ID in error response', () => {
    const error = new Error('Test error')

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          correlationId: 'test-correlation-id'
        })
      })
    )
  })

  it('logs error with request details', () => {
    const error = new Error('Test error')

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    const serialized = String(consoleErrorSpy.mock.calls[0][0])
    expect(serialized).toContain('Request failed with unexpected error')
    expect(serialized).toContain('"path":"/test"')
    expect(serialized).toContain('"method":"GET"')
    expect(serialized).toContain('Test error')
    expect(serialized).toContain('[test-correlation-id]')
  })

  it('handles malformed JSON body parser errors', () => {
    const error = new SyntaxError('Unexpected token }') as SyntaxError & {
      statusCode: number
      type: string
      body: string
    }
    error.statusCode = 400
    error.type = 'entity.parse.failed'
    error.body = '{"bad":}'

    errorHandler(error, mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.status).toHaveBeenCalledWith(400)
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        message: 'Malformed JSON request body',
        code: 'INVALID_JSON',
        statusCode: 400,
        correlationId: 'test-correlation-id'
      }
    })
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Invalid JSON request body')
  })
})

describe('notFoundHandler middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>

  beforeEach(() => {
    mockReq = {
      path: '/unknown',
      method: 'GET'
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
  })

  it('returns 404 with route not found message', () => {
    notFoundHandler(mockReq as Request, mockRes as Response)

    expect(mockRes.status).toHaveBeenCalledWith(404)
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        message: 'Route GET /unknown not found',
        code: 'NOT_FOUND',
        statusCode: 404
      }
    })
  })
})

describe('asyncHandler utility', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction

  beforeEach(() => {
    mockReq = {}
    mockRes = {
      json: vi.fn()
    }
    mockNext = vi.fn()
  })

  it('calls next with error when async function throws', async () => {
    const error = new Error('Async error')
    const asyncFn = async () => {
      throw error
    }

    const wrapped = asyncHandler(asyncFn)
    await wrapped(mockReq as Request, mockRes as Response, mockNext)

    expect(mockNext).toHaveBeenCalledWith(error)
  })

  it('does not call next when async function succeeds', async () => {
    const asyncFn = async (req: Request, res: Response) => {
      res.json({ success: true })
    }

    const wrapped = asyncHandler(asyncFn)
    await wrapped(mockReq as Request, mockRes as Response, mockNext)

    expect(mockRes.json).toHaveBeenCalledWith({ success: true })
    expect(mockNext).not.toHaveBeenCalled()
  })
})
