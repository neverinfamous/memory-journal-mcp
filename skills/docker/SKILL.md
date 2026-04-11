---
name: docker
description: |
  Production-grade Docker and container best practices. Use when writing
  Dockerfiles, configuring Docker Compose, optimizing image size and build
  speed, implementing security hardening, or debugging container issues.
  Triggers on "Docker", "Dockerfile", "container", "Compose", "BuildKit",
  "multi-stage build", "image size", "docker-compose".
---

# Docker & Container Engineering Standards

This skill codifies 2026 Docker best practices — secure, minimal, reproducible container images using BuildKit, multi-stage builds, and Compose v2.

## 1. Dockerfile Fundamentals

### Always Start With BuildKit Syntax

```dockerfile
# syntax=docker/dockerfile:1
```

Place this as the **first line** of every Dockerfile. It enables:
- Parallel stage execution
- Cache mounts (`--mount=type=cache`)
- Secret mounts (`--mount=type=secret`)
- Reproducible builds across Docker versions

### Base Image Selection

| Use Case | Recommended Base | Why |
|----------|-----------------|-----|
| **Node.js** | `node:22-slim` | Debian Slim — small, has essential libs |
| **Python** | `python:3.13-slim` | Minimal Debian, no build tools |
| **Go** | `scratch` or `distroless` | Static binary needs nothing |
| **General** | `debian:bookworm-slim` | Stable, well-patched, small |

- **NEVER** use `:latest` — always pin to a specific version tag
- **Prefer `-slim` variants** over full images to reduce attack surface
- **Consider `distroless`** for production — no shell, no package manager = minimal attack surface

## 2. Multi-Stage Builds (Required for Production)

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

### Key Rules

- **Name every stage**: `FROM ... AS builder` — makes builds readable and targetable
- **Copy only artifacts**: Use `COPY --from=builder` to cherry-pick built files
- **Never install dev dependencies in the runtime stage**
- **The runtime stage should have ZERO build tools** (no compilers, no git, no curl)

## 3. Security Hardening

### Non-Root Execution (Mandatory)

```dockerfile
# Create a system user with no home directory, no login shell
RUN groupadd -r appgroup && useradd -r -g appgroup -s /usr/sbin/nologin appuser

# Switch to the non-root user BEFORE CMD
USER appuser
```

- **NEVER** run containers as root in production
- **NEVER** use `--privileged` flag unless absolutely required
- **Set `USER` as late as possible** — after all `RUN` commands that need root

### Secret Handling

```dockerfile
# ✅ Good: BuildKit secret mount (never stored in layers)
RUN --mount=type=secret,id=npm_token \
    NPM_TOKEN=$(cat /run/secrets/npm_token) \
    npm config set //registry.npmjs.org/:_authToken=$NPM_TOKEN

# ❌ Bad: ARG/ENV secrets (visible in image history)
ARG NPM_TOKEN
ENV NPM_TOKEN=$NPM_TOKEN
```

- **NEVER** use `ARG` or `ENV` for secrets — they are baked into image layers
- **NEVER** `COPY` `.env` files into the image
- Use `--mount=type=secret` (BuildKit) for build-time secrets
- Use Docker Compose `secrets:` or orchestrator secrets for runtime

### Vulnerability Scanning

```bash
docker scout cves <image>          # Docker Scout
trivy image <image>                # Trivy (open source)
grype <image>                      # Grype (Anchore)
```

- Run scanning in CI — **hard-fail** on HIGH/CRITICAL vulnerabilities
- Never use `continue-on-error: true` for security gates

## 4. Layer Optimization

### Instruction Ordering

Docker caches each layer. Order instructions from **least-changing to most-changing**:

```dockerfile
# 1. Base image (rarely changes)
FROM node:22-slim

# 2. System deps (changes infrequently)
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# 3. Application deps (changes when lock file changes)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 4. Application code (changes most frequently)
COPY . .
RUN pnpm build
```

### Cache Mounts (BuildKit)

```dockerfile
# Cache package manager downloads between builds
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt
```

### `.dockerignore` (Required)

Create a `.dockerignore` in every project with a Dockerfile:

```
.git
.github
node_modules
dist
*.md
.env*
.vscode
.idea
tmp/
coverage/
```

- **ALWAYS** exclude `.git` — it can be hundreds of MB
- **ALWAYS** exclude `node_modules` — reinstall inside the container
- **ALWAYS** exclude `.env*` — prevents secret leaks

## 5. Docker Compose v2

### Structure

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: runtime           # Target a specific stage
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:17-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

### Best Practices

- **Use `depends_on` with health checks** — not just service start order
- **Use named volumes** for persistent data — never bind-mount the entire project in production
- **Use environment files** (`env_file:`) for non-secret config
- **Use `secrets:`** for credentials — they are mounted as files, not env vars
- **Pin image versions** — `postgres:17-alpine`, not `postgres:latest`

## 6. CI/CD Integration

### GitHub Actions Pattern

```yaml
- name: Build and push
  uses: docker/build-push-action@<sha>
  with:
    context: .
    push: true
    tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

- **Use GitHub Actions cache** (`type=gha`) for CI builds
- **Tag with commit SHA** — never `:latest` for production
- **Scan before push** — run vulnerability scanning as a build step

## 7. Anti-Patterns (Never Do These)

| Anti-Pattern | Why It's Wrong | Do This Instead |
|-------------|---------------|-----------------|
| `FROM ubuntu:latest` | Unpinned, large, unpredictable | Pin version, use `-slim` |
| `RUN apt-get update` alone | Cache goes stale across builds | Combine with `install` in one `RUN` |
| `ADD` for local files | Unpredictable (auto-extracts) | Use `COPY` explicitly |
| Multiple `RUN apt-get` | Creates unnecessary layers | Chain with `&&` in one `RUN` |
| `COPY . .` before deps | Breaks layer cache on every code change | Copy lock file first, install, then copy source |
| Running as root | Security vulnerability | Create and switch to `appuser` |
| Secrets in `ENV`/`ARG` | Visible in image history | Use `--mount=type=secret` |
| No `.dockerignore` | Bloated context, potential secret leaks | Always create one |
