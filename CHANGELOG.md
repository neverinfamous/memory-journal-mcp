# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Performance Benchmarking Suite** — Added a `vitest bench` powered benchmarking suite to measure baseline performance for database operations, vector indexing, and tool execution overhead. Included new `"bench"` npm script.

- **GitHub Milestones Integration** — Full CRUD support for GitHub Milestones
  - 5 new tools: `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone` (38 total tools)
  - 2 new resources: `memory://github/milestones` (list view) and `memory://milestones/{number}` (detail view) (20 total resources)
  - Session briefing (`memory://briefing`) now includes milestone progress in the user message table
  - GitHub status resource (`memory://github/status`) now includes milestone summary data
  - `create_github_issue_with_entry` now accepts optional `milestone_number` parameter to assign issues to milestones
  - `get_github_issues` and issue resources now include milestone association data
  - New `ICON_MILESTONE` flag icon for milestone tools and resources
  - Milestone tools reference added to `ServerInstructions.ts` for agent guidance
- **Server Host Bind Parameter** — New `--server-host` CLI option and `MCP_HOST` environment variable for configuring HTTP transport bind address
  - Defaults to `localhost`; set to `0.0.0.0` for container deployments
  - Also reads `HOST` environment variable as fallback
  - CLI flag takes precedence over environment variables

### Changed

- **Dependency Updates**
  - `@eslint/js`: 9.39.2 → 10.0.1 (major)
  - `@modelcontextprotocol/sdk`: 1.26.0 → 1.27.1 (minor)
  - `@types/node`: 25.2.0 → 25.3.2 (minor)
  - `eslint`: 9.39.2 → 10.0.2 (major)
  - `simple-git`: 3.28.0 → 3.32.3 (minor)
  - `sql.js`: 1.12.0 → 1.14.0 (minor)
  - `typescript-eslint`: 8.54.0 → 8.56.1 (minor)
  - `axios` override: 1.13.2 → 1.13.5 (patch) — fixes GHSA-43fc-jf86-j433 (DoS via `__proto__` key in `parseConfig`)

### Documentation

- **AntiGravity IDE Guidance** — Added explicit note in README.md and DOCKER_README.md that AntiGravity does not currently support MCP server instructions, with workaround to manually provide `ServerInstructions.ts` contents

### Improved

- **`get_entry_by_id` Importance Scoring Breakdown** — Tool now returns `importanceBreakdown` alongside the `importance` score, showing weighted component contributions: `significance` (30%), `relationships` (35%), `causal` (20%), `recency` (15%). Gives agents transparency into _why_ an entry scored a given importance level.
- **`get_cross_project_insights` Inactive Threshold Visibility** — Tool output now includes `inactiveThresholdDays: 7` field, making the hardcoded inactive project classification criteria self-documenting. Previously, consumers saw an empty `inactive_projects` array with no way to know the cutoff.
- **Database I/O — Debounced Save** — Mutation methods (`createEntry`, `updateEntry`, `deleteEntry`, `linkEntries`, `mergeTags`) now use a 500ms debounced `scheduleSave()` instead of synchronous `save()` on every call, batching rapid writes into a single disk flush. `close()` and `restoreFromFile()` still flush immediately for data safety.
- **Vector Index Rebuild — Paginated Fetching** — `rebuildIndex()` now uses `getEntriesPage(offset, limit)` with `REBUILD_PAGE_SIZE=200` instead of loading all entries at once via `getRecentEntries(10000)`, reducing peak memory usage for large journals.
- **Vector Index Rebuild — Parallel Batch Embedding** — Entries are embedded in parallel batches of 5 (`REBUILD_BATCH_SIZE`) via `Promise.all` instead of sequentially, improving rebuild throughput.
- **Vector Index Rebuild — Sequential Insertion** — Embeddings are generated in parallel batches for throughput, but vectra insertions are sequential to avoid file I/O race conditions. Index is pre-cleaned in bulk to eliminate per-item upsert deletes.
- **Server Startup — `getTools()` Deduplication** — Eliminated a duplicate `getTools()` call during server startup; tool names for instruction generation are now extracted from the same array used for registration, saving one full tool-construction pass.
- **GitHub API — TTL Response Cache** — Read methods (`getIssues`, `getIssue`, `getPullRequests`, `getPullRequest`, `getWorkflowRuns`, `getRepoContext`, `getMilestones`, `getMilestone`) now cache responses for 5 minutes. Mutation methods (`createIssue`, `closeIssue`, `createMilestone`, `updateMilestone`, `deleteMilestone`, `moveProjectItem`, `addProjectItem`) automatically invalidate related caches. Public `clearCache()` method available for manual invalidation.

### Fixed

- **Docker Hub Short Description** — Corrected "HTTPS" → "HTTP/SSE" and formatting in `docker-publish.yml` short-description field
- **`delete_entry` Permanent Delete of Soft-Deleted Entries** — `delete_entry(id, permanent: true)` now works on previously soft-deleted entries. Added `getEntryByIdIncludeDeleted()` so permanent deletion can find entries regardless of soft-delete state. Previously returned `{ success: false, error: "Entry not found" }` for soft-deleted entries.
- **`list_tags` Zero-Count Tag Filtering** — `list_tags` tool and `memory://tags` resource no longer return orphan tags with zero usage count, reducing clutter from deleted or merged tags
- **`delete_entry` Existence Check (P154)** — Tool now pre-checks entry existence before mutation, returning `{ success: false, error: "Entry X not found" }` for nonexistent entries instead of always returning `success: true`
- **`link_entries` Existence Check (P154)** — Tool now pre-checks both source and target entry existence before creating relationship, returning `{ success: false, message: "Source/Target entry X not found" }` instead of silently creating orphan relationships
- **`visualize_relationships` Existence Disambiguation (P154)** — When `entry_id` parameter specifies a nonexistent entry, tool now returns `{ message: "Entry X not found" }` instead of the ambiguous `"No entries found with relationships matching your criteria"`
- **`memory://health` Tool Count** — Health resource now dynamically computes tool count from `TOOL_GROUPS` instead of a hardcoded value. Previously reported 33 tools; now correctly reports 38 after milestone tools were added.
- **`delete_github_milestone` Structured Error** — Tool now returns `{ success: false, milestoneNumber, message, error }` matching `DeleteMilestoneOutputSchema` when deletion fails. Previously returned only `{ error }` without structured fields.
- **`JournalEntry` GitHub Metadata** — Entry output now includes 10 GitHub integration fields (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `prStatus`, `projectNumber`, `projectOwner`, `workflowRunId`, `workflowName`, `workflowStatus`) in all tool responses. Previously stored in DB but omitted from `create_entry`, `get_entry_by_id`, `get_recent_entries`, and search results.

### CI/CD

- **Removed Dependabot Auto-Merge Workflow** — Deleted `dependabot-auto-merge.yml`; dependency PRs now require manual review and merge
- **Trivy Action Update** — Updated `aquasecurity/trivy-action` 0.33.1 → 0.34.0 in `security-update.yml` (bundles Trivy scanner 0.69.1)
- **CI Test Matrix Alignment** — Updated Node.js test matrix from `[20.x, 22.x, 25.x]` to `[24.x, 25.x]` to match `engines.node: >=24.0.0`
- **Blocking npm audit** — Removed `continue-on-error: true` from `npm audit` step in lint-and-test.yml; known vulnerabilities now fail the pipeline
- **Blocking Secret Scanning** — Removed `continue-on-error: true` from TruffleHog step in secrets-scanning.yml; verified secret leaks now fail the pipeline

### Security

