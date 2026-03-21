## [Unreleased]

### Added

- **Team Tools Parity** — 12 new team tools bringing the team group from 3 to 15 tools: `team_get_entry_by_id`, `team_list_tags`, `team_search_by_date_range`, `team_update_entry`, `team_delete_entry`, `team_merge_tags`, `team_get_statistics`, `team_link_entries`, `team_visualize_relationships`, `team_export_entries`, `team_backup`, `team_list_backups`. Split `team.ts` into `team/` directory with 8 sub-modules.
- **Team Vector & Insights** — 5 new team tools bringing the team group from 15 to 20 tools: `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`, `team_get_cross_project_insights`. Added `teamVectorManager` infrastructure for isolated team vector indexing.

### Fixed

- **`team_list_tags` output validation error** — Handler passed raw `listTags()` result with `usageCount` field directly, but `TagOutputSchema` expects `count`. Added mapping to match the personal `list_tags` handler pattern.

### Security
- **CI/CD Hardening**: Added `--provenance` flag to `npm publish` in `publish-npm.yml` for SLSA Build L3 attestation. Added `id-token: write` permission for OIDC provenance token generation.
- **CI/CD Harmonization**:
  - Added `dependabot-auto-merge.yml` (auto-squash patch/minor, manual review for major)
  - Added `security-extended,security-and-quality` CodeQL query sets (was using defaults only)
  - Added `.gitleaks.toml` and `.trivyignore` configuration files
- **CI Action Bumps** (supply-chain pinning):
  - `github/gh-aw` actions (`setup`, `setup-cli`) bumped from `v0.58.1` → `v0.58.3` (SHA-pinned)
  - `github/codeql-action` (`init`, `autobuild`, `analyze`, `upload-sarif`) bumped from pre-v4.33.0 SHA → `v4.33.0` (SHA-pinned, all steps in sync)
  - `actions/upload-artifact` in `docker-publish.yml` corrected from `v6` → `v7` (SHA-pinned, resolves upload/download mismatch)
  - `github/gh-aw/actions/setup-cli` mutable semver tag replaced with pinned SHA (supply-chain hardening)

### Changed

- **Code Quality Audit Fixes**: Used `milestoneCompletionPct` helper in milestone tool handlers and extracted `MAX_QUERY_LIMIT` constant/helper in search handlers to DRY up duplication.
- **npm publish gated behind Docker checks** — npm no longer publishes on release creation; instead `docker-publish.yml` calls `publish-npm.yml` via `workflow_call` after Docker Scout passes and images are pushed. Both artifacts ship together or neither ships. Manual `workflow_dispatch` fallback preserved.
- **Dependency Updates** — Updated 27 npm packages; `eslint` → `10.1.0`, `jose` → `6.2.2`, `sqlite-vec` → `0.1.7`, `typescript-eslint` → `8.57.1`. 0 vulnerabilities.
