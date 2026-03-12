# memory-journal-mcp Code Map

> **Agent-optimized navigation reference.** Read this before searching the codebase. Covers directory layout, handler→tool mapping, type locations, error handling, and key constants.
>
> Last updated: March 12, 2026

---

## Directory Tree

```
src/
├── cli.ts                          # CLI entry point (arg parsing, --db, --transport, --tool-filter)
├── index.ts                        # Barrel re-export for library consumers
│
├── server/
│   ├── McpServer.ts                # McpServer setup, tool/resource/prompt wiring, scheduler init
│   └── Scheduler.ts                # Automated task scheduler (periodic index rebuilds, etc.)
│
├── database/
│   ├── SqliteAdapter.ts            # Database layer (sql.js WASM) — CRUD, analytics, relationships,
│   │                               #   causal graphs, significance scoring — 58KB single file
│   └── schema.ts                   # DDL schema definitions (CREATE TABLE statements)
│
├── types/
│   ├── index.ts                    # Barrel — ToolDefinition, ResourceDefinition, PromptDefinition,
│   │                               #   ServerConfig, HealthStatus, ToolContext, ToolAnnotations,
│   │                               #   ResourceAnnotations, McpIcon, DEFAULT_CONFIG, error exports
│   ├── error-types.ts              # ErrorCategory enum, ErrorResponse, ErrorContext interfaces
│   ├── errors.ts                   # MemoryJournalMcpError base + 6 subclasses (see § Error Handling)
│   ├── entities.ts                 # EntryType, SignificanceType, RelationshipType, JournalEntry,
│   │                               #   Tag, Relationship, Embedding, ImportanceBreakdown
│   ├── filtering.ts                # ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig
│   └── github.ts                   # GitHubProject, GitHubIssue, GitHubPullRequest, GitHubMilestone,
│                                   #   GitHubWorkflowRun, KanbanBoard, TrafficData, RepoStats
│
├── constants/
│   ├── ServerInstructions.ts       # Agent instructions string (26KB — system prompt)
│   ├── server-instructions.md      # Human-readable version (21KB)
│   └── icons.ts                    # MCP icon definitions per tool group
│
├── filtering/
│   └── ToolFilter.ts               # ToolFilter class — parse/apply --tool-filter expressions
│
├── utils/
│   ├── error-helpers.ts            # formatHandlerError(), formatHandlerErrorResponse(),
│   │                               #   formatZodError() (see § Error Handling)
│   ├── logger.ts                   # Logger class (structured JSON, severity filtering)
│   ├── McpLogger.ts                # MCP protocol logging integration
│   ├── progress-utils.ts           # MCP progress notification helpers
│   └── security-utils.ts           # SecurityError (extends MemoryJournalMcpError), SQL sanitization,
│                                   #   path traversal prevention
│
├── github/
│   └── GitHubIntegration.ts        # GitHub API client (Octokit) — issues, PRs, milestones,
│                                   #   projects V2, kanban, traffic, workflows — 51KB single file
│
├── vector/
│   └── VectorSearchManager.ts      # Semantic search (sentence-transformers/all-MiniLM-L6-v2) — 14KB
│
├── transports/
│   └── http/
│       ├── server.ts               # HTTP/SSE transport (Streamable HTTP + legacy SSE)
│       ├── handlers.ts             # Route handlers (POST /mcp, GET /sse, health, etc.)
│       ├── security.ts             # Security headers, rate limiting, CORS, HSTS
│       ├── types.ts                # HTTP transport types
│       └── index.ts                # Barrel
│
├── handlers/
│   ├── tools/                      # Tool handler files (see § Handler Map below)
│   ├── resources/                  # Resource handler files (see § below)
│   └── prompts/                    # Prompt handler files (see § below)
│
├── codemode/                       # Code Mode sandbox (9 files)
│   ├── types.ts                    # SandboxOptions, PoolOptions, SandboxResult, RpcRequest/Response
│   ├── security.ts                 # CodeModeSecurityManager — blocked patterns, rate limiting
│   ├── sandbox.ts                  # VM-based sandbox (dev/test) + SandboxPool with LRU cache
│   ├── worker-sandbox.ts           # Worker-thread sandbox (production) + WorkerSandboxPool
│   ├── worker-script.ts            # Worker entry point — builds mj.* proxy, vm.createContext
│   ├── sandbox-factory.ts          # Mode selection factory ('vm' / 'worker'), pool creation
│   ├── api.ts                      # API bridge — generates namespaced API from ToolDefinition[]
│   ├── api-constants.ts            # Method aliases, positional param maps, group prefix rules
│   └── index.ts                    # Barrel re-export
│
├── auth/                            # OAuth 2.1 authentication (10 files)
│   ├── types.ts                    # OAuth types, token claims, auth context
│   ├── errors.ts                   # OAuthError (extends MemoryJournalMcpError), AUTH_ error codes
│   ├── scopes.ts                   # Scope constants, hierarchy, tool-group-to-scope mapping
│   ├── token-validator.ts          # JWT validation via jose (JWKS caching, issuer/audience)
│   ├── oauth-resource-server.ts    # RFC 9728 protected resource metadata endpoint
│   ├── authorization-server-discovery.ts  # RFC 8414 AS metadata discovery with caching
│   ├── scope-map.ts                # Scope ↔ tool group bidirectional mapping
│   ├── auth-context.ts             # AsyncLocalStorage-based per-request auth context
│   ├── middleware.ts               # Express middleware for token extraction & scope enforcement
│   └── index.ts                    # Barrel re-export
```

