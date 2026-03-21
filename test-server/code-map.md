# memory-journal-mcp Code Map

> **Agent-optimized navigation reference.** Read this before searching the codebase. Covers directory layout, handler→tool mapping, resources, prompts, error hierarchy, and key constants.
>
> Last updated: March 21, 2026

---

## Directory Tree

```
src/
├── cli.ts                          # CLI entry point (arg parsing, transport selection)
├── index.ts                        # Barrel re-export for library consumers
├── version.ts                      # Version SSoT — reads package.json, exports VERSION
│
├── server/
│   ├── mcp-server.ts               # McpServer setup, tool/resource/prompt wiring
│   ├── registration.ts             # Tool/resource/prompt registration logic
│   └── scheduler.ts                # HTTP-only automated scheduling (backup, vacuum, rebuild-index)
│
├── types/                          # Core TypeScript types (barrel: types/index.ts)
│   ├── entities.ts                 # EntryType, SignificanceType, RelationshipType, JournalEntry, Tag, Relationship, Embedding
│   ├── error-types.ts              # ErrorCategory enum + ErrorResponse/ErrorContext interfaces
│   ├── errors.ts                   # MemoryJournalMcpError (base) + 5 concrete error subclasses
│   ├── filtering.ts                # ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig
│   ├── github.ts                   # GitHubProject, GitHubIssue, GitHubPullRequest, GitHubMilestone, KanbanBoard, RepoStats, etc.
│   └── index.ts                    # Barrel — re-exports all sub-modules + ToolDefinition, ResourceDefinition, PromptDefinition, ServerConfig
│
├── constants/
│   ├── icons.ts                    # MCP icon definitions per tool group (CDN SVG URLs)
│   ├── server-instructions.md      # Source markdown for behavioral instruction levels
│   └── server-instructions.ts      # Behavioral guidance + GOTCHAS_CONTENT export + generateInstructions()
│
├── filtering/
│   └── tool-filter.ts              # ToolFilter class — parse/apply --tool-filter expressions, group/shortcut/tool resolution
│
├── utils/
│   ├── error-helpers.ts            # formatHandlerError() — structured {success:false} builder
│   ├── github-helpers.ts           # GitHub token scrubbing and helper utilities
│   ├── logger.ts                   # Logger class (structured JSON, severity filtering)
│   ├── mcp-logger.ts               # MCP-specific logger with module prefixing
│   ├── progress-utils.ts           # MCP progress notification helpers (ProgressContext)
│   ├── security-utils.ts           # Input validation, SQL injection prevention, path traversal guards
│   ├── vector-index-helpers.ts     # Vector index utility helpers
│   └── errors/
│       └── error-response-fields.ts # ErrorFieldsMixin SSoT — 6 optional error fields for output schemas
│
├── auth/                           # OAuth 2.1 implementation
│   ├── auth-context.ts             # Auth context utilities
│   ├── middleware.ts               # Express-style OAuth middleware
│   ├── token-validator.ts          # JWT/JWKS token validation
│   ├── scopes.ts                   # Scope parsing and enforcement
│   ├── scope-map.ts                # Tool→scope mapping (read/write/admin)
│   ├── oauth-resource-server.ts    # RFC 9728 /.well-known/oauth-protected-resource
│   ├── authorization-server-discovery.ts  # RFC 8414 auth server metadata discovery
│   ├── transport-agnostic.ts       # Non-Express auth re-exports for transport portability
│   ├── errors.ts                   # OAuth-specific error classes
│   ├── types.ts                    # OAuth TypeScript types
│   └── index.ts                    # Barrel
│
├── transports/
│   └── http/
│       ├── handlers.ts             # HTTP request handlers (root info, health)
│       ├── security.ts             # Security headers, rate limiting, CORS, body parsing
│       ├── types.ts                # HTTP transport types
│       ├── index.ts                # Barrel
│       └── server/
│           ├── index.ts            # HTTP server factory (stateful/stateless selection)
│           ├── stateful.ts         # Stateful HTTP transport (Streamable HTTP + session management)
│           ├── stateless.ts        # Stateless HTTP transport (serverless mode)
│           └── legacy-sse.ts       # Legacy SSE transport (MCP 2024-11-05 compat)
│
├── codemode/                       # Code Mode sandbox (secure JS execution)
│   ├── sandbox.ts                  # SandboxPool lifecycle manager
│   ├── sandbox-factory.ts          # Sandbox creation factory
│   ├── worker-sandbox.ts           # Worker thread sandbox (MessagePort RPC bridge)
│   ├── worker-script.ts            # Worker thread entry point — builds mj.* API proxy; Proxy trap returns structured errors for readonly mode
│   ├── api.ts                      # mj.* API bridge (exposes tools to sandbox)
│   ├── api-constants.ts            # API bridge constants, method→group map, JSON-RPC codes
│   ├── security.ts                 # Code validation (blocked patterns, injection prevention)
│   ├── types.ts                    # Sandbox TypeScript types
│   └── index.ts                    # Barrel
│
├── database/
│   ├── adapter-factory.ts          # Database adapter factory (creates SqliteAdapter)
│   ├── core/
│   │   ├── interfaces.ts           # IDatabaseAdapter interface (database contract)
│   │   ├── schema.ts               # Database schema DDL (tables, indexes, FTS5)
│   │   └── entry-columns.ts        # Column name constants for entry queries
│   └── sqlite-adapter/
│       ├── index.ts                # SqliteAdapter class (implements IDatabaseAdapter)
│       ├── native-connection.ts    # better-sqlite3 connection management
│       ├── backup.ts               # Backup/restore operations
│       ├── tags.ts                 # Tag CRUD and merge operations
│       ├── relationships.ts        # Entry relationship operations
│       └── entries/
│           ├── index.ts            # Entry operations barrel
│           ├── crud.ts             # Entry create/read/update/delete
│           ├── search.ts           # FTS5 search, date-range search
│           ├── importance.ts       # Importance scoring algorithm
│           ├── statistics.ts       # Journal statistics and analytics
│           └── shared.ts           # Shared entry query helpers
│
├── vector/
│   └── vector-search-manager.ts    # VectorSearchManager — sqlite-vec + @huggingface/transformers integration
│
├── github/
│   └── github-integration/
│       ├── index.ts                # GitHubIntegration class (facade for all GitHub operations)
│       ├── client.ts               # GitHub REST API client (Octokit wrapper)
│       ├── repository.ts           # Repository context detection (owner/repo from git remote)
│       ├── issues.ts               # Issue operations (list, get, create, close)
│       ├── pull-requests.ts        # PR operations (list, get)
│       ├── projects.ts             # GitHub Projects v2 / Kanban operations (GraphQL)
│       ├── milestones.ts           # Milestone CRUD (create, get, update, delete)
│       ├── insights.ts             # Repository insights (stars, forks, traffic, referrers)
│       └── types.ts                # GitHub integration internal types
│
└── handlers/
    ├── tools/                      # Tool handlers — see § Handler Map below
    │   ├── index.ts                # getTools() / callTool() dispatch, tool map cache
    │   ├── schemas.ts              # Shared Zod input schemas (reused across groups)
    │   ├── error-fields-mixin.ts   # Re-export stub → canonical SSoT at utils/errors/error-response-fields.ts
    │   ├── core.ts                 # Core tool group (6 tools)
    │   ├── search.ts               # Search tool group (4 tools)
    │   ├── analytics.ts            # Analytics tool group (2 tools)
    │   ├── relationships.ts        # Relationships tool group (2 tools)
    │   ├── export.ts               # Export tool group (1 tool)
    │   ├── admin.ts                # Admin tool group (5 tools)
    │   ├── backup.ts               # Backup tool group (4 tools)
    │   ├── codemode.ts             # Code Mode tool group (1 tool)
    │   ├── team/                   # Team tool group (20 tools)
    │   │   ├── index.ts            # Barrel — composes all team sub-modules
    │   │   ├── helpers.ts          # Shared team helpers (author batch-fetch, constants)
    │   │   ├── schemas.ts          # Team Zod input/output schemas (all 20 tools)
    │   │   ├── core-tools.ts       # Core team tools (create, get_by_id, get_recent, list_tags)
    │   │   ├── search-tools.ts     # Search team tools (search, search_by_date_range)
    │   │   ├── admin-tools.ts      # Admin team tools (update, delete, merge_tags)
    │   │   ├── analytics-tools.ts  # Analytics team tools (get_statistics, get_cross_project_insights)
    │   │   ├── relationship-tools.ts # Relationship team tools (link, visualize)
    │   │   ├── export-tools.ts     # Export team tool (export_entries)
    │   │   ├── backup-tools.ts     # Backup team tools (backup, list_backups)
    │   │   └── vector-tools.ts     # Vector team tools (semantic_search, vector_index_stats, rebuild, add)
    │   ├── github.ts               # GitHub tools barrel (re-exports from github/ subdirectory)
    │   └── github/                 # GitHub tool handlers (split by domain)
    │       ├── helpers.ts          # Shared GitHub tool helpers (repo detection, error formatting)
    │       ├── schemas.ts          # GitHub tool Zod input/output schemas
    │       ├── read-tools.ts       # Read-only GitHub tools (get_github_issues, get_github_prs, get_github_issue, get_github_pr, get_github_context)
    │       ├── issue-tools.ts      # Issue lifecycle tools (create_github_issue_with_entry, close_github_issue_with_entry)
    │       ├── kanban-tools.ts     # Kanban tools (get_kanban_board, move_kanban_item)
    │       ├── milestone-tools.ts  # Milestone CRUD tools (5 tools)
    │       ├── insights-tools.ts   # Insights tool (get_repo_insights)
    │       ├── copilot-tools.ts    # Copilot tool (get_copilot_reviews)
    │       └── mutation-tools.ts   # Mutation tools barrel
    │
    ├── resources/                  # Resource handlers
    │   ├── index.ts                # Resource registration barrel
    │   ├── shared.ts               # Shared resource helpers (formatters, entry rendering)
    │   ├── github.ts               # GitHub static resources (status, insights, milestones)
    │   ├── graph.ts                # Graph resources (recent relationships, actions narrative)
    │   ├── team.ts                 # Team resources (recent, statistics)
    │   ├── help.ts                 # Dynamic help resources (memory://help, memory://help/{group}, memory://help/gotchas)
    │   ├── templates.ts            # Template resources (projects, issues, PRs, kanban, milestones)
    │   └── core/
    │       ├── index.ts            # Core static resources barrel
    │       ├── health.ts           # memory://health resource
    │       ├── instructions.ts     # memory://instructions resource
    │       ├── utilities.ts        # memory://recent, memory://significant, memory://tags, memory://statistics, memory://rules, memory://workflows, memory://skills
    │       └── briefing/
    │           ├── index.ts        # memory://briefing resource (assembles sections)
    │           ├── context-section.ts   # Journal context section (entry count, recent entries)
    │           ├── github-section.ts    # GitHub context section (repo, CI, issues, PRs, milestones, insights)
    │           └── user-message.ts      # User message section (rules, skills awareness)
    │
    └── prompts/                    # Prompt handlers
        ├── index.ts                # Prompt registration barrel
        ├── workflow.ts             # 10 workflow prompts (standup, retro, digest, analysis, etc., confirm-briefing)
        └── github.ts              # 6 GitHub prompts (project-status-summary, pr-summary, code-review-prep, pr-retrospective, actions-failure-digest, project-milestone-tracker)
```

