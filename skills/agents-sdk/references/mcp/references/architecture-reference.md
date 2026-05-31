# Reference Architecture

Canonical directory layout for MCP servers in the fleet. All new servers should converge toward this structure.

> Read this reference when scaffolding a new MCP server or reviewing project structure.

---

## Directory Layout

```
src/
├── cli.ts                          # CLI entry point (delegates to cli/ submodules)
├── index.ts                        # Barrel re-export for library consumers
│
├── cli/                            # CLI submodules (split when cli.ts >300 lines)
│   ├── args.ts                     # Argument parsing, transport selection
│   ├── config.ts                   # DB/OAuth config builders
│   ├── server.ts                   # stdio/HTTP server starters
│   └── index.ts                    # Barrel
│
├── server/
│   ├── mcp-server.ts               # McpServer setup, adapter registration
│   ├── built-in-tools.ts           # Built-in tool registration (server_info, server_health, list_adapters)
│   ├── help-resources.ts           # Help resource registration (filtered by --tool-filter)
│   └── audit-tools.ts              # Audit resource + snapshot resource registration (when audit enabled)
│
├── types/                          # Core TS types (barrel: types/index.ts)
│   ├── adapters.ts                 # ToolDefinition, ResourceDefinition, PromptDefinition
│   ├── auth.ts                     # OAuthConfig, OAuthScope, TokenClaims
│   ├── database.ts                 # DatabaseConfig, QueryResult, ColumnInfo, TableInfo
│   ├── errors.ts                   # {Server}McpError base + subclasses (adapter-style flat)
│   ├── filtering.ts                # ToolGroup, MetaGroup, ToolFilterRule
│   ├── server.ts                   # TransportType, McpServerConfig
│   └── index.ts                    # Barrel (also re-exports error classes)
│
├── constants/
│   ├── server-instructions.ts      # Generated or runtime: slim INSTRUCTIONS + HELP_CONTENT/GOTCHAS_CONTENT
│   ├── server-instructions.md      # (Hybrid approach) Single source markdown for instruction levels
│   └── server-instructions/        # (Build-time approach) Per-group .md source files
│
├── filtering/
│   ├── tool-constants.ts           # (Optional) TOOL_GROUPS arrays, META_GROUPS shortcuts — split when imported by 3+ modules
│   └── tool-filter.ts              # ToolFilter class (may include group constants for simpler servers)
│
├── utils/
│   ├── annotations.ts              # MCP tool annotation helpers
│   ├── icons.ts                    # MCP icon definitions per tool group
│   ├── identifiers.ts              # SQL identifier validation/sanitization
│   ├── where-clause.ts             # WHERE clause builder/validator
│   ├── fts-config.ts               # FTS configuration name validation (SQL injection prevention)
│   ├── query-helpers.ts            # coerceNumber(), coerceLimit(), buildLimitClause(), DEFAULT_QUERY_LIMIT, toStr()
│   ├── validate-path.ts            # Path traversal validation (backup, dump, restore, attach tools)
│   ├── insights-manager.ts         # In-memory insights memo (memo://insights resource)
│   ├── progress-utils.ts           # MCP progress notification helpers (sendProgress, buildProgressContext)
│   ├── resource-annotations.ts     # Resource annotation presets (HIGH/MEDIUM/LOW_PRIORITY, ASSISTANT_FOCUSED)
│   ├── error-suggestions.ts        # Pattern-based error suggestions + findSuggestion() (auto-refinement)
│   ├── version.ts                  # SSoT version (reads package.json via createRequire)
│   ├── index.ts                    # Barrel
│   ├── errors/                     # Error class hierarchy (non-adapter servers — full decomposition)
│   │   ├── base.ts                 # Abstract base — auto-refines generic codes
│   │   ├── categories.ts           # ErrorCategory enum + ErrorResponse interface
│   │   ├── classes.ts              # Concrete error subclasses
│   │   ├── error-response-fields.ts # ErrorFieldsMixin (SSoT)
│   │   ├── format.ts               # formatHandlerError()
│   │   ├── suggestions.ts          # Fuzzy typo hints
│   │   └── index.ts
│   └── logger/                     # Logger (subdirectory for complex servers)
│       ├── logger.ts               # Structured JSON logger
│       ├── module-logger.ts        # createModuleLogger() factory
│       ├── error-codes.ts          # Module-prefixed codes
│       ├── types.ts
│       └── index.ts
│
├── pool/                           # DB connection pool (separate from adapter)
│   └── connection-pool.ts          # Pool manager with health checks
│
├── auth/                           # OAuth 2.1 implementation (11 files)
│   ├── auth-context.ts             # AsyncLocalStorage per-request auth context
│   ├── authorization-server-discovery.ts # RFC 8414 metadata discovery with TTL caching
│   ├── errors.ts                   # OAuthError extends server base class (httpStatus, wwwAuthenticate)
│   ├── middleware.ts               # Express middleware — token extraction, scope enforcement, error handler
│   ├── oauth-resource-server.ts    # RFC 9728 /.well-known/oauth-protected-resource
│   ├── scope-map.ts                # O(1) reverse lookup: tool name → required scope
│   ├── scopes.ts                   # Scope definitions, hierarchy, tool group → scope mapping
│   ├── token-validator.ts          # JWT validation via jose, JWKS caching, claim extraction
│   ├── transport-agnostic.ts       # Transport-agnostic auth utilities (createAuthenticatedContext, validateAuth)
│   ├── types.ts                    # RFC 9728/8414/7591 type definitions, config interfaces
│   └── index.ts                    # Barrel
│   # Variant for complex auth (db-mcp): middleware.ts → middleware/index.ts, scopes.ts → scopes/index.ts
│
├── audit/                          # Audit logging subsystem (servers with --audit-log)
│   ├── types.ts                    # AuditEntry, AuditConfig, AuditStats interfaces
│   ├── logger.ts                   # Async-buffered JSONL writer with log rotation
│   ├── interceptor.ts              # AuditInterceptor — scope-based tool invocation filtering
│   ├── backup-manager.ts           # Pre-mutation DDL snapshot generator (.tar.gz compressed)
│   └── index.ts                    # Barrel
│
├── transports/
│   ├── index.ts                    # Barrel
│   └── http/
│       ├── server.ts               # HTTP/SSE transport orchestrator (route registration, server lifecycle)
│       ├── streamable.ts           # Streamable HTTP transport handler (POST/GET/DELETE /mcp)
│       ├── stateless.ts            # Stateless HTTP transport handler (serverless mode)
│       ├── legacy-sse.ts           # Legacy SSE transport handler (GET /sse, POST /messages)
│       ├── handlers.ts             # Route handlers (health, 404, shared utilities)
│       ├── security.ts             # Security headers, rate limiting, CORS, DNS rebinding, body parsing
│       ├── types.ts                # Config interfaces, constants, timeout constants
│       └── index.ts                # Barrel
│
├── codemode/                       # Code Mode sandbox (10 files for non-adapter, 5+api/ for adapter)
│   ├── sandbox.ts                  # SandboxPool lifecycle (LRU script cache, vm.createContext)
│   ├── sandbox-factory.ts          # Runtime mode selection (CodeModeSandbox or WorkerSandbox)
│   ├── auto-return.ts              # Last-expression auto-return transform (IIFE helper)
│   ├── worker-sandbox.ts           # Worker thread (MessagePort RPC, resource limits, hard timeout)
│   ├── worker-script.ts            # Worker entry point (async Proxy API, vm isolation)
│   ├── api.ts                      # Tool API bridge — non-adapter servers (single file + api-constants.ts)
│   ├── api-constants.ts            # JSON-RPC codes, method names, aliases, examples, positional maps
│   ├── security.ts                 # Code validation, blocked patterns, rate limiting, result size
│   ├── types.ts                    # SandboxOptions, PoolOptions, SecurityConfig, RPC types
│   └── index.ts                    # Barrel
│   # Adapter servers with large tool sets (50+ tools) use api/ subdirectory instead:
│   # api/
│   #   index.ts                    # Main API bridge — exposes tools to sandbox
│   #   maps.ts                     # Tool name → handler function mapping
│   #   group-api.ts                # Per-group API surface generation
│   #   aliases.ts                  # Tool alias resolution
│   #   normalize.ts                # Parameter normalization utilities
│
├── adapters/                       # Adapter-based servers (db-mcp, postgres-mcp, mysql-mcp)
│   ├── database-adapter.ts         # Abstract base class
│   ├── query-validation.ts         # SELECT vs write detection
│   └── {engine}/
│       ├── {engine}-adapter.ts     # Concrete adapter
│       ├── transaction-operations.ts # Transaction helper operations (extracted from adapter)
│       ├── index.ts                # Barrel
│       ├── schema-operations/      # Schema introspection queries
│       │   ├── describe.ts         # Table/column metadata queries
│       │   ├── list.ts             # List tables/schemas/indexes
│       │   └── index.ts            # Barrel
│       ├── schemas/                # Zod schemas (per group, never inline)
│       │   ├── error-response-fields.ts # ErrorFieldsMixin (SSoT — adapter servers store here)
│       │   └── {group}/            # One subdirectory per tool group
│       ├── prompts/                # MCP prompts
│       ├── resources/              # MCP resources
│       └── tools/                  # Tool handler files (per group subdirectories)
│           ├── column-validation.ts  # Shared existence validators
│           ├── core/error-parser.ts  # Engine-specific error code mapping
│           ├── core/error-helpers.ts # formatHandlerError() orchestrator
│           └── {group}/              # One subdirectory per tool group
│
├── handlers/                       # Non-adapter servers (e.g., memory-journal-mcp)
│   ├── tools/                      # Tool handlers (per-group files or subdirectories)
│   │   ├── index.ts                # getTools() / callTool() dispatch, tool map cache
│   │   ├── schemas.ts              # Shared Zod schemas (cross-group)
│   │   ├── error-fields-mixin.ts   # Re-export stub → utils/errors/error-response-fields.ts
│   │   ├── {group}.ts              # Single-file tool groups
│   │   ├── {group}/                # Multi-file tool groups (e.g., github/, team/)
│   │   └── team/                   # Team DB mirrored tools (if multi-DB)
│   ├── resources/                  # MCP Resource handlers
│   │   ├── index.ts                # Resource registration barrel
│   │   ├── shared.ts               # Shared helpers (formatters, renderers)
│   │   ├── help.ts                 # Dynamic help resources ({prefix}://help)
│   │   ├── templates.ts            # URI template resources
│   │   ├── {domain}.ts             # Domain resources (github.ts, graph.ts, team.ts)
│   │   └── core/                   # Core static resources
│   │       ├── briefing/            # Briefing system (modular sections)
│   │       ├── health.ts            # Health resource
│   │       └── utilities.ts         # Utility resources
│   └── prompts/                    # MCP Prompt handlers
│       ├── index.ts
│       ├── workflow.ts
│       └── {domain}.ts
```