- **GHSA-w7fw-mjwx-w883 (qs)** — Updated `qs` 6.14.1 → 6.14.2 to fix low-severity arrayLimit bypass in comma parsing that allows denial of service
- **CVE-2026-26960 (tar)** — Manually patched npm's bundled `tar` → `7.5.8` in Dockerfile to fix HIGH severity path traversal vulnerability (CVSS 7.1). Also updated npm override.
- **HTTP Transport Hardening** — Comprehensive security improvements for HTTP mode:
  - **Configurable CORS** — New `--cors-origin` CLI flag and `MCP_CORS_ORIGIN` env var (default: `*`). Previously hardcoded `Access-Control-Allow-Origin: *`.
  - **Request Body Size Limit** — Added 1MB limit to `express.json()` to prevent memory exhaustion DoS attacks
  - **Security Headers** — Added `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on all HTTP responses
  - **Session Timeout** — Stateful HTTP sessions now expire after 30 minutes of inactivity (5-minute sweep interval). Prevents unbounded memory growth from abandoned sessions.
- **Error Log Token Scrubbing** — Logger now automatically sanitizes `error` context fields to redact GitHub tokens (classic `ghp_`, fine-grained `github_pat_`), Bearer tokens, and Authorization headers before writing to stderr. New `sanitizeErrorForLogging()` in `security-utils.ts`.
- **SECURITY.md Rewrite** — Complete rewrite for TypeScript era. Removed all outdated Python references. Added documentation for HTTP transport security (CORS, headers, session timeout, body limits), GitHub token handling, and CI/CD security pipeline.
- **docker-compose.yml Rewrite** — Replaced Python-era configuration with TypeScript commands. Removed SSH/gitconfig root mounts, deprecated `version` key, and `PYTHONPATH`. Added HTTP transport service with resource limits and secure volume mount options.
- **Dockerfile Version Label** — Updated hardcoded `4.0.0` → `4.3.1` to match actual package version
- **Dockerfile Healthcheck** — Replaced no-op `console.log` healthcheck with `process.exit(0)` validation. Added documentation for HTTP-mode override using `curl`.
- **Legacy Cleanup** — Removed leftover Python `__pycache__` directories from `src/` subtree

## [4.3.1] - 2026-02-05

### Changed

- **Dependency Updates**
  - `@modelcontextprotocol/sdk`: 1.25.3 → 1.26.0 (minor)
  - `@types/node`: 25.0.10 → 25.2.0 (minor)
  - `commander`: 14.0.2 → 14.0.3 (patch)
  - `globals`: 17.1.0 → 17.3.0 (minor)

### Fixed

- **`get_cross_project_insights` Output Schema Validation** — Fixed empty result case returning incomplete object
  - When no projects met minimum entry threshold, handler returned only `message` and `projects`
  - Now returns all required fields: `project_count`, `total_entries`, `inactive_projects`, `time_distribution`
  - Fixes MCP outputSchema validation error when tool returns empty results

### Security

- **CVE-2026-24515 (libexpat)** — Explicit libexpat install from Alpine edge fixes CRITICAL severity null pointer dereference vulnerability.
- **CVE-2026-25210 (libexpat)** — Same patch fixes MEDIUM severity integer overflow information disclosure/data integrity issue.
- **CVE-2026-23950 + CVE-2026-24842 (tar)** — Manually patched npm's bundled `tar` → `7.5.7` in Dockerfile to fix HIGH severity vulnerabilities (path traversal, CVSS 8.2). Also added npm override for project dependencies.

## [4.3.0] - 2026-01-18

### Added

- **Causal Relationship Types** — 3 new relationship types for decision tracing and failure analysis
  - `blocked_by`: Entry was blocked by another (e.g., blocker → resolution)
  - `resolved`: Entry resolved/fixed an issue from another
  - `caused`: Entry caused or led to another outcome
  - Distinct Mermaid arrow styles: `--x` for blocked_by, `==>` for resolved, `-.->` for caused
  - Updated Field Notes with guidance on when to use causal types

- **Enhanced Analytics** — `get_statistics` now returns 4 additional metrics for deeper insights
  - `decisionDensity`: Significant entries per period (entries with `significanceType`)
  - `relationshipComplexity`: Total relationships / total entries average
  - `activityTrend`: Period-over-period growth percentage
  - `causalMetrics`: Counts for `blocked_by`, `resolved`, `caused` relationships

- **Significance Gradients** — Computed `importance` scores (0.0-1.0) for entries
  - Formula weights: significance type (30%), relationship count (35%), causal relationships (20%), recency (15%)
  - `get_entry_by_id` now returns `importance` field
  - `memory://significant` resource sorts entries by importance (highest first)

### Fixed

- **Docker Workflow Duplicate Builds** — Removed `push: tags: ['v*']` trigger that caused duplicate image sets when releasing versions
  - Docker builds now only trigger via `workflow_run` after "Lint and Test" passes
  - Version tags still applied based on `package.json` version
  - Removed obsolete `preflight-check` job

### Improved

- **`memory://significant` Secondary Sort** — Entries with equal importance scores are now sorted by timestamp (newest first)
  - Previously, entries with identical importance could appear in non-deterministic order
  - Secondary sort ensures consistent, chronological ordering for ties
- **`create_entry` Auto-populates `issueUrl`** — When creating an entry with `issue_number` but no `issueUrl`, the URL is now auto-constructed from cached repository info
  - Requires GitHub integration and prior `getRepoInfo()` call (happens naturally during briefing)
  - Eliminates need to manually provide `issueUrl` when linking to issues
- **Harmonized Graph Arrow Styles** — `memory://graph/recent` now uses the same arrow mappings as `visualize_relationships` tool
  - Added causal relationship types: `blocked_by` (--x), `resolved` (==>), `caused` (-.->)
  - Added missing types: `clarifies` (-.->) and `response_to` (<-->)
  - Standardized `implements` to use `==>` (was `-.->`) for consistency

## [4.2.0] - 2026-01-17

### Added

- **HTTP/SSE Transport** — Run the server in HTTP mode for remote access and web-based clients
  - New `--transport http --port 3000` CLI options
  - `POST /mcp` — JSON-RPC requests (initialize, tools/call, resources/read, etc.)
  - `GET /mcp` — SSE stream for server-to-client notifications (supports resumability via `Last-Event-ID`)
  - `DELETE /mcp` — Session termination
  - **Stateful mode** (default): Session management via `mcp-session-id` header
  - **Stateless mode** (`--stateless`): No session management, ideal for serverless deployments
    - Trade-off: Progress notifications and SSE streaming unavailable in stateless mode
  - Uses MCP SDK's `StreamableHTTPServerTransport` with Express
  - New dependencies: `express@^5.1.0`, `@types/express` (devDependency)
- **New Tool: `cleanup_backups`** — Automatic backup rotation to prune old backups
  - `keep_count` parameter specifies how many recent backups to retain (default: 5)
  - Returns list of deleted filenames and count of kept backups
  - Added to `backup` tool group in ToolFilter
- **New Tool: `merge_tags`** — Tag normalization for consolidating similar tags
  - Merge duplicate/similar tags (e.g., `phase-2` → `phase2`)
  - Source tag is deleted after merge; target tag created if not exists
  - Updates all entry-tag links and usage counts
  - Added to `admin` tool group in ToolFilter
- **Tool Count**: 31 → 33 tools (backup: 3 → 4, admin: 4 → 5)

### Improved

- **`semantic_search` Hint Enhancement** — Improved feedback when no results found
  - Hint now includes the current `similarity_threshold` value (e.g., "0.3")
  - Suggests lowering threshold (e.g., "Try 0.2 for broader matches.")
  - Helps users understand why queries return empty and how to adjust
- **`restore_backup` Enhanced Warning** — Improved feedback about reverted changes
  - Warning message now explicitly mentions tag merges, new entries, and relationships are reverted
  - New `revertedChanges` field in output with specific details about reverted data
  - `tagMerges` message now clarifies: "Previously merged tags will reappear as separate tags."
  - Added Field Note in `memory://instructions` documenting restore behavior
- **`memory://prs/{pr_number}/timeline` Enhancement** — Live PR metadata from GitHub API
  - New `prMetadata` field with title, state, draft, mergedAt, closedAt, author, headBranch, baseBranch
  - New `timelineNote` field with human-readable PR status (e.g., "PR #67 is merged (merged)")
  - Differentiates timeline from simpler `memory://prs/{pr_number}/entries` resource

### Documentation

- **`memory://tags` vs `list_tags` Schema** — Documented intentional difference between resource and tool output
  - Resource includes `id`, `name`, `count` (for reference/management use cases)
  - Tool returns only `name`, `count` (optimized for filtering/display)
  - Added to `ServerInstructions.ts` Field Notes section
- **Tag Naming Conventions** — Added guidance for consistent tag naming patterns
  - Recommends lowercase with dashes (e.g., `bug-fix`, `phase-2`)
  - Documents `merge_tags` tool for consolidating duplicates
