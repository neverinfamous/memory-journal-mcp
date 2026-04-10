# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.2.0...HEAD)

### Fixed
- Verified Readonly Sandbox Enforcement via Code Mode (Phase 18) successfully. Validated that `readonly: true` correctly strips mutation APIs (throwing 'Operation not found'), while retaining read APIs properly. Verified that default mode allows state mutations seamlessly. No code modifications were required.
- Verified Payload Optimization via Code Mode (Phase 30) successfully. All checks including Kanban throttling (`summary_only`, `item_limit`), body truncation, `MAX_QUERY_LIMIT` bounds, and the 100KB Result Size Cap passed perfectly with proper structed outputs and truncation metadata. No code modifications were required.
- Verified Core CRUD via Code Mode (Phase 20) successfully. All operations including create, read, update, delete, with parameter checks and schema error handling behave deterministically and correctly.
- Verified Admin, Backup & Export tools via Code Mode (Phase 26/27) successfully. No modifications required as all functions behave deterministically according to the strict error handling matrix.
- Verified structured error handling and domain/type mismatch tests across all `mj.*` API groups via Code Mode (Phase 29). All 10 groups tested successfully, demonstrating clean JSON results (`success: false`) without leaking raw MCP exceptions.
- Verified GitHub tools via Code Mode (Phase 25) successfully. All 16 read-only, issue lifecycle, Kanban operations, milestone CRUD, and Copilot methods act deterministically under strict sandbox rules, generating correct metadata bindings and cleanly returning `success: false` schema validations.
- Verified IO & Interoperability tools via Code Mode (Phase 26) successfully. The Markdown & legacy format exporters, file orchestration, and path traversal protection perform safely. Replaced strict OS-slash matching in the verification script to accurately assess OS-agnostic IO results.
- Verified Cross-Group Orchestration via Code Mode (Phase 23) successfully. Multi-tool workflows spanning analytics, search, core, admin, and github groups executed deterministically within a single sandbox run, confirming high-efficiency multi-group operations and accurate token estimates.
- Verified Relationships & Visualization tools via Code Mode (Phase 24) successfully. Fixed an issue where `visualize_relationships` implicitly returned `{ success: false, message: ... }` on nonexistent entries without a standard structured `error` field, now mapped natively to `ResourceNotFoundError`.
