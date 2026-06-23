import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServiceLogger } from '../../utils/logger'

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs error details with sanitized context', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logger = createServiceLogger('LoggerTest')

    logger.error('Operation failed', new Error('boom'), {
      correlationId: 'correlation-1',
      apiKey: 'secret-key',
      nested: {
        token: 'secret-token',
        safe: 'value'
      }
    })

    const serialized = String(consoleErrorSpy.mock.calls[0][0])
    expect(serialized).toContain('[ERROR]')
    expect(serialized).toContain('[correlation-1]')
    expect(serialized).toContain('Operation failed')
    expect(serialized).toContain('Error: boom')
    expect(serialized).toContain('"apiKey":"[REDACTED]"')
    expect(serialized).toContain('"token":"[REDACTED]"')
    expect(serialized).toContain('"safe":"value"')
  })
})
