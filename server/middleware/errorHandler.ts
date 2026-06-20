import { Request, Response, NextFunction, RequestHandler } from 'express'
import { config } from '../config'
import { ServiceError, isServiceError } from '../errors'
import { createRequestLogger, logger } from '../utils/logger'

// Extended request type with correlation ID
interface RequestWithCorrelation extends Request {
  correlationId?: string
}

export interface AppError extends Error {
  statusCode?: number
  status?: number
  code?: string
  details?: Record<string, unknown>
  type?: string
  body?: unknown
}

export class HttpError extends Error implements AppError {
  statusCode: number
  code: string

  constructor(statusCode: number, message: string, code?: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code || 'INTERNAL_ERROR'
    this.name = 'HttpError'
  }
}

export const errorHandler = (
  err: AppError | ServiceError,
  req: RequestWithCorrelation,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) => {
  const correlationId = req.correlationId
  const requestLogger = correlationId ? createRequestLogger(correlationId) : logger

  if (isJsonParseError(err)) {
    requestLogger.warn('Invalid JSON request body', {
      event: 'http.validation_error',
      path: req.path,
      method: req.method,
      statusCode: 400,
      code: 'INVALID_JSON'
    })

    return res.status(400).json({
      error: {
        message: 'Malformed JSON request body',
        code: 'INVALID_JSON',
        statusCode: 400,
        ...(correlationId && { correlationId })
      }
    })
  }

  // Handle ServiceError instances with rich error info
  if (isServiceError(err)) {
    requestLogger.error('Request failed with service error', err, {
      event: 'http.error',
      path: req.path,
      method: req.method,
      statusCode: err.statusCode,
      code: err.code,
      details: err.details
    })

    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        correlationId,
        ...(err.details && { details: err.details }),
        ...(config.server.env === 'development' && { stack: err.stack })
      }
    })
  }

  // Handle generic (non-ServiceError) errors. These are unknown/uncontrolled
  // errors that may carry internal details in their message, so in production
  // we mask the message regardless of statusCode. Only ServiceError instances
  // (handled above) are considered "safe to surface" client errors.
  const statusCode = err.statusCode || err.status || 500
  const rawMessage = err.message || 'Internal Server Error'
  const isProduction = config.server.env === 'production'

  // Log error - omit stack trace in production
  requestLogger.error('Request failed with unexpected error', err, {
    event: 'http.error',
    path: req.path,
    method: req.method,
    statusCode,
    code: err.code || 'INTERNAL_ERROR'
  })

  // In production, never leak the raw message of an unknown error. For client
  // (4xx) errors return a generic client-error message; otherwise a generic
  // server-error message. In non-production environments, surface the real
  // message to aid debugging.
  let responseMessage: string
  if (isProduction) {
    responseMessage =
      statusCode >= 400 && statusCode < 500
        ? 'Request could not be processed'
        : 'Internal Server Error'
  } else {
    responseMessage = rawMessage
  }

  // Send error response - omit stack trace in production
  res.status(statusCode).json({
    error: {
      message: responseMessage,
      code: err.code || 'INTERNAL_ERROR',
      statusCode,
      correlationId,
      ...(config.server.env === 'development' && { stack: err.stack })
    }
  })
}

export const notFoundHandler = (req: Request, res: Response) => {
  const correlationId = (req as RequestWithCorrelation).correlationId

  res.status(404).json({
    error: {
      message: `Route ${req.method} ${req.path} not found`,
      code: 'NOT_FOUND',
      statusCode: 404,
      ...(correlationId && { correlationId })
    }
  })
}

function isJsonParseError(err: AppError | ServiceError): boolean {
  if (!(err instanceof SyntaxError)) {
    return false
  }

  const candidate = err as AppError
  return (
    (candidate.statusCode === 400 || candidate.status === 400) &&
    (candidate.type === 'entity.parse.failed' || 'body' in candidate)
  )
}

// Async error wrapper
type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<void | Response>

export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
