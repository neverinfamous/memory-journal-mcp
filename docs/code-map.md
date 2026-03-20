# memory-journal-mcp Code Map

> **Agent-optimized navigation reference.** Read this before searching the codebase. Covers directory layout, handler→tool mapping, type locations, error handling, and key constants.

---

## Directory Tree

```
src/
├── cli.ts                          # CLI entry point (arg parsing, --db, --transport, --tool-filter)
├── index.ts                        # Package entry point (barrel re-export)
│
├── server/
│   ├── mcp-server.ts               # McpServer setup, tool/resource/prompt wiring, scheduler init
│   └── scheduler.ts                # Automated task scheduler (backups, vacuum, index rebuilds)
│
├── database/
│   ├── adapter-factory.ts          # DatabaseAdapterFactory — creates SqliteAdapter
│   ├── core/
│   │   ├── interfaces.ts           # IDatabaseAdapter, IDatabaseConnection interfaces
│   │   ├── schema.ts               # DDL schema definitions (CREATE TABLE, FTS5 virtual table, sync triggers)
│   │   └── entry-columns.ts        # ENTRY_COLUMNS projection constant
│   └── sqlite-adapter/
│       ├── native-connection.ts    # NativeConnectionManager (better-sqlite3 + sqlite-vec extension)
│       ├── entries/
│       │   ├── crud.ts             # Entry CRUD operations
│       │   ├── search.ts           # FTS5 full-text search (BM25 ranking, LIKE fallback), date range queries
│       │   ├── statistics.ts       # Analytics queries (counts, breakdowns, trends)
│       │   ├── importance.ts       # calculateImportance() scoring
│       │   ├── shared.ts           # Shared entry query helpers (queryRow, queryRows)
│       │   └── index.ts            # Barrel
│       ├── tags.ts                 # Tag CRUD, batch linking, merge
│       ├── relationships.ts        # Relationship queries, causal chains
│       ├── backup.ts               # Backup/restore operations
│       └── index.ts                # SqliteAdapter class, barrel
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
│   ├── server-instructions.ts      # Agent instructions generator — 3 tiers: essential (~1.2K tokens), standard (~1.4K), full (~6.7K)
│   ├── server-instructions.md      # Human-readable version of the instructions
│   └── icons.ts                    # MCP icon definitions per tool group
│
├── filtering/
│   └── tool-filter.ts              # ToolFilter class — parse/apply --tool-filter expressions
│
├── utils/
│   ├── error-helpers.ts            # formatHandlerError(), formatZodError()
│   │                               #   (see § Error Handling)
│   ├── logger.ts                   # Logger class (structured JSON, severity filtering)
│   ├── mcp-logger.ts               # MCP protocol logging integration
│   ├── progress-utils.ts           # MCP progress notification helpers
│   ├── security-utils.ts           # SecurityError (extends MemoryJournalMcpError), SQL sanitization,
│   │                               #   path traversal prevention, sanitizeAuthor()
│   ├── github-helpers.ts           # Shared resolveIssueUrl() helper
│   └── vector-index-helpers.ts     # autoIndexEntry() helper for fire-and-forget indexing
│
├── github/
│   └── github-integration/
│       ├── client.ts               # GitHubClient — Octokit wrapper, TTL-aware LRU cache
│       ├── repository.ts           # Repository info, context detection
│       ├── issues.ts               # Issue queries, create/close
│       ├── pull-requests.ts        # PR queries
│       ├── milestones.ts           # Milestone CRUD
│       ├── projects.ts             # Projects V2, Kanban boards, item management
│       ├── insights.ts             # Repo stats, traffic, referrers, popular paths
│       ├── types.ts                # Internal GitHub types
│       └── index.ts                # GitHubIntegration class, barrel
│
├── vector/
│   └── vector-search-manager.ts    # Semantic search (sqlite-vec + @huggingface/transformers
│                                   #   all-MiniLM-L6-v2, 384-dim) — 13KB
│
├── transports/
│   └── http/
│       ├── handlers.ts             # Route handlers (health, root info, bearer auth middleware)
│       ├── security.ts             # Security headers, built-in rate limiting, CORS, HSTS
│       ├── types.ts                # HTTP transport types, constants
│       ├── server/
│       │   ├── stateful.ts         # Stateful HTTP transport (session management)
│       │   ├── stateless.ts        # Stateless HTTP transport (serverless)
│       │   ├── legacy-sse.ts       # Legacy SSE transport (MCP 2024-11-05)
│       │   └── index.ts            # HttpTransport class, barrel
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
├── auth/                            # OAuth 2.1 authentication (11 files)
│   ├── types.ts                    # OAuth types, token claims, auth context
│   ├── errors.ts                   # OAuthError (extends MemoryJournalMcpError), AUTH_ error codes
│   ├── scopes.ts                   # Scope constants, hierarchy, tool-group-to-scope mapping
│   ├── token-validator.ts          # JWT validation via jose (JWKS caching, issuer/audience)
│   ├── oauth-resource-server.ts    # RFC 9728 protected resource metadata endpoint
│   ├── authorization-server-discovery.ts  # RFC 8414 AS metadata discovery with caching
│   ├── scope-map.ts                # Scope ↔ tool group bidirectional mapping
│   ├── auth-context.ts             # AsyncLocalStorage-based per-request auth context
│   ├── middleware.ts               # Express middleware for token extraction & scope enforcement
│   ├── transport-agnostic.ts       # Transport-agnostic auth utilities (createAuthenticatedContext, etc.)
│   └── index.ts                    # Barrel re-export
```

