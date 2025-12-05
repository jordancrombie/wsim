# =============================================================================
# WSIM Backend - Multi-stage Dockerfile
# =============================================================================
# Stage 1: Dependencies
# Stage 2: Builder (TypeScript compilation)
# Stage 3: Runner (Production image)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src/

# Generate Prisma client and build TypeScript
RUN npx prisma generate && npm run build

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Set production environment
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 wsim && \
    adduser --system --uid 1001 wsim

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy Prisma artifacts from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Copy package.json for reference
COPY package.json ./

# Change ownership to non-root user
RUN chown -R wsim:wsim /app

# Switch to non-root user
USER wsim

# Expose port
EXPOSE 3003

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start command (migrations run separately or via entrypoint)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