---

## Structural Rules

- Every directory has `index.ts` barrel
- Imports use `.js` extension (ESM)
- After splitting `foo.ts` → `foo/` directory: update imports from `./foo.js` → `./foo/index.js`
- Output schemas: one file per tool group, never inline
- **Error hierarchy (two valid patterns):**
  - _Non-adapter servers_ (db-mcp, memory-journal-mcp): Full `utils/errors/` decomposition (7 files) with `ErrorFieldsMixin` in `error-response-fields.ts`
  - _Adapter servers_ (postgres-mcp, mysql-mcp): Flat `types/errors.ts` with `ErrorFieldsMixin` in `schemas/error-response-fields.ts`
  - Both patterns use the same auto-refinement mechanism and `formatHandlerError()` — the difference is organizational
- **Logger (two valid patterns):**
  - _Complex servers_: `utils/logger/` subdirectory (5 files: logger, module-logger, error-codes, types, index)
  - _Simpler servers_: Flat `utils/logger.ts` + `utils/module-logger.ts` (2 files)
- Error classes: importable from both direct path and `types/` barrel (re-exported subset)
- Shared helpers: `column-validation.ts`, `helpers.ts`, `schemas.ts` per group — no tools registered in these files
- Connection pool: separate `pool/` directory when pool management has its own lifecycle (health checks, size tuning)
- Engine error parser: `tools/core/error-parser.ts` maps DB-native error codes to structured errors
- **Codemode API bridge (two valid patterns):**
  - _Non-adapter servers_: Single `api.ts` + `api-constants.ts` (aliases, examples, positional maps co-located)
  - _Adapter servers_ (50+ tools): `api/` subdirectory with dedicated `maps.ts`, `group-api.ts`, `aliases.ts`, `normalize.ts`
- **Server file extraction (progressive decomposition):**
  - When `mcp-server.ts` exceeds ~400 lines, extract into `server/` with dedicated files:
  - `built-in-tools.ts` — server_info, server_health, list_adapters registration
  - `help-resources.ts` — help resource registration filtered by `--tool-filter`
  - `audit-tools.ts` — audit resource + snapshot resource (when audit enabled)
- **Auth module (two valid patterns):**
  - _Standard_: Flat 11-file `src/auth/` directory
  - _Complex servers_ (db-mcp): `middleware.ts` → `middleware/index.ts` and `scopes.ts` → `scopes/index.ts` when these files exceed ~500 lines
- **Audit subsystem:** `src/audit/` directory (4 files + barrel) for servers with `--audit-log`. Separate from `utils/` because it has its own lifecycle (buffered writes, log rotation, graceful close)
- **Path validation:** `utils/validate-path.ts` for tools that accept file paths. Resolves canonical path, rejects `..` traversal, enforces `ALLOWED_IO_ROOTS` boundary
- **Insights manager:** `utils/insights-manager.ts` for servers with analysis/memo capabilities. In-memory bounded list exposed via `memo://insights` resource
