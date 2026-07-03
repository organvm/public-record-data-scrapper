import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { config } from '../config'

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email?: string
    role?: string
    orgId?: string
    tier?: string
  }
}

interface JwtPayload {
  sub: string
  email?: string
  role?: string
  org_id?: string
  iat?: number
  exp?: number
  // Custom/namespaced claims (e.g. Auth0 'https://<app>/org_id') are read
  // dynamically by the claim resolvers below, so allow arbitrary keys.
  [claim: string]: unknown
}

/**
 * Coerce an arbitrary claim value to a non-empty string, or undefined.
 * Guards against object/array/number claim shapes that some IdPs emit.
 */
function asClaimString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  return undefined
}

/**
 * Resolve a namespaced custom claim from a decoded JWT.
 *
 * Auth0 (and other OIDC IdPs) emit custom claims under a namespace URI, e.g.
 * `https://app.example.com/org_id`. We check the configured (unprefixed) claim
 * name first, then fall back to any key whose suffix matches one of the
 * provided suffixes (case-insensitive). Returns the first non-empty string.
 */
function resolveNamespacedClaim(
  decoded: JwtPayload,
  primaryClaim: string,
  suffixes: string[]
): string | undefined {
  const direct = asClaimString(decoded[primaryClaim])
  if (direct !== undefined) return direct

  const lowerSuffixes = suffixes.map((s) => s.toLowerCase())
  for (const key of Object.keys(decoded)) {
    const lowerKey = key.toLowerCase()
    if (lowerSuffixes.some((suffix) => lowerKey.endsWith(suffix))) {
      const value = asClaimString(decoded[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

/**
 * Resolve the organization id from the configured claim plus namespaced
 * variants ending in /org_id or /orgId.
 */
function resolveOrgId(decoded: JwtPayload): string | undefined {
  return resolveNamespacedClaim(decoded, config.jwt.orgClaim, ['/org_id', '/orgid'])
}

/**
 * Resolve the subscription/plan tier from the configured claim plus namespaced
 * variants ending in /tier or /plan. Advisory: downstream entitlement code
 * decides whether to trust it.
 */
function resolveTier(decoded: JwtPayload): string | undefined {
  return resolveNamespacedClaim(decoded, config.jwt.tierClaim, [
    `/${config.jwt.tierClaim.toLowerCase()}`,
    '/tier',
    '/plan'
  ])
}

/**
 * Build the authenticated user object from a verified JWT payload, applying the
 * namespaced claim resolvers for org and tier.
 */
function buildUser(decoded: JwtPayload): NonNullable<AuthenticatedRequest['user']> {
  return {
    id: decoded.sub,
    email: asClaimString(decoded.email),
    role: asClaimString(decoded.role),
    orgId: resolveOrgId(decoded),
    tier: resolveTier(decoded)
  }
}

/**
 * Build the verify options for jsonwebtoken.
 * Always pins the signing algorithm to HS256 to prevent algorithm-confusion
 * attacks (e.g. the "alg: none" or RS256/HS256 key-confusion class). Issuer
 * and audience are pinned when configured.
 */
function getVerifyOptions(): jwt.VerifyOptions {
  const options: jwt.VerifyOptions = {
    algorithms: ['HS256']
  }
  if (config.jwt.issuer) {
    options.issuer = config.jwt.issuer
  }
  if (config.jwt.audience) {
    options.audience = config.jwt.audience
  }
  return options
}

/**
 * JWT authentication middleware.
 * Validates Bearer token from Authorization header.
 * Adds user info to request object if valid.
 */
export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const apiKeyHeader = req.headers['x-api-key']
  const authHeader = req.headers.authorization
  let token = ''

  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1]
    }
  }

  // Validate API key via header or bearer token
  if (config.server?.apiKey && (apiKeyHeader === config.server.apiKey || token === config.server.apiKey)) {
    req.user = {
      id: 'system-cli',
      role: 'admin',
      orgId: 'system' // System-level privileges for scripts/CLI
    }
    return next()
  }

  if (!authHeader) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No authorization header provided'
    })
  }

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid authorization header format. Expected: Bearer <token>'
    })
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret, getVerifyOptions()) as JwtPayload

    req.user = buildUser(decoded)

    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token has expired'
      })
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token'
      })
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed'
    })
  }
}

/**
 * Optional authentication middleware.
 * Adds user info to request if valid token provided, but doesn't require it.
 */
export const optionalAuthMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const apiKeyHeader = req.headers['x-api-key']
  const authHeader = req.headers.authorization
  let token = ''

  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1]
    }
  }

  // Validate API key via header or bearer token
  if (config.server?.apiKey && (apiKeyHeader === config.server.apiKey || token === config.server.apiKey)) {
    req.user = {
      id: 'system-cli',
      role: 'admin',
      orgId: 'system' // System-level privileges for scripts/CLI
    }
    return next()
  }

  if (!authHeader || !token) {
    return next()
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret, getVerifyOptions()) as JwtPayload

    req.user = buildUser(decoded)
  } catch {
    // Ignore invalid tokens for optional auth
  }

  next()
}

/**
 * Role-based authorization middleware.
 * Requires authMiddleware to run first.
 * @param allowedRoles - Array of roles allowed to access the route
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      })
    }

    if (!req.user.role || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      })
    }

    next()
  }
}
