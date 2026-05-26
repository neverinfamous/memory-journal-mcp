# Testing Strategy Reference

4-layer testing model with structural invariants for MCP servers.

> Read this reference when setting up tests or reviewing test coverage for an MCP server.

---

## 4-Layer Testing Model

MCP servers require four complementary testing layers plus structural invariant tests.

| Layer | Tool | Scope | Transport | Speed |
|-------|------|-------|-----------|-------|
| **1. Unit Tests** | Vitest | Handler logic, schemas, validation, error paths | None (mocked) | Fast |
| **1b. Invariant Tests** | Vitest | Structural enforcement (annotations, output schemas) | None | Fast |
| **1c. Benchmarks** | Vitest bench | Handler dispatch, schema parsing, logger sanitization | None | Fast |
| **2. E2E Tests** | Playwright | Live server process, HTTP lifecycle, security headers | HTTP (dual) | Medium |
| **3. Integration Scripts** | Node.js `.mjs` | Protocol compliance, scheduler, transport-specific features | stdio + HTTP | Variable |
| **4. Agent-Driven Tests** | MCP tool calls | Functional verification of all tools, resources, prompts | stdio (live) | Slow |

---

## Layer 1: Unit Tests (Vitest)

Core handler logic, input validation, error formatting, database adapters. Mock external dependencies. Target ≥90% line coverage.

```
tests/
├── handlers/          # Tool handler logic
├── database/          # Adapter + query tests
├── server/            # Resource + prompt tests
├── auth/              # OAuth module (8 files)
├── security/          # Input sanitization
├── filtering/         # Tool filter expressions
├── codemode/          # Sandbox execution
└── e2e/               # Playwright (Layer 2)
```

---

## Layer 1b: Invariant Tests (Vitest)

Structural enforcement tests that verify every tool meets minimum standards. Run as part of the unit test suite.

| Test File | Enforces |
|-----------|----------|
| `tool-annotations.test.ts` | Every tool has `annotations` with explicit `readOnlyHint`, per-group checks, title validation |
| `tool-output-schemas.test.ts` | Every tool has `outputSchema`, error response acceptance, centralized schema wiring, no orphan schemas |

---

## Layer 2: E2E Tests (Playwright)

Spawn real `dist/cli.js` process + MCP SDK client. Test the system as a black box.

**Canonical spec inventory (~50 spec files, ~300+ tests):**

| Category | Spec Files | Coverage |
|----------|-----------|----------|
| **Zod Sweeps** | `zod-sweep.spec.ts`, `zod-sweep-native.spec.ts` | Every tool called with `{}` — must return structured error, never raw `-32602` |
| **Numeric Coercion** | `numeric-coercion.spec.ts`, `numeric-coercion-native.spec.ts` | String-typed numeric param coercion |
| **Boundary** | `boundary.spec.ts` | Empty tables, NULLs, idempotency, edge cases |
| **Aliases** | `aliases.spec.ts` | Backward-compatible parameter aliases |
| **Payloads** | `payloads-{group}.spec.ts` | Per-group payload correctness (one spec per tool group) |
| **Errors** | `errors.spec.ts`, `errors-extended.spec.ts`, `errors-native.spec.ts` | Error path coverage |
| **Code Mode** | `codemode.spec.ts`, `codemode-groups.spec.ts` | Sandbox lifecycle + all groups |
| **Help Resources** | `help-resources.spec.ts` | Root + per-group help resources listed, readable, non-empty |
| **Resources/Prompts** | `resources.spec.ts`, `prompts.spec.ts` | MCP resource/prompt verification |
| **Auth** | `auth.spec.ts`, `oauth-discovery.spec.ts` | OAuth 2.1 and RFC 9728 metadata |
| **Security** | `security.spec.ts` | Security header assertions, HSTS |
| **Rate Limiting** | `rate-limiting.spec.ts` | 429 burst, Retry-After header, health exemption |
| **Sessions** | `sessions.spec.ts`, `session-advanced.spec.ts` | Session management |
| **Transport** | `streaming.spec.ts`, `streamable-http.spec.ts`, `protocols.spec.ts` | Transport protocol tests |

**Testing cadence per group:** invariant (vitest) → zod sweep (E2E) → payload correctness (E2E) → error paths (E2E).

**Dual transport parity:** Run the same assertion suite against both stateful and stateless HTTP modes.

---

## Layer 3: Integration Scripts (Node.js `.mjs`)

For features that require **separate server processes** — can't be tested via vitest mocks or MCP tool calls. Zero external dependencies (just Node.js `child_process` + `fetch`).

**Standard scripts:**

| Script | Purpose | Transport |
|--------|---------|-----------|
| `test-help-resources.mjs` | Verify slim instructions + help resource filtering by group | stdio |
| `test-tool-annotations.mjs` | Parse `tools/list` response, verify `openWorldHint` counts and 0 missing | stdio |
| `test-scheduler.mjs` | Init HTTP session, read `memory://health`, wait for jobs, verify `runCount` + `lastResult` | HTTP |
| `test-instruction-levels.mjs` | Instruction level generation (`essential`, `standard`, `full`) — verify token budgets | stdio |