---

## Handler → Tool Mapping

Each file below registers tools with `group` labels. The `index.ts` barrel composes all groups via `getAllToolDefinitions()`.

### Tool Handlers (`src/handlers/tools/`)

| Group             | Handler File(s)                    | Tools | Key Exports                                                                                                                          |
| ----------------- | ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **codemode**      | `codemode.ts`                      | 1     | `mj_execute_code`                                                                                                                    |
| **core**          | `core.ts`                          | 6     | `create_entry`, `get_entry_by_id`, `get_recent_entries`, `create_entry_minimal`, `test_simple`, `list_tags`                          |
| **search**        | `search.ts`                        | 4     | `search_entries`, `search_by_date_range`, `semantic_search`, `get_vector_index_stats`                                                |
| **analytics**     | `analytics.ts`                     | 2     | `get_statistics`, `get_cross_project_insights`                                                                                       |
| **relationships** | `relationships.ts`                 | 2     | `link_entries`, `visualize_relationships`                                                                                            |
| **export**        | `export.ts`                        | 1     | `export_entries`                                                                                                                     |
| **admin**         | `admin.ts`                         | 5     | `update_entry`, `delete_entry`, `merge_tags`, `rebuild_vector_index`, `add_to_vector_index`                                          |
| **github**        | `github/read-tools.ts`             | 5     | `get_github_issues`, `get_github_prs`, `get_github_issue`, `get_github_pr`, `get_github_context`                                    |
|                   | `github/issue-tools.ts`            | 2     | `create_github_issue_with_entry`, `close_github_issue_with_entry`                                                                    |
|                   | `github/kanban-tools.ts`           | 2     | `get_kanban_board`, `move_kanban_item`                                                                                               |
|                   | `github/milestone-tools.ts`        | 5     | `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone`     |
|                   | `github/insights-tools.ts`         | 1     | `get_repo_insights`                                                                                                                  |
|                   | `github/copilot-tools.ts`          | 1     | `get_copilot_reviews`                                                                                                                |
| **backup**        | `backup.ts`                        | 4     | `backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups`                                                                |
| **team**          | `team/core-tools.ts`               | 4     | `team_create_entry`, `team_get_entry_by_id`, `team_get_recent`, `team_list_tags`                                                     |
|                   | `team/search-tools.ts`             | 2     | `team_search`, `team_search_by_date_range`                                                                                           |
|                   | `team/admin-tools.ts`              | 3     | `team_update_entry`, `team_delete_entry`, `team_merge_tags`                                                                          |
|                   | `team/analytics-tools.ts`          | 2     | `team_get_statistics`, `team_get_cross_project_insights`                                                                             |
|                   | `team/relationship-tools.ts`       | 2     | `team_link_entries`, `team_visualize_relationships`                                                                                  |
|                   | `team/export-tools.ts`             | 1     | `team_export_entries`                                                                                                                |
|                   | `team/backup-tools.ts`             | 2     | `team_backup`, `team_list_backups`                                                                                                   |
|                   | `team/vector-tools.ts`             | 4     | `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`                       |

