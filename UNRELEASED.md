# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.0.1...HEAD)

### Added
- Created the `io` tool group to manage bidirectional data portability and cross-domain data indexing.
- Added `export_markdown` and `import_markdown` tools for full round-trip entry synchronization using semantic YAML frontmatter parsing.
- Added `team_export_markdown` and `team_import_markdown` tools to support seamless data synchronization for team databases.
- Included `assertSafeDirectoryPath` core security guardrail for path traversal protection on directory-based APIs.
- Added `relationship_type` filtering flag to `visualize_relationships` tool to isolate specific graph edge connections.

- Integrated comprehensive test matrices for the IO tooling, executing validation checks via Vitest mapping logic and Playwright's E2E payload contracts.
- Added comprehensive documentation structures (`test-core-io.md`, `test-cm-io.md`) mapping declarative test paths for direct MCP mapping verification.

### Changed
- Refactored the legacy `export` tool group into the unified `io` interface, adopting the `mj.io.*` namespace inside Code Mode (the `export` alias is preserved for backwards compatibility).
- Deprecated `ICON_EXPORT` constant in favor of `ICON_IO` utilizing a bidirectional SVG visual design to signal interoperable data flow.
- Lowercased group mappings for API Code Mode proxies.
- Re-architected direct MCP and Code Mode test routing (DAG Phase 26–28) cleanly isolating IO lifecycle tests from administrative tracking.
