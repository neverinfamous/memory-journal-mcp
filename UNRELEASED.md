# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.2.0...HEAD)

### Fixed
- Verified Core CRUD via Code Mode (Phase 20) successfully. All operations including create, read, update, delete, with parameter checks and schema error handling behave deterministically and correctly.
- Verified Admin, Backup & Export tools via Code Mode (Phase 26/27) successfully. No modifications required as all functions behave deterministically according to the strict error handling matrix.
- Verified structured error handling and domain/type mismatch tests across all `mj.*` API groups via Code Mode (Phase 29). All 10 groups tested successfully, demonstrating clean JSON results (`success: false`) without leaking raw MCP exceptions.
- Verified GitHub tools via Code Mode (Phase 25) successfully. All 16 read-only, issue lifecycle, Kanban operations, milestone CRUD, and Copilot methods act deterministically under strict sandbox rules, generating correct metadata bindings and cleanly returning `success: false` schema validations.