### Utility Files (no tools, shared helpers)

| File                             | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `index.ts`                       | `getTools()` / `callTool()` dispatch, O(1) tool map cache, icon mapping    |
| `schemas.ts`                     | Shared Zod input/output schemas reused across multiple tool groups         |
| `error-fields-mixin.ts`          | Re-export stub → `utils/errors/error-response-fields.ts` (canonical SSoT)  |
| `../version.ts`                  | Version SSoT — reads `package.json`, exports `VERSION`                     |
| `github/helpers.ts`              | GitHub repo auto-detection, error formatting, token scrubbing              |
| `github/schemas.ts`              | Zod input/output schemas for all 16 GitHub tools                           |
| `github/mutation-tools.ts`       | GitHub mutation tools barrel (re-exports issue + kanban + milestone tools)  |

---

## Resources (`src/handlers/resources/`)

27 resources total — 20 static + 7 template.

### Static Resources

| Handler File             | Resources                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `core/briefing/index.ts` | `memory://briefing` — session initialization (~300 tokens)                                        |
| `core/instructions.ts`   | `memory://instructions` — behavioral guidance for AI agents                                       |
| `core/health.ts`         | `memory://health` — server health & diagnostics                                                   |
| `core/utilities.ts`      | `memory://recent`, `memory://significant`, `memory://tags`, `memory://statistics`, `memory://rules`, `memory://workflows`, `memory://skills` |
| `github.ts`              | `memory://github/status`, `memory://github/insights`, `memory://github/milestones`                |
| `graph.ts`               | `memory://graph/recent`, `memory://graph/actions`, `memory://actions/recent`                      |
| `team.ts`                | `memory://team/recent`, `memory://team/statistics`                                                |
| `help.ts`                | `memory://help` (tool group index), `memory://help/{group}` (per-group tool details), `memory://help/gotchas` (field notes) |

