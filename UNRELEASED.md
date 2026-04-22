# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

### Verified
- Phase 18 Code Mode API Bridge verification. Confirmed `readonly: true` successfully restricts write operations by dynamically stripping write tools from the `mj.*` sandbox object, while allowing reads (e.g., `getRecentEntries`, `searchEntries`). Confirmed default mode permits full CRUD.
