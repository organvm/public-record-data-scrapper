# UCC-MCA Intelligence API Server

Express.js REST API backend for the UCC-MCA Intelligence Platform.

## Directory Structure

```
server/
├── config/              # Configuration files
│   └── index.ts        # Server configuration
├── database/           # Database connection and utilities
│   └── connection.ts   # PostgreSQL connection pool
├── middleware/         # Express middleware
│   ├── errorHandler.ts      # Global error handling
│   ├── requestLogger.ts     # Request logging with correlation IDs
│   ├── rateLimiter.ts       # Rate limiting
│   └── validateRequest.ts   # Zod schema validation
├── queue/              # Job queue system (BullMQ + Redis)
│   ├── connection.ts        # Redis connection manager
│   ├── queues.ts           # Queue definitions
│   ├── scheduler.ts        # Recurring job scheduler
│   ├── workers/            # Worker implementations
│   │   ├── ingestionWorker.ts   # UCC data ingestion
│   │   ├── enrichmentWorker.ts  # Data enrichment
│   │   └── healthWorker.ts      # Health score calculations
│   └── README.md           # Queue system documentation
├── routes/             # API route handlers
│   ├── prospects.ts    # Prospect endpoints
│   ├── competitors.ts  # Competitor intelligence endpoints
│   ├── portfolio.ts    # Portfolio company endpoints
│   ├── enrichment.ts   # Data enrichment endpoints
│   ├── jobs.ts         # Job queue monitoring endpoints
│   └── health.ts       # Health check endpoints
├── services/           # Business logic layer
│   ├── ProspectsService.ts      # Prospect operations
│   ├── CompetitorsService.ts    # Competitor analysis
│   ├── PortfolioService.ts      # Portfolio management
│   └── EnrichmentService.ts     # Data enrichment
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
├── index.ts            # API server entry point
├── worker.ts           # Worker process entry point
├── tsconfig.json       # TypeScript configuration
└── README.md           # This file
```

## API Endpoints

### Health Checks

- `GET /api/health` - Basic health check
- `GET /api/health/detailed` - Detailed health with dependencies
- `GET /api/health/ready` - Kubernetes readiness probe
- `GET /api/health/live` - Kubernetes liveness probe

### Prospects

- `GET /api/prospects` - List prospects (paginated, filtered, sorted)
- `GET /api/prospects/:id` - Get prospect details
- `POST /api/prospects` - Create prospect
- `PATCH /api/prospects/:id` - Update prospect
- `DELETE /api/prospects/:id` - Delete prospect

### Competitors

- `GET /api/competitors` - List competitors (paginated, filtered, sorted)
- `GET /api/competitors/:id` - Get competitor details
- `GET /api/competitors/:id/analysis` - Get SWOT analysis
- `GET /api/competitors/stats` - Get competitor statistics

### Portfolio

- `GET /api/portfolio` - List portfolio companies (paginated, filtered, sorted)
- `GET /api/portfolio/:id` - Get portfolio company details
- `GET /api/portfolio/:id/health-history` - Get health score history
- `GET /api/portfolio/stats` - Get portfolio statistics

### Enrichment

- `POST /api/enrichment/prospect` - Enrich single prospect
- `POST /api/enrichment/batch` - Batch enrich prospects
- `POST /api/enrichment/refresh` - Trigger data refresh
- `GET /api/enrichment/status` - Get enrichment pipeline status
- `GET /api/enrichment/queue` - Get enrichment queue status

### Job Queue

- `POST /api/jobs/ingestion` - Trigger UCC ingestion job
- `POST /api/jobs/enrichment` - Trigger enrichment job
- `POST /api/jobs/health-scores` - Trigger health score calculation
- `GET /api/jobs/:jobId` - Get job status
- `GET /api/jobs/queues/stats` - Get queue statistics
- `GET /api/jobs/queues/:queueName` - List jobs in queue
- `DELETE /api/jobs/:jobId` - Remove job from queue

## Environment Variables

