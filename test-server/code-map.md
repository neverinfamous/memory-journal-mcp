# memory-journal-mcp Code Map

> **Agent-optimized navigation reference.** Read this before searching the codebase. Covers directory layout, handler→tool mapping, resources, prompts, error hierarchy, and key constants.
>
> Last updated: June 18, 2026

---

## Directory Tree

```
src/
├── cli/                            # CLI entry point
│   ├── index.ts                    # Main CLI execution and command logic
│   ├── program-options.ts          # Commander.js CLI option definitions
│   └── server-options-builder.ts   # Maps CLI options/env vars to ServerConfig
├── index.ts                        # Barrel re-export for library consumers
├── version.ts                      # Version SSoT — reads package.json, exports VERSION
│
├── server/
│   ├── mcp-server/                 # McpServer setup (refactored from single file)
│   │   ├── index.ts                # Barrel
│   │   ├── core.ts                 # Server factory, config wiring, ToolHandlerConfig builder
│   │   ├── initialization.ts       # Dependency initialization (db, vectorManager, github, runtime)
│   │   ├── tool-registration.ts    # Tool/resource/prompt registration, instructions composition, callTool dispatch
│   │   └── types.ts                # ServerOptions interface
│   ├── subscription-manager.ts     # Real-time resource subscriptions and state management
│   ├── auto-prune.ts               # Importance-based data lifecycle on startup (archive → soft-delete → hard-delete)
│   ├── registration.ts             # Tool/resource/prompt registration logic
│   ├── scheduler.ts                # HTTP-only automated scheduling (backup, vacuum, rebuild-index, digest, report)
│   └── digest-reporter.ts          # Scheduled report formatting and webhook delivery
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
│   └── server-instructions.ts      # HELP_CONTENT map + generateInstructions() + composable segments
│
├── filtering/
│   └── tool-filter.ts              # ToolFilter class — parse/apply --tool-filter expressions, group/shortcut/tool resolution
│
├── utils/
│   ├── config-manager.ts           # Runtime configuration manager (hot-reload, event emitter)
│   ├── config-resolver.ts          # CLI/env/config-file resolution with type coercion
│   ├── error-helpers.ts            # formatHandlerError() — structured {success:false} builder
│   ├── github-helpers.ts           # GitHub token scrubbing and helper utilities
│   ├── logger.ts                   # Logger class (structured JSON, severity filtering)
│   ├── maintenance-lock.ts         # ServerRuntime — maintenance mode lock + instance globals
│   ├── mcp-logger.ts               # MCP-specific logger with module prefixing
│   ├── progress-utils.ts           # MCP progress notification helpers (ProgressContext)
│   ├── query-helpers.ts            # coerceLimit(), buildLimitClause(), DEFAULT_QUERY_LIMIT
│   ├── request-context.ts          # AsyncLocalStorage request context
│   ├── resource-annotations.ts     # Centralized resource annotation presets (HIGH/MEDIUM/LOW_PRIORITY)
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
│   ├── types.ts                # OAuth TypeScript types
│   └── index.ts                # Barrel
│
├── transports/
│   └── http/
│       ├── handlers.ts             # HTTP request handlers (root info, health)
│       ├── security.ts             # Security headers, rate limiting, CORS, body parsing
│       ├── types.ts                # HTTP transport types
│       ├── index.ts                # Barrel
│       └── server/
│           ├── index.ts            # HTTP server factory (stateful/stateless selection)
│           ├── stateful.ts         # Stateful HTTP transport (Integrates `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, and `deleteProjectV2Item`.)
│           ├── stateless.ts        # Stateless HTTP transport (serverless mode)
│           └── legacy-sse.ts       # Legacy SSE transport (MCP 2024-11-05 compat)
│
├── codemode/                       # Code Mode sandbox (secure JS execution)
│   ├── sandbox-factory.ts          # Sandbox creation factory (engine-level restrictions: codeGeneration disabled, frozen prototypes, Proxy nullified, API surface frozen)
│   ├── auto-return.ts              # Last-expression auto-return transform (IIFE helper)
│   ├── worker-sandbox.ts           # Worker thread sandbox (MessagePort RPC bridge, pre-warmed pool with lifecycle management)
│   ├── worker-script.ts            # Worker thread entry point — initializes shimMj (empty-target proxy) and applies strict API surface freezing
│   ├── worker-api-proxy.ts         # Worker API Proxy Builder (builds mj.* API, handles missing await interceptions)
│   ├── worker-result-proxy.ts      # Result Wrapping Proxy (prevents silent failures, explicit IPC serialization traps)
│   ├── api/                        # Unified mj.* API bridge factory
│   │   ├── index.ts                # Barrel — exports parseProjectRegistry
│   │   ├── journal-api.ts          # Unified API builder (creates Sandbox bindings and schema descriptors)
│   │   ├── group-factory.ts        # Group proxy factory (handles camelCase aliases, normalizes positional params)
│   │   ├── param-normalizer.ts     # Parameter normalization (snake_case ↔ camelCase, positional → named, type coercion)
│   │   └── types.ts                # API bridge TypeScript types
│   ├── api-constants.ts            # API bridge constants, method→group map, JSON-RPC codes
│   ├── security.ts                 # Code validation (18 blocked patterns, 50KB code size limit, injection prevention)
│   ├── type-generator.ts           # Zod schema-to-TypeScript declaration generator
│   ├── types.ts                    # Sandbox TypeScript types
│   └── index.ts                    # Barrel
│
├── database/
│   ├── adapter-factory.ts          # Database adapter factory (creates SqliteAdapter)
│   ├── core/
│   │   ├── interfaces.ts           # IDatabaseAdapter interface (database contract)
│   │   ├── schema.ts               # Database schema DDL (tables, indexes, FTS5)
│   │   └── entry-columns.ts        # Column name constants for entry queries
│   ├── migrations/                 # Versioned database migrations (001-010, migration-manager)
│   │   ├── 001-init.ts ... 010-add-author-aliases.ts
│   │   ├── migration.ts            # Migration interface contract
│   │   ├── migration-list.ts       # Sequential migration chain array registry
│   │   └── migration-manager.ts    # Transactional runner & self-healing legacy retrofitting
│   └── sqlite-adapter/
│       ├── index.ts                # SqliteAdapter class (implements IDatabaseAdapter)
│       ├── native-connection.ts    # better-sqlite3 connection management
│       ├── backup.ts               # Backup/restore operations
│       ├── tags.ts                 # Tag CRUD and merge operations
│       ├── relationships.ts        # Entry relationship operations
│       ├── members.ts              # Team member CRUD and RBAC role resolution
│       └── entries/
│           ├── index.ts            # Entry operations barrel
│           ├── crud.ts             # Entry create/read/update/delete, including batch operations
│           ├── search/             # Search query module (refactored from flat file)
│           │   ├── index.ts        # Barrel
│           │   ├── query.ts        # FTS5 search, date-range search, faceted search, WHERE clause builder
│           │   ├── cursor.ts       # Opaque cursor encoding/decoding (keyset pagination)
│           │   └── fts-sanitizer.ts # FTS5 query sanitization (injection prevention)
│           ├── digest.ts           # Digest computation queries (project activity, trends)
│           ├── fuzzy-matcher.ts    # Fallback fuzzy string matching (Levenshtein)
│           ├── importance.ts       # Importance scoring algorithm
│           ├── statistics.ts       # Journal statistics and analytics
│           └── shared.ts           # Shared entry query helpers (ENTRY_COLUMNS, rowToEntry, rowsToEntries)
│
├── vector/
│   └── vector-search-manager/      # VectorSearchManager (refactored from single file)
│       ├── index.ts                # Barrel
│       ├── manager.ts              # VectorSearchManager — sqlite-vec + @huggingface/transformers integration
│       ├── rebuild.ts              # Vector index rebuild logic (full re-embedding)
│       └── types.ts                # Vector search TypeScript types
│
├── markdown/                       # Markdown import/export (round-trip frontmatter parsing)
│   ├── converters/                 # Markdown converter utilities
│   ├── exporter.ts                 # Export entries to Markdown
│   ├── frontmatter.ts              # YAML frontmatter utilities
│   ├── importer.ts                 # Import entries from Markdown
│   └── index.ts                    # Barrel
│
├── observability/                  # Phase 2: in-memory tool call metrics accumulation
│   ├── index.ts                    # Barrel — exports globalMetrics singleton + helpers
│   ├── metrics.ts                  # MetricsAccumulator — per-tool call counts, durations, token estimates, latency percentiles
│   ├── latency-tracker.ts          # LatencyTracker — per-tool sliding-window p50/p95/p99 percentile tracker
│   ├── token-estimator.ts          # estimateTokens() (content-type-aware heuristic: prose/json/code) + injectTokenEstimate()
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
│   ├── commit-references/          # Commit message parser and issue/PR reference resolver
│   └── github-integration/
│       ├── index.ts                # GitHubIntegration class (facade for all GitHub operations)
│       ├── client.ts               # GitHub REST API client (Octokit wrapper)
│       ├── repository.ts           # Repository context detection (owner/repo from git remote)
│       ├── issues.ts               # Issue operations (list, get, create, close, getIssueComments)
│       ├── pull-requests.ts        # PR operations (list, get)
│       ├── projects.ts               # GitHub Projects v2 / Kanban operations (GraphQL)
│       ├── milestones.ts           # Milestone CRUD (create, get, update, delete)
│       ├── insights.ts             # Repository insights (stars, forks, traffic, referrers)
│       └── types.ts                # GitHub integration internal types
│
└── handlers/
    ├── tools/                      # 100 tool handlers (10 groups) — see § Handler Map below
    │   ├── index.ts                # getTools() / callTool() dispatch, tool map cache
    │   ├── schemas.ts              # Shared Zod output schemas (reused across groups)
    │   ├── error-fields-mixin.ts   # Re-export stub → canonical SSoT at utils/errors/error-response-fields.ts
    │   ├── core/                   # Core tool group (7 tools, refactored from flat file)
    │   │   ├── index.ts            # Barrel
    │   │   ├── schemas.ts          # Core Zod input/output schemas (dual-schema: strict + MCP)
    │   │   └── tools.ts            # Core tool handlers (create_entry, get_entry_by_id, get_recent_entries, etc.)
    │   ├── search/                 # Search tool group (6 tools)
    │   │   ├── index.ts            # Barrel — composes all search tools
    │   │   ├── schemas.ts          # Search Zod input/output schemas
    │   │   ├── helpers.ts          # Search helper functions
    │   │   ├── auto.ts             # Auto-mode query heuristic classifier
    │   │   ├── fts.ts              # FTS5 search logic
    │   │   ├── search-entries.ts   # search_entries tool handler
    │   │   ├── date-range-search.ts # search_by_date_range tool handler
    │   │   ├── semantic-search.ts  # semantic_search tool handler
    │   │   ├── cross-team.ts       # Cross-team search logic
    │   │   ├── hybrid.ts           # RRF (Reciprocal Rank Fusion) hybrid logic
    │   │   └── misc-tools.ts       # get_vector_index_stats, list_deleted_entries
    │   ├── analytics.ts            # Analytics tool group (2 tools)
    │   ├── relationships.ts        # Relationships tool group (2 tools)
    │   ├── io/                     # IO tool group (4 tools, refactored from flat file)
    │   │   ├── index.ts            # Barrel
    │   │   ├── schemas.ts          # IO Zod input/output schemas
    │   │   └── tools.ts            # IO tool handlers (export_entries, export_markdown, import_markdown, import_external)
    │   ├── admin/                  # Admin tool group (11 tools, refactored from flat file)
    │   │   ├── index.ts            # Barrel — composes all admin tools
    │   │   ├── schemas.ts          # Admin Zod input/output schemas
    │   │   ├── core-tools.ts       # Core admin tools (update_entry, delete_entry, restore_entry)
    │   │   ├── batch-tools.ts      # Batch admin tools (batch_create/update/delete_entries)
    │   │   ├── misc-tools.ts       # Misc admin tools (merge_tags, search_audit_log)
    │   │   ├── vector-tools.ts     # Vector admin tools (rebuild_vector_index, add_to_vector_index)
    │   │   └── update_configuration.ts # Runtime config update tool (update_configuration)
    │   ├── backup.ts               # Backup tool group (4 tools)
    │   ├── codemode/               # Code Mode tool group (1 tool, refactored from flat file)
    │   │   ├── index.ts            # Barrel
    │   │   ├── schemas.ts          # Code Mode Zod input/output schemas
    │   │   ├── handler.ts          # mj_execute_code handler (sandbox dispatch, project registry resolution)
    │   │   └── singleton-state.ts  # Code Mode singleton state (sandbox pool, session context)
    │   ├── team/                   # Team tool group (44 tools)
    │   │   ├── index.ts            # Barrel — composes all team sub-modules
    │   │   ├── helpers.ts          # Shared team helpers (author batch-fetch, constants)
    │   │   ├── schemas.ts          # Team Zod input/output schemas (all 31 tools)
    │   │   ├── core-tools.ts       # Core team tools (create, get_by_id, get_recent, list_tags)
    │   │   ├── search-tools.ts     # Search team tools (search, search_by_date_range)
    │   │   ├── admin-tools.ts      # Admin team tools (update, delete, merge_tags)
    │   │   ├── analytics-tools.ts  # Analytics team tools (get_statistics, get_cross_project_insights, team_get_collaboration_matrix)
    │   │   ├── relationship-tools.ts # Relationship team tools (link, visualize)
    │   │   ├── export-tools.ts     # Export team tool (export_entries)
    │   │   ├── io-tools.ts         # IO team tools (export_markdown, import_markdown)
    │   │   ├── backup-tools.ts     # Backup team tools (backup, list_backups)
    │   │   ├── flag-tools.ts       # Flag team tools (team_pass_flag, team_resolve_flag)
    │   │   ├── flag-extension-tools.ts # Flag query/mutation/analytics tools (team_list_flags, team_update_flag, team_get_flag_analytics)
    │   │   ├── member-tools.ts     # Team member tools (team_add_member, etc)
    │   │   ├── alias-tools.ts      # Author alias tools (team_add_author_alias, etc)
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
    │   ├── shared.ts               # Shared resource helpers (formatters, entry rendering, BriefingConfig)
    │   ├── staleness.ts            # Staleness detection resources (memory://staleness)
    │   ├── github.ts               # GitHub static resources (status, insights, milestones)
    │   ├── graph.ts                # Graph resources (recent relationships, actions narrative)
    │   ├── insights.ts             # Insights resources (digest, team-collaboration)
    │   ├── team.ts                 # Team resources (recent, statistics)
    │   ├── help.ts                 # Dynamic help resources (memory://help, memory://help/{group}) with codemode dynamic tool rewriting
    │   ├── templates.ts            # Template resources (projects, issues, PRs, kanban, milestones)
    │   └── core/
    │       ├── index.ts            # Core static resources barrel
    │       ├── health.ts           # memory://health resource
    │       ├── instructions.ts     # memory://instructions resource
    │       ├── utilities.ts        # memory://recent, memory://significant, memory://tags, memory://statistics, memory://rules, memory://workflows, memory://skills
    │       └── briefing/
    │           ├── index.ts        # memory://briefing resource (assembles sections)
    │           ├── context-section.ts   # Journal context section (entry count, recent entries)
    │           ├── system-section.ts    # System section (server config, registry, workspace context)
    │           ├── insights-section.ts  # Insights section (digest summary, orphan stats, graph hubs)
    │           ├── github-section.ts    # GitHub context section (repo, CI, issues, PRs, milestones, insights)
    │           └── user-message.ts      # User message section (rules, skills awareness)
    │
    └── prompts/                    # Prompt handlers
        ├── index.ts                # Prompt registration barrel
        ├── workflow.ts             # 11 workflow prompts (standup, retro, digest, analysis, etc., confirm-briefing)
        ├── github.ts               # 6 GitHub prompts (project-status-summary, pr-summary, code-review-prep, pr-retrospective, actions-failure-digest, project-milestone-tracker)
        ├── adversarial.ts          # 1 adversarial prompt (adversarial-plan-review)
        └── team.ts                 # 1 team prompt (flag-dashboard)

