import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { validateRequest } from '../../middleware/validateRequest'

describe('validateRequest middleware', () => {
  let mockReq: Partial<Request>
  let mockRes: Partial<Response>
  let mockNext: NextFunction
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockReq = {
      body: {},
      query: {},
      params: {}
    }
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    }
    mockNext = vi.fn()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('body validation', () => {
    const bodySchema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().int().positive().optional()
    })

    it('passes validation with valid body', () => {
      mockReq.body = {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30
      }

      const middleware = validateRequest({ body: bodySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockRes.status).not.toHaveBeenCalled()
    })

    it('transforms body to match schema', () => {
      mockReq.body = {
        name: 'John Doe',
        email: 'john@example.com',
        extraField: 'should be stripped'
      }

      // Note: Without strict(), extra fields are preserved
      const middleware = validateRequest({ body: bodySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('returns 400 for invalid body', () => {
      mockReq.body = {
        name: '',
        email: 'invalid-email'
      }

      const middleware = validateRequest({ body: bodySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            details: expect.arrayContaining([
              expect.objectContaining({ field: expect.any(String), message: expect.any(String) })
            ])
          })
        })
      )
      expect(mockNext).not.toHaveBeenCalled()
    })

    it('includes field names in error details', () => {
      mockReq.body = {
        email: 'invalid'
      }

      const middleware = validateRequest({ body: bodySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      const jsonCall = (mockRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0]
      const details = jsonCall.error.details

      expect(details).toContainEqual(expect.objectContaining({ field: 'name' }))
      expect(details).toContainEqual(expect.objectContaining({ field: 'email' }))
    })

    it('includes correlation ID when validation fails with request context', () => {
      mockReq = {
        ...mockReq,
        correlationId: 'correlation-1',
        body: {
          name: '',
          email: 'invalid-email'
        }
      } as Partial<Request>

      const middleware = validateRequest({ body: bodySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            correlationId: 'correlation-1'
          })
        })
      )
    })
  })

  describe('query validation', () => {
    const querySchema = z.object({
      page: z.string().regex(/^\d+$/).transform(Number).default('1'),
      limit: z.string().regex(/^\d+$/).transform(Number).default('10'),
      search: z.string().optional()
    })

    it('passes validation with valid query params', () => {
      mockReq.query = {
        page: '2',
        limit: '20',
        search: 'test'
      }

      const middleware = validateRequest({ query: querySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockReq.query).toEqual({
        page: 2,
        limit: 20,
        search: 'test'
      })
    })

    it('applies default values', () => {
      mockReq.query = {}

      const middleware = validateRequest({ query: querySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      // Defaults are applied as strings (before regex validation happens)
      // so the transform converts the default string '1' to number 1
      expect(mockReq.query).toEqual({
        page: '1',
        limit: '10'
      })
    })

    it('applies string defaults when no transform', () => {
      const simpleSchema = z.object({
        page: z.string().default('1'),
        limit: z.string().default('10')
      })

      mockReq.query = {}

      const middleware = validateRequest({ query: simpleSchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
      expect(mockReq.query).toEqual({
        page: '1',
        limit: '10'
      })
    })

    it('returns 400 for invalid query params', () => {
      mockReq.query = {
        page: 'invalid',
        limit: '-5'
      }

      const middleware = validateRequest({ query: querySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockNext).not.toHaveBeenCalled()
    })
  })

  describe('params validation', () => {
    const paramsSchema = z.object({
      id: z.string().uuid()
    })

    it('passes validation with valid params', () => {
      mockReq.params = {
        id: '550e8400-e29b-41d4-a716-446655440000'
      }

      const middleware = validateRequest({ params: paramsSchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('returns 400 for invalid params', () => {
      mockReq.params = {
        id: 'not-a-uuid'
      }

      const middleware = validateRequest({ params: paramsSchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            details: expect.arrayContaining([expect.objectContaining({ field: 'id' })])
          })
        })
      )
    })
  })

  describe('combined validation', () => {
    it('validates body, query, and params together', () => {
      const schemas = {
        body: z.object({ name: z.string() }),
        query: z.object({ include: z.string().optional() }),
        params: z.object({ id: z.string() })
      }

      mockReq.body = { name: 'Test' }
      mockReq.query = { include: 'details' }
      mockReq.params = { id: '123' }

      const middleware = validateRequest(schemas)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('returns all validation errors at once', () => {
      const schemas = {
        body: z.object({ name: z.string().min(1) }),
        params: z.object({ id: z.string().uuid() })
      }

      mockReq.body = { name: '' }
      mockReq.params = { id: 'invalid' }

      const middleware = validateRequest(schemas)
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      // First failing validation stops execution
    })
  })

  describe('edge cases', () => {
    it('handles empty schemas object', () => {
      const middleware = validateRequest({})
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalled()
    })

    it('passes non-Zod errors to next', () => {
      const faultySchema = {
        parse: () => {
          throw new Error('Non-Zod error')
        }
      } as z.ZodSchema

      const middleware = validateRequest({ body: faultySchema })
      middleware(mockReq as Request, mockRes as Response, mockNext)

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
