/**
 * Structured Logging with Winston
 *
 * Provides centralized logging with:
 * - Multiple transport options (console, file, remote)
 * - Log levels (error, warn, info, debug)
 * - Structured JSON logging
 * - Correlation IDs for request tracking
 * - Performance metrics
 * - Log rotation
 */

import winston from 'winston'
import { v4 as uuidv4 } from 'uuid'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'

export interface LogMetadata {
  correlationId?: string
  userId?: string
  service?: string
  duration?: number | string
  statusCode?: number
  [key: string]: unknown
}

/**
 * Custom log format
 */
const customFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.metadata(),
  winston.format.json()
)

/**
 * Console format for development
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf((info: Record<string, unknown>) => {
    const { timestamp, level, message, metadata, ...rest } = info as {
      timestamp?: unknown
      level?: unknown
      message?: unknown
      metadata?: Record<string, unknown>
      [key: string]: unknown
    }

    // winston.format.metadata() collects user-provided fields (correlationId,
    // userId, etc.) under a nested `metadata` key. The previous printf only
    // spread the top-level fields, so those values never reached the console.
    // Merge the nested metadata back in (plus any stray top-level extras) so
    // correlationId/userId are always visible.
    const meta: Record<string, unknown> = {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      ...rest
    }

    let metaStr = ''
    if (Object.keys(meta).length > 0) {
      metaStr = `\n${JSON.stringify(meta, null, 2)}`
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`
  })
)

/**
 * Create Winston logger instance
 */
function createLogger(): winston.Logger {
  const env = process.env.NODE_ENV || 'development'
  const logLevel = process.env.LOG_LEVEL || (env === 'production' ? 'info' : 'debug')

  const transports: winston.Transport[] = []

  // Console transport (always enabled)
  transports.push(
    new winston.transports.Console({
      format: env === 'production' ? customFormat : consoleFormat,
      level: logLevel
    })
  )

  // File transport (production)
  if (env === 'production') {
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: customFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 10
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: customFormat,
        maxsize: 10485760, // 10MB
        maxFiles: 10
      })
    )
  }

  return winston.createLogger({
    level: logLevel,
    format: customFormat,
    transports,
    exitOnError: false
  })
}

/**
 * Logger class with enhanced functionality
 */
export class Logger {
  private winston: winston.Logger
  private defaultMetadata: LogMetadata = {}

  constructor() {
    this.winston = createLogger()
  }

  /**
   * Set default metadata for all logs
   */
  setDefaultMetadata(metadata: LogMetadata): void {
    this.defaultMetadata = { ...this.defaultMetadata, ...metadata }
  }

  /**
   * Log error
   */
  error(message: string, metadata?: LogMetadata): void {
    this.winston.error(message, { ...this.defaultMetadata, ...metadata })
  }

  /**
   * Log warning
   */
  warn(message: string, metadata?: LogMetadata): void {
    this.winston.warn(message, { ...this.defaultMetadata, ...metadata })
  }

  /**
   * Log info
   */
  info(message: string, metadata?: LogMetadata): void {
    this.winston.info(message, { ...this.defaultMetadata, ...metadata })
  }

  /**
   * Log debug
   */
  debug(message: string, metadata?: LogMetadata): void {
    this.winston.debug(message, { ...this.defaultMetadata, ...metadata })
  }

  /**
   * Log with correlation ID
   */
  withCorrelation(correlationId: string): CorrelatedLogger {
    return new CorrelatedLogger(this, correlationId)
  }

  /**
   * Create child logger with additional metadata
   */
  child(metadata: LogMetadata): Logger {
    const childLogger = new Logger()
    childLogger.setDefaultMetadata({ ...this.defaultMetadata, ...metadata })
    return childLogger
  }

