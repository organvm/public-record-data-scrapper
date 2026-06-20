import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError, ZodIssue } from 'zod'

interface ValidationSchemas {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
}

export const validateRequest = (schemas: ValidationSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate body
      if (schemas.body) {
        req.body = schemas.body.parse(req.body)
      }

      // Validate query. In Express 5 `req.query` is a getter with no setter that
      // re-derives the parsed querystring on each access, so mutating it in place
      // (delete + Object.assign) does not persist — downstream handlers would read
      // the raw, un-coerced values. Redefine it as an own data property holding the
      // parsed/coerced result so the schema's transforms actually take effect.
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query)
        Object.defineProperty(req, 'query', {
          value: parsedQuery,
          writable: true,
          enumerable: true,
          configurable: true
        })
      }

      // Validate params - use Object.assign to avoid getter-only property issue
      if (schemas.params) {
        const parsedParams = schemas.params.parse(req.params)
        Object.keys(req.params).forEach((key) => delete req.params[key])
        Object.assign(req.params, parsedParams)
      }

      next()
    } catch (error) {
      if (error instanceof ZodError) {
        // Zod 4.x uses 'issues', Zod 3.x uses 'errors'
        const issues: ZodIssue[] = error.issues || []
        const errorMessages = issues.map((err) => ({
          field: err.path.join('.'),
          message: err.message
        }))

        return res.status(400).json({
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            statusCode: 400,
            details: errorMessages
          }
        })
      }

      next(error)
    }
  }
}
