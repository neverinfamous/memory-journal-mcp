# Memory Journal MCP Server - TypeScript Version
# Multi-stage build for optimized production image
FROM node:24-alpine AS builder

WORKDIR /app

# Install build dependencies and upgrade packages for security
# Use Alpine edge for latest security patches (curl CVE-2025-14524, zlib CVE-2026-27171, etc.)
RUN apk add --no-cache python3 make g++ && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl zlib && \
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

# Fix CVE-2026-23950, CVE-2026-24842, CVE-2026-26960, GHSA-qffp-2rhf-9h96: Manually update npm's bundled tar to 7.5.11
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack tar@7.5.11 && \
    rm -rf node_modules/tar && \
    tar -xzf tar-7.5.11.tgz && \
    mv package node_modules/tar && \
    rm tar-7.5.11.tgz

# Fix CVE-2026-27903, CVE-2026-27904: Manually update npm's bundled minimatch to 10.2.4
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack minimatch@10.2.4 && \
    rm -rf node_modules/minimatch && \
    tar -xzf minimatch-10.2.4.tgz && \
    mv package node_modules/minimatch && \
    rm minimatch-10.2.4.tgz

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
# Explicit zlib upgrade for CVE-2026-27171 (MEDIUM)
RUN apk add --no-cache git ca-certificates && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl libexpat zlib && \
    apk upgrade --no-cache && \
    npm install -g npm@latest --force && npm cache clean --force

# Fix GHSA-73rr-hh4g-fpgx: Manually update npm's bundled diff@8.0.2 to 8.0.3
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack diff@8.0.3 && \
    rm -rf node_modules/diff && \
    tar -xzf diff-8.0.3.tgz && \
    mv package node_modules/diff && \
    rm diff-8.0.3.tgz

# Fix CVE-2026-23950, CVE-2026-24842, CVE-2026-26960, GHSA-qffp-2rhf-9h96: Manually update npm's bundled tar to 7.5.11
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack tar@7.5.11 && \
    rm -rf node_modules/tar && \
    tar -xzf tar-7.5.11.tgz && \
    mv package node_modules/tar && \
    rm tar-7.5.11.tgz

# Fix CVE-2026-27903, CVE-2026-27904: Manually update npm's bundled minimatch to 10.2.4
RUN cd /usr/local/lib/node_modules/npm && \
    npm pack minimatch@10.2.4 && \
    rm -rf node_modules/minimatch && \
    tar -xzf minimatch-10.2.4.tgz && \
    mv package node_modules/minimatch && \
    rm minimatch-10.2.4.tgz

# Copy built artifacts and install production-only dependencies
COPY --from=builder /app/dist ./dist
COPY package*.json .npmrc ./
RUN npm ci --omit=dev && \
    rm -rf node_modules/protobufjs/cli && \
    npm cache clean --force
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

# Health check - validates Node.js is responsive
# For HTTP mode, override with: HEALTHCHECK CMD curl -f http://localhost:3000/mcp || exit 1
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Run the MCP server
ENTRYPOINT ["node", "dist/cli.js"]

# Labels for Docker Hub
LABEL maintainer="Adamic.tech"
LABEL description="Memory Journal MCP Server - Project context management for AI-assisted development"
LABEL org.opencontainers.image.source="https://github.com/neverinfamous/memory-journal-mcp"
LABEL io.modelcontextprotocol.server.name="io.github.neverinfamous/memory-journal-mcp"
