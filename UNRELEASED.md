# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

<<<<<<< Updated upstream
### Dependencies

- Bumped `aquasecurity/trivy-action` from `v0.35.0` to `v0.36.0`.
- Bumped `github/codeql-action` from `v4.35.1` to `v4.35.2`.
- Bumped `trufflesecurity/trufflehog` from `v3.94.3` to `v3.95.2`.
- Bumped `actions/attest-build-provenance` from `v2` to `v4.1.0` (SHA-pinned).

=======
### Fixed

- Code Mode and standard test failures when creating, resolving, or searching global team flags by resolving strict `project_number` nullish schema validation errors.
- Internal crash in `team_search` and `team_search_by_date_range` when filtering global flags by conditionally bypassing the strict multi-tenant `project_number` requirements when explicitly searching for `flag:` tags or `entry_type === 'flag'`.
>>>>>>> Stashed changes
