### Changed

- **Code Quality Audit Fixes**
  - Renamed 7 `PascalCase` files to kebab-case to match workspace standards (`sqlite-adapter.ts`, `tool-filter.ts`, `github-integration.ts`, `mcp-server.ts`, `mcp-logger.ts`, `vector-search-manager.ts`, `server-instructions.ts`, `scheduler.ts`) and updated 27 import references across the codebase
  - Converted 13 bare `throw new Error(...)` statements to typed error classes (`ConfigurationError`, `ResourceNotFoundError`, `ConnectionError`, `QueryError`, `ValidationError`) for consistent error handling and standard structured error responses (`vector-search-manager.ts`, `sqlite-adapter.ts`, `handlers/resources/index.ts`, `handlers/prompts/index.ts`, `authorization-server-discovery.ts`, `sandbox-factory.ts`)
  - Renamed `src/types/sql.js.d.ts` to `sql-js.d.ts` to ensure strict compliance with kebab-case naming standard
  - Eliminated `eslint-disable-next-line` pragmas where possible (e.g. `no-control-regex` solved natively in `security-utils.ts`, `no-explicit-any` removed in `backup.ts`)
  - Strictified `z.object({})` Zod schemas by appending `.strict()` for safer payload validation on empty schemas (`admin.ts`, `backup.ts`, `core.ts`, `search.ts`, `read-tools.ts`)
### Fixed

- Replaced `as unknown` type assertions with strict types where appropriate (`wasm-connection.ts`, `backup.ts`) and auth test mocks with properly mapped `QueryResult` types and `Object.create(Type.prototype)` mock instantiation.
- Resolved native driver (better-sqlite3) `datatype mismatch` and `more than one statement` exceptions by strictly enforcing `IDatabaseConnection`'s `exec` implementation in analytical routes.
- Abstracted `rawDb.exec` within the `relationships` tool group to an integrated adapter `executeRawQuery` to prevent query injection bypasses.
- Secured native snapshot backups by switching from blocked in-memory blob exports to transactional file-system copies with `wal_checkpoint(TRUNCATE)`.

### Added

- **Dual-Backend SQLite Architecture** — Migrated from a pure WASM (`sql.js`) persistence model to a dual-backend architecture. Introduces `better-sqlite3` as the native disk-backed driver to eliminate event-loop-blocking memory serialization, while retaining the modernized `sql.js` adapter as a zero-compilation WASM fallback. Both backends seamlessly support the exact same `IDatabaseConnection` interfaces and return structures. Added `--sqlite-native` CLI flag (enabled by default).
- **Harmonized Error Types (`error-types.ts`)** — New `ErrorCategory` enum (9 categories: validation, connection, query, permission, config, resource, authentication, authorization, internal), `ErrorResponse` interface, and `ErrorContext` interface. Part of the harmonized error handling standard across db-mcp, postgres-mcp, mysql-mcp, and memory-journal-mcp
- **`MemoryJournalMcpError` Base Class (`errors.ts`)** — Enriched base error class with `category`, `code`, `suggestion`, `recoverable`, `details`, and `cause` properties. Includes `toResponse()` method returning structured `ErrorResponse`. 6 subclasses: `ConnectionError`, `QueryError`, `ValidationError`, `ResourceNotFoundError`, `ConfigurationError`, `PermissionError`
- **`OAuthError` Extends `MemoryJournalMcpError`** — OAuth errors now inherit full error handling infrastructure (category, suggestion, toResponse()). Auto-categorizes as AUTHENTICATION (401) or AUTHORIZATION (403) based on httpStatus. Deprecated standalone `getWWWAuthenticateHeader()` utility; removed from barrel export
- **`SecurityError` Extends `MemoryJournalMcpError`** — Security validation errors (`InvalidDateFormatError`, `PathTraversalError`) now participate in the enriched error hierarchy with VALIDATION category
- **`formatHandlerErrorResponse()` Function** — New enriched error formatter in `error-helpers.ts` returning full `ErrorResponse` objects with code, category, suggestion, and recoverable fields. Handles `MemoryJournalMcpError`, `ZodError`, and raw errors. Existing `formatHandlerError()` preserved for backward compatibility

