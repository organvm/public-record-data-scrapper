import { Request, Response, NextFunction } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { createRequestLogger } from '../utils/logger'

const CORRELATION_ID_HEADER = 'x-correlation-id'
const REQUEST_ID_HEADER = 'x-request-id'
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_LOGGED_BODY_LENGTH = 1000

// Sensitive keys that should be redacted from logs (query params)
const SENSITIVE_PARAM_KEYS = [
  'token',
  'password',
  'secret',
  'key',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'jwt',
  'bearer',
  'access_token',
  'refresh_token',
  'session',
  'cookie'
]

// Sensitive keys that should be redacted from request bodies
const SENSITIVE_BODY_KEYS = [
  'password',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'oldPassword',
  'secret',
  'apiKey',
  'api_key',
  'apiSecret',
  'api_secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'creditCard',
  'credit_card',
  'cardNumber',
  'card_number',
  'cvv',
  'cvc',
  'ssn',
  'socialSecurityNumber',
  'social_security_number',
  'pin',
  'bankAccount',
  'bank_account',
  'accountNumber',
  'account_number',
  'routingNumber',
  'routing_number',
  'privateKey',
  'private_key'
]

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

function resolveCorrelationId(req: Request): {
  correlationId: string
  source: 'header' | 'generated'
  rejectedHeader: boolean
} {
  const headerValue =
    getHeaderValue(req.headers[CORRELATION_ID_HEADER]) ??
    getHeaderValue(req.headers[REQUEST_ID_HEADER])
  const trimmed = headerValue?.trim()

  if (trimmed && CORRELATION_ID_PATTERN.test(trimmed)) {
    return { correlationId: trimmed, source: 'header', rejectedHeader: false }
  }

  return {
    correlationId: uuidv4(),
    source: 'generated',
    rejectedHeader: Boolean(trimmed)
  }
}

function redactSensitiveParams(query: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(query)) {
    const keyLower = key.toLowerCase()
    const isSensitive = SENSITIVE_PARAM_KEYS.some((sensitive) => keyLower.includes(sensitive))
    redacted[key] = isSensitive ? '[REDACTED]' : value
  }
  return redacted
}

function redactSensitiveBody(body: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 5) return { '[TRUNCATED]': 'Object too deep' }
  if (Buffer.isBuffer(body)) {
    return { type: 'Buffer', length: body.length }
  }
  if (Array.isArray(body)) {
    return body.map((item) => redactSensitiveBody(item, depth + 1))
  }
  if (!body || typeof body !== 'object') {
    return body
  }

  const redacted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const keyLower = key.toLowerCase()
    const isSensitive = SENSITIVE_BODY_KEYS.some(
      (sensitive) =>
        keyLower === sensitive.toLowerCase() || keyLower.includes(sensitive.toLowerCase())
    )

    if (isSensitive) {
      redacted[key] = '[REDACTED]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively redact nested objects
      redacted[key] = redactSensitiveBody(value, depth + 1)
    } else if (Array.isArray(value)) {
      // Redact arrays of objects
      redacted[key] = value.map((item) => redactSensitiveBody(item, depth + 1))
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

function truncateBody(body: unknown, maxLength = MAX_LOGGED_BODY_LENGTH): string {
  const stringified = JSON.stringify(body)
  if (stringified.length > maxLength) {
    return stringified.slice(0, maxLength) + '...[TRUNCATED]'
  }
  return stringified
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const { correlationId, source, rejectedHeader } = resolveCorrelationId(req)
  ;(req as Request & { correlationId: string }).correlationId = correlationId
  res.setHeader('X-Correlation-ID', correlationId)

  const log = createRequestLogger(correlationId)

  const start = Date.now()

  // Prepare redacted body for logging
  let redactedBody: unknown
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body) || typeof req.body !== 'object') {
      redactedBody = redactSensitiveBody(req.body)
    } else if (Object.keys(req.body as Record<string, unknown>).length > 0) {
      redactedBody = redactSensitiveBody(req.body)
    }
  }

  // Log incoming request with sensitive data redacted
  log.info('HTTP request received', {
    event: 'http.request',
    method: req.method,
    path: req.path,
    query: redactSensitiveParams(req.query as Record<string, unknown>),
    body: redactedBody ? truncateBody(redactedBody) : undefined,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    requestIdSource: source,
    rejectedRequestIdHeader: rejectedHeader
  })

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start

    log.info('HTTP response completed', {
      event: 'http.response',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration
    })
  })

  next()
}
