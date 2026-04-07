# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.0.0...HEAD)

### Added

- `.github/workflows/hol-skill-validate.yml`: HOL skill validation CI gate — validates `skills/github-commander` package structure on push/PR via `hashgraph-online/skill-publish` in validate-only mode (no secrets, no publishing). Scoped to skill directory changes via `paths:` filter. Incorporates PR [#360](https://github.com/neverinfamous/memory-journal-mcp/pull/360) with corrections: standard checkout SHA, `main`-only trigger, path filtering.

### Fixed

- `DOCKER_README.md`: repaired broken env var table (two fragments with missing header separator merged into one); removed deprecated `GITHUB_REPO_PATH` row (removed in v7.0.0)
