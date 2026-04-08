# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.0.1...HEAD)

### Security

- Disabled OIDC token minting in the HOL validation workflow (`id-token: none`) as a Least Privilege security best practice (resolves PR #378 intent).
- Removed deprecated `gitleaks-action` from the secret scanning workflow in favor of the active `trufflehog` step to resolve Node.js 20 deprecation warnings.
- Updated `docker/scout-action` to `v1.20.4` to clear pending security scanning CI warnings.

### Fixed

- Removed unnecessary `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` environment flag from the Trivy security scanning job.
- Applied explicit version pinning comments (`# v1.0.11`) to the `skill-publish` workflow step for transparent auditability.

### Added

- Created the `io` tool group to manage bidirectional data portability and cross-domain data indexing.
- Added `export_markdown` and `import_markdown` tools for full round-trip entry synchronization using semantic YAML frontmatter parsing.
- Added `team_export_markdown` and `team_import_markdown` tools to support seamless data synchronization for team databases.
- Included `assertSafeDirectoryPath` core security guardrail for path traversal protection on directory-based APIs.
- Added `relationship_type` filtering flag to `visualize_relationships` tool to isolate specific graph edge connections.

- Integrated comprehensive test matrices for the IO tooling, executing validation checks via Vitest mapping logic and Playwright's E2E payload contracts.
- Added comprehensive documentation structures (`test-core-io.md`, `test-cm-io.md`) mapping declarative test paths for direct MCP mapping verification.
- Verified unified IO Code Mode API via executing `test-cm-io.md` test run, achieving zero regression mapping and path traversal protection.
- Verified Core IO Tool Group functionality via direct MCP execution, affirming successful payload limits, relative OS path generation, and absolute prevention of traversal vulnerabilities.

### Changed

**Dependency Updates**

- `typescript-eslint` from 8.57.0 to 8.58.1

- Refactored the legacy `export` tool group into the unified `io` interface, adopting the `mj.io.*` namespace inside Code Mode (the `export` alias is preserved for backwards compatibility).
- Deprecated `ICON_EXPORT` constant in favor of `ICON_IO` utilizing a bidirectional SVG visual design to signal interoperable data flow.
- Lowercased group mappings for API Code Mode proxies.
- Re-architected direct MCP and Code Mode test routing (DAG Phase 26–28) cleanly isolating IO lifecycle tests from administrative tracking.
