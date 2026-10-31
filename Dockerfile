# Memory Journal MCP Server - TypeScript Version
# Multi-stage build for optimized production image
#
# Security Notes:
# - Last Docker Scout scan: 2026-10-31 on node:26.2.0-alpine (Alpine 3.23), 0 critical / 1 high / 2 medium.
#   All three are Alpine OS packages with NO upstream fix available yet (accepted until fixed;
#   re-check with `docker scout cves` on each base image or Alpine package update):
#     - git 2.52.0-r0      HIGH   CVE-2025-66413  (runtime image; only matters when git runs against untrusted repos)
#     - busybox 1.37.0-r30 MEDIUM CVE-2025-60876
#     - nghttp2 1.69.0-r0  MEDIUM CVE-2026-58055
#   CI gates already ignore unfixed findings (Scout `only-fixed: true`, Trivy `ignore-unfixed: true`).
# - Runtime vs bundled: the production stage contains only the app (dist/), production node_modules
#   (`pnpm install --prod`), git/curl/ca-certificates and the Alpine libs upgraded below.
#   npm and npx are removed from the runtime image; pnpm exists only in the
#   builder stage (pinned to pnpm@11.9.0 to match pnpm-lock.yaml / pnpm-workspace.yaml).
# - Dependency pins live in pnpm-workspace.yaml `overrides` (mirrored in package.json) and .pnpmfile.cjs;
#   .pnpmfile.cjs MUST be copied into every install stage or `--frozen-lockfile` fails the pnpmfile checksum.
# - pnpm audit is clean as of this scan; there are no `npm pack` patched packages in this Dockerfile.
FROM node:26.2.0-alpine AS builder

WORKDIR /app

# Install build dependencies and upgrade packages for security
# Use Alpine edge for latest security patches (curl CVE-2025-14524, zlib CVE-2026-27171, libcrypto3 CVE-2026-45447)
RUN apk add --no-cache python3 make g++ gettext git sqlite-dev && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl expat libexpat zlib libcrypto3 libssl3 nghttp2-libs && \
    apk upgrade --no-cache

# Install pnpm to ensure reproducible builds across the ecosystem
RUN npm install -g pnpm@11.9.0 && npm cache clean --force

# Copy package files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs ./

# Install all dependencies (including devDependencies for build)
# The .npmrc has legacy-peer-deps=true to handle zod peer conflicts
RUN pnpm install --frozen-lockfile

# Remove protobufjs CLI entirely - not needed at runtime
# Eliminates CVE-2019-10790 (taffydb), CVE-2025-54798 (tmp), CVE-2025-5889 (brace-expansion)
RUN rm -rf node_modules/protobufjs/cli

# Copy source code
COPY tsconfig.json tsconfig.build.json tsup.config.ts ./
COPY src/ ./src/

# Build TypeScript
RUN pnpm run build

# Compile sqlite-vec native extension from source for Alpine (musl libc)
# We use v0.1.9 to match the package.json version
RUN curl -L https://github.com/asg017/sqlite-vec/archive/refs/tags/v0.1.9.tar.gz | tar -xz && \
    cd sqlite-vec-0.1.9 && \
    sed -i 's/typedef u_int8_t uint8_t;//g' sqlite-vec.c && \
    sed -i 's/typedef u_int16_t uint16_t;//g' sqlite-vec.c && \
    sed -i 's/typedef u_int32_t uint32_t;//g' sqlite-vec.c && \
    sed -i 's/typedef u_int64_t uint64_t;//g' sqlite-vec.c && \
    make loadable && \
    cp dist/vec0.so /app/vec0.so && \
    cd .. && \
    rm -rf sqlite-vec-0.1.9

# Install production-only dependencies in a separate directory for clean copy
RUN mkdir /app/prod_modules && \
    cp package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs /app/prod_modules/ && \
    cd /app/prod_modules && \
    pnpm install --frozen-lockfile --prod && \
    rm -rf node_modules/protobufjs/cli

# Strip unnecessary ONNX runtime binaries from production dependencies:
# - Remove onnxruntime-web entirely (browser-only, not needed in Node.js)
# - Remove non-Linux platform binaries from onnxruntime-node (darwin, win32)
RUN rm -rf /app/prod_modules/node_modules/onnxruntime-web \
           /app/prod_modules/node_modules/.onnxruntime-node-* \
           /app/prod_modules/node_modules/onnxruntime-node/bin/napi-v3/darwin \
           /app/prod_modules/node_modules/onnxruntime-node/bin/napi-v3/win32

# Production stage
FROM node:26.2.0-alpine

WORKDIR /app

# Install runtime dependencies with security fixes
# Use Alpine edge for curl with CVE fixes (and nghttp2-libs for CVE-2026-27135)
# Explicit libexpat upgrade for CVE-2026-24515 (CRITICAL) and CVE-2026-25210 (MEDIUM)
# Explicit zlib upgrade for CVE-2026-27171 (MEDIUM)
# Explicit libcrypto3/libssl3 upgrade for CVE-2026-45447 (HIGH)
RUN apk add --no-cache git ca-certificates && \
    apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/main curl expat libexpat zlib libcrypto3 libssl3 nghttp2-libs && \
    apk upgrade --no-cache && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Copy built artifacts, sqlite-vec, and production dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/vec0.so ./vec0.so
COPY --from=builder /app/prod_modules/node_modules ./node_modules
COPY skills ./skills
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
ENV MCP_HOST=0.0.0.0

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
