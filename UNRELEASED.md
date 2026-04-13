# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.4.0...HEAD)

### Added

- **Skills**: Integrated `github-copilot-cli` skill for interactive, terminal-native code reviews.
- **Workflows**: Added `copilot-audit` pre-push review loop for evaluating uncommitted changes via Copilot.
- **Hush Protocol**: Introduced a machine-actionable team communication system:
  - Tools: Added `team_pass_flag` and `team_resolve_flag`.
  - Resources: Added `memory://flags` dashboard and `memory://flags/vocabulary`.
  - Config: Added `--flag-vocabulary` CLI argument and `FLAG_VOCABULARY` env var.
  - Core: Added `'flag'` entry type, `ICON_FLAG`, and behavioral instructions.
- **Briefing**: Integrated active flags summary and added `localTime` for chronological grounding.

### Changed

- **Dependency Updates**:
  - Bumped `better-sqlite3` to v12.9.0
  - Bumped `globals` to v17.5.0
  - Bumped `simple-git` to v3.36.0
- **Briefing**: Renamed the ambiguous `Matrix Density` insight label to `Relationship density`.

### Fixed

- **Types**: Added missing `importanceScore` property to `JournalEntry` interface.
- **Search**: Fixed early `.slice()` truncation that dropped high-relevance results prior to importance sorting.
- **Analytics**: Fixed SQLite `%Y-Q` quarterly grouping calculation by explicitly deriving months.
- **Constraints**: Fixed raw limit evaluation by strictly enforcing `MAX_QUERY_LIMIT` (500) across Team Searches.
- **Consistency**: Hardened `teamCollaborationResource` return payload structure.
- **Hush Protocol**: Fixed SQLite mapping bug inadvertently casting `autoContext` JSON strings to booleans.
- **Analytics**: Fixed an issue in `get_statistics` where the date range filter was inadvertently ignored for causal relationship metrics.
- **Transport**: Resolved an E2E testing timeout in `session-advanced.spec.ts` caused by dangling MCP SDK Server transports preventing sequential reconnections. `server.close()` is now wrapped in a `Promise.race` to forcefully detach SDK transport state and unblock the event loop.

### Validation

- **Integrity**: Completed Phase 12 Data Integrity Verification mapping round-trip fidelity, strict search/soft-delete isolations, unicode edge cases, FTS/semantic bounds, and native relationship boundaries utilizing direct MCP routines without logical fault or SQL leak.
- **Kanban**: Completed End-to-End Lifecycle Verification encompassing `add_kanban_item`, `move_kanban_item`, `delete_kanban_item`, and optimized `get_kanban_board` payload structures matching architectural assertions.
- **Optimization**: Completed Payload Optimization Verification confirming Kanban throttling (`summary_only`, `item_limit`), Issue/PR body truncation (default 800 chars), `MAX_QUERY_LIMIT` validation hooks (≤500), and Code Mode execution boundaries (≤100KB) across all test vectors seamlessly emitting structured `VALIDATION_ERROR` objects as intended.
- **Resources**: Completed full deterministic verification covering all 24 static and 14 template resource endpoints. Verified dynamic ID injection for timelines, issues, and Kanban boards with graceful structured fallback nodes on non-existent `99999` constraints avoiding runtime transport failures.
- **Output Schema**: Completed deterministic enumeration of all 68 registered tools to verify strict adherence to the `structuredContent` paradigm via programmatic evaluation of Zod schema definitions (`ErrorFieldsMixin`). Confirmed that unpredicted errors consistently wrap back into strict validation payloads, while nominal tools deliver explicitly decoupled `content` fallback arrays simultaneously with structured objects.
- **Admin**: Completed deterministic verification of Admin Tool Group (`update_entry`, `delete_entry`, `merge_tags`, `list_tags`, `add_to_vector_index`, `rebuild_vector_index`). Validated rigid structured error patterns governing domain boundary tests (e.g. self-referencing tag merges and non-existent entry targets), strictly typed schema mutations, and graceful vector indexing fallback compliance avoiding unexpected crash cases.
- **Backup**: Completed deterministic verification of Backup & Export Tool Group (`backup_journal`, `restore_backup`, `export_entries`, `cleanup_backups`). Validated strict path traversal blockers, resource not found responses, Zod type conformity, and correct filter enforcement (out-of-bounds dates and missing tags returning structured empty payloads rather than silent omissions).
- **Core**: Completed deterministic verification of the Core tool group (`create_entry`, `create_entry_minimal`, `get_entry_by_id`, `get_recent_entries`, `get_statistics`). Validated structured error responses against Zod validations, handled round-trip fidelity checks, boundary empty payloads, array length constraints, and verified the successful resolution of the relationship tracking date bound bug.
- **Transports**: Verified stateful session isolation and Sequential MCP execution lifecycle directly against the `@modelcontextprotocol/sdk` StreamableHTTP client via exhaustive Playwright E2E simulation.
