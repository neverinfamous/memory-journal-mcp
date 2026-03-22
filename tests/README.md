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
  - ✅ `npx vitest run path/to/file.test.ts`
  - ❌ `npx vitest` (Unless explicitly asked for a full suite run)
- **Output Limits:** When running tests via standard terminal commands, use `OutputCharacterCount: ≥10000` to ensure you see the summary line. 
- **Assertion:** Never assume a test passed if the output is truncated. You MUST verify the final summary line (`✓ 1 passed`).

### 3. File Naming & Structure
- Test files must mirror the source directory structure.
- Naming convention: `<source-filename>.test.ts` (e.g., `src/foo/bar.ts` → `tests/foo/bar.test.ts`).
- **Never** use PascalCase or camelCase. Use `kebab-case`.

### 4. Error Assertions (Structured Errors)
- The Memory Journal MCP server uses a strict **Structured Error Pattern**. Tools NEVER throw raw exceptions to the client. They return: 
  `{ success: false, error: '...', code: '...', category: '...', suggestion: '...' }`.
- When testing tool handlers, **assert the structured response**, do not expect the tool to `.toThrow()`.

## 📂 Directory Structure Reference
| Directory | Tests What |
|---|---|
| `auth/` | OAuth 2.1 middleware, token validation, scopes |
| `codemode/` | Sandbox security, API bridge, worker lifecycle |
| `database/` | SQLite adapter, entry CRUD, search, tags, backup |
| `handlers/` | Tool handlers, resource handlers, prompt handlers (Integration) |
| `security/` | Input validation, SQL injection, path traversal |
| `transports/` | HTTP transport, rate limiting, session behavior |
| `vector/` | Vector search manager, semantic embedding logic |

---
*For a complete code map and directory breakdown, see `test-server/code-map.md`.*
