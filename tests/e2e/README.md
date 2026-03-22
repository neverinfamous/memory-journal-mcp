# Memory Journal MCP - Playwright Suite (E2E)

> **⚠️ AI AGENT INSTRUCTIONS:** Read these rules before creating, modifying, or running tests in this directory.

## 📌 Framework & Purpose
- **Framework:** Playwright (`playwright.config.ts`)
- **Purpose:** End-to-End (E2E) protocol, transport, and integration parity testing.
- **Focus:** HTTP/SSE transport, sessions, CORS, security headers, rate limiting, stateless mode, and automated schedulers.
- **Database:** Uses a dedicated isolated test DB (`.test-output/e2e/test-e2e.db`).

## 🚨 AI Agent Testing Rules

### 1. Scope of E2E Tests
- **DO NOT** write tests here to verify core handler logic (e.g., does `create_entry` work in SQLite?). That belongs in the Vitest suite (`tests/README.md`).
- **DO** write tests here to ensure the complete HTTP system correctly negotiates protocols, streams SSE events, handles standard MCP payloads, manages stateless instances, or evaluates server-level behaviors.

### 2. Execution Protocol
- Run via npm scripts: `npm run test:e2e`
- For targeted test files: `npx playwright test tests/e2e/your-file.spec.ts`
- Playwright automatically handles spinning up the development server via the `webServer` config in `playwright.config.ts`.
- Check output carefully to verify that the server started successfully before tests executed.

### 3. File Naming & Structure
- Naming convention: `<feature>.spec.ts` (e.g., `payloads-admin.spec.ts`, `health.spec.ts`, `streaming.spec.ts`).
- **Never** use PascalCase or camelCase. Use `kebab-case`.
- Helper functions belong in `tests/e2e/helpers.ts`. Do not duplicate initialization and HTTP request logic across tests. Use the provided helpers for MCP handshakes, session initialization, and request execution.

### 4. Flakiness & Determinism
- Do not rely on fixed `setTimeout()` unless absolutely necessary. Rely on Playwright's auto-retry assertions (e.g., `expect.poll`).
- Tests should clean up their state or be isolated from one another. Wait for scheduled intervals to conclude securely or manage time appropriately.

---
*For a complete code map and directory breakdown, see `test-server/code-map.md`.*