- **`semantic_search` Threshold Guidance** — New Field Note documenting threshold recommendations
  - Default 0.3, broader matches at 0.2-0.25, strict matches at 0.4+
  - Added `similarity_threshold` to tool parameter reference table

### Changed

- **`memory://instructions` Default Level** — Changed from `standard` to `full` so agents always receive complete tool parameter reference and field notes (~600 tokens)
- **Briefing `clientNote`** — Simplified from "If prompts unavailable or Dynamic Context Management behaviors missing..." to clearer "For complete tool reference and field notes, read memory://instructions."
- **Expanded StructuredContent Coverage** — 7 additional tools now return `structuredContent` with Zod validation
  - `test_simple`, `export_entries`, `rebuild_vector_index`, `add_to_vector_index`
  - `move_kanban_item`, `create_github_issue_with_entry`, `close_github_issue_with_entry`
  - All 33 tools with response data now have formal output schemas

### Fixed

- **CI Status "unknown" for Cancelled Workflows** — Fixed `memory://briefing` and `memory://github/status` reporting "unknown" when latest workflow was cancelled
  - Added proper handling for `cancelled` conclusion alongside `success` and `failure`
  - CI status type now includes `passing | failing | pending | cancelled | unknown`

## [4.1.0] - 2026-01-17

### Added

- **Auto-rebuild Vector Index on Startup** — New `--auto-rebuild-index` CLI flag and `AUTO_REBUILD_INDEX` env var
  - When enabled, server rebuilds the vector index from all database entries during startup
  - Ensures `memory://health` reports accurate `itemCount` matching `entryCount`
  - Useful for deployments where the in-memory index needs to be synchronized after server restarts
- **`move_to_done` Option for `close_github_issue_with_entry`** — Automatically move Kanban item to "Done" when closing an issue
  - New `move_to_done` boolean parameter (default: `false`)
  - New `project_number` parameter (uses `DEFAULT_PROJECT_NUMBER` if not specified)
  - Finds the issue on the Kanban board and moves it to the "Done" column
  - Output includes `kanban` field with move result
- **`autoContext` Field Documentation** — Added "Field Notes" section to server instructions explaining the reserved field
- **MCP Progress Notifications** — Long-running operations now emit `notifications/progress` for improved user experience
  - **`rebuild_vector_index`**: Reports progress every 10 entries with total count
  - **`restore_backup`**: Reports 3-phase progress (backup → restore → verify)
  - **`export_entries`**: Reports 2-phase progress (fetch → process)
  - Requires client support for `progressToken` in request `_meta` (MCP 2025-11-25)
  - New utility module: `src/utils/progress-utils.ts`
- **MCP Icons Array Support** — Tools, resources, and prompts now include optional `icons` for visual representation in MCP clients
  - Follows MCP 2025-11-25 specification with `src`, `mimeType`, `sizes` properties
  - **31 tools** with group-based icons (core, search, analytics, github, backup, etc.)
  - **15 resources** with context-appropriate icons (briefing, recent, graph, health, github, etc.)
  - **15 prompts** with message bubble icon
  - Uses SVG data URIs for self-contained distribution (no external dependencies)
  - New type: `McpIcon` in `src/types/index.ts`
  - New module: `src/constants/icons.ts` with centralized icon definitions
- **Expanded StructuredContent Coverage** — Extended Zod output schemas from 5 to 24 tools
  - **17 new output schemas** defined in `src/handlers/tools/index.ts`
  - **Phase 1 (Core Read)**: `SemanticSearchOutputSchema`, `TagsListOutputSchema`, `VectorStatsOutputSchema`, `VisualizationOutputSchema`, `CrossProjectInsightsOutputSchema`
  - **Phase 2 (Mutations)**: `CreateEntryOutputSchema`, `UpdateEntryOutputSchema`, `DeleteEntryOutputSchema`, `LinkEntriesOutputSchema`
  - **Phase 3 (GitHub)**: `GitHubIssuesListOutputSchema`, `GitHubIssueResultOutputSchema`, `GitHubPRsListOutputSchema`, `GitHubPRResultOutputSchema`, `GitHubContextOutputSchema`, `KanbanBoardOutputSchema`
  - **Phase 4 (Backup)**: `BackupResultOutputSchema`, `BackupsListOutputSchema`, `RestoreResultOutputSchema`
  - Clients supporting `structuredContent` receive validated JSON for programmatic consumption
- **`semantic_search` Hint Control** — New `hint_on_empty` parameter (default: `true`) to control hint display
  - When `false`, suppresses hints about empty results or index status
  - Useful for programmatic consumers that handle empty results differently
- **PR Resource Empty Hints** — `memory://prs/{pr_number}/entries` and `memory://prs/{pr_number}/timeline` now include a `hint` field when no entries are linked
  - Hint: "No journal entries linked to this PR. Use create_entry with pr_number to link entries."

### Documentation

- **GitHub Fallback Behavior** — Documented in both `README.md` and `DOCKER_README.md`
  - Explains what happens when GitHub tools cannot auto-detect repository information
  - Shows example `requiresUserInput: true` response when `owner` and `repo` parameters are needed

### Known Limitations

- **Icons not visible in protocol output** — MCP SDK v1.25.2 has `icons` in type definitions but `registerTool()`, `registerResource()`, and `registerPrompt()` don't pass icons through to protocol responses. Server-side implementation is correct and future-ready; will work when SDK adds proper passthrough.

### Fixed

- **`list_tags` Output Schema Validation** — Fixed tool returning `usageCount` instead of `count` required by `TagsListOutputSchema`
  - Handler now maps database `usageCount` field to schema-expected `count` field
  - Fixes "expected number for tags[*].count, received undefined" validation error
- **`semantic_search` Misleading Hint** — Fixed hint always showing "No entries in vector index" even when index had items
  - Now checks actual index stats to determine if index is truly empty
  - Shows appropriate hint: "No entries matched your query above the similarity threshold" when items exist but don't match
- **`getRecentEntries` Deterministic Ordering** — Added secondary sort by ID for consistent results
  - Entries with identical timestamps now sorted by `id DESC` for deterministic ordering
  - Prevents non-reproducible results when entries share timestamps
- **GHSA-73rr-hh4g-fpgx (diff DoS)** — Manually patched npm's bundled `diff@8.0.2` → `8.0.3` in Dockerfile
  - npm team hasn't released fix yet, so we patch it directly via `npm pack` + replace
- **CVE-2026-23745 (tar)** — Manually patched npm's bundled `tar@7.5.2` → `7.5.3` in Dockerfile
  - Addresses high-severity vulnerability (CVSS 8.2) in npm's bundled tar package
- **`memory://health` Vector Index Field Name** — Aligned `indexedEntries` → `itemCount` for consistency with `get_vector_index_stats` tool
- **`memory://tags` Field Naming** — Mapped `usageCount` → `count` for consistency with `list_tags` tool output
- **`create_github_issue_with_entry` Default Status** — Issues added to projects now default to "Backlog" column when `initial_status` is not specified
- **`delete_entry` Vector Index Cleanup** — Deleting entries now removes them from the vector index, preventing orphaned index entries and `itemCount` discrepancy between vector index and database
- **`memory://instructions` Query Parameter Documentation** — Removed misleading description about query parameter support (`?level=essential|standard|full`) since MCP SDK performs exact URI matching at the SDK level before invoking handlers
- **Docker Security Gate** — Restructured workflow to scan BEFORE push:
  - `security-scan` now runs FIRST (before any images are pushed)
  - `build-platform` only runs after security scan passes
  - Uses `--only-fixed` to block only on fixable CVEs
  - Unfixable upstream CVEs (Alpine zlib, busybox) do not block deploys
- **Docker Build Optimization** — Comprehensive `.dockerignore` rewrite reducing build context by ~200MB:
  - Added `node_modules/` (~195MB) — reinstalled in builder stage
  - Added `mcp-publisher.exe` (6.3MB) — local publishing tool
  - Added dev tooling files (`.prettierrc`, `eslint.config.js`, etc.)
  - Added `releases/` directory and security scanning configs
  - Organized into logical sections with clear documentation

## [4.0.0] - 2026-01-16

### Added

