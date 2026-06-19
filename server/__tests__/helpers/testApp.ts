/**
 * Test application factory for route testing.
 *
 * Creates a minimal Express app with routes but without
 * database connections, rate limiting, or other production
 * middleware that would complicate testing.
 */
import express, { Express } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../../config'
import { errorHandler, notFoundHandler } from '../../middleware/errorHandler'
import { authMiddleware } from '../../middleware/authMiddleware'

// Import routes
import prospectsRouter from '../../routes/prospects'
import enrichmentRouter from '../../routes/enrichment'
import contactsRouter from '../../routes/contacts'
import dealsRouter from '../../routes/deals'

/**
 * Creates a test Express application with routes but minimal middleware.
 * Does not include rate limiting, logging, or database connections.
 */
export function createTestApp(): Express {
  const app = express()

  // Basic middleware
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Protected routes
  app.use('/api/prospects', authMiddleware, prospectsRouter)
  app.use('/api/enrichment', authMiddleware, enrichmentRouter)
  app.use('/api/contacts', authMiddleware, contactsRouter)
  app.use('/api/deals', authMiddleware, dealsRouter)

  // Error handling
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

/**
 * Generates a valid JWT token for testing.
 *
 * @param userId - The user ID to embed in the token
 * @param options - Optional email, role, orgId, and tier
 * @returns A valid JWT token string
 */
export function generateTestToken(
  userId: string = 'test-user-123',
  options: { email?: string; role?: string; orgId?: string | null; tier?: string } = {}
): string {
  const payload: Record<string, unknown> = {
    sub: userId,
    email: options.email || 'test@example.com',
    role: options.role || 'user'
  }

  // Mint the org_id claim used for multi-tenant isolation. Pass `orgId: null`
  // explicitly to simulate a token with no tenant binding (fail-closed paths).
  if (options.orgId !== null) {
    payload.org_id = options.orgId || 'test-org'
  }

  if (options.tier) {
    payload.tier = options.tier
  }

  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: '1h'
  })
}

/**
 * Creates an authorization header value for testing.
 *
 * @param userId - The user ID for the token
 * @param options - Optional email, role, orgId, and tier
 * @returns Authorization header value (Bearer token)
 */
export function createAuthHeader(
  userId: string = 'test-user-123',
  options: { email?: string; role?: string; orgId?: string | null; tier?: string } = {}
): string {
  return `Bearer ${generateTestToken(userId, options)}`
}