---

## Handler → Tool Mapping

44 tools across 11 groups.

### Tool Handlers (`src/handlers/tools/`)

| Group | Handler File(s) | Tools | Key Tools |
|-------|----------------|-------|-----------|
| **core** | `core.ts` | 6 | `create_entry`, `get_entries`, `update_entry`, `delete_entry`, `get_entry_by_id`, `undelete_entry` |
| **search** | `search.ts` | 5 | `search_entries`, `search_by_tags`, `search_by_date`, `semantic_search`, `get_related` |
| **analytics** | `analytics.ts` | 3 | `get_analytics`, `get_timeline`, `get_significance_trends` |
| **relationships** | `relationships.ts` | 5 | `create_relationship`, `get_relationships`, `delete_relationship`, `get_causal_chain`, `detect_causal_patterns` |
| **export** | `export.ts` | 2 | `export_entries`, `generate_summary` |
| **admin** | `admin.ts` | 4 | `rebuild_vector_index`, `get_vector_index_stats`, `get_health_status`, `manage_scheduler` |
| **backup** | `backup.ts` | 3 | `create_backup`, `list_backups`, `restore_backup` |
| **team** | `team.ts` | 4 | `team_create_entry`, `team_get_entries`, `team_search`, `team_get_analytics` |
| **github** | `github.ts` → `github/` | 11 | See sub-handlers below |
| | `github/read-tools.ts` | 4 | `github_get_repo`, `github_get_issues`, `github_get_pull_requests`, `github_get_workflow_runs` |
| | `github/issue-tools.ts` | 2 | `github_create_issue`, `github_update_issue` |
| | `github/milestone-tools.ts` | 1 | `github_get_milestones` |
| | `github/kanban-tools.ts` | 1 | `github_get_kanban` |
| | `github/insights-tools.ts` | 2 | `github_get_traffic`, `github_get_contributors` |
| | `github/copilot-tools.ts` | 1 | `get_copilot_reviews` |
| **codemode** | `codemode.ts` | 1 | `mj_execute_code` (sandboxed JavaScript execution via `mj.*` API) |

