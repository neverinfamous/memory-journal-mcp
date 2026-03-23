## [Unreleased]

### Added

- Add 7 new Playwright E2E spec files: `zod-sweep`, `boundary`, `errors-extended`, `numeric-coercion`, `help-resources`, `integration-workflows`, `streamable-http` (~115 new tests)
- Add `codemode-groups.spec.ts` E2E spec: systematic per-group Code Mode API surface validation (25 tests covering help(), representative calls, method aliases) — ported from db-mcp/postgres-mcp patterns
- Add `callToolRaw`, `getBaseURL`, `expectHandlerError` helpers to E2E test infrastructure
- Add `TEAM_DB_PATH` to Playwright test server config — enables functional E2E coverage of all team tools
- Add **GitHub Commander** skill system: 8 shipped workflow files teaching agents structured issue triage, PR review, milestone sprints, and security/quality/performance audits — with configurable validation gates, auto-detected security scanning, journal audit trails, and HITL checkpoints
- Add shipped skills auto-discovery: `memory://skills` resource now scans the package's own `skills/` directory in addition to user-configured `SKILLS_DIR_PATH`
- Add **Wiki Drift Detector**: new GitHub Action (`.github/workflows/wiki-drift-detector.md`) that clones the `.wiki` repository during PR logic to flag and suggest updates for outdated wiki documentation (Tools, Resources, Configuration).

### Fixed

- Fix `restore_backup` returning MCP-level `isError: true` instead of structured handler error when `confirm` is omitted — relax inputSchema so validation reaches handler
- Fix `team_link_entries` allowing self-referential links — add self-loop guard matching personal `link_entries`

### Changed

- Add `files` field to `package.json` — npm tarball now ships `dist/`, `skills/`, `LICENSE`, and `README.md`
- Override `onnxruntime-web` with empty stub — eliminates 90 MB unused browser WASM runtime from dependency tree
- Override `sharp` with empty stub — removes unused image processing transitive dependency from `@huggingface/transformers`