- **Configurable Briefing (`memory://briefing`)** — 5 new env vars / CLI flags to customize the session briefing
  - `BRIEFING_ENTRY_COUNT` / `--briefing-entries` — Number of journal entries (default: 3)
  - `BRIEFING_INCLUDE_TEAM` / `--briefing-include-team` — Include team DB entries in briefing
  - `BRIEFING_ISSUE_COUNT` / `--briefing-issues` — Number of issues to list with titles (0 = count only)
  - `BRIEFING_PR_COUNT` / `--briefing-prs` — Number of PRs to list with titles (0 = count only)
  - `BRIEFING_PR_STATUS` / `--briefing-pr-status` — Show PR status breakdown (open/merged/closed)
  - Issues and PRs row now always displayed in the `userMessage` table when GitHub is available
  - `RULES_FILE_PATH` / `--rules-file` — Path to user rules file; shown in briefing with size and last-modified age
  - `SKILLS_DIR_PATH` / `--skills-dir` — Path to skills directory; shown in briefing with skill count
  - Expanded `## Rule & Skill Suggestions` in server instructions with guidance for adding, updating, and refining rules and skills
  - `BRIEFING_WORKFLOW_COUNT` / `--briefing-workflows` — Number of recent workflow runs to list with names and status icons
  - `BRIEFING_WORKFLOW_STATUS` / `--briefing-workflow-status` — Show workflow run status breakdown (passing/failing/pending/cancelled)
  - CI Status row in briefing enhanced to show named runs (✅ build · ❌ deploy) or aggregated counts
  - `get_copilot_reviews` tool — Fetch Copilot's code review findings for any PR (state, file-level comments with paths/lines)
  - `BRIEFING_COPILOT_REVIEWS` / `--briefing-copilot` — Aggregate Copilot review state across recent PRs in briefing
  - Copilot review patterns in server instructions (learn from reviews, pre-emptive checking, `copilot-finding` tag)