- **GitHub Issue Lifecycle Tools** — Integrated issue management with automatic journal entries
  - **`create_github_issue_with_entry`**: Creates GitHub issue AND linked journal entry
    - **New**: `initial_status` parameter to set Kanban column (e.g., "Backlog", "Ready")
  - **`close_github_issue_with_entry`**: Closes issue AND creates resolution entry with significance
  - Auto-detects owner/repo from git context
  - Custom entry content optional with sensible auto-generated defaults
- **New `GitHubIntegration` Methods**: `createIssue()`, `closeIssue()` for Octokit operations
- **Tool Count**: 29 → 31 tools (github group: 7 → 9)
- **New Prompt: `confirm-briefing`** — Session context acknowledgment for users
  - Generates formatted acknowledgment message showing what context the agent received
  - Displays journal stats, latest entries preview, and behavioral guidance
  - Helps users understand what context the AI agent has before continuing
- **Briefing Resource Enhancement** — `memory://briefing` now includes:
  - `userMessage`: Pre-formatted context summary for agents to show users
  - `autoRead` and `sessionInit` annotations: Hints for clients that support auto-subscribe behavior
  - `templateResources`: Array of 6 template resource URIs (projects, issues, PRs, kanban) for full discoverability
  - Enhanced description: "AUTO-READ AT SESSION START" for discoverability
  - `clientNote`: Pointer to `memory://instructions` for clients that don't auto-inject ServerInstructions
- **New `memory://instructions` Resource** — Universal access to full server behavioral guidance
  - Exposes the same instructions that `ServerInstructions.ts` provides to auto-inject clients
  - Enables AntiGravity and other clients to access Dynamic Context Management patterns
  - Resource count: 17 → 18 resources (12 static + 6 template)
- **structuredContent Text Fallback** — Tools with `outputSchema` now return both:
  - `structuredContent`: Validated JSON for clients that support it (Cursor, Claude Desktop)
  - `content`: Formatted JSON text for clients that don't (AntiGravity)
  - Fixes "tool call completed" display issue in AntiGravity for 5 tools
- **Session Start Guidance** — Enhanced `ServerInstructions.ts` with acknowledgment step
  - Step 1: Read `memory://briefing` for project context
  - Step 2: **Show the `userMessage` to the user**
  - Step 3: Proceed with user's request
- **Prompt Count** — 14 → 15 prompts (added `confirm-briefing`)
- **MCP 2025-11-25 Resource Annotations** — Added `lastModified` (ISO 8601 timestamp) to key dynamic resources
  - Compact behavioral guidance (when to create/search entries)
  - Latest 3 entries preview with truncated content
  - GitHub status summary (repo, branch, CI, open issues/PRs)
  - Quick access links to related resources
  - Priority 1.0 (highest) — designed to be read first at session start
  - Optimized for clients that don't auto-inject server instructions (Antigravity, VSCode, etc.)
- **MCP 2025-11-25 Tool `outputSchema`** — Structured output validation for high-value tools
  - Tools return `structuredContent` (validated against schema) instead of raw text `content`
  - **5 tools with `outputSchema`**: `get_recent_entries`, `search_entries`, `search_by_date_range`, `get_entry_by_id`, `get_statistics`
  - New Zod schemas: `EntryOutputSchema`, `EntriesListOutputSchema`, `RelationshipOutputSchema`, `EntryByIdOutputSchema`, `StatisticsOutputSchema`
  - SDK validates output at runtime — ensures response matches declared schema

### Changed

- **Resource Handler Architecture** — Added `ResourceResult` interface for typed resource responses with annotations
  - Handlers can now return `{ data, annotations: { lastModified } }` structure
  - Backward compatible: existing handlers returning raw data still work
- **Confirmed OpenWorldHint Compliance** — All 7 GitHub tools already have `openWorldHint: true` annotation
- **Tiered Server Instructions** — `generateInstructions()` now supports `level` parameter
  - `essential` (~200 tokens): Core behavioral guidance only
  - `standard` (~400 tokens): + GitHub integration patterns (default)
  - `full` (~600 tokens): + tool/resource/prompt listings
- **Resource Count** — 16 → 17 → 18 resources (added `memory://briefing`, then `memory://instructions`)
- **Node.js 24 LTS Engines Alignment** — Updated `package.json` engines field to match Dockerfile baseline
  - `engines.node`: >=18.0.0 → >=24.0.0 (Dockerfile already using `node:24-alpine`)
- **Enhanced AI Agent Behavioral Guidance** — Added new `Behavioral Guidance` section to `ServerInstructions.ts`
  - **When to Query Project Context** — Encourages agents to fetch `memory://recent` or use `semantic_search` at conversation start; includes time awareness via `memory://health`
  - **When to Create Entries** — Clear triggers for documenting implementations, decisions, bug fixes, and milestones
  - **Building the Knowledge Graph** — Guidance on using `link_entries` to connect related work
  - **GitHub Integration Workflows** — Guidance on linking entries to Issues/PRs, documenting GitHub activity, and Kanban patterns
  - **Initial Context Strategy** — Guidance on dynamically choosing context based on user prompt
- **Initial Briefing Optimization** — Server instructions now include latest entry snapshot for immediate context
- **New `memory://github/status` Resource** — Compact GitHub overview with progressive disclosure (CI status, commit SHA, issue/PR numbers, Kanban summary)
- **Optimized `get-context-bundle` Prompt** — Now uses compact entry summaries (~85% token reduction) instead of full content
- **ServerInstructions Token Optimization** — Reduced BASE_INSTRUCTIONS by ~53% (207→97 lines) with client-agnostic server naming
- **Dynamic Context Management Documentation** — Promoted new feature in README.md and DOCKER_README.md Key Benefits
- **Wiki Documentation Updates** — Added Dynamic Context Management to Home.md, Quick-Start.md, Architecture.md, Tools.md, Installation.md
- **Client Compatibility Notes** — Documented AntiGravity IDE limitations in README.md, DOCKER_README.md, and Installation.md
  - ServerInstructions not injected: AntiGravity does not call `getServerInstructions()`
  - Resource hints not honored: `autoRead`/`sessionInit` annotations ignored
  - Workaround: Manual briefing read or user rules
- **Dependency Updates**
  - `@types/node`: 25.0.8 → 25.0.9
  - `vectra`: 0.11.1 → 0.12.3 (unpinned, packaging bug fixed)

### Documentation

- **GitHub Management Capabilities** — Added hybrid workflow documentation explaining MCP + gh CLI approach
  - New section in `README.md` and `DOCKER_README.md` with capability matrix
  - Enhanced `Git-Integration.md` wiki page with comprehensive capability table
  - Includes example issue lifecycle workflow demonstrating journal linking with gh CLI operations

### Fixed

- **Trivy Security Scan Workflow** — Fixed workflow that hadn't run since September 2025
  - Updated `aquasecurity/trivy-action` from unstable `@master` to stable `@0.33.1`
  - Added `push` trigger on `main` branch for Dockerfile/package changes to ensure regular scans
  - Added `pull_request` trigger for security validation before merging