skills/
├── bun/                            # Bun ecosystem conventions and testing patterns
├── github-commander/               # Automated pipeline orchestration (triage, PR, audit)
├── golang/                         # Go 1.22+ structure, concurrency, and error handling
├── rust/                           # Rust ownership, traits, and error propagation
└── shadcn-ui/                      # Form schemas, component generation, and styling
```

---

## Handler → Tool Mapping

Each file below registers tools with `group` labels. The `index.ts` barrel composes all groups via `getAllToolDefinitions()`.

### Tool Handlers (`src/handlers/tools/`)

<!-- BEGIN: TOOL_MAPPING -->
| Group | Tools |
| ----- | ----- |
| **admin** | `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`, `update_entry`, `delete_entry`, `restore_entry`, `update_configuration`, `merge_tags`, `search_audit_log`, `rebuild_vector_index`, `add_to_vector_index` |
| **analytics** | `get_statistics`, `get_cross_project_insights` |
| **backup** | `backup_journal`, `list_backups`, `restore_backup`, `cleanup_backups` |
| **codemode** | `mj_execute_code` |
| **core** | `create_entry`, `get_entry_by_id`, `get_recent_entries`, `get_entry_history`, `list_tags`, `test_simple`, `trigger_progress`, `test_error_handling` |
| **github** | `get_copilot_reviews`, `get_repo_insights`, `create_github_issue_with_entry`, `close_github_issue_with_entry`, `get_kanban_board`, `move_kanban_item`, `add_kanban_item`, `delete_kanban_item`, `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone`, `get_github_issues`, `get_github_prs`, `get_github_issue`, `get_github_pr`, `get_github_context` |
| **io** | `export_entries`, `export_markdown`, `import_markdown`, `import_external` |
| **relationships** | `link_entries`, `visualize_relationships` |
| **search** | `cross_team_search`, `search_by_date_range`, `get_vector_index_stats`, `list_deleted_entries`, `search_entries`, `semantic_search` |
| **team** | `team_batch_create_entries`, `team_batch_update_entries`, `team_batch_delete_entries`, `team_update_entry`, `team_delete_entry`, `team_restore_entry`, `team_merge_tags`, `team_add_author_alias`, `team_remove_author_alias`, `team_list_author_aliases`, `team_resolve_author`, `team_consolidate_authors`, `team_get_statistics`, `team_get_cross_project_insights`, `team_get_collaboration_matrix`, `team_backup`, `team_list_backups`, `team_create_entry`, `team_get_entry_by_id`, `team_get_recent`, `team_list_tags`, `team_export_entries`, `team_get_flag_analytics`, `team_list_flags`, `team_update_flag`, `team_pass_flag`, `team_resolve_flag`, `team_export_markdown`, `team_import_markdown`, `team_import_external`, `team_add_member`, `team_remove_member`, `team_update_member_role`, `team_list_members`, `team_get_member`, `team_link_entries`, `team_visualize_relationships`, `team_search`, `team_search_by_date_range`, `team_list_deleted_entries`, `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index` |

<!-- END: TOOL_MAPPING -->

### Utility Files (no tools, shared helpers)

| File                       | Purpose                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                 | `getTools()` / `callTool()` dispatch, O(1) tool map cache, icon mapping, audit interceptor + metrics wrapping (both cached and progress-path) |
| `schemas.ts`               | Shared Zod input/output schemas reused across multiple tool groups                                                                            |
| `error-fields-mixin.ts`    | Re-export stub → `utils/errors/error-response-fields.ts` (canonical SSoT)                                                                     |
| `../version.ts`            | Version SSoT — reads `package.json`, exports `VERSION`                                                                                        |
| `github/helpers.ts`        | GitHub repo auto-detection, error formatting, token scrubbing                                                                                 |
| `github/schemas.ts`        | Zod input/output schemas for all 18 GitHub tools                                                                                              |
| `github/mutation-tools.ts` | GitHub mutation tools barrel (re-exports issue + kanban + milestone tools)                                                                    |

---

## Resources (57 total)

> **Note**: The server also registers 6 alias endpoints (e.g., `memory://status`, `memory://tools`, `memory://journal/recent`) for backward compatibility. This brings the dynamic resource count reported by `ListMcpResources` or internal methods to 57, though they map to the 51 capabilities listed below.

