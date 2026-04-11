# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added
- Phase 2: Verified all 16 GitHub capability tools including issue lifecycle, milestones, kanban board manipulation, and copilot PR review analysis.

- `python` skill: Modern Python engineering — `uv`, `ruff`, type hints, `pytest`, Pydantic v2, `src/` layout, and async patterns.
- `docker` skill: Production-grade Docker — multi-stage builds, BuildKit, non-root users, secret mounts, Compose v2, and CI/CD integration.
- `tailwind-css` skill: Tailwind CSS v4 — CSS-first `@theme` configuration, `@custom-variant` dark mode, responsive design, animations, and v3 migration.
- `github-actions` skill: GitHub Actions CI/CD — SHA pinning, permission hardening, caching, matrix strategies, reusable workflows, and artifacts v4.
- Bumped `neverinfamous-agent-skills` package from `1.0.8` → `1.1.0` for expanded skill catalog (15 → 19 skills).
- `sort_by` parameter (`'timestamp'` | `'importance'`) to core and team search tools.
- `importanceScore` metadata field in search results when importance sorting is active.
- Post-fetch fallback importance sorting for semantic and hybrid searches.
- `team_get_collaboration_matrix` tool to analyze author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for automated background repository health snapshotting.
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- `--digest-interval` CLI argument to specify snapshot generation frequency.
- Injected analytics metrics (`relationshipDensity`, `activityTrend`, `significanceSpike`) into `memory://briefing` payloads.

### Fixed
- `CloseGitHubIssueWithEntryOutputSchema`: `kanban.projectNumber` was required (`z.number()`) but omitted when no project is configured, causing output validation crash (`-32602`) when calling `close_github_issue_with_entry` with `move_to_done: true` and no `project_number`. Made `.optional()` and added missing `error` field to match handler output.
- Missing `sortBy` forwarding to underlying fetches during `ftsSearch()` delegations.
- Strict typing and ESLint caching errors regarding filter limits and significance metric validations.
- Missing `export` tool group namespace (`mj.export.*`) in the Code Mode instruction documentation table, ensuring all 10 API discoverability groups are correctly documented for LLM context.


### Security
- Verified Direct MCP GitHub Integration (Phase 12), confirming all 16 GitHub tools: read-only context/issues/PRs, issue lifecycle (create, milestone assignment, close, move_to_done), Kanban board CRUD, milestone CRUD end-to-end, repository insights (all sections), and Copilot review retrieval. Structured errors confirmed for all 404 paths and already-closed issues.
- Verified Admin tag management, export filters, and Backup/Restore lifecycle through the Code Mode sandbox. All tools strictly return structured `{ success: false }` bounds errors.

- Verified Code Mode API discoverability (Phase 17), confirming top-level and per-group help documentation, method aliases, and positional argument proxying.
- Verified Code Mode Core CRUD operations (Phase 20), confirming native object hydration for `share_with_team`, `is_personal` toggles, `project_owner`, and `issueUrl` auto-population without raw MCP exceptions.
- Verified Code Mode Error Matrix and Zod Sweeps (Phase 29), ensuring `{}` empty parameters, type mismatches, and domain boundaries return uniform `{ success: false }` across all 10 `mj.*` API groups without sandbox crashes.
- Verified Code Mode GitHub Tools (Phase 25), confirming all 16 `mj.github.*` endpoints, read-only limits, Kanban operations, issue and milestone lifecycles correctly surface schema-compliant responses and structured errors instead of raw `-32602` faults.
- Verified Code Mode IO & Interoperability (Phase 26), confirming legacy export payload hydration, markdown file orchestration within sandbox mapped directories, and strict path traversal halts.
- Verified Code Mode Cross-Group Orchestration (Phase 23), validating complex, multi-round agent workflows (Journal Dashboards, Tag Analytics, Relationship Graphs, Vector Index Lifecycles) persist state securely across `mj.*` namespaces.
- Verified Code Mode Payload Optimization (Phase 30), validating that Kanban board throttling (`summary_only`, `item_limit`), schema truncation logic, Code Mode result size caps (100KB limits), and explicit execution limits (MAX_QUERY_LIMIT=500) securely restrict payload sizes without unexpected crashes.
- Verified Code Mode Readonly Enforcement (Phase 18), confirming that read operations succeed while write operations are structurally blocked and omitted from the API bridge when `readonly: true` is asserted.
- Verified Code Mode Relationships & Visualization (Phase 24), confirming multi-type relationship linking, duplicate detection, metadata persistence, and successful Markdown visualization with structured `mermaid` and `legend` payloads.
- Verified Code Mode Sandbox Basics (Phase 16), confirming fundamental expression evaluation, async/await and built-in availability, reliable execution metrics propagation, and infinite loop timeout enforcement with structured errors.
- Verified Code Mode Search & Semantics (Phase 21), confirming FTS5 boolean logic, single-query filters, cross-database search capabilities, Date Range error paths, Semantic vector integrations, and exact Timestamp vs Importance-sorted ranking across all native endpoints.
- Verified Code Mode Error Handling & Security (Phase 19), validating input validation layers, strict pattern blocking (`require`, `eval`, `__proto__`), runtime error interception, and global variable nullification to enforce sandbox integrity.
- Verified Code Mode Team Admin & Collaboration (Phase 28), verifying secure tag merging and logical deletions, robust team analytics generation, relationships with duplicate handling, inter-op markdown IO integration, strict path isolation, backup management paths, and collaboration matrix streaming.
- Verified Code Mode Team CRUD & Search (Phase 28.1–28.3), confirming explicit and auto-detected authorship, combined parameter search filters, detailed relationship hydration, correct boundary checking for schema constraints (entry_type formatting, tag uniqueness), and exact Date Range matches without sandbox exceptions.
- Verified Code Mode Team Vector, Insights & Cross-Tool Errors (Phase 28.9-28.10), confirming successful index rebuilding, team vector queries with similarity limits, automated cross-project density insights reporting, and strict verification that all 18 cross-tool violation paths reliably return structured `{ success: false }` wrappers across the isolation bridge.
- Verified Code Mode Multi-Step Workflows (Phase 22), confirming robust execution of chained API calls, data transformations (map, sort, reduce), conditional branching based on queries, and accurate create/read/search round-trips within the isolated sandbox environment.
- Verified Direct MCP Core Entry CRUD operations (Phase 2 core tools), confirming full metadata persistence, auto-population of GitHub objects, robust team/personal database routing, correct relationships hydration, and strict significance/type constraint enforcements gracefully returned as structured errors.
- Verified Direct MCP Core Infrastructure (Phase 1), confirming server health data propagation, precise tool annotation statistics, dynamic briefing enrichment, robust workflow status insights, and proper initialization of the test environment.
- Verified Direct MCP IO & Markdown Interoperability, confirming legacy export functionality, Markdown file orchestration with auto-reconciliation, safe OS path boundaries, and strict path traversal defenses.
- Verified Direct MCP Core Relationships & Visualization (Phase 4), validating causal arrow synchronization across both code-defined relationships and `memory://graph/recent` components, and strict non-duplicate linkage error boundaries.
- Verified Direct MCP HTTP Scheduler (Phase 6), confirming automated backup, vacuum, index rebuild, and digest operations execute reliably on isolated timers without cascade failures, while remaining fully dormant in default stdio invocation mode.
