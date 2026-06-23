/**
 * Server-side structured logging utility
 *
 * Provides consistent JSON logging with timestamps, levels, and context.
 * Designed for production use with log aggregation systems.
 */

import { config } from '../config'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  context?: LogContext
  error?: {
    name: string
    message: string
    stack?: string
  }
  correlationId?: string
}

// Sensitive keys are redacted from every structured log context. Keep this list
// broad because log context can be built from request, CLI, and integration data.
const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'creditCard',
  'ssn'
]

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
}

// Set log level based on environment
const envLogLevel = process.env.LOG_LEVEL as LogLevel | undefined
const minLogLevel: LogLevel =
  envLogLevel && LOG_LEVEL_PRIORITY[envLogLevel] !== undefined
    ? envLogLevel
    : config.server.env === 'production'
      ? 'info'
      : 'debug'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLogLevel]
}

function formatLogEntry(entry: LogEntry): string {
  // In production, output JSON for log aggregation
  if (config.server.env === 'production') {
    return JSON.stringify(entry)
  }

  // In development, output human-readable format
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : ''
  const errorStr = entry.error
    ? `\n  Error: ${entry.error.message}${entry.error.stack ? `\n  Stack: ${entry.error.stack}` : ''}`
    : ''
  const correlationStr = entry.correlationId ? ` [${entry.correlationId}]` : ''

  return `[${entry.timestamp}] [${entry.level.toUpperCase()}]${correlationStr} ${entry.message}${contextStr}${errorStr}`
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  }

  if (context && Object.keys(context).length > 0) {
    // Extract correlationId if present
    if (context.correlationId) {
      entry.correlationId = context.correlationId as string
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correlationId: _, ...rest } = context
      if (Object.keys(rest).length > 0) {
        entry.context = rest
      }
    } else {
      entry.context = context
    }
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      // Only include stack trace in non-production
      stack: config.server.env !== 'production' ? error.stack : undefined
    }
  }

  return entry
}

/**
 * Logger interface for consistent logging throughout the server
 */
export interface Logger {
  /** Log debug information (suppressed in production by default) */
  debug: (message: string, context?: LogContext) => void
  /** Log general information */
  info: (message: string, context?: LogContext) => void
  /** Log warnings */
  warn: (message: string, context?: LogContext) => void
  /** Log errors with optional Error object */
  error: (message: string, error?: Error, context?: LogContext) => void
  /** Create a child logger with additional context */
  child: (defaultContext: LogContext) => Logger
}

function createLogger(defaultContext?: LogContext): Logger {
  const mergeContext = (context?: LogContext): LogContext | undefined => {
    if (!defaultContext && !context) return undefined
    return sanitizeContext({ ...defaultContext, ...context })
  }

  return {
    debug: (message: string, context?: LogContext) => {
      if (!shouldLog('debug')) return
      const entry = createLogEntry('debug', message, mergeContext(context))
      console.debug(formatLogEntry(entry))
    },

    info: (message: string, context?: LogContext) => {
      if (!shouldLog('info')) return
      const entry = createLogEntry('info', message, mergeContext(context))
      console.info(formatLogEntry(entry))
    },

    warn: (message: string, context?: LogContext) => {
      if (!shouldLog('warn')) return
      const entry = createLogEntry('warn', message, mergeContext(context))
      console.warn(formatLogEntry(entry))
    },

    error: (message: string, error?: Error, context?: LogContext) => {
      if (!shouldLog('error')) return
      const entry = createLogEntry('error', message, mergeContext(context), error)
      console.error(formatLogEntry(entry))
    },

    child: (childContext: LogContext): Logger => {
      return createLogger({ ...defaultContext, ...childContext })
    }
  }
}

/**
 * Default logger instance
 *
 * @example
 * import { logger } from '../utils/logger'
 *
 * logger.debug('Processing request', { endpoint: '/api/prospects' })
 * logger.info('User authenticated', { userId: '123' })
 * logger.warn('Cache miss', { key: 'user:123' })
 * logger.error('Database query failed', error, { query: 'SELECT *' })
 */
export const logger: Logger = createLogger()

/**
 * Create a logger for a specific service or module
 *
 * @example
 * const dbLogger = createServiceLogger('Database')
 * dbLogger.info('Connection established', { host: 'localhost' })
 */
export function createServiceLogger(service: string): Logger {
  return createLogger({ service })
}

/**
 * Create a logger with request context
 *
 * @example
 * const reqLogger = createRequestLogger(req.correlationId)
 * reqLogger.info('Processing request')
 */
export function createRequestLogger(correlationId: string): Logger {
  return createLogger({ correlationId })
}

/**
 * Measure and log execution time of an async function
 *
 * @example
 * const result = await withTiming('databaseQuery', async () => {
 *   return await db.query('SELECT * FROM prospects')
 * }, { table: 'prospects' })
 */
export async function withTiming<T>(
  operation: string,
  fn: () => Promise<T>,
  context?: LogContext
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    const duration = Date.now() - start
    logger.debug(`${operation} completed`, { ...context, durationMs: duration })
    return result
  } catch (error) {
    const duration = Date.now() - start
    logger.error(`${operation} failed`, error as Error, {
      ...context,
      durationMs: duration
    })
    throw error
  }
}

/**
 * Sanitize sensitive data from log context
 */
export function sanitizeContext(context: LogContext): LogContext {
  const sanitized: LogContext = {}

  for (const [key, value] of Object.entries(context)) {
    const keyLower = key.toLowerCase()
    const isSensitive = SENSITIVE_KEYS.some((sensitive) =>
      keyLower.includes(sensitive.toLowerCase())
    )

    if (isSensitive) {
      sanitized[key] = '[REDACTED]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeContext(value as LogContext)
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item && typeof item === 'object' ? sanitizeContext(item as LogContext) : item
      )
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}