- **Dependabot Label Configuration** — Created missing `npm` label in GitHub repository. Dependabot requires labels to exist before it can apply them to pull requests.
- **Vectra Type Definitions** — Now unpinned in v3.1.6. Previously pinned to v0.11.1 due to a packaging bug in v0.12.x where TypeScript type definitions (`.d.ts` files) were not included in the published npm package.
- **Docker Latest Tag** — Fixed `latest` tag not being applied on `workflow_run` triggered builds. Two issues were fixed: (1) The `{{is_default_branch}}` template doesn't evaluate correctly for `workflow_run` events - replaced with explicit branch detection. (2) The `security-scan` and `merge-and-push` jobs were being skipped due to cascading skip behavior from the skipped `preflight-check` job - added `always()` with explicit success checks for direct dependencies.
- **Semantic Search Timing** — Fixed race condition where search returned 0 results immediately after rebuild. Previous attempt using 100ms delay was insufficient; now using explicit index synchronization to ensure vectra's internal state is refreshed.
- **Auto-Indexing** — Fixed missing auto-indexing for `create_entry`, `create_entry_minimal`, and `update_entry` tools. New and updated entries are now immediately available for semantic search without requiring a full index rebuild.
- **CI Status Discrepancy** — Aligned `memory://github/status` logic with `memory://briefing` to use the latest _completed_ run for status determination. Previous logic incorrectly reported "failing" if _any_ of the last 5 runs failed, causing confusion when the latest run was passing.
- **GitHub Actions Resource** — `memory://actions/recent` now fetches live workflow runs from GitHub API and presents them as virtual journal entries, aligning with the graph view.
- **Project Board Automation** — `create_github_issue_with_entry` now accepts `project_number` to automatically add the created issue to a GitHub Project v2 Kanban board.
- **Search Filter Accuracy** — Fixed `search_entries` ignoring filters when `query` is empty. Now correctly filters by `issue_number`, `pr_number`, etc.
- **Default Project Number** — Added `--default-project` CLI option and `DEFAULT_PROJECT_NUMBER` environment variable to auto-add issues to a specific project if no `project_number` is provided.
- **Documentation Updates** — Updated README and DOCKER_README to document default project configuration and correct `mcp-config-example.json`.
- **`export_entries` Limit Parameter** — Added missing `limit` parameter to `export_entries` tool. Previously always exported 100 entries; now respects the `limit` parameter (default: 100).
- **`get_statistics` GroupBy Visibility** — Added `groupBy` field to statistics output so callers can verify which grouping was applied.
- **Entry Output Schema Completeness** — Added missing GitHub metadata fields to `EntryOutputSchema`: `projectOwner`, `issueUrl`, `prUrl`, `prStatus`, `workflowName`, `workflowStatus`.
- **Vector Index Stats Inconsistency** — Fixed `memory://health` reporting 0 indexed entries after `rebuild_vector_index`. Changed `getStats()` to use vectra's `getIndexStats()` API which explicitly loads from disk for authoritative stats.

### Documentation

- **GitHub Management Capabilities** — Added hybrid workflow documentation explaining MCP + gh CLI approach
  - New section in `README.md` and `DOCKER_README.md` with capability matrix
  - Enhanced `Git-Integration.md` wiki page with comprehensive capability table
  - Includes example issue lifecycle workflow demonstrating journal linking with gh CLI operations
- **`get_github_context` Clarification** — Updated description to clarify it only returns **open** items (closed items excluded).
- **`move_kanban_item` Case Sensitivity** — Documented that status matching is case-insensitive and to use exact status names from `get_kanban_board`.
- **Virtual Entry IDs** — Documented in Resources.md that `memory://actions/recent` returns virtual entries with negative IDs (negated workflow run IDs) to distinguish from database entries.
- **Resource Annotations Note** — Added note in Resources.md that MCP 2025-11-25 annotations (e.g., `lastModified`) may not be visible in all clients due to SDK/client limitations.

## [3.1.5] - 2026-01-11

### Security

- **Remove protobufjs CLI** — Eliminates CVE-2019-10790 (taffydb), CVE-2025-54798 (tmp), CVE-2025-5889 (brace-expansion). CLI folder not needed at runtime.

## [3.1.4] - 2026-01-11

### Fixed

- **Docker npm Upgrade** — Added `npm install -g npm@latest` to production stage (was only in builder stage). Fixes CVE-2025-64756 (glob) and CVE-2025-64118 (tar) in final Docker image.

## [3.1.3] - 2026-01-11

### Security

- **Docker CVE Fixes** — Active remediation for 7 CVEs:
  - npm global upgrade fixes CVE-2025-64756 (glob) and CVE-2025-64118 (tar)
  - Alpine edge for curl fixes CVE-2025-14524, CVE-2025-14819, CVE-2025-14017
  - protobufjs cli cleanup fixes CVE-2025-54798 (tmp) and CVE-2025-5889 (brace-expansion)
- **Reduced CVE Allowlist** — Only truly unfixable CVEs remain (zlib with no upstream fix, taffydb unmaintained)

## [3.1.2] - 2026-01-11

### Fixed

