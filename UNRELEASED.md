# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Fixed
- Stabilized and verified Code Mode Error Matrix (Phase 29):
  - Validated that all 10 `mj.*` API groups correctly handle empty parameter objects (`{}`).
  - Confirmed strict structured error responses (`{ success: false }`) for type mismatches (e.g., strings passed as IDs).
  - Verified domain errors (missing entity, invalid merge, 404s) and security boundaries (path traversal) consistently return structured errors rather than raw MCP exceptions, without crashing the sandbox environment.
