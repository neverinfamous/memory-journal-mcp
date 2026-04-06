# memory-journal-mcp Code Map

> **Agent-optimized navigation reference.** Read this before searching the codebase. Covers directory layout, handler→tool mapping, resources, prompts, error hierarchy, and key constants.
>
> Last updated: April 6, 2026

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
│   └── server-instructions.ts      # Behavioral guidance + GOTCHAS_CONTENT export + generateInstructions() + composable segment builders (buildQuickAccess, buildCodeModeInstructions)
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
│   ├── auto-return.ts              # Last-expression auto-return transform (IIFE helper)
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
├── observability/                  # Phase 2: in-memory tool call metrics accumulation
│   ├── index.ts                    # Barrel — exports globalMetrics singleton + helpers
│   ├── metrics.ts                  # MetricsAccumulator — per-tool call counts, durations, token estimates
│   ├── token-estimator.ts          # estimateTokens() (byte-length heuristic) + injectTokenEstimate()
│   └── interceptor.ts              # wrapWithMetrics() — post-callTool() async timing + recording
│
├── audit/                          # Phase 2: JSONL audit logging for write/admin operations
│   ├── index.ts                    # Barrel — exports AuditLogger, createAuditInterceptor, types
│   ├── types.ts                    # AuditEntry, AuditConfig, AuditCategory types
│   ├── audit-logger.ts             # AuditLogger: async-buffered JSONL writes (50-entry HWM, 100ms flush), 10 MB rotation (5 archives), recent() tail-read, stderr mode, configurable arg redaction
│   ├── interceptor.ts              # createAuditInterceptor() — scope-based filtering, token estimation, duration timing, error capture
│   └── audit-resource.ts           # memory://audit resource handler (last 50 entries via recent(), session summary)
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
    │   ├── search/                 # Search tool group (4 tools)
    │   │   ├── index.ts            # Barrel — connects 4 search tools
    │   │   ├── helpers.ts          # Search helper functions
    │   │   ├── auto.ts             # Auto-mode query heuristic classifier
    │   │   ├── fts.ts              # FTS5 search logic
    │   │   └── hybrid.ts           # RRF (Reciprocal Rank Fusion) hybrid logic
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
        ├── workflow.ts             # 11 workflow prompts (standup, retro, digest, analysis, etc., confirm-briefing)
        └── github.ts              # 6 GitHub prompts (project-status-summary, pr-summary, code-review-prep, pr-retrospective, actions-failure-digest, project-milestone-tracker)