See `.env.example` in the project root for all available environment variables.

Required variables:

- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

Optional tiered integration variables (used when routing by `x-data-tier`):

- `FREE_TIER_DNB_API_KEY`, `STARTER_TIER_DNB_API_KEY`
- `FREE_TIER_GOOGLE_PLACES_API_KEY`, `STARTER_TIER_GOOGLE_PLACES_API_KEY`
- `FREE_TIER_CLEARBIT_API_KEY`, `STARTER_TIER_CLEARBIT_API_KEY`
- `FREE_TIER_NEWS_API_KEY`, `STARTER_TIER_NEWS_API_KEY`
- `FREE_TIER_CSC_UCC_API_KEY`, `STARTER_TIER_CSC_UCC_API_KEY`
- `FREE_TIER_CSC_UCC_USERNAME`, `STARTER_TIER_CSC_UCC_USERNAME`
- `FREE_TIER_CTCORP_API_KEY`, `STARTER_TIER_CTCORP_API_KEY`
- `FREE_TIER_LEXISNEXIS_API_KEY`, `STARTER_TIER_LEXISNEXIS_API_KEY`
- `FREE_TIER_LEXISNEXIS_CUSTOMER_ID`, `STARTER_TIER_LEXISNEXIS_CUSTOMER_ID`

If tiered variables are unset, the server falls back to the non-tiered env vars
(e.g., `DNB_API_KEY`, `GOOGLE_PLACES_API_KEY`).

## Data Tiering

The server routes requests by `x-data-tier`. OSS/free values resolve to `free-tier`,
paid values resolve to `starter-tier`, and responses include `x-data-tier-resolved`.

Tier limits/filters:

- Prospects: free-tier clamps `limit` to 20 and enforces `min_score >= 70`; starter-tier allows up to 100.
- Competitors: free-tier clamps `limit` to 20 and requires at least 3 filings per competitor; starter-tier allows up to 100 with no minimum.
- UCC ingestion selects a provider (CSC/CTCorp/LexisNexis) per tier when credentials are present; the chosen `uccProvider` is stored in job data and surfaced via `/api/jobs/:jobId`.

Job workers (ingestion/health/enrichment) resolve tiered integrations using the
same env mapping and log which integrations are enabled per tier.

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 6+ (required for job queue system)

### Installation

```bash
# Install dependencies (from project root)
npm install --legacy-peer-deps
```

### Database Setup

```bash
# Create database
createdb ucc_intelligence

# Run migrations
npm run migrate

# Check migration status
npm run migrate:status
```

### Development

```bash
# Run backend server only
npm run dev:server

# Run worker process only (requires Redis)
npm run dev:worker

# Run frontend + backend
npm run dev:all

# Run frontend + backend + workers (full stack)
npm run dev:all
```

The server will start on http://localhost:3000

**Note:** The `dev:all` script now includes the worker process. Make sure Redis is running before starting the full stack.

### Production Build

```bash
# Build backend
npm run build:server

# Start production server (API only)
npm run start:server

# Start production worker process (separate terminal/process)
npm run start:worker
```

For production deployments, run the server and worker as separate processes. This allows independent scaling and resource allocation.

## Architecture

### Request Flow

```
Client Request
  ↓
[Rate Limiter] → 429 if exceeded
  ↓
[Request Logger] → Assigns correlation ID
  ↓
[Route Handler] → Express router
  ↓
[Validation Middleware] → Zod schema validation
  ↓
[Service Layer] → Business logic
  ↓
[Database] → PostgreSQL queries
  ↓
[Response] → JSON response
  ↓
[Error Handler] → Global error catching
```

### Error Handling

All errors are caught by the global error handler and returned in a consistent format:

```json
{
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "statusCode": 400,
    "correlationId": "uuid-here"
  }
}
```

### Validation

All request data is validated using Zod schemas. Invalid requests return 400 with details:

