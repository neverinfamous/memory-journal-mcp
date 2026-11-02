# Memory Journal MCP - Vitest Suite (Unit/Integration)

> **⚠️ AI AGENT INSTRUCTIONS:** Read these rules before creating, modifying, or running tests in this directory.

## 📌 Framework & Purpose

- **Framework:** Vitest (`vitest.config.ts`)
- **Execution Environment:** Node.js
- **Purpose:** Fast, isolated unit testing and database/handler integration testing.
- **Not for:** Core HTTP transport/SSE protocol testing (see `tests/e2e/README.md`).

## 🚨 AI Agent Testing Rules

### 1. Meaningful Tests ONLY

- **DO NOT** write tests just to boost coverage metrics.
- Focus on testing logic boundaries, error handling, input validation, and expected success paths.
- We require high-quality, meaningful assertions. Never use `expect(true).toBe(true)` or `continue-on-error` patterns.

### 2. Execution Protocol

- **Targeted Runs:** NEVER run the entire test suite when working on a specific file. Run targeted tests to save time and token context.
  - ✅ `pnpm exec vitest run path/to/file.test.ts`
  - ❌ `pnpm run test:watch` (Unless explicitly running interactive watch mode)
- **Output Limits:** When running tests via standard terminal commands, use `OutputCharacterCount: ≥10000` to ensure you see the summary line.
- **Assertion:** Never assume a test passed if the output is truncated. You MUST verify the final summary line (`✓ 1 passed`).

### 3. File Naming & Structure

- Test files must mirror the source directory structure.
- Naming convention: `<source-filename>.test.ts` (e.g., `src/foo/bar.ts` → `tests/foo/bar.test.ts`).
- **Never** use PascalCase or camelCase. Use `kebab-case`.

### 4. Error Assertions (Structured Errors)

- The Memory Journal MCP server uses a strict **Structured Error Pattern**. Tools NEVER throw raw exceptions to the client. They return:
  `{ success: false, error: '...', code: '...', category: '...', suggestion?: '...', recoverable: boolean, details?: {...}, aggregated_errors?: [...] }`.
- When testing tool handlers, **assert the structured response**, do not expect the tool to `.toThrow()`.

## 📂 Directory Structure Reference

| Directory        | Tests What                                                      |
| ---------------- | --------------------------------------------------------------- |
| `audit/`         | JSONL audit logger, redaction, rotation, audit resource         |
| `auth/`          | OAuth 2.1 middleware, token validation, scopes                  |
| `cli/`           | CLI argument parsing, subcommands, server option resolution     |
| `codemode/`      | Sandbox security, API bridge, worker lifecycle                  |
| `constants/`     | Server instructions, icons, and briefing constant verification  |
| `database/`      | SQLite adapter, entry CRUD, search, tags, backup                |
| `e2e/`           | Playwright HTTP/SSE transport and protocol E2E suite            |
| `filtering/`     | Tool filter parsing, presets, group/tool exclusion and inclusion |
| `git/`           | Local Git repository inspection and commit history helpers      |
| `github/`        | GitHub REST & Projects v2 GraphQL client integration            |
| `handlers/`      | Tool handlers, resource handlers, prompt handlers (Integration) |
| `integration/`   | Cross-module end-to-end pipeline and RBAC boundary tests        |
| `markdown/`      | Markdown frontmatter parsing, import, and export                |
| `migrations/`    | Versioned SQLite schema migrations and legacy upgrades          |
| `observability/` | Metrics interceptor, Prometheus exporter, token estimator       |
| `security/`      | Input validation, SQL injection, path traversal                 |
| `server/`        | MCP server initialization, registration, scheduler, and interceptors |
| `transports/`    | HTTP transport, rate limiting, session behavior                 |
| `unit/`          | Targeted unit suites for CLI, normalizers, and proxies          |
| `utils/`         | Error formatting, security helpers, logger, progress utilities  |
| `vector/`        | Vector search manager, semantic embedding logic                 |
| `global-teardown.ts` | Global Vitest teardown (cleans up temporary test DBs and backups) |

---

_For a complete code map and directory breakdown, see `test-server/code-map.md`._