```

---

## Handler → Tool Mapping

Each file below registers tools with `group` labels. The `index.ts` barrel composes all groups via `getAllToolDefinitions()`.

### Tool Handlers (`src/handlers/tools/`)

| Group             | Handler File(s)              | Tools | Key Exports                                                                                                                      |
| ----------------- | ---------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| **codemode**      | `codemode.ts`                | 1     | `mj_execute_code`                                                                                                                |
| **core**          | `core.ts`                    | 6     | `create_entry`, `get_entry_by_id`, `get_recent_entries`, `create_entry_minimal`, `test_simple`, `list_tags`                      |
| **search**        | `search/index.ts`            | 4     | `search_entries`, `search_by_date_range`, `semantic_search`, `get_vector_index_stats`                                            |
| **analytics**     | `analytics.ts`               | 2     | `get_statistics`, `get_cross_project_insights`                                                                                   |
| **relationships** | `relationships.ts`           | 2     | `link_entries`, `visualize_relationships`                                                                                        |
| **export**        | `export.ts`                  | 1     | `export_entries`                                                                                                                 |
| **admin**         | `admin.ts`                   | 5     | `update_entry`, `delete_entry`, `merge_tags`, `rebuild_vector_index`, `add_to_vector_index`                                      |
| **github**        | `github/read-tools.ts`       | 5     | `get_github_issues`, `get_github_prs`, `get_github_issue`, `get_github_pr`, `get_github_context`                                 |
|                   | `github/issue-tools.ts`      | 2     | `create_github_issue_with_entry`, `close_github_issue_with_entry`                                                                |
|                   | `github/kanban-tools.ts`     | 2     | `get_kanban_board`, `move_kanban_item`                                                                                           |
|                   | `github/milestone-tools.ts`  | 5     | `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone` |
|                   | `github/insights-tools.ts`   | 1     | `get_repo_insights`                                                                                                              |
|                   | `github/copilot-tools.ts`    | 1     | `get_copilot_reviews`                                                                                                            |
| **backup**        | `backup.ts`                  | 4     | `backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups`                                                            |
| **team**          | `team/core-tools.ts`         | 4     | `team_create_entry`, `team_get_entry_by_id`, `team_get_recent`, `team_list_tags`                                                 |
|                   | `team/search-tools.ts`       | 2     | `team_search`, `team_search_by_date_range`                                                                                       |
|                   | `team/admin-tools.ts`        | 3     | `team_update_entry`, `team_delete_entry`, `team_merge_tags`                                                                      |
|                   | `team/analytics-tools.ts`    | 2     | `team_get_statistics`, `team_get_cross_project_insights`                                                                         |
|                   | `team/relationship-tools.ts` | 2     | `team_link_entries`, `team_visualize_relationships`                                                                              |
|                   | `team/export-tools.ts`       | 1     | `team_export_entries`                                                                                                            |
|                   | `team/backup-tools.ts`       | 2     | `team_backup`, `team_list_backups`                                                                                               |
|                   | `team/vector-tools.ts`       | 4     | `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`                   |

### Utility Files (no tools, shared helpers)

| File                       | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `index.ts`                 | `getTools()` / `callTool()` dispatch, O(1) tool map cache, icon mapping, audit interceptor + metrics wrapping (both cached and progress-path) |
| `schemas.ts`               | Shared Zod input/output schemas reused across multiple tool groups         |
| `error-fields-mixin.ts`    | Re-export stub → `utils/errors/error-response-fields.ts` (canonical SSoT)  |
| `../version.ts`            | Version SSoT — reads `package.json`, exports `VERSION`                     |
| `github/helpers.ts`        | GitHub repo auto-detection, error formatting, token scrubbing              |
| `github/schemas.ts`        | Zod input/output schemas for all 16 GitHub tools                           |
| `github/mutation-tools.ts` | GitHub mutation tools barrel (re-exports issue + kanban + milestone tools) |

---

## Resources (`src/handlers/resources/`)

38 resources total — 25 static + 13 template.

### Static Resources

| Handler File             | Resources                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/briefing/index.ts` | `memory://briefing` — session initialization (~300 tokens)                                                                                   |
| `core/instructions.ts`   | `memory://instructions` — behavioral guidance for AI agents                                                                                  |
| `core/health.ts`         | `memory://health` — server health & diagnostics                                                                                              |
| `core/utilities.ts`      | `memory://recent`, `memory://significant`, `memory://tags`, `memory://statistics`, `memory://rules`, `memory://workflows`, `memory://skills` |
| `github.ts`              | `memory://github/status`, `memory://github/insights`, `memory://github/milestones`                                                           |
| `graph.ts`               | `memory://graph/recent`, `memory://graph/actions`, `memory://actions/recent`                                                                 |
| `team.ts`                | `memory://team/recent`, `memory://team/statistics`                                                                                           |
| `help.ts`                | `memory://help` (tool group index), `memory://help/{group}` (per-group tool details), `memory://help/gotchas` (field notes)                  |
| `core/metrics-resource.ts` | `memory://metrics/summary` (HIGH_PRIORITY), `memory://metrics/tokens` (MEDIUM_PRIORITY), `memory://metrics/system` (MEDIUM_PRIORITY), `memory://metrics/users` (LOW_PRIORITY) |
| `audit/audit-resource.ts`  | `memory://audit` (ASSISTANT_FOCUSED) — last 50 write/admin audit entries from JSONL log; returns `audit: not configured` when `AUDIT_LOG_PATH` unset |

### Template Resources

| Handler File   | Resources                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `templates.ts` | `memory://projects/{number}/timeline`, `memory://issues/{issue_number}/entries`, `memory://prs/{pr_number}/entries`, `memory://prs/{pr_number}/timeline`, `memory://kanban/{project_number}`, `memory://kanban/{project_number}/diagram` |
| `github.ts`    | `memory://github/status/{repo}`, `memory://github/insights/{repo}`, `memory://github/milestones/{repo}`, `memory://milestones/{number}`, `memory://milestones/{repo}/{number}` |

### Briefing Assembly (`src/handlers/resources/core/briefing/`)