**Script conventions:**
- Node.js ESM (`.mjs`), no dependencies — run with `node test-server/script.mjs`
- Exit code 0 = pass, 1 = fail
- Handle SSE response parsing for HTTP transport (`text/event-stream` → JSON-RPC)
- Support env vars for configuration (e.g., `MCP_URL`, `WAIT_SECONDS`)
- Always `npm run build` before running

**Dual transport testing:** The scheduler activates in both HTTP stateful and stateless modes. Integration scripts should verify behavior in both when applicable:

| Mode | CLI Flags | Sessions | Scheduler |
|------|-----------|----------|-----------|
| stdio | `--transport stdio` (default) | N/A | ❌ |
| HTTP stateful | `--transport http` | `mcp-session-id` header | ✅ |
| HTTP stateless | `--transport http --stateless` | No sessions (serverless) | ✅ |

---

## Layer 4: Agent-Driven Tests (MCP Tool Calls)

Exhaustive functional testing of all tools, resources, and prompts via direct MCP calls from an AI agent. Organized in phased test plans.

**Orchestration pattern (`test-server/` directory):**

| File | Purpose |
|------|---------|
| `README.md` | Agent-optimized orchestration doc — file inventory, conventions, script reference, troubleshooting |
| `code-map.md` | Comprehensive architecture reference (directory layout, module responsibilities, cross-references) |
| `tool-reference.md` | Tool inventory taxonomy (all tools by group with scope, annotations, schema status) |
| `prompt-template.md` | Extracted testing prompt boilerplate for consistent formatting across all test prompts |
| `test-tool-groups/*.md` | ~20 self-contained prompts at sub-group granularity (e.g., `test-core.md`, `test-json-get.md`) |
| `test-codemode/*.md` | ~12 prompts for Code Mode groups + sandbox security + WASM degradation |
| `test-advanced/*.md` | ~10 stress test prompts per tool group (Pattern P401: Agent-First Stress Testing) |
| `test-resources.md` | Dedicated resource verification (all data + help resources) |
| `test-prompts.md` | Dedicated prompt verification |
| `test-agent-experience.md` | ~20 open-ended scenarios validating help resource sufficiency |
| `*.mjs` | Integration scripts (Layer 3) |

**Test count taxonomy:** Document tool counts using the formal taxonomy: Group tools (per-group subtotal) / Built-in tools (server_info, server_health, list_adapters) / Audit tools (when audit enabled) / Inventory tools (when applicable) / MCP total (sum visible to clients via `tools/list`).

**Test plan conventions:**
- Phases numbered 0-N, each with a table of `| Test | Command | Expected |`
- Error-path tests marked with 🔴 prefix
- Reporting: ❌ Fail, ⚠️ Issue, ✅ inline only (omit from summary)
- Mermaid-producing resources must specify `text/plain` MIME in expected results
- Script-based phases (help resources, scheduler) reference scripts, not inline commands

**Standardized Prompt Format:** Use `prompt-template.md` boilerplate for all test prompts. This ensures consistent structure (Setup, Prerequisites, Test Matrix, Reporting Format) across 40+ test files. Generate or update prompts programmatically when adding new tool groups.

**OAuth Tests:** 8 test files in `src/auth/tests/`. See [`oauth-reference.md`](../oauth-reference.md) §Testing Patterns for file list and mocking strategies.

---

## Code Quality & Supply Chain

- No duplicated code, consistent error handling, full type coverage, <600 line modules
- **SHA-pinned CI Actions:** Pin all GitHub Actions by SHA digest (not version tag) to prevent supply chain injection
- **Version SSoT:** Create `src/version.ts` that reads `version` from `package.json` at runtime (via `createRequire`). **Both adapters** (if dual-backend) `import { VERSION }` — never hardcode version strings. On a bump, only `package.json` needs updating
- **Lockfile integrity:** Verify lockfile SHA-256 checksum + `git diff --exit-code` before `npm ci` in CI pipelines. Prevents supply chain attacks via lockfile manipulation
- **Dockerfile patch drift:** Weekly CI workflow to detect stale transitive dependency patches (e.g., `package.json` overrides) against upstream versions. Alert when patches diverge from upstream releases
- Regular dependency scanning and artifact integrity

**Compact JSON Serialization:** Use `JSON.stringify(result)` (no pretty-print) for tool responses — ~15-20% payload reduction on large results. Retain `JSON.stringify(result, null, 2)` only for error responses where human readability matters.

**WASM/Native Backend Parity:** For servers with dual backends (e.g., WASM + Native), maintain a parity checklist:
- Features registered but always failing in one backend (e.g., FTS5 on WASM) must return structured "Feature Not Available" errors, not raw crashes
- Test each backend independently — Code Mode can mask registration-only failures
- Document backend-specific capabilities in help resources

**WASM Degradation Testing:** For dual-backend servers, add dedicated degradation test suites:
- Verify WASM-unsupported features return structured `{ success: false, code: 'FEATURE_NOT_AVAILABLE' }` errors
- Test Code Mode gracefully degrades (e.g., `codemode-wasm-degradation.md` prompt)
- Confirm tool count differences between backends match expected parity (`test-tool-annotations.mjs` validates this)
- Document expected tool counts per backend in `test-server/README.md`
