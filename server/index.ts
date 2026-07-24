import express, { Express, Request, Response } from 'express'
import type { Server as HttpServer } from 'http'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import swaggerUi from 'swagger-ui-express'
import YAML from 'yamljs'
import { config, validateConfig } from './config'
import { database } from './database/connection'
import { errorHandler, notFoundHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
import { createRateLimiter, closeRateLimiterConnection } from './middleware/rateLimiter'
import { authMiddleware, requireRole } from './middleware/authMiddleware'
import { apiKeyOrJwtAuth } from './middleware/apiKeyAuth'
import { orgContextMiddleware } from './middleware/orgContext'
import { httpsRedirect } from './middleware/httpsRedirect'
import { dataTierRouter } from './middleware/dataTier'
import { auditMiddleware } from './middleware/auditMiddleware'
import { createServiceLogger } from './utils/logger'

// Import routes
import prospectsRouter from './routes/prospects'
import competitorsRouter from './routes/competitors'
import portfolioRouter from './routes/portfolio'
import enrichmentRouter from './routes/enrichment'
import healthRouter from './routes/health'
import jobsRouter from './routes/jobs'
import contactsRouter from './routes/contacts'
import dealsRouter from './routes/deals'
import webhooksRouter from './routes/webhooks'
import apiKeysRouter from './routes/apiKeys'
import billingRouter from './routes/billing'
import statusRouter from './routes/status'
import competitiveRouter from './routes/competitive'
import outreachRouter from './routes/outreach'
import communicationsRouter from './routes/communications'
import complianceRouter from './routes/compliance'
import discoveryRouter from './routes/discovery'
import metricsRouter from './routes/metrics'
import agenticRouter from './routes/agentic'
import scrapeRouter from './routes/scrape'
import underwritingRouter from './routes/underwriting'

// Import queue infrastructure
import {
  initializeQueues,
  closeQueues,
  initTelemetryPersistence,
  hydrateTelemetryFromDatabase
} from './queue/queues'
import { jobScheduler } from './queue/scheduler'
import { redisConnection } from './queue/connection'

const serverLogger = createServiceLogger('Server')

export class Server {
  private app: Express
  private httpServer: HttpServer | null = null
  private shuttingDown = false

  constructor() {
    this.app = express()
    this.setupMiddleware()
    this.setupRoutes()
    this.setupErrorHandling()
  }

  private setupMiddleware(): void {
    // Trust proxy configuration. Controls whether Express derives req.ip /
    // req.secure / req.protocol from X-Forwarded-* headers. Defaults to false
    // (do not trust) and must be opted into when running behind a known proxy
    // (ALB/Nginx). Rate limiting and HTTPS redirect rely on this being correct.
    this.app.set('trust proxy', config.app.trustProxy)

    // HTTPS redirect (before everything else in production)
    this.app.use(httpsRedirect)

    // Security headers
    this.app.use(helmet())
    this.app.use(
      cors({
        origin: config.cors.origin,
        credentials: config.cors.credentials
      })
    )

    // Raw body middleware for webhooks (must be before JSON parser)
    // This preserves the raw body for signature verification
    this.app.use(
      '/api/webhooks',
      express.raw({
        type: 'application/json',
        limit: '1mb',
        verify: (req: Request, res: Response, buf: Buffer) => {
          // Store raw body for signature verification
          ;(req as Request & { rawBody?: Buffer }).rawBody = buf
        }
      })
    )

    // Parsing for webhook form data (Twilio sends as x-www-form-urlencoded)
    this.app.use('/api/webhooks', express.urlencoded({ extended: true, limit: '1mb' }))

    // Billing (Stripe) webhook + routes: Stripe signatures are verified against
    // the RAW request body, so this path must NOT be JSON-parsed. Mount raw body
    // parsing before the global JSON parser. The billing route handler receives
    // req.body as a Buffer and passes it to Stripe's constructEvent.
    this.app.use('/api/billing', express.raw({ type: 'application/json', limit: '1mb' }))

    // Parsing (for all other routes). Default to a conservative 1mb limit; the
    // larger 10mb allowance is only granted on the specific routes that ingest
    // bulk payloads (e.g. enrichment uploads). Keeping the global default small
    // limits the blast radius of oversized-body / memory-exhaustion abuse.
    this.app.use(express.json({ limit: '1mb' }))
    this.app.use(express.urlencoded({ extended: true, limit: '1mb' }))

    // Compression
    this.app.use(compression())

    // Logging
    this.app.use(requestLogger)

    // NOTE: dataTierRouter is deliberately NOT mounted here (#348). Tier
    // resolution reads req.user (JWT tier claim, then the org's
    // subscription_tier), and req.user is populated by the per-route
    // authMiddleware — a global pre-auth mount always resolved free-tier,
    // which silently applied the free-tier min-score floor to every caller.
    // It is mounted per-route AFTER auth in setupRoutes().

    // Rate limiting (Redis-based in production, in-memory in development)
    this.app.use(createRateLimiter())

    // Audit logging for compliance tracking
    this.app.use(auditMiddleware)
  }

  private setupRoutes(): void {
    // Public routes have no authenticated entitlement context, so resolve them
    // explicitly as free-tier and expose that decision on every response. Keep
    // these mounts path-scoped: mounting dataTierRouter globally would run
    // before auth and incorrectly freeze protected requests at free-tier.
    this.app.use('/api/docs', dataTierRouter)

    // Swagger UI documentation
    this.setupSwaggerDocs()

    // Public status page (no auth, bookmarkable)
    this.app.use('/status', dataTierRouter)
    this.app.use(statusRouter)

    // Public routes (no authentication required). dataTierRouter resolves
    // free-tier here (no req.user) — explicit, and keeps health's tier read
    // honest rather than relying on the fail-closed accessor default.
    this.app.use('/api/health', dataTierRouter, healthRouter)

    // Webhook routes (signature verification, no JWT auth)
    this.app.use('/api/webhooks', dataTierRouter, webhooksRouter)

    // Metrics (self-protecting: valid JWT OR METRICS_TOKEN; 401 when neither —
    // must NOT sit behind the global authMiddleware or the token scrape path breaks)
    this.app.use('/api/metrics', dataTierRouter, metricsRouter)

    // Billing routes (Stripe). The webhook is authenticated via Stripe signature
    // verification on the raw body (mounted above), not JWT.
    this.app.use('/api/billing', dataTierRouter, billingRouter)

    // Protected API routes (authentication required).
    // orgContextMiddleware runs AFTER authMiddleware (so req.user.orgId is
    // populated) and BEFORE the routers, binding the tenant context that the
    // core DB client uses to SET app.current_org_id for RLS (migration 018).
    // dataTierRouter likewise runs AFTER authMiddleware (#348): it resolves the
    // entitlement from req.user (tier claim, then the org's subscription_tier),
    // so mounted pre-auth it always failed closed to free-tier — which silently
    // applied the free-tier min-score floor to every authenticated caller.
    this.app.use('/api/prospects', authMiddleware, orgContextMiddleware, dataTierRouter, prospectsRouter)
    this.app.use('/api/competitors', authMiddleware, orgContextMiddleware, dataTierRouter, competitorsRouter)
    this.app.use('/api/portfolio', authMiddleware, orgContextMiddleware, dataTierRouter, portfolioRouter)
    this.app.use('/api/enrichment', authMiddleware, orgContextMiddleware, dataTierRouter, enrichmentRouter)
    this.app.use('/api/jobs', authMiddleware, orgContextMiddleware, dataTierRouter, jobsRouter)
    this.app.use('/api/contacts', authMiddleware, orgContextMiddleware, dataTierRouter, contactsRouter)
    this.app.use('/api/deals', authMiddleware, orgContextMiddleware, dataTierRouter, dealsRouter)
    this.app.use('/api/competitive', authMiddleware, orgContextMiddleware, dataTierRouter, competitiveRouter)
    this.app.use('/api/outreach', authMiddleware, orgContextMiddleware, dataTierRouter, outreachRouter)
    this.app.use('/api/communications', authMiddleware, orgContextMiddleware, dataTierRouter, communicationsRouter)
    this.app.use('/api/compliance', authMiddleware, orgContextMiddleware, dataTierRouter, complianceRouter)
    this.app.use('/api/discovery', authMiddleware, orgContextMiddleware, dataTierRouter, discoveryRouter)
    this.app.use('/api/agentic', authMiddleware, orgContextMiddleware, dataTierRouter, agenticRouter)
    this.app.use('/api/underwriting', authMiddleware, orgContextMiddleware, dataTierRouter, underwritingRouter)
    // API key management (JWT + admin only - API keys must not be able to mint more keys)
    this.app.use(
      '/api/keys',
      authMiddleware,
      requireRole('admin'),
      orgContextMiddleware,
      dataTierRouter,
      apiKeysRouter
    )
    // scrape authenticates via API key OR JWT — either way req.user carries the
    // org/tier context by the time dataTierRouter resolves.
    this.app.use('/api/scrape', apiKeyOrJwtAuth, dataTierRouter, scrapeRouter)

    // Root endpoint
    this.app.get('/', dataTierRouter, (req, res) => {
      res.json({
        name: 'UCC-MCA Intelligence API',
        version: '1.0.0',
        status: 'ok',
        documentation: '/api/docs',
        endpoints: {
          prospects: '/api/prospects',
          competitors: '/api/competitors',
          portfolio: '/api/portfolio',
          enrichment: '/api/enrichment',
          health: '/api/health',
          jobs: '/api/jobs',
          contacts: '/api/contacts',
          deals: '/api/deals',
          competitive: '/api/competitive',
          outreach: '/api/outreach',
          communications: '/api/communications',
          compliance: '/api/compliance',
          discovery: '/api/discovery',
          scrape: '/api/scrape',
          keys: '/api/keys',
          metrics: '/api/metrics',
          webhooks: '/api/webhooks'
        }
      })
    })
  }

  private setupSwaggerDocs(): void {
    try {
      // Load OpenAPI spec from YAML file — use import.meta.url for ESM compat
      const __server_dir = path.dirname(fileURLToPath(import.meta.url))
      const openApiPath = path.join(__server_dir, 'openapi.yaml')

      if (fs.existsSync(openApiPath)) {
        const openApiSpec = YAML.load(openApiPath)

        // Swagger UI options
        const swaggerOptions: swaggerUi.SwaggerUiOptions = {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: 'UCC-MCA Intelligence API Docs',
          swaggerOptions: {
            persistAuthorization: true,
            displayRequestDuration: true,
            filter: true,
            showExtensions: true,
            showCommonExtensions: true
          }
        }

        // Serve Swagger UI at /api/docs
        this.app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, swaggerOptions))

        // Serve raw OpenAPI spec as JSON
        this.app.get('/api/docs/openapi.json', (req, res) => {
          res.json(openApiSpec)
        })

        // Serve raw OpenAPI spec as YAML
        this.app.get('/api/docs/openapi.yaml', (req, res) => {
          res.type('text/yaml').sendFile(openApiPath)
        })

        serverLogger.info('Swagger UI enabled', { path: '/api/docs' })
      } else {
        serverLogger.warn('OpenAPI spec not found', { openApiPath })

        // Serve placeholder when spec is missing
        this.app.get('/api/docs', (req, res) => {
          res.status(503).json({
            error: 'API documentation not available',
            message: 'OpenAPI specification file not found'
          })
        })
      }
    } catch (error) {
      serverLogger.error('Failed to load OpenAPI spec', toError(error))

      // Serve error message when spec fails to load
      this.app.get('/api/docs', (req, res) => {
        res.status(503).json({
          error: 'API documentation not available',
          message: 'Failed to load OpenAPI specification'
        })
      })
    }
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use(notFoundHandler)

    // Global error handler
    this.app.use(errorHandler)
  }

  async start(): Promise<void> {
    const port = config.server.port
    const host = config.server.host

    // Validate configuration
    try {
      validateConfig()
    } catch (error) {
      serverLogger.error('Configuration validation failed', toError(error))
      process.exit(1)
    }

    // Connect to database
    try {
      await database.connect()
    } catch (error) {
      serverLogger.error('Failed to connect to database', toError(error))
      process.exit(1)
    }

    // Initialize telemetry persistence and hydrate from database
    initTelemetryPersistence(database)
    if (config.telemetry.skipHydration) {
      serverLogger.warn('Telemetry startup hydration skipped by config')
    } else {
      const hydratedCount = await hydrateTelemetryFromDatabase({
        historyLimitPerState: config.telemetry.hydrateHistoryLimit
      })
      serverLogger.info('Telemetry hydrated from database', { hydratedCount })
    }

    // Initialize job queues
    try {
      initializeQueues()
    } catch (error) {
      serverLogger.error('Failed to initialize job queues', toError(error))
      process.exit(1)
    }

    // Start job scheduler
    try {
      await jobScheduler.start()
    } catch (error) {
      serverLogger.error('Failed to start job scheduler', toError(error))
      process.exit(1)
    }

    // Start server (retain the HTTP server handle so we can drain it on shutdown)
    this.httpServer = this.app.listen(port, host, () => {
      serverLogger.info('Server started', {
        env: config.server.env,
        host,
        port,
        healthUrl: `http://${host}:${port}/api/health`,
        jobsUrl: `http://${host}:${port}/api/jobs`,
        docsUrl: `http://${host}:${port}/api/docs`,
        database: this.maskConnectionString(config.database.url),
        redis: `${config.redis.host}:${config.redis.port}`
      })
    })
  }

  async shutdown(signal?: string): Promise<void> {
    // Guard against repeated SIGTERM/SIGINT triggering concurrent shutdowns.
    if (this.shuttingDown) {
      serverLogger.warn('Shutdown already in progress, ignoring duplicate signal', { signal })
      return
    }
    this.shuttingDown = true

    serverLogger.info('Server shutdown started', { signal })

    // Force exit if graceful shutdown hangs (e.g. a connection won't drain).
    const forceExitTimer = setTimeout(() => {
      serverLogger.error('Graceful shutdown timed out after 30s, forcing exit')
      process.exit(1)
    }, 30_000)
    forceExitTimer.unref()

    try {
      // Stop accepting new connections and drain in-flight HTTP requests.
      if (this.httpServer) {
        await new Promise<void>((resolve, reject) => {
          this.httpServer!.close((err) => (err ? reject(err) : resolve()))
        })
      }

      // Stop job scheduler
      jobScheduler.stop()

      // Close queues
      await closeQueues()

      // Close rate limiter Redis connection
      await closeRateLimiterConnection()

      // Disconnect from Redis
      await redisConnection.disconnect()

      // Disconnect from database
      await database.disconnect()

      serverLogger.info('Server shutdown complete')
      clearTimeout(forceExitTimer)
      process.exit(0)
    } catch (error) {
      serverLogger.error('Error during shutdown', toError(error))
      clearTimeout(forceExitTimer)
      process.exit(1)
    }
  }

  private maskConnectionString(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`
    } catch {
      return 'postgresql://***:***@***/***'
    }
  }

  getApp(): Express {
    return this.app
  }
}

/**
 * Build the Express app for a SERVERLESS host (e.g. a Vercel Node function).
 *
 * Unlike `Server.start()`, this does NOT bind a port, start the BullMQ workers,
 * or the cron scheduler — a serverless function is request-scoped and the
 * background workers run elsewhere. It makes a single best-effort database
 * connection (memoized across warm invocations) so DB-backed routes work when
 * `DATABASE_URL` is configured; if the connection is absent or fails, those
 * routes fail closed through the normal error handler rather than hanging.
 *
 * The promise is cached so a warm Lambda/Vercel container reuses one app + pool.
 */
let serverlessAppPromise: Promise<Express> | null = null
export function getServerlessApp(): Promise<Express> {
  if (!serverlessAppPromise) {
    serverlessAppPromise = (async () => {
      const server = new Server()
      if (process.env.DATABASE_URL) {
        try {
          await database.connect()
        } catch (error) {
          console.error(
            '[serverless] database connect failed; DB-backed routes will return errors:',
            error
          )
        }
      } else {
        console.warn(
          '[serverless] DATABASE_URL not set; only stateless routes (health, docs) will work.'
        )
      }
      return server.getApp()
    })()
  }
  return serverlessAppPromise
}

// Start the server only when this module is executed directly — never on
// import (e.g. by tests or tooling). The esbuild bundle (scripts/build-server.mjs)
// shims `import.meta.url` to `pathToFileURL(__filename)`, so this guard holds in
// both the bundled CJS entrypoint (`node dist/server.cjs`) and the raw ESM source
// (`tsx server/index.ts`); importing the module yields the `Server` class with no
// side effects.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  const server = new Server()
  server.start().catch((error) => {
    serverLogger.error('Fatal error during server startup', toError(error))
    process.exit(1)
  })

  // Graceful shutdown on termination signals (guarded against duplicates inside
  // shutdown()).
  process.on('SIGTERM', () => {
    void server.shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    void server.shutdown('SIGINT')
  })

  // Process-level safety nets: log loudly and shut down cleanly rather than
  // leaving the process in an undefined state.
  process.on('unhandledRejection', (reason) => {
    serverLogger.error('Unhandled promise rejection', toError(reason))
    void server.shutdown('unhandledRejection')
  })
  process.on('uncaughtException', (error) => {
    serverLogger.error('Uncaught exception', toError(error))
    void server.shutdown('uncaughtException')
  })
}

export default Server

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
