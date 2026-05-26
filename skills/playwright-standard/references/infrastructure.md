# Playwright Infrastructure & CI/CD Reference

## Scale & Performance

### Parallelization

- Run tests in parallel to reduce overall execution time.
- Configure `workers` in `playwright.config.ts`. Locally use `process.env.CI ? 1 : 4` to avoid machine lockup.

### Sharding

- Distribute tests across multiple CI machines.
- Example command: `npx playwright test --shard=1/3`.
- Combine blob reports for a unified HTML report.

## CI Configuration

### Trace & Video

- Tracing: `'on-first-retry'` (Best balance of debug info vs storage).
- Video: `'on-first-retry'` (High fidelity failure evidence).

### Secret Management

- Use environment variables for secrets: `process.env.PASSWORD`.
- Never commit `.env` or hardcoded keys.

## Docker & Containerization

### SLSA Compliance

- Pin images using SHA-256 digests: `mcr.microsoft.com/playwright:v1.59.1-focal@sha256:xxxx`.
- Avoid floating tags like `:latest` or `:v1` to ensure reproducible builds.

### Execution Policy

- Run as a non-root user when possible.
- Mount the host machine's UI/X11 socket if running headed mode inside Docker.

## Reporting & Analytics

- Use **Currents.dev** for enterprise-grade reporting, flakiness detection, and parallelization analytics.
- Integrate via the `@currents/playwright` reporter plugin.