---

## Handler → Tool Mapping

56 tools across 10 groups.

### Tool Handlers (`src/handlers/tools/`)

| Group             | Handler File(s)             | Tools |                                                                                                                        Key Tools |
| ----------------- | --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------: |
| **core**          | `core.ts`                   | 6     |                      `create_entry`, `create_entry_minimal`, `get_recent_entries`, `get_entry_by_id`, `test_simple`, `list_tags` |
| **search**        | `search.ts`                 | 4     |                                            `search_entries`, `search_by_date_range`, `semantic_search`, `get_vector_index_stats` |
| **analytics**     | `analytics.ts`              | 2     |                                                                                   `get_statistics`, `get_cross_project_insights` |
| **relationships** | `relationships.ts`          | 2     |                                                                                        `link_entries`, `visualize_relationships` |
| **export**        | `export.ts`                 | 1     |                                                                                                                 `export_entries` |
| **admin**         | `admin.ts`                  | 5     |                                      `update_entry`, `delete_entry`, `merge_tags`, `rebuild_vector_index`, `add_to_vector_index` |
| **backup**        | `backup.ts`                 | 4     |                                                            `backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups` |
| **team**          | `team.ts`                   | 3     |                                                                            `team_create_entry`, `team_get_recent`, `team_search` |
| **github**        | `github.ts` → `github/`     | 16    |                                                                                                           See sub-handlers below |
|                   | `github/read-tools.ts`      | 5     |                                 `get_github_issues`, `get_github_issue`, `get_github_prs`, `get_github_pr`, `get_github_context` |
|                   | `github/issue-tools.ts`     | 2     |                                                                `create_github_issue_with_entry`, `close_github_issue_with_entry` |
|                   | `github/kanban-tools.ts`    | 2     |                                                                                           `get_kanban_board`, `move_kanban_item` |
|                   | `github/milestone-tools.ts` | 5     | `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone` |
|                   | `github/insights-tools.ts`  | 1     |                                                                                                              `get_repo_insights` |
|                   | `github/copilot-tools.ts`   | 1     |                                                                                                            `get_copilot_reviews` |
| **codemode**      | `codemode.ts`               | 1     |                                                                `mj_execute_code` (sandboxed JavaScript execution via `mj.*` API) |