- **CI Build Pipeline** — Added `.npmrc` with `legacy-peer-deps=true` to resolve `npm ci` failures from optional peer dependency conflicts (vectra's zod@^3.23.8 vs zod@^4.x)
- **Docker Workflow Gating** — Added `preflight-check` job to docker-publish.yml; tag pushes now run lint/typecheck/build before Docker deployment

## [3.1.1] - 2026-01-11

### Security

- **Docker Image Security** — Added `apk upgrade --no-cache` to builder stage for latest security patches
  - Fixes CVE-2026-22184 (zlib critical)
  - Fixes CVE-2025-14524, CVE-2025-14819, CVE-2025-14017 (curl)
- **NPM Dependency Override** — Added `glob@^11.1.0` override to fix CVE-2025-64756 (ReDoS)

### Fixed

- **CI Build** — Regenerated `package-lock.json` to fix lock file desync with MCP SDK peer dependencies

## [3.1.0] - 2026-01-11

### Added

- **GitHub Projects v2 Kanban Support** — View and manage GitHub Project boards directly from AI agents
  - **New Tool: `get_kanban_board`** — Fetch project items grouped by Status columns (Backlog, Ready, In progress, In review, Done)
  - **New Tool: `move_kanban_item`** — Move items between status columns using GraphQL mutations
  - **New Resource: `memory://kanban/{project_number}`** — JSON board data with items grouped by status
  - **New Resource: `memory://kanban/{project_number}/diagram`** — Mermaid visualization of Kanban board
  - **Multi-level project discovery** — Searches user → repository → organization level projects automatically
  - **Dynamic status columns** — Supports any Status field configuration per project
- **Server Instructions** — Usage instructions are now automatically provided to AI agents via the MCP protocol's `instructions` capability during server initialization. See [`src/constants/ServerInstructions.ts`](https://github.com/neverinfamous/memory-journal-mcp/blob/main/src/constants/ServerInstructions.ts).
- **Comprehensive AI Agent Instructions** — Rewritten `ServerInstructions.ts` with:
  - Explicit MCP access patterns (`CallMcpTool`, `ListMcpResources`, `FetchMcpResource`)
  - Tool parameter reference tables for all 29 tools
  - Default GitHub Projects v2 status column documentation
  - Guidance for finding correct project by `projectTitle`

### Fixed

- **Dependabot Configuration** — Migrated from deprecated `pip` ecosystem to `npm` ecosystem
  - **Root Cause**: The v3.0.0 TypeScript rewrite removed all Python dependency files, but Dependabot was still configured for `pip`
  - **Symptom**: Dependabot security scans failed with `dependency_file_not_found: / not found`
  - **Resolution**: Replaced `pip` ecosystem with `npm` ecosystem and updated dependency groups to match TypeScript/Node.js packages (MCP SDK, Zod, sql.js, vectra, build tools, linting)

### Changed

- **Docker Base Image** — Upgraded from `node:22-alpine` to `node:24-alpine` (Active LTS)
  - Node.js 24 is the current Active LTS release (support through April 2028)
  - Node.js 25 was skipped as it's a non-LTS "Current" release (EOL June 2026)
- **Dependency Updates**
  - `@modelcontextprotocol/sdk` 1.25.1 → 1.25.2 (patch)
  - `@octokit/rest` 21.1.1 → 22.0.1 (major)
  - `globals` 16.5.0 → 17.0.0 (major)
  - `typescript-eslint` 8.50.1 → 8.52.0 (minor)
  - `vectra` 0.9.0 → 0.11.1 (minor) — Updated `queryItems` call to new API signature with BM25 hybrid search support
  - `zod` 4.2.1 → 4.3.5 (minor)

## [3.0.0] - 2025-12-28

### 🎉 Complete TypeScript Rewrite

This release is a **complete ground-up rewrite in TypeScript**, delivering a pure JavaScript stack with zero native dependencies. The Python codebase is deprecated and archived in `archive/python-v2`.

### Added - Backup & Restore Tools

- **New Tool Group: `backup`** - Never lose your journal data again
  - `backup_journal` - Create timestamped database backups with custom naming
  - `list_backups` - List all available backup files with metadata
  - `restore_backup` - Restore from any backup (auto-creates safety backup before restore)

### Added - Server Health Resource

- **New Resource: `memory://health`** - Comprehensive server diagnostics
  - Database stats: path, size, entry count, relationship count, tag count
  - Backup info: directory, count, last backup details
  - Vector index: availability, indexed entries, model name
  - Tool filter: active status, enabled/total counts

### Added - Tool Annotations (MCP 2025-11-25)

- All **29 tools** now include behavioral hints for AI safety:
  - `readOnlyHint` - Indicates read-only operations
  - `destructiveHint` - Warns of data modification
  - `idempotentHint` - Safe to retry
  - `openWorldHint` - External service calls (GitHub)

### Added - Dynamic Structured Logging

- **RFC 5424 severity levels** - emergency, alert, critical, error, warning, notice, info, debug
- **Module-prefixed codes** - Operation-specific like `DB_CONNECT`, `VECTOR_SEARCH`
- **Centralized logger** - All output to stderr (stdout reserved for MCP protocol)
- **Debug mode** - Enable with `DEBUG=true` environment variable

### Changed - Technology Stack

- **Language**: Python → TypeScript (Node.js 18+)
- **Database**: Python sqlite3 → sql.js (pure JavaScript)
- **Vector Search**: FAISS + sentence-transformers → vectra + @xenova/transformers
- **Distribution**: PyPI → npm
- **Installation**: `pip install memory-journal-mcp` → `npm install -g memory-journal-mcp`

### Changed - CI/CD Modernization

- **Native ARM64 Builds** - No more slow QEMU emulation
- **NPM Publishing** - Replaces PyPI distribution
- **CodeQL Analysis** - JavaScript/TypeScript static security analysis
- **Docker Scout** - Container vulnerability scanning with blocking gates
- **Dependabot Auto-Merge** - Automatic patch/minor updates

### Capabilities Summary

| Category        | Count | Notes                                                                  |
| --------------- | ----- | ---------------------------------------------------------------------- |
| **Tools**       | 29    | +2 Kanban tools (get_kanban_board, move_kanban_item)                   |
| **Tool Groups** | 8     | core, search, analytics, relationships, export, admin, github, backup  |
| **Prompts**     | 14    | Unchanged from v2.x                                                    |
| **Resources**   | 16    | +2 Kanban resources (memory://kanban/{n}, memory://kanban/{n}/diagram) |

### Migration from v2.x

**Breaking change:** Installation now via npm:

```bash
# Old (Python)
pip install memory-journal-mcp

# New (TypeScript)
npm install -g memory-journal-mcp
```

**Database compatibility:** ✅ Existing databases work without migration!

### Security

- **Input validation** - Zod schemas for all tool parameters
- **Path traversal protection** - Backup filename validation
- **SQL injection prevention** - Parameterized queries throughout
- **Content size limits** - Configurable per field

## [2.2.0] - 2025-12-08

### Added - Tool Filtering for Token Efficiency

- **Tool Filtering** - Selectively enable/disable tools via `MEMORY_JOURNAL_MCP_TOOL_FILTER` environment variable
  - **Up to 69% token reduction** - Disable unused tools to save context window space
  - **7 tool groups**: `core` (5), `search` (2), `analytics` (2), `relationships` (2), `export` (1), `admin` (2), `test` (2)
  - **Filter syntax**: `-group` to disable group, `-tool` to disable specific tool, `+tool` to re-enable
  - **Left-to-right processing**: Rules applied in order for precise control
  - **Useful for MCP clients with tool limits** (e.g., Windsurf's 100-tool limit)
  - **Default behavior**: All 16 tools enabled (backward compatible)
  - **Token savings by configuration**:
    - Production (`-test`): ~12% reduction (14 tools)
    - Read-only (`-admin`): ~15% reduction (14 tools)
    - Lightweight (core only): **~69% reduction** (5 tools)
- **New module**: `src/tool_filtering.py` with complete filtering logic
- **Comprehensive tests**: `tests/test_tool_filtering.py` with 100% coverage
- **Documentation**: New wiki page [Tool-Filtering](Tool-Filtering) with detailed examples

### Improved - Dark Mode Visualization

- **Actions Visual Graph** (`memory://graph/actions`) - Improved color scheme for dark mode readability
  - Medium-saturated fill colors with better contrast
  - Black text on colored backgrounds for legibility
  - Darker stroke/border colors for node definition
  - Compact class-based Mermaid styling for smaller output
  - Streamlined footer (single line vs multi-line legend)

### Changed

- **Server integration** - `handle_list_tools()` and `handle_call_tool()` now respect filtering configuration
- **Error handling** - Disabled tools return clear error message when called
- **Constants** - Actions graph colors moved to `src/constants.py` for easy customization

### Documentation

- Updated [README.md](https://github.com/neverinfamous/memory-journal-mcp#tool-filtering-optional) with tool filtering section and token savings
- Updated [DOCKER_README.md](https://github.com/neverinfamous/memory-journal-mcp/blob/main/DOCKER_README.md#tool-filtering) with Docker-specific examples
- Updated `mcp-config-example.json` with environment variable example
- New wiki page: [Tool-Filtering.md](Tool-Filtering) with comprehensive guide

### Technical Details

- **Environment variable**: `MEMORY_JOURNAL_MCP_TOOL_FILTER` - comma-separated filter rules
- **Caching**: Uses `@lru_cache(maxsize=1)` for performance
- **Logging**: Info/warning messages logged to stderr for debugging
- **Type safety**: Maintains Pyright strict compliance

## [2.1.0] - 2025-11-26

### Added - Actions Visual Graph Resource

- **New Resource: `memory://graph/actions`** - CI/CD narrative visualization
  - Generates Mermaid diagrams showing workflow runs, failures, investigation entries, and deployments
  - **Narrative flow**: `Commit → Workflow Run → Failure → Investigation Entry → Fix Commit → Success → Deployment`
  - **Node types**: Commits (hexagon), PRs (stadium), Workflow runs (rectangle), Failed jobs (parallelogram), Journal entries, Deployments
  - **Query parameters**: `?branch=X&workflow=Y&limit=15` for filtering
  - Identifies "fix patterns" - when failed workflows are followed by successful ones
  - Links journal entries to workflow run investigations
  - Color-coded styling: green (success), red (failure), yellow (pending), blue (entries)

### Fixed - Pyright Strict Type Compliance

- **700+ type issues fixed** - Complete Pyright strict mode compliance achieved
- **All exclusions removed** from `pyrightconfig.json`:
  - Removed `reportMissingTypeStubs` exclusion
  - Removed `reportUnknownVariableType` exclusion
  - Removed `reportUnknownMemberType` exclusion
  - Removed `reportUnknownArgumentType` exclusion
  - Removed `reportUnknownParameterType` exclusion
  - Removed `reportUnknownLambdaType` exclusion
- **Type safety badge now accurate** - `[![Type Safety](https://img.shields.io/badge/Pyright-Strict-blue.svg)]` reflects true strict compliance
- All `Any` types replaced with proper TypedDicts and explicit annotations
- Improved code maintainability and IDE support through complete type coverage

### Added - GitHub Actions Failure Summarizer Prompt

- **New Prompt: `actions-failure-digest`** - Comprehensive GitHub Actions failure analysis
  - Generates digest of recent CI/CD failures with root cause analysis
  - **Failing Jobs Summary** - Lists failed workflows, jobs, and specific failed steps
  - **Linked Journal Entries** - Finds entries connected to affected commits/PRs
  - **Recent Code/PR Changes** - Context from current branch and associated PRs
  - **Previous Similar Failures** - Semantic search for recurring patterns
  - **Possible Root Causes** - AI-assisted analysis of failure patterns
  - **Next Steps** - Actionable recommendations for resolution
  - Optional filters: `branch`, `workflow_name`, `pr_number`, `days_back`, `limit`
  - Leverages existing semantic search, clustering, and relationship enumeration
- **New API Helper Function**: `get_workflow_run_jobs()` - Fetch job-level details for workflow runs
- **New API Helper Function**: `get_failed_workflow_runs()` - Convenience function for fetching recent failures

### Added - GitHub Actions Resources

- **4 New MCP Resources for CI/CD Visibility** - Expose GitHub Actions as first-class resources
  - `memory://actions/recent` - Recent workflow runs with filtering (JSON)
    - Query params: `?branch=X&workflow=Y&commit=SHA&pr=N&limit=10`
    - Returns: CI status, run list, related journal entries
  - `memory://actions/workflows/{workflow_name}/timeline` - Workflow-specific timeline (Markdown)
    - Blends: workflow runs, journal entries, PR events
  - `memory://actions/branches/{branch}/timeline` - Branch CI timeline (Markdown)
    - Blends: workflow runs, journal entries, PR lifecycle events
  - `memory://actions/commits/{sha}/timeline` - Commit-specific timeline (Markdown)
    - Blends: workflow runs for commit, related journal entries
- **New API Helper Functions** (in `src/github/api.py`):
  - `get_workflow_runs_by_name()` - Filter runs by workflow name (case-insensitive)
  - `get_unique_workflow_names()` - Extract unique workflow names from recent runs
- **Enhanced Resource URI Parsing** - Support for query parameters and new action patterns

### Added - GitHub Actions Integration (Phase 1)

- **GitHub Actions Workflow Runs Support** - Foundation layer for CI/CD integration
  - Link journal entries to workflow runs via `workflow_run_id`, `workflow_name`, `workflow_status` parameters
  - Automatic CI status detection in context bundle (`passing`, `failing`, `pending`, `unknown`)
  - Search and filter entries by workflow run ID
  - Database migration adds `workflow_run_id`, `workflow_name`, `workflow_status` columns with index
- **Enhanced Context Capture** - Project context now includes:
  - Up to 5 recent workflow runs for current branch
  - Overall CI status computed from latest workflow runs
  - Automatic caching (5 min TTL) for workflow run data
- **New API Functions** (in `src/github/api.py`):
  - `get_repo_workflow_runs()` - Fetch workflow runs with caching, branch/status filters
  - `get_workflow_run_details()` - Get detailed workflow run information
  - `get_workflow_runs_for_commit()` - Find runs for a specific commit SHA
  - `get_workflow_runs_for_pr()` - Find runs associated with a PR
  - `compute_ci_status()` - Compute overall CI status from workflow runs
  - All functions include `gh` CLI fallbacks
- **Enhanced Search Capabilities**
  - `search_entries` tool: New filter for `workflow_run_id`
  - `search_by_date_range` tool: New filter for `workflow_run_id`
  - Find all journal entries related to specific workflow runs
- **Enhanced Entry Display**
  - `get_entry_by_id` now shows linked workflow runs with name and status
  - Entry creation confirms workflow linkage (e.g., "Linked to: Workflow Run #12345 (CI Tests) [completed]")
- **New TypedDict Model**: `GitHubWorkflowRunDict` for type-safe workflow run data

### Added - GitHub Issues & Pull Requests Integration

- **GitHub Issues Support** - Complete integration with GitHub Issues
  - Auto-link entries to issues via branch name detection (patterns: `issue-123`, `#123`, `feature/issue-456`)
  - Manual issue linking via `issue_number` and `issue_url` parameters
  - Issue context automatically captured from GitHub API (open issues for current repo)
  - Search and filter entries by issue number
  - Database migration adds `issue_number` and `issue_url` columns
- **GitHub Pull Requests Support** - Full PR integration with auto-detection
  - Auto-detect current PR from branch (finds matching head branch)
  - Manual PR linking via `pr_number`, `pr_url`, and `pr_status` parameters
  - PR status tracking (draft, open, merged, closed)
  - PR context automatically captured including linked issues, reviewers, and stats
  - Search and filter entries by PR number and status
  - Database migration adds `pr_number`, `pr_url`, `pr_status` columns
- **Enhanced Context Capture** - Project context now includes:
  - Up to 10 recent open issues from current repository
  - Up to 5 recent open PRs from current repository
  - Current PR detection based on active branch
  - Automatic caching (15 min TTL) to minimize API calls
- **Enhanced Search Capabilities**
  - `search_entries` tool: New filters for `issue_number`, `pr_number`, `pr_status`
  - `search_by_date_range` tool: New filters for `issue_number`, `pr_number`
  - Find all journal entries related to specific issues or PRs
- **Enhanced Entry Display**
  - `get_entry_by_id` now shows linked issues and PRs with URLs
  - Entry creation confirms GitHub linkage (e.g., "Linked to: Issue #123, PR #456 (open)")

### Fixed

- **Missing GitHub Issues Implementation** - Fixed incomplete `github_issues` field in models
  - Was referenced in `ContextData` but never populated
  - Now fully implemented with API functions, caching, and context integration

### Technical Details

- **New API Functions** (in `src/github/api.py`):
  - `get_repo_issues()` - Fetch repository issues with caching
  - `get_issue_details()` - Get detailed issue information
  - `get_repo_pull_requests()` - Fetch repository PRs with caching
  - `get_pr_details()` - Get detailed PR information including stats
  - `get_pr_from_branch()` - Find PR by head branch name
  - `_parse_linked_issues()` - Extract issue references from PR bodies
  - All functions include `gh` CLI fallbacks for environments without `requests` library
- **Database Schema Changes**:
  - Added `issue_number`, `issue_url` columns to `memory_journal` table
  - Added `pr_number`, `pr_url`, `pr_status` columns to `memory_journal` table
  - Created indexes for efficient filtering: `idx_memory_journal_issue_number`, `idx_memory_journal_pr_number`
  - Automatic migrations run on server startup
- **New Models** (in `src/models.py`):
  - `GitHubIssueDict` - Type definition for issue data
  - `GitHubPullRequestDict` - Type definition for PR data with review stats
  - Updated `EntryDict` with issue and PR fields
  - Updated `ContextData` with `github_issues`, `current_pr`, `github_pull_requests` fields
- **Branch Name Patterns** - Auto-detection supports:
  - `issue-123`, `issue/123`, `fix/issue-456`
  - `#123` (shorthand)
  - `/123-` or `/123/` patterns
- **Backward Compatibility** - All new fields are optional; existing databases migrate seamlessly

## [2.0.1] - 2025-10-28

### Fixed - Windows Platform Support

- **Git subprocess hang fix** - All Git operations now work reliably on Windows
  - Migrated all `subprocess.run()` calls to `Popen()` with `stdin=subprocess.DEVNULL`
  - Prevents stdin inheritance from MCP server's stdio channel
  - Eliminates deadlocks/hangs when running Git commands
  - Affected files: `database/context.py`, `github/integration.py`
- **Working directory detection** - Server now reliably detects Git context
  - Added `os.chdir(project_root)` on server startup
  - Server automatically changes to project root directory
  - Resolves "Not a Git repository" errors
  - Recommendation: Add `"cwd"` parameter to MCP configuration

### Changed - GitHub Projects v2 Migration

- **GraphQL API migration** - Migrated from deprecated REST API to GraphQL
  - Old REST API endpoints return HTTP 410 Gone (deprecated)
  - New GraphQL API (`projectsV2` query) for Projects v2
  - **New module**: `github/graphql.py` with GraphQL query definitions
  - **Token requirement**: `read:project` or `project` scope now required
  - Supports both user and organization projects
  - Returns same data structure for backward compatibility
- **Enhanced debugging** - Added comprehensive debug logging throughout Git and GitHub operations
  - Tracks subprocess execution times
  - Logs API call results
  - Helps diagnose configuration issues

### Documentation

- Updated Configuration.md with Windows-specific troubleshooting
- Updated GitHub-Projects-Integration.md with GraphQL migration notes
- Updated Architecture.md with v2.0.1 technical improvements
- Added token scope requirements and MCP configuration examples

## [2.0.0] - 2025-10-28

### Added - Git-Based Team Collaboration

- **Team Collaboration Feature** - Share journal entries with your team via Git while maintaining privacy
  - **Two-database architecture**: Personal DB (local) + Team DB (Git-tracked)
  - **Explicit opt-in sharing**: `share_with_team` parameter on entry creation
  - **Privacy-first design**: All entries private by default, sharing requires explicit consent
  - **New database file**: `.memory-journal-team.db` (Git-tracked for team synchronization)
  - **New database column**: `share_with_team` (integer, default 0) in `memory_journal` table
  - **Automatic schema migration**: Existing databases updated automatically
- **New Module**: `src/database/team_db.py` - TeamDatabaseManager class
  - Copy entries to team database
  - Query team entries with filters (tags, date range, entry type)
  - Git status checking for synchronization
  - Entry count and statistics
- **Enhanced Search**: All search operations automatically query both personal and team databases
  - `search_entries` - Returns combined results with team indicator (👥)
  - `search_by_date_range` - Includes team entries in date-based queries
  - Results show source (personal vs team) for clarity
- **New Resource**: `memory://team/recent` - Access recent team-shared entries
  - Returns JSON with team entry count and formatted entries
  - Marked with `source: team_shared` for identification
- **Enhanced Tool**: `create_entry` gains `share_with_team` parameter
  - Set to `true` to copy entry to team database
  - Confirmation message shows sharing status
  - Preserves all entry data (tags, significance, relationships, GitHub Projects)

### Changed - Major Refactoring

- **Complete Internal Architecture Refactoring** - Transformed from monolithic codebase to modular architecture
  - **96% reduction** in main file size (4,093 lines → 175 lines)
  - **30 focused modules** organized into logical layers (~150-300 lines each)
  - **Clear separation of concerns** - Database, GitHub, MCP handlers isolated
  - **Module structure**:
    - `server.py` (175 lines) - Entry point & MCP protocol dispatchers
    - `database/` (4 modules) - MemoryJournalDB, operations, context management, team_db
    - `github/` (3 modules) - Integration, caching, API operations
    - `handlers/` (20 modules) - MCP tools, prompts, resources
    - Core utilities - constants, exceptions, utils, vector_search
  - **Design patterns implemented**:
    - Dispatcher pattern for MCP protocol routing
    - Dependency injection for component initialization
    - Module-level state for handler dependencies
  - **Benefits**:
    - 10x improvement in code maintainability
    - Independent, testable components
    - Self-documenting structure
    - Easier debugging and optimization
    - Foundation for rapid feature development

### Added

- **Custom exception classes** - Centralized error handling with specific exception types
- **Constants module** - All configuration and magic values extracted (including team DB path)
- **Utilities module** - Common functions deduplicated (FTS5 escaping, Mermaid sanitization, etc.)
- **Enhanced documentation** - REFACTORING_SUMMARY.md with complete architecture analysis
- **Team Collaboration Wiki Page** - Comprehensive guide to Git-based entry sharing

### Performance

- ✅ **No degradation** - All async operations preserved
- ✅ **Same startup time** - 2-3 seconds maintained
- ✅ **Same operation speed** - No overhead from modularization

### Compatibility

- ✅ **100% backward compatible** - Zero breaking changes
- ✅ **API unchanged** - All 16 tools, 10 prompts, 4 resources work identically
- ✅ **Database schema** - No changes required
- ✅ **Environment variables** - Same configuration
- ✅ **Seamless upgrade** - Simply update and restart

### Documentation

- Updated Architecture Wiki with complete v2.0.0 module documentation
- Updated Performance Wiki with refactoring analysis
- Added REFACTORING_SUMMARY.md with detailed technical breakdown
- Updated all README files with v2.0.0 highlights

## [1.2.2] - 2025-10-26

### Security

- **URL Parsing Vulnerability Fix (CodeQL #110, #111)** - Fixed incomplete URL substring sanitization in GitHub remote URL parsing
  - **Impact**: Prevented potential URL spoofing attacks where malicious URLs could bypass GitHub hostname checks
  - **Root Cause**: Used substring checks (`'github.com' in url`) instead of proper URL parsing
  - **Fix**: Implemented proper `urllib.parse.urlparse()` validation with exact hostname matching
  - **Details**:
    - SSH URLs: Explicit prefix validation with `startswith('git@github.com:')`
    - HTTPS/HTTP URLs: Parse with `urlparse()` and verify `hostname == 'github.com'`
    - Prevents bypasses like `http://evil.com/github.com/fake` or `http://github.com.evil.com/fake`
  - **Severity**: Medium (limited to Git remote URL parsing in local repository context)
  - **Reference**: [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

## [1.2.1] - 2025-10-26

### Fixed

- **Semantic search initialization** - Resolved async/lazy loading race condition that could cause semantic_search to hang on first use
  - Moved ML dependency imports to module-level initialization
  - Eliminated async lock deadlock during model loading
  - First semantic search call now completes in <1 second (previously could timeout)
- **Thread pool optimization** - Increased worker count from 2 to 4 to prevent contention during ML model loading

### Changed

- Improved initialization progress messages with step-by-step feedback (Step X/3)
- Added explicit stderr flushing for real-time progress updates

## [1.2.0] - 2025-10-26

### Added - Phase 3: Organization Support

- **Organization-Level GitHub Projects** - Full support for org-level projects alongside user projects
  - Automatic owner detection (user vs organization)
  - Dual project lookup showing both user and org projects
  - Separate `GITHUB_ORG_TOKEN` support for org-specific permissions
  - All Phase 2 analytics work with org projects
- **Enhanced Phase 2 Features for Organizations**
  - Cross-project insights spanning user and org projects
  - Status summaries for org project teams
  - Milestone tracking with org-level milestones
  - Smart caching (80%+ API reduction, 24hr owner type cache)

### Added - Phase 2: Advanced Project Analytics

- **New Tool:** `get_cross_project_insights` - Multi-project analysis and pattern detection
- **New Prompts:**
  - `project-status-summary` - Comprehensive GitHub Project status reports
  - `project-milestone-tracker` - Milestone progress with velocity tracking
- **New Resource:** `memory://projects/{number}/timeline` - Live activity feed combining journal + GitHub events
- **Enhanced:** `get_statistics` with `project_breakdown` parameter for per-project metrics
- **Smart Caching System** - GitHub API response caching with configurable TTLs (1hr projects, 15min items)

### Added - Phase 1: GitHub Projects Integration

- **GitHub Projects Support** - Connect journal entries with GitHub Projects (user & org)
  - Entry creation with `project_number`, `project_item_id`, `github_project_url` parameters
  - Automatic project detection from repository context
  - Search and filter entries by project
  - Project context in context bundles
- **New Database Columns:** `project_number`, `project_item_id`, `github_project_url`
- **Graceful Degradation:** Works without GitHub token (project features disabled)

### Fixed

- **FTS5 Search Query Escaping** - Special characters (hyphens, dots, colons) in search queries now handled correctly
  - Organization names like "my-company" now searchable
  - Version numbers like "v1.2.0" work properly
  - Implemented `escape_fts5_query()` function with quote wrapping

## [1.1.3] - 2025-10-04

### Fixed

- **Migration Logic** - Fixed schema migration check to properly handle fresh database installations

## [1.1.2] - 2025-10-04

### Security

- **CVE-2025-8869** - Mitigated pip symbolic link vulnerability by upgrading to pip >=25.0

## [1.1.1] - 2025-10-04

### Fixed

- **F-String Syntax** - Fixed Python syntax error preventing builds on clean environments

## [1.1.0] - 2025-10-04

### Added

- **Entry Relationships** - Link entries with typed relationships (references, implements, clarifies, evolves_from, response_to)
- **New Tool:** `link_entries` - Create relationships between entries
- **New Tool:** `visualize_relationships` - Generate Mermaid diagrams of entry connections
- **New Resource:** `memory://graph/recent` - Live relationship graph visualization
- **New Prompts:** `find-related`, `get-context-bundle`
- **Soft Delete** - Entries can be soft-deleted and recovered
- **Database Schema Enhancements** - `relationships` table, `deleted_at` column

### Fixed

- **Database Locking** - Eliminated race conditions in concurrent tag updates
- **Thread Safety** - Single-connection transactions prevent conflicts

### Changed

- **Performance:** 10x faster startup (14s → 2-3s) through lazy loading of ML dependencies
- **Optimized Database:** Removed expensive PRAGMA operations from startup

### Documentation

- Created comprehensive GitHub Wiki (17 pages)
- Enhanced README with feature overview
- Added Docker Hub README

## [1.0.2] - 2025-09-15

### Initial Beta Release

- 13 MCP tools for journal management
- Triple search system (FTS5, date range, semantic)
- 6 workflow prompts
- 2 MCP resources
- Git and GitHub CLI integration
- SQLite FTS5 full-text search
- Optional FAISS semantic search

[Unreleased]: https://github.com/neverinfamous/memory-journal-mcp/compare/v4.1.0...HEAD
[4.1.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.5...v4.0.0
[3.1.5]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.2.0...v3.0.0
[2.2.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.2...v2.0.0
[1.2.2]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.3...v1.2.0
[1.1.3]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/neverinfamous/memory-journal-mcp/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v1.0.2