### Static Resources

<!-- BEGIN: RESOURCES -->
| URI | Name |
| --- | ---- |
| `memory://briefing` | Initial Briefing |
| `memory://briefing/{+repo}` | Dynamic Briefing |
| `memory://health` | Server Health |
| `memory://instructions` | Server Instructions |
| `memory://metrics/summary` | Metrics Summary |
| `memory://metrics/tokens` | Metrics Tokens |
| `memory://metrics/resources` | Metrics Resources |
| `memory://metrics/system` | Metrics System |
| `memory://metrics/users` | Metrics Users |
| `memory://metrics/latency` | Metrics Latency |
| `memory://recent` | Recent Entries |
| `memory://significant` | Significant Entries |
| `memory://tags` | All Tags |
| `memory://statistics` | Statistics |
| `memory://rules` | Rules File |
| `memory://workflows` | Workflows |
| `memory://skills` | Skills |
| `memory://github/status` | GitHub Status |
| `memory://github/insights` | Repository Insights |
| `memory://github/milestones` | GitHub Milestones |
| `memory://milestones/{number}` | Milestone Detail |
| `memory://graph/recent` | Recent Relationship Graph |
| `memory://graph/actions` | Actions Graph |
| `memory://actions/recent` | Recent Actions |
| `memory://help` | Help — Tool Groups |
| `memory://help/{group}` | Help — Tool Group Detail |
| `memory://insights/digest` | Analytics Digest |
| `memory://insights/team-collaboration` | Team Collaboration Matrix |
| `memory://insights/reports` | Report History |
| `memory://staleness` | Project Staleness |
| `memory://staleness/{project_number}` | Project Staleness Details |
| `memory://team/recent` | Recent Team Entries |
| `memory://team/statistics` | Team Statistics |
| `memory://flags` | Active Flags |
| `memory://flags/vocabulary` | Flag Vocabulary |
| `memory://flags/history` | Resolved Flags History |
| `memory://projects/{number}/timeline` | Project Timeline |
| `memory://issues/{issue_number}/entries` | Issue Entries |
| `memory://prs/{pr_number}/entries` | PR Entries |
| `memory://prs/{pr_number}/timeline` | PR Timeline |
| `memory://commits/{project_number}` | Project Commits |
| `memory://commits/{project_number}/by-issue` | Commits by Issue |
| `memory://commits/{project_number}/by-pr` | Commits by PR |
| `memory://kanban/{project_number}` | Kanban Board |
| `memory://kanban/{project_number}/diagram` | Kanban Diagram |