### Template Resources

| Handler File    | Resources                                                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `templates.ts`  | `memory://projects/{number}/timeline`, `memory://issues/{issue_number}/entries`, `memory://prs/{pr_number}/entries`, `memory://prs/{pr_number}/timeline`, `memory://kanban/{project_number}`, `memory://kanban/{project_number}/diagram`, `memory://milestones/{number}` |

### Briefing Assembly (`src/handlers/resources/core/briefing/`)

The `memory://briefing` resource is modular — each section is a separate file:

| File                  | Section                                                        |
| --------------------- | -------------------------------------------------------------- |
| `index.ts`            | Assembles all sections, respects instruction level              |
| `context-section.ts`  | Journal context (entry count, recent entries, team DB)          |
| `github-section.ts`   | GitHub context (repo, CI, issues, PRs, milestones, insights)   |
| `user-message.ts`     | User message (rules file, skills directory awareness)           |

---

## Prompts (`src/handlers/prompts/`)

16 workflow prompts total.

| File          | Prompts                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workflow.ts` | `find-related`, `prepare-standup`, `prepare-retro`, `weekly-digest`, `analyze-period`, `goal-tracker`, `get-context-bundle`, `get-recent-entries`, `confirm-briefing`, `session-summary` |
| `github.ts`   | `project-status-summary`, `pr-summary`, `code-review-prep`, `pr-retrospective`, `actions-failure-digest`, `project-milestone-tracker`                                                    |
| `index.ts`    | Barrel — re-exports workflow + GitHub prompts, `getPrompt()` / `getPrompts()` dispatch                                                                                                   |

---

## Error Class Hierarchy

All errors extend `MemoryJournalMcpError` (defined in `src/types/errors.ts`). Every tool returns structured `{success: false, error, code, category, suggestion, recoverable}` via `formatHandlerError()` — never raw MCP exceptions.

```
MemoryJournalMcpError (errors.ts)
├── ConnectionError         code: CONNECTION_FAILED       category: connection      recoverable: true
├── QueryError              code: QUERY_FAILED            category: query
├── ValidationError         code: VALIDATION_FAILED       category: validation
├── ResourceNotFoundError   code: RESOURCE_NOT_FOUND      category: resource         accepts: resourceType, identifier
├── ConfigurationError      code: CONFIGURATION_ERROR     category: configuration
└── PermissionError         code: PERMISSION_DENIED       category: permission
```

**ErrorCategory enum** (`src/types/error-types.ts`): `validation`, `connection`, `query`, `permission`, `configuration`, `resource`, `authentication`, `authorization`, `internal`

**Usage pattern** — all tool handlers:

```typescript
import { ValidationError } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'