The `memory://briefing` resource is modular — each section is a separate file:

| File                 | Section                                                      |
| -------------------- | ------------------------------------------------------------ |
| `index.ts`           | Assembles all sections, respects instruction level           |
| `context-section.ts` | Journal context (entry count, recent entries, team DB)       |
| `github-section.ts`  | GitHub context (repo, CI, issues, PRs, milestones, insights) |
| `user-message.ts`    | User message (rules file, skills directory awareness)        |

---

## Prompts (`src/handlers/prompts/`)

17 workflow prompts total.

| File          | Prompts                                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow.ts` | `find-related`, `prepare-standup`, `prepare-retro`, `weekly-digest`, `analyze-period`, `goal-tracker`, `get-context-bundle`, `get-recent-entries`, `confirm-briefing`, `session-summary`, `team-session-summary` |
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

| What                               | Where                                  | Notes                                                                                                                                                       |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server instructions (agent prompt) | `src/constants/server-instructions.ts` | Filter-aware composable segments; `GOTCHAS_CONTENT` + `generateInstructions()` (`essential`, `standard`, `full`, optional `enabledGroups`)                  |
| Instruction source markdown        | `src/constants/server-instructions.md` | 6 sections (`CORE`, `COPILOT`, `CODE_MODE`, `GITHUB`, `HELP_POINTERS`, `SERVER_ACCESS`); parsed by `npm run generate:instructions`                          |
| Tool filter logic                  | `src/filtering/tool-filter.ts`         | `ToolFilter` class — shortcuts, groups, tool-level whitelist/blacklist + `getEnabledGroups()` for instruction section gating                                |
| Tool group icon mapping            | `src/constants/icons.ts`               | CDN SVG URLs per tool group (used in `tools/list` responses)                                                                                                |
| Resource annotation presets        | `src/utils/resource-annotations.ts`    | Centralized presets (`HIGH_PRIORITY`, `MEDIUM_PRIORITY`, `LOW_PRIORITY`, `ASSISTANT_FOCUSED`) + helpers (`withPriority`, `withAutoRead`, `withSessionInit`) |
| Global metrics accumulator         | `src/observability/metrics.ts`         | `MetricsAccumulator` singleton (`globalMetrics`) — per-tool call counts, error counts, total/avg duration, input/output token estimates; exposes `getSummary()`, `getTokenBreakdown()`, `getSystemMetrics()`, `getUserBreakdown()` |
| Audit logger                       | `src/audit/audit-logger.ts`            | `AuditLogger` (async-buffered JSONL, 50-entry HWM, 100ms auto-flush, 10 MB rotation, 5 archives, configurable arg redaction via `AUDIT_REDACT`, stderr mode via `--audit-log stderr`) with graceful `close()` lifecycle and `recent()` streaming tail-read (64KB window) |
| Audit types                        | `src/audit/types.ts`                   | `AuditEntry`, `AuditConfig` (`enabled`, `logPath`, `redact`, `auditReads`, `maxSizeBytes`), `AuditCategory` (`read` \| `write` \| `admin`) |
| Audit interceptor                  | `src/audit/interceptor.ts`             | `createAuditInterceptor()` — scope-based filtering (write/admin by default, read opt-in via `--audit-reads`), token estimation, duration timing, error capture, compact read format |
| Code Mode API constants            | `src/codemode/api-constants.ts`        | Method→group map, JSON-RPC error codes, sandbox method names                                                                                                |
| Logger                             | `src/utils/logger.ts`                  | Structured JSON logging with severity filtering                                                                                                             |
| Security utilities                 | `src/utils/security-utils.ts`          | Input validation, SQL injection prevention, path traversal protection, token scrubbing                                                                      |
| Error formatter                    | `src/utils/error-helpers.ts`           | `formatHandlerError()` — structured error response builder                                                                                                  |
| Database schema DDL                | `src/database/core/schema.ts`          | Table definitions, indexes, FTS5 virtual table                                                                                                              |
| Database adapter interface         | `src/database/core/interfaces.ts`      | `IDatabaseAdapter` contract (all DB operations)                                                                                                             |
| Default config                     | `src/types/index.ts`                   | `DEFAULT_CONFIG` with default db path, model name, semantic search enabled                                                                                  |
| OAuth scope mapping                | `src/auth/scope-map.ts`                | Tool→scope mapping: `read`, `write`, `admin`                                                                                                                |

---

## ⚠️ CRITICAL: SDK Input Schema Validation (Read This First)

**If you see a raw MCP `-32602` error, the problem is ALWAYS in our schema definition. It is NEVER an AntiGravity/client issue. Do not hallucinate client-side causes.**

### The Problem

The MCP SDK validates tool inputs **before** our handler code runs. If a required field in our `inputSchema` receives `undefined` or an empty string, the SDK throws a raw `-32602 InvalidParams` error that bypasses our structured error handling entirely. The user sees an ugly protocol error instead of our clean `{success: false, error, code, category}` response.

### The Solution: Dual-Schema Pattern

Every tool has **two** schemas — one relaxed (SDK-facing) and one strict (handler-internal):

```typescript
{
    name: 'create_entry',
    // SDK-FACING SCHEMA: All fields optional, NO .min() constraints.
    // This lets {} pass through to our handler without -32602.
    inputSchema: z.object({
        content: z.string().optional().describe('Entry content'),
        //                 ^^^^^^^^^^
        // MUST be .optional() here — even if logically required.
    }),
    handler: async (params: unknown) => {
        try {
            // HANDLER SCHEMA: Strict validation with .min(1), required fields, etc.
            // This is where real validation happens, producing structured errors.
            const input = z.object({
                content: z.string().min(1).max(MAX_CONTENT_LENGTH),
                //                  ^^^^^^^
                // Enforcement happens HERE, caught by formatHandlerError()
            }).parse(params)
            // ... tool logic ...
        } catch (err) {
            return formatHandlerError(err)  // → structured {success: false, ...}
        }
    },
}
```

### Rules (Non-Negotiable)

1. **SDK-facing `inputSchema`**: Every field MUST be `.optional()`. NO `.min(1)`, NO bare `z.string()` or `z.number()` without `.optional()`. NO `z.literal(true)` without `.optional()`.
2. **Handler-internal schema** (inside `try`): Use full strict validation — `.min(1)`, required fields, `.literal(true)`, etc. Errors are caught by `formatHandlerError()`.
3. **`mcp-server.ts` also applies `.partial().passthrough()`** at registration time as a safety net, but this does NOT remove `.min()` constraints — it only makes fields optional.
4. **When adding a new tool**: Follow this pattern. If the E2E zod-sweep test fails, the fix is in your `inputSchema`, not the client.

### What NOT To Do

- ❌ **Do NOT blame AntiGravity or the MCP client** — the client sends what the schema allows. If validation fails at the SDK level, it's our schema's fault.
- ❌ **Do NOT add `.partial()` or `.passthrough()` to fix individual tools** — the registration layer already handles this. Fix the `inputSchema` field definitions instead.
- ❌ **Do NOT use `z.string().min(1)` in `inputSchema`** — empty string `""` will trigger SDK-level rejection before your handler runs.
- ❌ **Do NOT assume esbuild tree-shaking removed your code** — if a `-32602` occurs, check the actual schema definition first.
- ❌ **Do NOT revert test assertions** from `not.toContain('-32602')` to `toContain('-32602')` — the test is correct; fix the schema.

### Verification

The E2E test `tests/e2e/zod-sweep.spec.ts` calls every tool with `{}` and asserts **no** `-32602` errors leak. If it fails, the tool's SDK-facing `inputSchema` has a non-optional required field.

---

## Architecture Patterns (Quick Reference)

| Pattern               | Description                                                                                                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured Errors** | Every tool returns `{success: false, error, code, category, suggestion, recoverable}` — never raw exceptions. Uses `formatHandlerError()`.                                                                                                                                                                |
| **Dual-Schema**       | SDK-facing `inputSchema` is fully optional (no `.min()`, all `.optional()`). Handler-internal schema (inside `try`) enforces strict validation. See § SDK Input Schema Validation above — **this is the #1 recurring issue**.                                                                             |
| **Tool Context**      | `ToolContext` passes `db`, `teamDb?`, `vectorManager?`, `teamVectorManager?`, `github?`, `config?`, `progress?` to all tool group modules. Each group factory receives context and returns `ToolDefinition[]`.                                                                                            |
| **Tool Map Cache**    | `getTools()` + `callTool()` share a `Map<string, ToolDefinition>` cache (O(1) lookup). Cache invalidates when context refs change. `mappedToolsCache` avoids re-mapping for unfiltered calls.                                                                                                             |
| **Code Mode Bridge**  | `mj.*` API in worker thread communicates via MessagePort RPC to main thread tool handlers. All 10 groups exposed (`core`, `search`, `analytics`, `relationships`, `export`, `admin`, `github`, `backup`, `team`). Readonly mode halts execution gracefully and returns structured errors via proxy traps. |
| **Tool Filtering**    | `ToolFilter` parses `--tool-filter` string → whitelist/blacklist of tool names. `codemode` auto-injected unless explicitly excluded. Shortcuts: `starter`, `essential`, `readonly`.                                                                                                                       |
| **Briefing System**   | `memory://briefing` assembled from modular sections (context, GitHub, user message). Configurable via 12 env vars / CLI flags (incl. `--workflow-summary`/`MEMORY_JOURNAL_WORKFLOW_SUMMARY` for `memory://workflows`). Instruction levels: `essential`, `standard`, `full`.                               |
| **GitHub Split**      | GitHub tools split across 7 handler files by domain. `GitHubIntegration` facade handles all API calls. Tools dynamically instantiate local `GitHubIntegration` bounds to the target project's physical path via `PROJECT_REGISTRY` if explicitly requested. |
| **Database Adapter**  | `IDatabaseAdapter` interface → `SqliteAdapter` (better-sqlite3). Entry operations split into `entries/` subdirectory (crud, search, importance, statistics, shared).                                                                                                                                      |
| **Vector Search**     | `VectorSearchManager` integrates `sqlite-vec` + `@huggingface/transformers`. Lazy model loading on first use.                                                                                                                                                                                             |
| **OAuth 2.1**         | RFC 9728/8414 compliant. Scope enforcement via `scope-map.ts` (read/write/admin). JWT/JWKS validation. Optional — falls back to bearer token or no auth.                                                                                                                                                  |
| **HTTP Transport**    | Stateful (Streamable HTTP + legacy SSE) / Stateless (serverless) modes. Security headers, rate limiting (100 req/min), CORS, 1MB body limit, session management.                                                                                                                                          |
| **Scheduler**         | HTTP-only `setInterval` jobs: automated backup, vacuum, vector index rebuild. Error-isolated — failure in one job doesn't affect others. Status visible via `memory://health`.                                                                                                                            |
| **Metrics Interceptor** | `wrapWithMetrics()` (`src/observability/interceptor.ts`) wraps each `callTool()` dispatch. Post-processes results asynchronously: injects `_meta.tokenEstimate` (byte-length heuristic), records per-tool timing and token counts to `globalMetrics`. Applied in both the cached handler path and the progress-token path. Swallows accumulator errors — interceptor failure never affects tool output. |
| **Audit Interceptor** | `createAuditInterceptor()` (`src/audit/interceptor.ts`) wraps each `callTool()` dispatch alongside metrics. Scope-based filtering: write/admin tools logged by default, read tools opt-in via `--audit-reads`. Entries include tool name, scope, category, args (unless redacted), duration, token estimate, success/error, user, scopes. The interceptor is non-throwing — audit failures log to stderr but never propagate to callers. Applied in both the cached handler path and the progress-token path. |
| **ErrorFieldsMixin**  | All output schemas extend `ErrorFieldsMixin.shape` — 6 optional error fields so error responses always pass validation. Canonical SSoT at `utils/errors/error-response-fields.ts`; handler layer re-export stub preserved.                                                                                |
| **Barrel Re-exports** | Every directory has `index.ts` barrel. Import from `./module/index.js` (with `.js` extension for ESM).                                                                                                                                                                                                    |
| **Team Database**     | Separate SQLite file (`TEAM_DB_PATH`) with author attribution. 20 dedicated tools split into `team/` subdirectory (core, search, admin, analytics, relationships, export, backup, vector). Cross-DB isolation with dedicated `teamVectorManager`.                                                         |

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