<!-- END: RESOURCES -->

### Briefing Assembly (`src/handlers/resources/core/briefing/`)

The `memory://briefing` resource is modular — each section is a separate file:

| File                 | Section                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `index.ts`           | Assembles all sections, respects instruction level                                                |
| `context-section.ts` | Journal context (entry count, recent entries, team DB)                                            |
| `github-section.ts`  | GitHub context (repo, CI, issues, PRs, milestones, insights)                                      |
| `user-message.ts`    | User message (rules file, skills directory awareness)                                             |
| `system-section.ts`  | System context (version, tool/resource/prompt counts, test health, unreleased summary, localTime) |

---

## Prompts (`src/handlers/prompts/`)

19 prompts total (11 workflow + 6 GitHub + 1 adversarial + 1 team).

<!-- BEGIN: PROMPTS -->
| Prompt | Description |
| ------ | ----------- |
| `adversarial-plan-review` | Bootstrap an adversarial planning workflow with structured review dimensions, sc... |
| `project-status-summary` | GitHub Project status reports |
| `pr-summary` | Pull request journal activity summary |
| `code-review-prep` | Comprehensive PR review preparation |
| `pr-retrospective` | Completed PR analysis with learnings |
| `actions-failure-digest` | CI/CD failure analysis with root cause identification |
| `project-milestone-tracker` | Milestone progress tracking |
| `flag-dashboard` | Triage active flags with priority assessment and resolution guidance |
| `find-related` | Discover connected entries via semantic similarity |
| `prepare-standup` | Daily standup summaries |
| `prepare-retro` | Sprint retrospectives |
| `weekly-digest` | Day-by-day weekly summaries |
| `analyze-period` | Deep period analysis with insights |
| `goal-tracker` | Milestone and achievement tracking |
| `get-context-bundle` | Project context with recent entries, statistics, and GitHub status hints |
| `get-recent-entries` | Formatted recent entries |
| `confirm-briefing` | Acknowledge session context received from memory://briefing to inform the user |
| `session-summary` | Create a session summary entry capturing what was accomplished, pending items, a... |
| `team-session-summary` | Create a session summary entry for the team capturing what was accomplished, pen... |

