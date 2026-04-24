# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.1...HEAD)

### Added

- `adversarial-planner` skill: multi-pass adversarial planning and review with structured critique stages and Copilot CLI validation
- New entry types: `plan_draft`, `adversarial_review`, `plan_refinement`, `copilot_validation`

### Fixed

- Stale version `7.6.0` in `server.json` (version field and OCI identifier) → updated to `7.6.1`
- Stale skill name `mastering-typescript` in server instructions → corrected to `typescript`
- Added `adversarial-planner` and `copilot-audit` to the native skills listing in server instructions