**Non-tool handler files:**
| File | Purpose |
|------|---------|
| `index.ts` | `createToolDefinitions(ctx)` — assembles all tools, applies ToolContext |
| `schemas.ts` | Shared Zod schemas, constants (`ENTRY_TYPES`, `SIGNIFICANCE_TYPES`, `DATE_FORMAT_REGEX`), `relaxedNumber()` helper for MCP input schemas |
| `error-fields-mixin.ts` | Shared `ErrorFieldsMixin` Zod fragment — extended into all output schemas for `formatHandlerError()` compatibility |
| `github/schemas.ts` | GitHub-specific Zod schemas |
| `github/helpers.ts` | GitHub tool shared helpers |
| `github/mutation-tools.ts` | (Placeholder for future mutation tools) |

---

## Resources (`src/handlers/resources/`)

22 resources providing read-only journal metadata:

| File                   | Resources                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core/`                | Core resources (briefing, instructions, health, utilities)                                                                                                                                                                     |
| `core/briefing/`       | `memory://briefing` — modular builders (github-section, context-section, user-message)                                                                                                                                         |
| `core/instructions.ts` | `memory://instructions`                                                                                                                                                                                                        |
| `core/health.ts`       | `memory://health`                                                                                                                                                                                                              |
| `core/utilities.ts`    | `memory://recent`, `memory://significant`, `memory://tags`, `memory://statistics`                                                                                                                                              |
| `graph.ts`             | `memory://graph/recent`, `memory://graph/actions`, `memory://actions/recent`                                                                                                                                                   |
| `team.ts`              | `memory://team/recent`, `memory://team/statistics`                                                                                                                                                                             |
| `github.ts`            | `memory://github/status`, `memory://github/insights`, `memory://github/milestones`                                                                                                                                             |
| `templates.ts`         | Template resources (`memory://projects/{N}/timeline`, `memory://issues/{N}/entries`, `memory://prs/{N}/entries`, `memory://prs/{N}/timeline`, `memory://kanban/{N}`, `memory://kanban/{N}/diagram`, `memory://milestones/{N}`) |
| `shared.ts`            | Shared resource helpers (`resolveGitHubRepo()`, `milestoneCompletionPct()`, etc.)                                                                                                                                              |
| `index.ts`             | `createResourceDefinitions(ctx)` — assembles all resources                                                                                                                                                                     |

---

## Prompts (`src/handlers/prompts/`)