// Throw typed errors:
throw new ValidationError('Entry ID required')

// Catch at handler boundary:
catch (error) {
  return formatHandlerError(error)
}
```

---

## Key Constants & Config

| What                               | Where                              | Notes                                                                                          |
| ---------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Server instructions (agent prompt) | `src/constants/server-instructions.ts` | Behavioral guidance + `GOTCHAS_CONTENT` export + `generateInstructions()` (`essential`, `standard`, `full`) |
| Instruction source markdown        | `src/constants/server-instructions.md` | Source content for behavioral instruction levels (tool reference served via `memory://help/{group}`)        |
| Tool group icon mapping            | `src/constants/icons.ts`               | CDN SVG URLs per tool group (used in `tools/list` responses)                                |
| Tool filter logic                  | `src/filtering/tool-filter.ts`         | `ToolFilter` class — shortcuts, groups, tool-level whitelist/blacklist                      |
| Resource annotation presets        | `src/utils/resource-annotations.ts`    | Centralized presets (`HIGH_PRIORITY`, `MEDIUM_PRIORITY`, `LOW_PRIORITY`, `ASSISTANT_FOCUSED`) + helpers (`withPriority`, `withAutoRead`, `withSessionInit`) |
| Code Mode API constants            | `src/codemode/api-constants.ts`        | Method→group map, JSON-RPC error codes, sandbox method names                                |
| Logger                             | `src/utils/logger.ts`                  | Structured JSON logging with severity filtering                                              |
| Security utilities                 | `src/utils/security-utils.ts`          | Input validation, SQL injection prevention, path traversal protection, token scrubbing       |
| Error formatter                    | `src/utils/error-helpers.ts`           | `formatHandlerError()` — structured error response builder                                   |
| Database schema DDL                | `src/database/core/schema.ts`          | Table definitions, indexes, FTS5 virtual table                                               |
| Database adapter interface         | `src/database/core/interfaces.ts`      | `IDatabaseAdapter` contract (all DB operations)                                              |
| Default config                     | `src/types/index.ts`                   | `DEFAULT_CONFIG` with default db path, model name, semantic search enabled                   |
| OAuth scope mapping                | `src/auth/scope-map.ts`               | Tool→scope mapping: `read`, `write`, `admin`                                                 |

