# Memory Journal MCP Server - TypeScript Version
# Multi-stage build for optimized production image
FROM node:24.15.0-alpine AS builder

WORKDIR /app

# Install build dependencies and upgrade packages for security
# Use Alpine edge for latest security patches (curl CVE-2025-14524, zlib CVE-2026-27171, etc.)
RUN apk add --no-cache python3 make g++ && \
    apk add --no-cache curl zlib libcrypto3 libssl3 && \
    apk upgrade --no-cache

# Upgrade npm globally to a pinned version to ensure reproducible builds
# Fixes CVE-2025-64756 (glob), CVE-2025-64118 (tar)
RUN npm install -g npm@10.9.2 && npm cache clean --force

# Copy package files first for better layer caching
COPY package*.json .npmrc ./

# Install all dependencies (including devDependencies for build)
# The .npmrc has legacy-peer-deps=true to handle zod peer conflicts
RUN npm ci

# Remove protobufjs CLI entirely - not needed at runtime
# Eliminates CVE-2019-10790 (taffydb), CVE-2025-54798 (tmp), CVE-2025-5889 (brace-expansion)
RUN rm -rf node_modules/protobufjs/cli

# Copy source code
COPY tsconfig.json tsconfig.build.json tsup.config.ts ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Install production-only dependencies in a separate directory for clean copy
RUN mkdir /app/prod_modules && \
    cp package*.json .npmrc /app/prod_modules/ && \
    cd /app/prod_modules && \
    npm ci --omit=dev && \
    rm -rf node_modules/protobufjs/cli && \
    npm cache clean --force

# Strip unnecessary ONNX runtime binaries from production dependencies:
# - Remove onnxruntime-web entirely (browser-only, not needed in Node.js)
# - Remove non-Linux platform binaries from onnxruntime-node (darwin, win32)
RUN rm -rf /app/prod_modules/node_modules/onnxruntime-web \
           /app/prod_modules/node_modules/.onnxruntime-node-* \
           /app/prod_modules/node_modules/onnxruntime-node/bin/napi-v3/darwin \
           /app/prod_modules/node_modules/onnxruntime-node/bin/napi-v3/win32

# Production stage
FROM node:24.15.0-alpine

WORKDIR /app

# Install runtime dependencies with security fixes
# Use Alpine edge for curl with CVE fixes
# Explicit libexpat upgrade for CVE-2026-24515 (CRITICAL) and CVE-2026-25210 (MEDIUM)
# Explicit zlib upgrade for CVE-2026-27171 (MEDIUM)
RUN apk add --no-cache git ca-certificates && \
    apk add --no-cache curl libexpat zlib libcrypto3 libssl3 && \
    apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy built artifacts and production dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prod_modules/node_modules ./node_modules
COPY package*.json ./
COPY LICENSE ./

# Create data directory for SQLite database with proper permissions
RUN mkdir -p /app/data && chmod 700 /app/data

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup && \
    chown -R appuser:appgroup /app

# Set environment variables
ENV NODE_ENV=production
ENV DB_PATH=/app/data/memory_journal.db

# Switch to non-root user
USER appuser

# Health check — validates Node.js runtime is responsive (sufficient for stdio mode,
# which is the default transport). For HTTP mode, override in docker-compose.yml with:
#   healthcheck:
#     test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
#     interval: 30s
#     timeout: 10s
#     retries: 3
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD sh -c 'if ps | grep "[n]ode.*http" > /dev/null; then curl -f http://localhost:3000/health || exit 1; else node -e "process.exit(0)" || exit 1; fi'

# Run the MCP server
ENTRYPOINT ["node", "dist/cli.js"]

# Labels for Docker Hub
LABEL maintainer="Adamic.tech"
LABEL description="Memory Journal MCP Server - Project context management for AI-assisted development"
LABEL org.opencontainers.image.source="https://github.com/neverinfamous/memory-journal-mcp"
LABEL io.modelcontextprotocol.server.name="io.github.neverinfamous/memory-journal-mcp"