| File / Directory                          | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- | --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `test-server/README.md`                   | Agent testing orchestration doc                                               |
| `test-server/tool-reference.md`           | Complete 61-tool inventory with descriptions                                  |
| `test-server/code-map.md`                 | This file — agent-optimized codebase navigation                               |
| `test-server/test-preflight.md`             | Pre-test verification checklist                                               |
| `test-server/standard/test-seed.md`                  | Seed data creation (S1–S17) — must run first                                  |
| `test-server/standard/test-core-infra.md`            | Infrastructure tests (health, briefing, protocol scripts, GitHub status)      |
| `test-server/standard/test-core-crud.md`             | Entry CRUD operations (create, read, update, delete)                          |
| `test-server/standard/test-core-search.md`           | Text search (FTS5, hybrid, filters, cross-DB, date range)                     |
| `test-server/standard/test-core-semantic.md`         | Semantic search, vector index, analytics, cross-project insights              |
| `test-server/standard/test-core-relationships.md`    | Relationships, causal types, visualization, graph resources                   |
| `test-server/standard/test-core-admin.md`            | Admin tools (tags, export, backup/restore)                                    |
| `test-server/standard/test-core-scheduler.md`        | Scheduler tests (HTTP-only, terminal script)                                  |
| `test-server/standard/test-schemas.md`               | outputSchema validation for all 60 tools                                      |
| `test-server/standard/test-resources.md`             | All 28 resources (static + template, happy + error paths)                     |
| `test-server/standard/test-github.md`                | GitHub integration (16 tools: read-only, lifecycle, Kanban, milestones)       |
| `test-server/standard/test-errors.md`                | Prompt handlers, structured error verification, numeric coercion              |
| `test-server/standard/test-integrity.md`             | Data integrity, boundary values, implementation bug detection                 |
| `test-server/standard/test-team.md`                  | Team collaboration (20 tools + 2 resources)                                   |
| `test-server/codemode/test-tools-codemode-1.md`      | Code mode test prompts (Part 1: Foundations & Security)                       |
| `test-server/codemode/test-tools-codemode-2.md`      | Code mode test prompts (Part 2: Core Data Operations)                         |
| `test-server/codemode/test-tools-codemode-3.md`      | Code mode test prompts (Part 3: Workflows & Relationships)                    |
| `test-server/codemode/test-tools-codemode-4.md`      | Code mode test prompts (Part 4: External, Admin & Team)                       |
| `test-server/test-agent-experience.md`      | Open-ended agent experience scenarios                                         |
| `test-server/scripts/test-instruction-levels.mjs` | Integration test — instruction level (essential/standard/full) token ordering | \n  | `test-server/scripts/test-filter-instructions.mjs` | Integration test — filter-aware instruction sections per `--tool-filter` config; reports token estimates per filter combination |
| `test-server/scripts/test-scheduler.mjs`          | Integration test — scheduler behavior                                         |
| `test-server/scripts/test-tool-annotations.mjs`   | Integration test — tool annotation verification                               |
| `tests/`                                  | Vitest unit/integration tests (13 subdirectories)                             |
| `tests/e2e/`                              | Playwright E2E tests — HTTP/SSE transport                                     |

