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
# Fixes CVE-2025-64756 (glob), CVE-2025-64118 (tar)
RUN npm install -g npm@latest --force && npm cache clean --force

# Fix GHSA-73rr-hh4g-fpgx: Manually update npm's bundled diff@8.0.2 to 8.0.3
# npm hasn't released a version with diff@8.0.3 yet, so we patch it directly
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack diff@8.0.3 && \
    rm -rf node_modules/diff && \
    tar -xzf diff-8.0.3.tgz && \
    mv package node_modules/diff && \
    rm diff-8.0.3.tgz

# Fix CVE-2026-23950: Manually update npm's bundled tar@7.5.3 to 7.5.4
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack tar@7.5.4 && \
    rm -rf node_modules/tar && \
    tar -xzf tar-7.5.4.tgz && \
    mv package node_modules/tar && \
    rm tar-7.5.4.tgz

# Copy package files first for better layer caching
COPY package*.json .npmrc ./

# Install all dependencies (including devDependencies for build)
# The .npmrc has legacy-peer-deps=true to handle zod peer conflicts
RUN npm ci

# Remove protobufjs CLI entirely - not needed at runtime
# Eliminates CVE-2019-10790 (taffydb), CVE-2025-54798 (tmp), CVE-2025-5889 (brace-expansion)
RUN rm -rf node_modules/protobufjs/cli

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
# Explicit libexpat upgrade for CVE-2026-24515 (CRITICAL) and CVE-2026-25210 (MEDIUM)
RUN apk add --no-cache git ca-certificates && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl libexpat && \
    apk upgrade --no-cache && \
    npm install -g npm@latest --force && npm cache clean --force

# Fix GHSA-73rr-hh4g-fpgx: Manually update npm's bundled diff@8.0.2 to 8.0.3
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack diff@8.0.3 && \
    rm -rf node_modules/diff && \
    tar -xzf diff-8.0.3.tgz && \
    mv package node_modules/diff && \
    rm diff-8.0.3.tgz

# Fix CVE-2026-23950: Manually update npm's bundled tar@7.5.3 to 7.5.4
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack tar@7.5.4 && \
    rm -rf node_modules/tar && \
    tar -xzf tar-7.5.4.tgz && \
    mv package node_modules/tar && \
    rm tar-7.5.4.tgz

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
LABEL version="4.0.0"
LABEL org.opencontainers.image.source="https://github.com/neverinfamous/memory-journal-mcp"
LABEL io.modelcontextprotocol.server.name="io.github.neverinfamous/memory-journal-mcp"