<!-- END: PROMPTS -->

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

| What                               | Where                                  | Notes                                                                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Server instructions (agent prompt) | `src/constants/server-instructions.ts` | Filter-aware composable segments; `HELP_CONTENT` map + `generateInstructions()` (`essential`, `standard`, `full`, optional `enabledGroups`)                                                                                                                              |
| Tool filter logic                  | `src/filtering/tool-filter.ts`         | `ToolFilter` class — shortcuts, groups, tool-level whitelist/blacklist + `getEnabledGroups()` for instruction section gating                                                                                                                                             |
| Tool group icon mapping            | `src/constants/icons.ts`               | CDN SVG URLs per tool group (used in `tools/list` responses)                                                                                                                                                                                                             |
| Resource annotation presets        | `src/utils/resource-annotations.ts`    | Centralized presets (`HIGH_PRIORITY`, `MEDIUM_PRIORITY`, `LOW_PRIORITY`, `ASSISTANT_FOCUSED`) + helpers (`withPriority`, `withAutoRead`, `withSessionInit`)                                                                                                              |
| Global metrics accumulator         | `src/observability/metrics.ts`         | `MetricsAccumulator` singleton (`globalMetrics`) — per-tool call counts, error counts, total/avg duration, input/output token estimates, latency percentiles (p50/p95/p99); exposes `getSummary()`, `getTokenBreakdown()`, `getSystemMetrics()`, `getUserBreakdown()`, `getLatencySummary()` |
| Audit logger                       | `src/audit/audit-logger.ts`            | `AuditLogger` (async-buffered JSONL, 50-entry HWM, 100ms auto-flush, 10 MB rotation, 5 archives, configurable arg redaction via `AUDIT_REDACT`, stderr mode via `--audit-log stderr`) with graceful `close()` lifecycle and `recent()` streaming tail-read (64KB window) |
| Audit types                        | `src/audit/types.ts`                   | `AuditEntry`, `AuditConfig` (`enabled`, `logPath`, `redact`, `auditReads`, `maxSizeBytes`), `AuditCategory` (`read` \| `write` \| `admin`)                                                                                                                               |
| Audit interceptor                  | `src/audit/interceptor.ts`             | `createAuditInterceptor()` — scope-based filtering (write/admin by default, read opt-in via `--audit-reads`), token estimation, duration timing, error capture, compact read format                                                                                      |
| Code Mode API constants            | `src/codemode/api-constants.ts`        | Method→group map, JSON-RPC error codes, sandbox method names                                                                                                                                                                                                             |
| Logger                             | `src/utils/logger.ts`                  | Structured JSON logging with severity filtering                                                                                                                                                                                                                          |
| Security utilities                 | `src/utils/security-utils.ts`          | Input validation, SQL injection prevention, path traversal protection, token scrubbing                                                                                                                                                                                   |
| Error formatter                    | `src/utils/error-helpers.ts`           | `formatHandlerError()` — structured error response builder                                                                                                                                                                                                               |
| Database schema DDL                | `src/database/core/schema.ts`          | Table definitions, indexes, FTS5 virtual table                                                                                                                                                                                                                           |
| Database adapter interface         | `src/database/core/interfaces.ts`      | `IDatabaseAdapter` contract (all DB operations)                                                                                                                                                                                                                          |
| Default config                     | `src/types/index.ts`                   | `DEFAULT_CONFIG` with default db path, model name, semantic search enabled                                                                                                                                                                                               |
| Embedding model                    | env var / `--embedding-model`          | Swappable HuggingFace feature extraction model for semantic search embeddings.                                                                                                                                                                                           |
| OAuth scope mapping                | `src/auth/scope-map.ts`                | Tool→scope mapping: `read`, `write`, `admin`                                                                                                                                                                                                                             |
| MAX_QUERY_LIMIT                    | `src/handlers/tools/search/helpers.ts` | 500 — shared cap for all paginated tools (core, github, search)                                                                                                                                                                                                          |
| CODE_MODE_MAX_RESULT_SIZE          | env var / `--codemode-max-result-size` | Configurable Code Mode output cap (default: 100KB). Read by `CodeModeSecurityManager` in `codemode.ts`                                                                                                                                                                   |

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

