# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.3.0...HEAD)

### Added
- `sort_by` parameter (`'timestamp'` | `'importance'`) to core and team search tools.
- `importanceScore` metadata field in search results when importance sorting is active.
- Post-fetch fallback importance sorting for semantic and hybrid searches.
- `team_get_collaboration_matrix` tool to analyze author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for automated background repository health snapshotting.
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- `--digest-interval` CLI argument to specify snapshot generation frequency.
- Injected analytics metrics (`relationshipDensity`, `activityTrend`, `significanceSpike`) into `memory://briefing` payloads.

### Fixed
- Missing `sortBy` forwarding to underlying fetches during `ftsSearch()` delegations.
- Strict typing and ESLint caching errors regarding filter limits and significance metric validations.
- Missing `export` tool group namespace (`mj.export.*`) in the Code Mode instruction documentation table, ensuring all 10 API discoverability groups are correctly documented for LLM context.

### Security
- Verified Admin tag management, export filters, and Backup/Restore lifecycle through the Code Mode sandbox. All tools strictly return structured `{ success: false }` bounds errors.
- Verified Code Mode API discoverability (Phase 17), confirming top-level and per-group help documentation, method aliases, and positional argument proxying.
- Verified Code Mode Core CRUD operations (Phase 20), confirming native object hydration for `share_with_team`, `is_personal` toggles, `project_owner`, and `issueUrl` auto-population without raw MCP exceptions.
- Verified Code Mode Error Matrix and Zod Sweeps (Phase 29), ensuring `{}` empty parameters, type mismatches, and domain boundaries return uniform `{ success: false }` across all 10 `mj.*` API groups without sandbox crashes.
- Verified Code Mode GitHub Tools (Phase 25), confirming all 16 `mj.github.*` endpoints, read-only limits, Kanban operations, issue and milestone lifecycles correctly surface schema-compliant responses and structured errors instead of raw `-32602` faults.
- Verified Code Mode IO & Interoperability (Phase 26), confirming legacy export payload hydration, markdown file orchestration within sandbox mapped directories, and strict path traversal halts.
- Verified Code Mode Cross-Group Orchestration (Phase 23), validating complex, multi-round agent workflows (Journal Dashboards, Tag Analytics, Relationship Graphs, Vector Index Lifecycles) persist state securely across `mj.*` namespaces.
- Verified Code Mode Payload Optimization (Phase 30), validating that Kanban board throttling (`summary_only`, `item_limit`), schema truncation logic, Code Mode result size caps (100KB limits), and explicit execution limits (MAX_QUERY_LIMIT=500) securely restrict payload sizes without unexpected crashes.
- Verified Code Mode Readonly Enforcement (Phase 18), confirming that read operations succeed while write operations are structurally blocked and omitted from the API bridge when `readonly: true` is asserted.