**Non-tool handler files:**
| File | Purpose |
|------|---------|
| `index.ts` | `createToolDefinitions(ctx)` — assembles all tools, applies ToolContext |
| `schemas.ts` | Shared Zod schemas, constants (`ENTRY_TYPES`, `SIGNIFICANCE_TYPES`, `DATE_FORMAT_REGEX`), `relaxedNumber()` helper for MCP input schemas |
| `github/schemas.ts` | GitHub-specific Zod schemas |
| `github/helpers.ts` | GitHub tool shared helpers |
| `github/mutation-tools.ts` | (Placeholder for future mutation tools) |

---

## Resources (`src/handlers/resources/`)

22 resources providing read-only journal metadata:

| File | Resources |
|------|-----------|
| `core.ts` | `memory://entries`, `memory://entries/{id}`, `memory://tags`, `memory://types`, `memory://significance`, `memory://search`, `memory://dates`, `memory://recent` |
| `graph.ts` | `memory://relationships`, `memory://causal-graph`, `memory://causal-patterns` |
| `team.ts` | `memory://team/entries`, `memory://team/stats` |
| `github.ts` | `memory://github/repo`, `memory://github/issues`, `memory://github/prs`, `memory://github/milestones`, `memory://github/runs`, `memory://github/kanban` |
| `templates.ts` | `memory://templates/{name}` (workflow templates) |
| `shared.ts` | Shared resource helpers |
| `index.ts` | `createResourceDefinitions(ctx)` — assembles all resources |

---

## Prompts (`src/handlers/prompts/`)

| File | Prompts |
|------|---------|
| `index.ts` | `daily_review`, `weekly_summary`, `project_status` |
| `workflow.ts` | `onboarding_setup`, `retrospective`, `goal_tracking`, `knowledge_extraction`, etc. |
| `github.ts` | `github_project_review`, `github_issue_triage` |

---

## Error Handling

memory-journal-mcp uses a **harmonized error handling hierarchy** matching the standard across db-mcp, postgres-mcp, and mysql-mcp.

### Error Class Hierarchy

```
Error
 └── MemoryJournalMcpError          (src/types/errors.ts — base: code, category, suggestion, recoverable, toResponse())
     ├── ConnectionError             (CONNECTION_FAILED, category: connection)
     ├── QueryError                  (QUERY_FAILED, category: query)
     ├── ValidationError             (VALIDATION_FAILED, category: validation)
     ├── ResourceNotFoundError       (RESOURCE_NOT_FOUND, category: resource)
     ├── ConfigurationError          (CONFIGURATION_ERROR, category: configuration)
     ├── PermissionError             (PERMISSION_DENIED, category: permission)
     ├── OAuthError                  (src/auth/errors.ts — adds httpStatus, wwwAuthenticate)
     │   ├── TokenMissingError       (AUTH_TOKEN_MISSING, category: authentication)
     │   ├── InvalidTokenError       (AUTH_TOKEN_INVALID, category: authentication)
     │   ├── TokenExpiredError       (AUTH_TOKEN_EXPIRED, category: authentication)
     │   ├── InvalidSignatureError   (AUTH_SIGNATURE_INVALID, category: authentication)
     │   ├── InsufficientScopeError  (AUTH_SCOPE_DENIED, category: authorization)
     │   ├── AuthServerDiscoveryError(AUTH_DISCOVERY_FAILED, category: authentication)
     │   ├── JwksFetchError          (AUTH_JWKS_FETCH_FAILED, category: authentication)
     │   └── ClientRegistrationError (AUTH_REGISTRATION_FAILED, category: authentication)
     └── SecurityError               (src/utils/security-utils.ts — category: validation)
         ├── InvalidDateFormatError  (INVALID_DATE_FORMAT)
         └── PathTraversalError      (PATH_TRAVERSAL)
```

### Error Formatting Functions (`src/utils/error-helpers.ts`)