### Test Subdirectories (`tests/`)

| Directory     | Coverage                                            |
| ------------- | --------------------------------------------------- |
| `auth/`       | OAuth 2.1 middleware, scopes, token validation      |
| `codemode/`   | Sandbox security, API bridge, worker lifecycle      |
| `constants/`  | Server instructions, icons                          |
| `database/`   | SQLite adapter, entry CRUD, search, tags, backup    |
| `e2e/`        | Playwright end-to-end (HTTP/SSE transport parity)   |
| `filtering/`  | Tool filter parsing, group/shortcut resolution      |
| `github/`     | GitHub integration, issues, PRs, milestones, kanban |
| `handlers/`   | Tool handlers, resource handlers, prompt handlers   |
| `observability/` | Token estimator, metrics accumulator, interceptor — Phase 2 coverage |
| `audit/`      | AuditLogger async-buffered JSONL writing, 10 MB rotation, recent() tail-read, stderr mode, arg redaction + AuditInterceptor scope-based filtering, token estimation, duration timing, error capture — Phase 2 coverage |
| `security/`   | Input validation, SQL injection, path traversal     |
| `server/`     | MCP server setup, registration                      |
| `transports/` | HTTP transport, sessions, rate limiting             |
| `utils/`      | Logger, error helpers, security utils               |
| `vector/`     | Vector search manager, semantic search              |