  /**
   * Log HTTP request
   */
  logRequest(
    req: {
      method: string
      url: string
      headers?: unknown
      body?: unknown
    },
    metadata?: LogMetadata
  ): void {
    this.info('HTTP Request', {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Log HTTP response
   */
  logResponse(
    res: {
      statusCode: number
      duration: number
    },
    metadata?: LogMetadata
  ): void {
    this.info('HTTP Response', {
      statusCode: res.statusCode,
      duration: `${res.duration}ms`,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Log performance metric
   */
  logPerformance(operation: string, duration: number, metadata?: LogMetadata): void {
    const level = duration > 1000 ? 'warn' : 'info'
    this.winston.log(level, `Performance: ${operation}`, {
      operation,
      duration: `${duration}ms`,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Log database query
   */
  logQuery(query: string, duration: number, metadata?: LogMetadata): void {
    this.debug('Database Query', {
      query,
      duration: `${duration}ms`,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Log external API call
   */
  logAPICall(
    api: string,
    endpoint: string,
    duration: number,
    statusCode?: number,
    metadata?: LogMetadata
  ): void {
    this.info('External API Call', {
      api,
      endpoint,
      duration: `${duration}ms`,
      statusCode,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Log cache operation
   */
  logCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'del',
    key: string,
    metadata?: LogMetadata
  ): void {
    this.debug('Cache Operation', {
      operation,
      key,
      ...this.defaultMetadata,
      ...metadata
    })
  }

  /**
   * Measure and log operation duration
   */
  async measureAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: LogMetadata
  ): Promise<T> {
    const startTime = Date.now()

    try {
      const result = await fn()
      const duration = Date.now() - startTime
      this.logPerformance(operation, duration, metadata)
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      this.error(`${operation} failed`, {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...this.defaultMetadata,
        ...metadata
      })
      throw error
    }
  }

  /**
   * Measure and log synchronous operation duration
   */
  measure<T>(operation: string, fn: () => T, metadata?: LogMetadata): T {
    const startTime = Date.now()

    try {
      const result = fn()
      const duration = Date.now() - startTime
      this.logPerformance(operation, duration, metadata)
      return result
    } catch (error) {
      const duration = Date.now() - startTime
      this.error(`${operation} failed`, {
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
        ...this.defaultMetadata,
        ...metadata
      })
      throw error
    }
  }
}

/**
 * Correlated logger for tracking requests
 */
export class CorrelatedLogger {
  constructor(
    private logger: Logger,
    private correlationId: string
  ) {}

  error(message: string, metadata?: LogMetadata): void {
    this.logger.error(message, { ...metadata, correlationId: this.correlationId })
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.logger.warn(message, { ...metadata, correlationId: this.correlationId })
  }

  info(message: string, metadata?: LogMetadata): void {
    this.logger.info(message, { ...metadata, correlationId: this.correlationId })
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.logger.debug(message, { ...metadata, correlationId: this.correlationId })
  }
}

/**
 * Generate correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4()
}

/**
 * Singleton logger instance
 */
export const logger = new Logger()

/**
 * Set service name for all logs
 */
export function setServiceName(serviceName: string): void {
  logger.setDefaultMetadata({ service: serviceName })
}

/**
 * Create middleware for Express to add correlation IDs
 */
export function correlationMiddleware(
  req: {
    method: string
    url: string
    headers: Record<string, string | string[] | undefined>
    correlationId?: string
  },
  res: {
    statusCode: number
    setHeader: (name: string, value: string) => void
    on: (event: 'finish', listener: () => void) => void
  },
  next: () => void
): void {
  const headerValue = req.headers['x-correlation-id']
  const correlationId =
    (Array.isArray(headerValue) ? headerValue[0] : headerValue) || generateCorrelationId()
  req.correlationId = correlationId
  res.setHeader('X-Correlation-ID', correlationId)

  // Log request
  logger.logRequest(
    {
      method: req.method,
      url: req.url,
      headers: req.headers
    },
    { correlationId }
  )

  // Track response time
  const startTime = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - startTime
    logger.logResponse(
      {
        statusCode: res.statusCode,
        duration
      },
      { correlationId }
    )
  })

  next()
}

/**
 * Audit log for security-sensitive operations
 */
export function auditLog(
  action: string,
  userId: string,
  resource: string,
  details?: unknown
): void {
  logger.info('Audit Log', {
    audit: true,
    action,
    userId,
    resource,
    details,
    timestamp: new Date().toISOString()
  })
}

/**
 * Error logging with stack trace
 */
export function logError(error: Error, context?: LogMetadata): void {
  logger.error(error.message, {
    stack: error.stack,
    name: error.name,
    ...context
  })
}

/**
 * Success logging for important operations
 */
export function logSuccess(operation: string, metadata?: LogMetadata): void {
  logger.info(`✓ ${operation}`, metadata)
}

/**
 * Failure logging for important operations
 */
export function logFailure(operation: string, error: Error, metadata?: LogMetadata): void {
  logger.error(`✗ ${operation}`, {
    error: error.message,
    stack: error.stack,
    ...metadata
  })
}

export default logger