```typescript
// In every tool handler:
try {
  const parsed = Schema.parse(params);
  // ... domain logic ...
  return { success: true, ... };
} catch (err) {
  return formatHandlerError(err);            // backward-compatible: {success, error}
  // or: return formatHandlerErrorResponse(err); // enriched: {success, error, code, category, suggestion, recoverable}
}
```

| Function | Purpose |
|----------|---------|
| `formatHandlerError(err)` | Returns `{success: false, error: "..."}` — backward-compatible, used by existing handlers |
| `formatHandlerErrorResponse(err)` | Returns enriched `ErrorResponse` with `code`, `category`, `suggestion`, `recoverable` — for future handler migration |
| `formatZodError(err)` | Extracts human-readable messages from Zod validation errors |

---

## Key Constants & Config

| What | Where | Notes |
|------|-------|-------|
| Server instructions (agent prompt) | `src/constants/ServerInstructions.ts` | 26KB — exported as string constant |
| Human-readable instructions | `src/constants/server-instructions.md` | 21KB markdown version |
| MCP icons | `src/constants/icons.ts` | Per-group icon definitions |
| Tool filter | `src/filtering/ToolFilter.ts` | `ToolFilter` class (same pattern as db-mcp/mysql-mcp/postgres-mcp) |
| Default config | `src/types/index.ts` | `DEFAULT_CONFIG` — dbPath, model name, semantic search toggle |
| Security utils | `src/utils/security-utils.ts` | SQL sanitization, path traversal prevention |

---

## Architecture Patterns (Quick Reference)

| Pattern | Description |
|---------|-------------|
| **Enriched Error Handling** | `MemoryJournalMcpError` hierarchy with `ErrorCategory`, `toResponse()`, `formatHandlerErrorResponse()`. Handlers currently use `formatHandlerError()` — enriched formatter available for future migration. |
| **Single Adapter** | No adapter abstraction — `SqliteAdapter` (sql.js WASM) used directly. No native backend. |
| **ToolContext** | All tool handlers receive `ToolContext` (db, teamDb?, vectorManager?, github?, config?, progress?). |
| **GitHub Integration** | `GitHubIntegration` (Octokit-based) — issues, PRs, milestones, projects V2, kanban, traffic. |
| **Vector Search** | `VectorSearchManager` with sentence-transformers model (all-MiniLM-L6-v2, 384-dim). |
| **Scheduler** | `Scheduler` for automated periodic tasks (vector index rebuilds, etc.). |
| **Tool Filtering** | Same `ToolFilter` pattern as database MCPs — `--tool-filter` CLI flag. |
| **Smart Path Resolution** | DB path auto-detected: CLI flag → root `memory_journal.db` → `test-server/` fallback. |
| **Code Mode** | Sandboxed JavaScript execution via `mj.*` API — `mj_execute_code` runs in `worker_threads` with `MessagePort` RPC bridge (port passed via `workerData`, results via `parentPort`), secondary `vm.createContext` isolation, resource limits, and hard timeouts. |
| **OAuth 2.1** | Optional RFC-compliant OAuth 2.0 auth for HTTP transport — JWT validation, JWKS caching, scope-based access control. 10 files in `src/auth/`. |

---

## Import Path Conventions

- All imports use **`.js` extension** (ESM requirement)
- Note: memory-journal-mcp uses **PascalCase filenames** for classes (e.g., `SqliteAdapter.ts`, `McpServer.ts`)
- Types re-exported via `types/index.ts` barrel

---

## Test Infrastructure

| File / Directory | Purpose |
|-----------------|---------|
| `test-server/README.md` | Agent testing orchestration doc |
| `test-server/test-tools.md` | Pass 1: Core functionality (Phases 1-10, 44 tools + 22 resources) |
| `test-server/test-tools2.md` | Pass 2: Validation & edge cases (Phases 11-15) |
| `test-server/tool-reference.md` | Complete 44-tool inventory by group |
| `tests/` | Vitest unit tests |
| `tests/e2e/` | Playwright E2E tests (HTTP/SSE transport) |