---

## Architecture Patterns (Quick Reference)

| Pattern                    | Description                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured Errors**      | Every tool returns `{success: false, error, code, category, suggestion, recoverable}` — never raw exceptions. Uses `formatHandlerError()`.                                                           |
| **Tool Context**           | `ToolContext` passes `db`, `teamDb?`, `vectorManager?`, `teamVectorManager?`, `github?`, `config?`, `progress?` to all tool group modules. Each group factory receives context and returns `ToolDefinition[]`. |
| **Tool Map Cache**         | `getTools()` + `callTool()` share a `Map<string, ToolDefinition>` cache (O(1) lookup). Cache invalidates when context refs change. `mappedToolsCache` avoids re-mapping for unfiltered calls.        |
| **Code Mode Bridge**       | `mj.*` API in worker thread communicates via MessagePort RPC to main thread tool handlers. All 10 groups exposed (`core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team`). Readonly mode halts execution gracefully and returns structured errors via proxy traps. |
| **Tool Filtering**         | `ToolFilter` parses `--tool-filter` string → whitelist/blacklist of tool names. `codemode` auto-injected unless explicitly excluded. Shortcuts: `starter`, `essential`, `readonly`.                   |
| **Briefing System**        | `memory://briefing` assembled from modular sections (context, GitHub, user message). Configurable via 12 env vars / CLI flags (incl. `--workflow-summary`/`MEMORY_JOURNAL_WORKFLOW_SUMMARY` for `memory://workflows`). Instruction levels: `essential`, `standard`, `full`.   |
| **GitHub Split**           | GitHub tools split across 7 handler files by domain (read, issues, kanban, milestones, insights, copilot, mutations). `GitHubIntegration` facade in `github/github-integration/` handles all API calls. |
| **Database Adapter**       | `IDatabaseAdapter` interface → `SqliteAdapter` (better-sqlite3). Entry operations split into `entries/` subdirectory (crud, search, importance, statistics, shared).                                  |
| **Vector Search**          | `VectorSearchManager` integrates `sqlite-vec` + `@huggingface/transformers`. Lazy model loading on first use.                                                                                        |
| **OAuth 2.1**              | RFC 9728/8414 compliant. Scope enforcement via `scope-map.ts` (read/write/admin). JWT/JWKS validation. Optional — falls back to bearer token or no auth.                                             |
| **HTTP Transport**         | Stateful (Streamable HTTP + legacy SSE) / Stateless (serverless) modes. Security headers, rate limiting (100 req/min), CORS, 1MB body limit, session management.                                     |
| **Scheduler**              | HTTP-only `setInterval` jobs: automated backup, vacuum, vector index rebuild. Error-isolated — failure in one job doesn't affect others. Status visible via `memory://health`.                        |
| **ErrorFieldsMixin**       | All output schemas extend `ErrorFieldsMixin.shape` — 6 optional error fields so error responses always pass validation. Canonical SSoT at `utils/errors/error-response-fields.ts`; handler layer re-export stub preserved. |
| **Barrel Re-exports**      | Every directory has `index.ts` barrel. Import from `./module/index.js` (with `.js` extension for ESM).                                                                                                |
| **Team Database**          | Separate SQLite file (`TEAM_DB_PATH`) with author attribution. 20 dedicated tools split into `team/` subdirectory (core, search, admin, analytics, relationships, export, backup, vector). Cross-DB isolation with dedicated `teamVectorManager`. |