| Pattern                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structured Errors**   | Every tool returns `{success: false, error, code, category, suggestion, recoverable}` — never raw exceptions. Uses `formatHandlerError()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Dual-Schema**         | SDK-facing `inputSchema` is fully optional (no `.min()`, all `.optional()`). Handler-internal schema (inside `try`) enforces strict validation. See § SDK Input Schema Validation above — **this is the #1 recurring issue**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Tool Context**        | `ToolContext` passes `db`, `teamDb?`, `vectorManager?`, `teamVectorManager?`, `github?`, `config?`, `progress?` to all tool group modules. Each group factory receives context and returns `ToolDefinition[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Tool Map Cache**      | `getTools()` + `callTool()` share a `Map<string, ToolDefinition>` cache (O(1) lookup). Cache invalidates when context refs change. `mappedToolsCache` avoids re-mapping for unfiltered calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Code Mode Bridge**    | `mj.*` API in worker thread communicates via MessagePort RPC to main thread tool handlers. All 10 groups exposed (`core`, `search`, `analytics`, `relationships`, `io`, `admin`, `github`, `backup`, `team`). Tools are also exposed as bare globals directly in the execution context (e.g., `createEntry()`) alongside legacy aliases (`journal`, `db`, `memory`, `sqlite`, etc.). Readonly mode halts execution gracefully and returns structured errors via proxy traps. Result cap 100KB default (configurable via `CODE_MODE_MAX_RESULT_SIZE`). Secured via separate V8 isolates, disabled `codeGeneration`, frozen built-in prototypes, and nullified `Proxy`/`Reflect`/`Symbol` constructors. |
| **Tool Filtering**      | `ToolFilter` parses `--tool-filter` string → whitelist/blacklist of tool names. `codemode` auto-injected unless explicitly excluded. Shortcuts: `starter`, `essential`, `readonly`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Briefing System**     | `memory://briefing` assembled from modular sections (context, GitHub, user message). Configurable via 13 env vars / CLI flags (incl. `--workflow-summary`/`MEMORY_JOURNAL_WORKFLOW_SUMMARY` for `memory://workflows`). Instruction levels: `essential`, `standard`, `full`.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **GitHub Split**        | **Tools**: 67 specialized agents (across 10 domains). `GitHubIntegration` facade handles all API calls. Tools dynamically instantiate local `GitHubIntegration` bounds to the target project's physical path via `PROJECT_REGISTRY` if explicitly requested, falling back to the first registered project globally.                                                                                                                                                                                                                                                                                                                                                                                   |
| **Database Adapter**    | `IDatabaseAdapter` interface → `SqliteAdapter` (better-sqlite3). Entry operations split into `entries/` subdirectory (crud, search, importance, statistics, shared).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Vector Search**       | `VectorSearchManager` integrates `sqlite-vec` + `@huggingface/transformers`. Lazy model loading on first use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **OAuth 2.1**           | RFC 9728/8414 compliant. Scope enforcement via `scope-map.ts` (read/write/admin). JWT/JWKS validation. Optional — falls back to bearer token or no auth.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **HTTP Transport**      | Stateful (Streamable HTTP + legacy SSE) / Stateless (serverless) modes. Security headers, rate limiting (100 req/min), CORS, 1MB body limit, session management.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Scheduler**           | HTTP-only `setInterval` jobs: automated backup, vacuum, vector index rebuild. Error-isolated — failure in one job doesn't affect others. Status visible via `memory://health`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Auto-Prune**          | Importance-based graduated data lifecycle on startup. Configured via `--archive-older-than-days`, `--prune-older-than-days`, `--hard-delete-older-than-days` and `--prune-importance-threshold` (default 0.15). Creates safety backup, archives active entries, soft-deletes low-importance entries, and hard-deletes stale soft-deleted entries via `executeDataLifecycle()` SQL CTEs, then cleans stale vector embeddings. Disabled by default. |
| **Metrics Interceptor** | `wrapWithMetrics()` (`src/observability/interceptor.ts`) wraps each `callTool()` dispatch. Post-processes results asynchronously: injects `_meta.tokenEstimate` (content-type-aware heuristic), records per-tool timing and token counts to `globalMetrics`. Applied in both the cached handler path and the progress-token path. Swallows accumulator errors — interceptor failure never affects tool output.                                                                                                                                                                                                                                                                                               |
| **Audit Interceptor**   | `createAuditInterceptor()` (`src/audit/interceptor.ts`) wraps each `callTool()` dispatch alongside metrics. Scope-based filtering: write/admin tools logged by default, read tools opt-in via `--audit-reads`. Entries include tool name, scope, category, args (unless redacted), duration, token estimate, success/error, user, scopes. The interceptor is non-throwing — audit failures log to stderr but never propagate to callers. Applied in both the cached handler path and the progress-token path.                                                                                                                                                                                         |
| **ErrorFieldsMixin**    | All output schemas extend `ErrorFieldsMixin.shape` — 6 optional error fields so error responses always pass validation. Canonical SSoT at `utils/errors/error-response-fields.ts`; handler layer re-export stub preserved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Barrel Re-exports**   | Every directory has `index.ts` barrel. Import from `./module/index.js` (with `.js` extension for ESM).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Team Database**       | Separate SQLite file (`TEAM_DB_PATH`) with author attribution. 20 dedicated tools split into `team/` subdirectory (core, search, admin, analytics, relationships, export, backup, vector). Cross-DB isolation with dedicated `teamVectorManager`.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

| File / Directory                                       | Purpose                                                                                                                                              |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `test-server/README.md`                                | Agent testing orchestration doc                                                                                                                      |
| `test-server/tool-reference.md`                        | Categorized 100-tool inventory                                                                                                                       |
| `test-server/code-map.md`                              | This file — agent-optimized codebase navigation                                                                                                      |
| `test-server/test-preflight.md`                        | Pre-test verification checklist                                                                                                                      |
| `test-server/standard/test-seed.md`                    | Seed data creation (S1–S17) — must run first                                                                                                         |
| `test-server/standard/test-core-infra.md`              | Infrastructure tests (health, briefing, protocol scripts, GitHub status)                                                                             |
| `test-server/standard/test-core-crud.md`               | Entry CRUD operations (create, read, update, delete)                                                                                                 |
| `test-server/standard/test-core-search.md`             | Text search (FTS5, hybrid, filters, cross-DB, date range)                                                                                            |
| `test-server/standard/test-core-semantic.md`           | Semantic search, vector index, analytics, cross-project insights                                                                                     |
| `test-server/standard/test-core-relationships.md`      | Relationships, causal types, visualization, graph resources                                                                                          |
| `test-server/standard/test-core-admin.md`              | Admin tools (tags, export, backup/restore)                                                                                                           |
| `test-server/standard/test-core-scheduler.md`          | Scheduler tests (HTTP-only, terminal script)                                                                                                         |
| `test-server/standard/test-schemas.md`                 | outputSchema validation for all 60 tools                                                                                                             |
| `test-server/standard/test-resources.md`               | All 28 resources (static + template, happy + error paths)                                                                                            |
| `test-server/standard/test-github.md`                  | **GitHubIntegration** (`index.ts`): Facade uniting 18 tools (issues, PRs, kanban, milestones, repo context). Orchestrates cross-module dependencies. |
| `test-server/standard/test-errors.md`                  | Prompt handlers, structured error verification, numeric coercion                                                                                     |
| `test-server/standard/test-integrity.md`               | Data integrity, boundary values, implementation bug detection                                                                                        |
| `test-server/standard/test-team.md`                    | Team collaboration (25 tools + 4 resources)                                                                                                          |
| `test-server/codemode/test-cm-sandbox-basics.md`       | Code mode — Phase 16: Sandbox basics (expressions, async, metrics, timeout)                                                                          |
| `test-server/codemode/test-cm-api-discovery.md`        | Code mode — Phase 17: API discoverability (help, aliases, positional args)                                                                           |
| `test-server/codemode/test-cm-readonly.md`             | Code mode — Phase 18: Readonly mode (read succeed, writes blocked)                                                                                   |
| `test-server/codemode/test-cm-security.md`             | Code mode — Phase 19: Error handling & security (18 blocked patterns, prototype freezing, nullified constructors)                                    |
| `test-server/codemode/test-cm-crud.md`                 | Code mode — Phase 20: Core CRUD (create, read, update, delete, error paths)                                                                          |
| `test-server/codemode/test-cm-search.md`               | Code mode — Phase 21: Search & semantics (FTS5, filters, analytics, vector)                                                                          |
| `test-server/codemode/test-cm-workflows.md`            | Code mode — Phase 22: Multi-step workflows (pipelines, branching, round-trip)                                                                        |
| `test-server/codemode/test-cm-orchestration.md`        | Code mode — Phase 23: Cross-group orchestration (health, tags, full pipeline)                                                                        |
| `test-server/codemode/test-cm-relationships.md`        | Code mode — Phase 24: Relationships & visualization (link, duplicate, Mermaid)                                                                       |
| `test-server/codemode/test-cm-github.md`               | Code mode — Phase 25: GitHub tools (16 tools: read, Kanban, lifecycle, CRUD)                                                                         |
| `test-server/codemode/test-cm-io.md`                   | Code mode — Phase 26: IO & interoperability (export, Markdown orchestration)                                                                         |
| `test-server/codemode/test-cm-admin-backup.md`         | Code mode — Phase 27: Admin, backup & export (tags, export, backup lifecycle)                                                                        |
| `test-server/codemode/test-cm-team-crud.md`            | Code mode — Phase 28.1-3: Team CRUD, error paths, date range search                                                                                  |
| `test-server/codemode/test-cm-team-admin.md`           | Code mode — Phase 28.4-9: Team admin, analytics, relationships, export, backup                                                                       |
| `test-server/codemode/test-cm-team-vector-errors.md`   | Code mode — Phase 28.10-11: Team vector, insights, cross-tool error verification                                                                     |
| `test-server/codemode/test-cm-error-matrix.md`         | Code mode — Phase 29: Systematic Zod sweeps + type mismatches across all groups                                                                      |
| `test-server/codemode/test-cm-payload-optimization.md` | Code mode — Phase 30: Payload optimization (throttling, truncation, cap, limits)                                                                     |
| `test-server/standard/test-core-io.md`                 | IO interoperability (legacy export, Markdown roundtrips)                                                                                             |
| `test-server/standard/test-tool-group-core.md`         | Granular stress test — Core tools error matrix, Zod sweeps, boundaries                                                                               |
| `test-server/standard/test-tool-group-admin.md`        | Granular stress test — Admin tools error matrix, Zod sweeps                                                                                          |
| `test-server/standard/test-tool-group-backup.md`       | Granular stress test — Backup tools error matrix, filter enforcement                                                                                 |
| `test-server/standard/test-tool-group-search.md`       | Granular stress test — Search tools error matrix, limit/threshold boundaries                                                                         |
| `test-server/standard/test-tool-group-github.md`       | Granular stress test — GitHub tools error matrix, OutputSchema compliance                                                                            |
| `test-server/standard/test-tool-group-team.md`         | Granular stress test — Team tools error matrix, missing DB context                                                                                   |
| `test-server/standard/test-payload-optimization.md`    | Cross-cutting — Kanban throttling, body truncation, pagination cap, result cap                                                                       |
| `test-server/test-agent-experience.md`                 | Open-ended agent experience scenarios                                                                                                                |
| `test-server/scripts/test-instruction-levels.mjs`      | Integration test — instruction level (essential/standard/full) token ordering                                                                        | \n  | `test-server/scripts/test-filter-instructions.mjs` | Integration test — filter-aware instruction sections per `--tool-filter` config; reports token estimates per filter combination |
| `test-server/scripts/test-scheduler.mjs`               | Integration test — scheduler behavior                                                                                                                |
| `test-server/scripts/test-tool-annotations.mjs`        | Integration test — tool annotation verification                                                                                                      |
| `tests/`                                               | Vitest unit/integration tests (13 subdirectories)                                                                                                    |
| `tests/e2e/`                                           | Playwright E2E tests — HTTP/SSE transport                                                                                                            |

### Test Subdirectories (`tests/`)

| Directory        | Coverage                                                                                                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`          | OAuth 2.1 middleware, scopes, token validation                                                                                                                                                                         |
| `codemode/`      | Sandbox security, API bridge, worker lifecycle                                                                                                                                                                         |
| `constants/`     | Server instructions, icons                                                                                                                                                                                             |
| `database/`      | SQLite adapter, entry CRUD, search, tags, backup                                                                                                                                                                       |
| `e2e/`           | Playwright end-to-end (HTTP/SSE transport parity, payload optimization: kanban throttling, body truncation, codemode cap)                                                                                              |
| `filtering/`     | Tool filter parsing, group/shortcut resolution                                                                                                                                                                         |
| `github/`        | GitHub integration, issues, PRs, milestones, kanban                                                                                                                                                                    |
| `handlers/`      | Tool handlers, resource handlers, prompt handlers                                                                                                                                                                      |
| `observability/` | Token estimator, metrics accumulator, interceptor — Phase 2 coverage                                                                                                                                                   |
| `audit/`         | AuditLogger async-buffered JSONL writing, 10 MB rotation, recent() tail-read, stderr mode, arg redaction + AuditInterceptor scope-based filtering, token estimation, duration timing, error capture — Phase 2 coverage |
| `security/`      | Input validation, SQL injection, path traversal                                                                                                                                                                        |
| `server/`        | MCP server setup, registration                                                                                                                                                                                         |
| `transports/`    | HTTP transport, sessions, rate limiting                                                                                                                                                                                |
| `utils/`         | Logger, error helpers, security utils                                                                                                                                                                                  |
| `vector/`        | Vector search manager, semantic search                                                                                                                                                                                 |