| File          | Prompts                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | Barrel + prompt assembly                                                                                                                                                                 |
| `workflow.ts` | `find-related`, `prepare-standup`, `prepare-retro`, `weekly-digest`, `analyze-period`, `goal-tracker`, `get-context-bundle`, `get-recent-entries`, `confirm-briefing`, `session-summary` |
| `github.ts`   | `project-status-summary`, `pr-summary`, `code-review-prep`, `pr-retrospective`, `actions-failure-digest`, `project-milestone-tracker`                                                    |

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
  return formatHandlerError(err); // enriched: {success, error, code, category, suggestion, recoverable}
}
```

| Function                  | Purpose                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `formatHandlerError(err)` | Returns enriched `ErrorResponse` with `code`, `category`, `suggestion`, `recoverable` — used by all handlers |
| `formatZodError(err)`     | Extracts human-readable messages from Zod validation errors                                                  |

---

## Key Constants & Config

| What                               | Where                                  | Notes                                                                                                                            |
| ---------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Server instructions (agent prompt) | `src/constants/server-instructions.ts` | `generateInstructions(enabledTools, prompts, latestEntry, level)` — configurable via `--instruction-level` / `INSTRUCTION_LEVEL` |
| Human-readable instructions        | `src/constants/server-instructions.md` | Human-readable markdown version                                                                                                  |
| MCP icons                          | `src/constants/icons.ts`               | Per-group icon definitions                                                                                                       |
| Tool filter                        | `src/filtering/tool-filter.ts`         | `ToolFilter` class (same pattern as db-mcp/mysql-mcp/postgres-mcp)                                                               |
| Default config                     | `src/types/index.ts`                   | `DEFAULT_CONFIG` — dbPath, model name, semantic search toggle                                                                    |
| Security utils                     | `src/utils/security-utils.ts`          | SQL sanitization, path traversal prevention, author sanitization                                                                 |

---

## Architecture Patterns (Quick Reference)

| Pattern                     | Description                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enriched Error Handling** | `MemoryJournalMcpError` hierarchy with `ErrorCategory`, `toResponse()`, `formatHandlerError()`. All handlers use enriched formatter. Output schemas include `ErrorFieldsMixin` for validation compatibility.                                                   |
| **Native SQLite**           | `better-sqlite3` for high-performance native disk access. `sqlite-vec` extension loaded for vector search. No WASM fallback.                                                                                                                                   |
| **Adapter Factory**         | `DatabaseAdapterFactory.create()` in `adapter-factory.ts` instantiates `SqliteAdapter`.                                                                                                                                                                        |
| **ToolContext**             | All tool handlers receive `ToolContext` (db, teamDb?, vectorManager?, github?, config?, progress?).                                                                                                                                                            |
| **GitHub Integration**      | `GitHubIntegration` class in `github-integration/` directory — modularized into client, issues, PRs, milestones, projects, insights.                                                                                                                           |
| **Vector Search**           | `VectorSearchManager` with `sqlite-vec` KNN queries + `@huggingface/transformers` embeddings (all-MiniLM-L6-v2, 384-dim). Embeddings stored in `vec_embeddings` virtual table.                                                                                 |
| **Scheduler**               | `Scheduler` for automated periodic tasks (backups, vacuum, vector index rebuilds).                                                                                                                                                                             |
| **Tool Filtering**          | Same `ToolFilter` pattern as database MCPs — `--tool-filter` CLI flag.                                                                                                                                                                                         |
| **Code Mode**               | Sandboxed JavaScript execution via `mj.*` API — `mj_execute_code` runs in `worker_threads` with `MessagePort` RPC bridge (port passed via `workerData`, results via `parentPort`), secondary `vm.createContext` isolation, resource limits, and hard timeouts. |
| **OAuth 2.1**               | Optional RFC-compliant OAuth 2.0 auth for HTTP transport — JWT validation, JWKS caching, scope-based access control. 11 files in `src/auth/`.                                                                                                                  |

---

## Import Path Conventions

- All imports use **`.js` extension** (ESM requirement)
- Filenames use **kebab-case** (e.g., `mcp-server.ts`, `sqlite-adapter/`, `tool-filter.ts`)
- Types re-exported via `types/index.ts` barrel

---

## Test Infrastructure

| File / Directory                          | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `test-server/README.md`                   | Agent testing orchestration doc                                                |
| `test-server/test-tools.md`               | Pass 1: Core functionality (Phases 0-10, 56 tools + 22 resources + 16 prompts) |
| `test-server/test-tools2.md`              | Pass 2: Validation & edge cases (Phases 11-15)                                 |
| `test-server/test-tools-codemode.md`      | Pass 3: Code Mode foundations (Phases 16-21)                                   |
| `test-server/test-tools-codemode2.md`     | Pass 4: Code Mode advanced (Phases 22-27)                                      |
| `test-server/test-instruction-levels.mjs` | Integration: instruction level ordering test (stdio)                           |
| `test-server/test-tool-annotations.mjs`   | Integration: tool annotation counts test (stdio)                               |
| `test-server/test-scheduler.mjs`          | Integration: scheduler job verification (HTTP, ~130s)                          |
| `docs/tool-reference.md`                  | Complete 44-tool inventory by group                                            |
| `tests/`                                  | Vitest unit tests                                                              |
| `tests/auth/`                             | Auth module unit tests (OAuth, JWT, scopes)                                    |
| `tests/e2e/`                              | Playwright E2E tests (HTTP/SSE transport)                                      |
