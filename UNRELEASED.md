# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.1...HEAD)

### Security

- Fixed XSS vulnerability in `ip-address` by overriding version to `10.2.0`
- Fixed HIGH severity Trivy code scanning alert (CVE-2026-27135) by explicitly upgrading `nghttp2-libs` from Alpine edge repository in Dockerfile

### Changed

- **Dependency Updates**
  - Bumped npm packages: `@huggingface/transformers` to `^4.2.0`, `eslint` to `^10.3.0`, `globals` to `^17.6.0`, `jose` to `^6.2.3`, `typescript-eslint` to `^8.59.2`, and `zod` to `^4.4.3`
  - Bumped `github/gh-aw-actions` to `v0.71.4` in GitHub Actions workflows
  - Bumped `aquasecurity/trivy-action` to `ed142fd0673e97e23eac54620cfb913e5ce36c25`
  - Bumped `github/codeql-action` to `95e58e9a2cdfd71adc6e0353d5c52f41a045d225`

### Added

- `adversarial-planner` skill: multi-pass adversarial planning and review with structured critique stages and Copilot CLI validation
- New entry types: `plan_draft`, `adversarial_review`, `plan_refinement`, `copilot_validation`

### Fixed

- Stale version `7.6.0` in `server.json` (version field and OCI identifier) → updated to `7.6.1`
- Stale skill name `mastering-typescript` in server instructions → corrected to `typescript`
- Added `adversarial-planner` and `copilot-audit` to the native skills listing in server instructions
- Fixed `assertSafeFilePath` validation in `buildRulesFileInfo` and `buildSkillsDirInfo` swallowing the output of `memory://briefing` metadata when paths were outside explicitly allowed IO roots.
- Fixed `INTERNAL_ERROR` during `restore_backup` in Code Mode by migrating atomic database swap from `fs.rename` to `fs.copyFile` to bypass Windows `EBUSY` file locks from `sqlite-vec`.
- Fixed `search_by_date_range` omitting the `source: 'personal'` metadata field when skipping cross-database merging.

### Verified

- **Team Collaboration**: Successfully executed Phase 10 certification for all 25 team tools and 4 team resources. Verified cross-project scoping (`project_number`), active flags integration (`Hush Protocol`), analytics grouping, vector indexing, robust author enrichment, and cross-project relationship tracking without requiring any schema or implementation bug fixes.
