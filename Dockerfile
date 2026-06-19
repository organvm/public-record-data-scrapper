# Multi-stage build for UCC-MCA Intelligence Platform
# Stage 1: Dependencies
FROM node:26-alpine AS deps
WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache libc6-compat

# Copy package files (and required scripts for postinstall)
COPY package.json package-lock.json ./
COPY scripts/ensure-main-branch.mjs ./scripts/ensure-main-branch.mjs

# Install all dependencies (including dev for build)
RUN npm ci

# Stage 1b: Production-only dependencies (no dev tooling)
# Produces a node_modules tree containing only runtime deps for the final image.
FROM node:26-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY scripts/ensure-main-branch.mjs ./scripts/ensure-main-branch.mjs

RUN npm ci --omit=dev

# Stage 2: Builder
FROM node:26-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build frontend + server bundle
RUN npm run build:render

# Stage 3: Production runner
FROM node:26-alpine AS runner
WORKDIR /app

# Security: Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy only production dependencies (no dev tooling ships to the runtime image)
COPY --from=prod-deps /app/node_modules ./node_modules

# Copy built application (frontend dist + server bundle)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy database migrations and scripts
COPY --from=builder /app/database ./database
COPY --from=builder /app/scripts/migrate.ts ./scripts/

# Change ownership to non-root user
RUN chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the server (esbuild bundle)
CMD ["node", "dist/server.cjs"]