```json
{
  "error": {
    "message": "Validation failed",
    "code": "VALIDATION_ERROR",
    "statusCode": 400,
    "details": [
      {
        "field": "company_name",
        "message": "String must contain at least 1 character(s)"
      }
    ]
  }
}
```

### Rate Limiting

Default rate limit: 100 requests per 15 minutes per IP address.

Response headers:

- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Timestamp when limit resets
- `Retry-After` - Seconds until retry (when limited)

## Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## Logging

All requests are logged with:

- Timestamp
- Correlation ID (UUID)
- HTTP method and path
- Status code
- Response time

Example log:

```
[REQUEST] {
  timestamp: '2025-01-17T10:30:00.000Z',
  correlationId: 'abc-123',
  method: 'GET',
  path: '/api/prospects',
  ip: '127.0.0.1'
}
[RESPONSE] {
  timestamp: '2025-01-17T10:30:00.150Z',
  correlationId: 'abc-123',
  method: 'GET',
  path: '/api/prospects',
  statusCode: 200,
  duration: '150ms'
}
```

## Job Queue System

The backend includes a BullMQ-based job queue system for background processing and scheduled tasks.

### Queues

1. **UCC Ingestion Queue** - Processes state-by-state UCC filing data ingestion
   - Schedule: Daily at 2:00 AM
   - Concurrency: 2 jobs

2. **Data Enrichment Queue** - Enriches prospect data with external signals
   - Schedule: Every 6 hours
   - Concurrency: 5 jobs

3. **Health Score Queue** - Calculates health scores for portfolio companies
   - Schedule: Every 12 hours
   - Concurrency: 3 jobs

### Usage

See `server/queue/README.md` for detailed documentation on:

- Job monitoring API endpoints
- Manual job triggering
- Worker configuration
- Retry strategies
- Troubleshooting

### Redis Requirement

The job queue system requires Redis to be running. Configure via environment variables:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
```

## Performance

### Database Connection Pooling

- Max connections: 20 (configurable via `DB_MAX_CONNECTIONS`)
- Idle timeout: 30 seconds
- Connection timeout: 2 seconds

### Response Time Targets

- P95 latency: <500ms
- P99 latency: <1s
- Database queries: <100ms P95

## Security

### Implemented

- Helmet.js security headers
- CORS configuration
- Rate limiting
- Input validation (Zod)
- SQL injection prevention (parameterized queries)
- JWT authentication
- API key authentication

### API Key Authentication

API Keys can be generated using the CLI script. The keys are hashed and stored securely in the `api_keys` database table.
You can issue a new API key for a specific organization by running:

```bash
npx tsx scripts/issue-api-key.ts --org <org_id> --name "My API Key"
```

This will generate an API key prefixed with `ucc_`. You must include this key in the `Authorization` header when making API requests:

```http
Authorization: Bearer ucc_xxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Planned (Phase 4)

- Role-based access control (RBAC)
- Data encryption
- Audit logging

## Monitoring

### Health Checks

The `/api/health/detailed` endpoint checks:

- Database connectivity
- Memory usage
- CPU usage

### Metrics (Phase 5)

Will expose Prometheus metrics at `/metrics`:

- HTTP request duration
- Request count by route and status
- Database connection pool stats
- Memory and CPU usage

## Deployment

See `docs/tasks/PHASE_5_TASKS.md` for production deployment instructions.

### Docker (Coming in Phase 5)

```bash
# Build image
docker build -t ucc-intelligence-api .

# Run container
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  ucc-intelligence-api
```

## Troubleshooting

### Database Connection Errors

```bash
# Check PostgreSQL is running
pg_isready

# Test connection manually
psql $DATABASE_URL
```

### Port Already in Use

```bash
# Kill process on port 3000
npm run kill

# Or use different port
PORT=3001 npm run dev:server
```

### Module Not Found Errors

```bash
# Clean install
rm -rf node_modules
npm install --legacy-peer-deps
```

## Contributing

See `CONTRIBUTING.md` in the project root.

## License

MIT - See `LICENSE` file
