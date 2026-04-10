# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.2.0...HEAD)

### Fixed

- Fixed `memory://github/status` so `milestones` explicitly returns an object with `{ openCount: 0, items: [] }` when there are no milestones, resolving layout inconsistencies.
- Fixed Vector/Semantic Index Metadata Filtering: Centralized `passMetadataFilters` helper in `helpers.ts` and retrofitted `hybridSearch` (RRF) and `semanticSearch` to correctly drop vector matches that do not pass in-memory filter criteria (such as `tags`, `isPersonal`, `projectNumber`, `entryType`, and date ranges), closing a critical filtering gap in Vector-based Search methods. Verified successfully via direct MCP calls.
- Fixed `ValidationError` class error code from `VALIDATION_FAILED` to `VALIDATION_ERROR` to align with the `formatHandlerError` Zod path, ensuring all validation errors (both schema-driven and programmatic) emit the same `VALIDATION_ERROR` code. Aligned `suggestions.ts` pattern-matched codes for `SQLITE_CONSTRAINT`, `malformed`, and `code validation failed` patterns to use `VALIDATION_ERROR` as well.
- Fixed `get_entry_by_id` to reject non-integer floats (e.g., `1.5`) with a structured `VALIDATION_ERROR` instead of passing the float to SQLite and returning a confusing `RESOURCE_NOT_FOUND` ("Entry 1.5 not found"). Applied `.int()` to `GetEntryByIdSchema.entry_id`.
- Fixed prompt registration callback in `registration.ts` to wrap handler execution in `try/catch`, preventing runtime exceptions from prompt handlers (e.g., `ConfigurationError` when `TEAM_DB_PATH` is absent) from propagating as raw MCP protocol errors. Errors are now returned as a user-visible message within the `messages` array.
- Added `success: true` to happy-path responses for `get_entry_by_id`, `get_recent_entries`, `test_simple`, and `list_tags` core tools to ensure consistent `success` field presence across all tool responses.
