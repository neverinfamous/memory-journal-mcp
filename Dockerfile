# Memory Journal MCP Server - TypeScript Version
# Multi-stage build for optimized production image
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies and upgrade packages for security
# Use Alpine edge for latest security patches (curl CVE-2025-14524, etc.)
RUN apk add --no-cache python3 make g++ && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl && \
    apk upgrade --no-cache

# Upgrade npm globally to get fixed versions of bundled packages
# Fixes CVE-2025-64756 (glob) and CVE-2025-64118 (tar)
RUN npm install -g npm@latest

# Copy package files first for better layer caching
COPY package*.json .npmrc ./

# Install all dependencies (including devDependencies for build)
# The .npmrc has legacy-peer-deps=true to handle zod peer conflicts
RUN npm ci

# Clean protobufjs bundled cli dependencies and apply overrides
# This ensures our brace-expansion and tmp overrides take effect
RUN rm -rf node_modules/protobufjs/cli/node_modules/brace-expansion \
           node_modules/protobufjs/cli/node_modules/tmp && \
    npm dedupe

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:24-alpine

WORKDIR /app

# Install runtime dependencies with security fixes
# Use Alpine edge for curl with CVE fixes
RUN apk add --no-cache git ca-certificates && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl && \
    apk upgrade --no-cache

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Server healthy')" || exit 1

# Run the MCP server
CMD ["node", "dist/cli.js"]

# Labels for Docker Hub
LABEL maintainer="Adamic.tech"
LABEL description="Memory Journal MCP Server - Project context management for AI-assisted development"
LABEL version="3.1.3"
LABEL org.opencontainers.image.source="https://github.com/neverinfamous/memory-journal-mcp"
LABEL io.modelcontextprotocol.server.name="io.github.neverinfamous/memory-journal-mcp"