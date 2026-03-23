## [Unreleased]

### Added

- Add 7 new Playwright E2E spec files: `zod-sweep`, `boundary`, `errors-extended`, `numeric-coercion`, `help-resources`, `integration-workflows`, `streamable-http` (~115 new tests)
- Add `callToolRaw`, `getBaseURL`, `expectHandlerError` helpers to E2E test infrastructure
- Add `TEAM_DB_PATH` to Playwright test server config — enables functional E2E coverage of all team tools

### Fixed

- Fix `restore_backup` returning MCP-level `isError: true` instead of structured handler error when `confirm` is omitted — relax inputSchema so validation reaches handler
- Fix `team_link_entries` allowing self-referential links — add self-loop guard matching personal `link_entries`

### Changed

- Add `files` field to `package.json` — npm tarball now ships only `dist/`, `LICENSE`, and `README.md` (93% size reduction from 3.9 MB to ~250 KB)
- Override `onnxruntime-web` with empty stub — eliminates 90 MB unused browser WASM runtime from dependency tree
- Override `sharp` with empty stub — removes unused image processing transitive dependency from `@huggingface/transformers`