---

## Import Path Conventions

- All imports use **`.js` extension** (ESM requirement): `import { x } from './foo/index.js'`
- After splitting `foo.ts` → `foo/` directory: update imports from `./foo.js` → `./foo/index.js`
- Error classes can be imported from:
  - `../../types/errors.js` (direct)
  - `../../types/index.js` (re-exported: `MemoryJournalMcpError`, `ConnectionError`, `QueryError`, `ValidationError`, `ResourceNotFoundError`, `ConfigurationError`, `PermissionError`)
- Error formatter: `import { formatHandlerError } from '../../utils/error-helpers.js'`

---

## Test Infrastructure

| File / Directory                  | Purpose                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `test-server/README.md`           | Agent testing orchestration doc                                                       |
| `test-server/tool-reference.md`   | Complete 61-tool inventory with descriptions                                          |
| `test-server/code-map.md`         | This file — agent-optimized codebase navigation                                       |
| `test-server/test-preflight.md`   | Pre-test verification checklist                                                       |
| `test-server/test-tools.md`       | Entry-point agent test protocol (main tool tests)                                     |
| `test-server/test-tools2.md`      | Additional tool test scenarios                                                        |
| `test-server/test-tools-codemode.md`  | Code mode specific test prompts                                                   |
| `test-server/test-tools-codemode2.md` | Additional code mode test scenarios                                               |
| `test-server/test-agent-experience.md` | Open-ended agent experience scenarios                                            |
| `test-server/test-instruction-levels.mjs` | Integration test — instruction level generation                              |
| `test-server/test-scheduler.mjs`  | Integration test — scheduler behavior                                                 |
| `test-server/test-tool-annotations.mjs` | Integration test — tool annotation verification                                 |
| `tests/`                          | Vitest unit/integration tests (13 subdirectories)                                     |
| `tests/e2e/`                      | Playwright E2E tests — HTTP/SSE transport                                             |

### Test Subdirectories (`tests/`)

| Directory       | Coverage                                           |
| --------------- | -------------------------------------------------- |
| `auth/`         | OAuth 2.1 middleware, scopes, token validation      |
| `codemode/`     | Sandbox security, API bridge, worker lifecycle      |
| `constants/`    | Server instructions, icons                          |
| `database/`     | SQLite adapter, entry CRUD, search, tags, backup    |
| `e2e/`          | Playwright end-to-end (HTTP/SSE transport parity)   |
| `filtering/`    | Tool filter parsing, group/shortcut resolution      |
| `github/`       | GitHub integration, issues, PRs, milestones, kanban |
| `handlers/`     | Tool handlers, resource handlers, prompt handlers   |
| `security/`     | Input validation, SQL injection, path traversal     |
| `server/`       | MCP server setup, registration                      |
| `transports/`   | HTTP transport, sessions, rate limiting              |
| `utils/`        | Logger, error helpers, security utils               |
| `vector/`       | Vector search manager, semantic search              |
