# Docker Templates

## Multi-Stage Build

Multi-stage builds are **mandatory** for any production image. They separate build-time dependencies from runtime.

```dockerfile
# syntax=docker/dockerfile:1

# ── Stage 1: Build ─────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# ── Stage 2: Runtime ───────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Copy ONLY production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER appuser
EXPOSE 3000
CMD ["node", "dist/index.js"]
```