- **OAuth 2.1 Authentication Module** — Full RFC-compliant OAuth 2.0 authentication and authorization for the HTTP transport
  - 10 new files in `src/auth/`: types, errors, scopes, token-validator, oauth-resource-server, authorization-server-discovery, scope-map, auth-context, middleware, barrel
  - RFC 9728 Protected Resource Metadata endpoint (`/.well-known/oauth-protected-resource`)
  - RFC 8414 Authorization Server Metadata discovery with caching
  - JWT validation via `jose` library with JWKS caching and issuer/audience verification
  - 10 tool groups mapped to 3 OAuth scopes: `read` (core, search, analytics, relationships, export), `write` (github, team), `admin` (admin, backup, codemode)
  - `AsyncLocalStorage`-based per-request auth context threading
  - Express middleware for token extraction, validation, and scope enforcement
  - Transport-agnostic utilities: `createAuthenticatedContext`, `validateAuth`, `formatOAuthError`
  - 5 new CLI flags: `--oauth-enabled`, `--oauth-issuer`, `--oauth-audience`, `--oauth-jwks-uri`, `--oauth-clock-tolerance`
  - Environment variable support: `OAUTH_ENABLED`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_JWKS_URI`

- **Code Mode (`mj_execute_code`)** — Sandboxed JavaScript execution for multi-step workflows with 70-90% token reduction
  - 9 new files in `src/codemode/`: types, security manager, VM sandbox, worker-thread sandbox, worker script, sandbox factory, API bridge, API constants, barrel
  - `src/handlers/tools/codemode.ts` — Tool handler with security validation, rate limiting, and API bridge construction
  - `mj.*` namespaced API exposes all 44 tools across 10 groups (core, search, analytics, relationships, export, admin, github, backup, team, codemode)
  - Positional argument support, method aliases, per-group `help()` for discoverability
  - Production sandbox: `node:worker_threads` with V8 isolate boundary, `node:vm` secondary isolation, MessagePort RPC bridge
  - Resource limits: code length (50KB), execution timeout (30s), memory (128MB), rate limiting (60 executions/min), result size (10MB)
  - `--sandbox-mode <mode>` CLI flag: `worker` (production, default) or `vm` (lightweight)
  - Tool count: 42 → 44 tools, tool groups: 9 → 10

### Changed

- **Performance Optimization (I/O & Memory)** — Refactored unbounded `SELECT * FROM memory_journal` queries across core handlers (`entries.ts`, `templates.ts`, `github.ts`, `core.ts`, `stats.ts`, `graph.ts`, `workflow.ts`) to use explicit `ENTRY_COLUMNS` projections, reducing I/O latency and WASM memory overhead.
- **GitHub API Caching** — Implemented a bounded (max 100 items), TTL-aware LRU cache strategy in `GitHubClient` to prevent memory leaks on long-running instances.
- **Core Handlers Modularized**:
  - **SQLite Adapter** — Split monolithic `src/database/sqlite-adapter.ts` (1640 lines) into `src/database/sqlite-adapter/` containing `connection.ts`, `tags.ts`, `entries.ts`, `relationships.ts`, `backup.ts`, and `index.ts`.
  - **GitHub Integration** — Split monolithic `src/github/github-integration.ts` (1707 lines) into `src/github/github-integration/` containing focused modules (`auth.ts`, `repos.ts`, `issues.ts`, `pull-requests.ts`, `search.ts`, `copilot.ts`, `index.ts`).
  - **Core Resources** — Split monolithic `src/handlers/resources/core.ts` (823 lines) into `src/handlers/resources/core/` containing `briefing.ts`, `instructions.ts`, `stats.ts`, and `index.ts`.
  - **Briefing Resource** — Split monolithic `src/handlers/resources/core/briefing.ts` (560 lines) into `src/handlers/resources/core/briefing/` containing focused builders (`github.ts`, `team.ts`, `system.ts`, `formatter.ts`, `types.ts`) and `index.ts`.
- **Test Directory Renamed** — Renamed `src/auth/__tests__` to `src/auth/tests` to comply with the project's strict kebab-case naming standard.
- **HTTP Transport Modularized** — Continued splitting `src/transports/http.ts` and `src/transports/http/server.ts` into a fully modularized directory:
  - `types.ts` — Configuration interface (`HttpTransportConfig`), constants, rate limiting types
  - `security.ts` — Client IP extraction, built-in rate limiting, CORS (wildcard subdomain support), security headers
  - `handlers.ts` — Health check, root info, bearer token auth middleware
  - `server/` — Split `server.ts` into `stateless.ts`, `stateful.ts`, `legacy-sse.ts`, and `index.ts`
  - `index.ts` — Barrel re-export
- **CORS Configuration** — `corsOrigin: string` changed to `corsOrigins: string[]` for multi-origin support. CLI `--cors-origin` accepts comma-separated values. Wildcard subdomain patterns supported (e.g., `*.example.com`).
- **HSTS Configuration** — HSTS is now config-driven via `enableHSTS: true` instead of auto-detecting from `X-Forwarded-Proto` header.
- **Cache-Control Header** — Strengthened from `no-store` to `no-store, no-cache, must-revalidate`.

### Fixed

- **Code Mode `timeout` Parameter Ignored** — The `timeout` parameter on `mj_execute_code` was parsed by the Zod schema but never forwarded to the sandbox pool. All executions used the default 30s timeout regardless of the user-specified value. Added per-call `timeoutMs` override to `ISandbox`, `ISandboxPool`, and all sandbox/pool implementations (`WorkerSandbox`, `WorkerSandboxPool`, `CodeModeSandbox`, `SandboxPool`). Handler now destructures `timeout` and passes it to `pool.execute()`.

### Security

- **Built-in Rate Limiting** — Replaced `express-rate-limit` dependency with zero-dependency implementation. Health endpoint bypass, `Retry-After` header on 429, periodic cleanup with `.unref()`.
- **Server Timeouts** — Added HTTP request (120s), keep-alive (65s), and headers (66s) timeouts to mitigate DoS attacks.
- **CORS Enhancements** — `Access-Control-Max-Age: 86400`, `Vary: Origin` for specific origin matching, `corsAllowCredentials` option.
- **Trust Proxy** — `trustProxy` config option for correct `X-Forwarded-For` client IP extraction behind reverse proxies.
- **Max Body Size** — Configurable `maxBodySize` (default: 1MB) to prevent large request body attacks.

### Removed

- **`express-rate-limit` Dependency** — Replaced by built-in rate limiter.
