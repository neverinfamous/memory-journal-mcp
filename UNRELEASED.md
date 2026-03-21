## [Unreleased]

### Added

- **Team Tools Parity** — 12 new team tools bringing the team group from 3 to 15 tools: `team_get_entry_by_id`, `team_list_tags`, `team_search_by_date_range`, `team_update_entry`, `team_delete_entry`, `team_merge_tags`, `team_get_statistics`, `team_link_entries`, `team_visualize_relationships`, `team_export_entries`, `team_backup`, `team_list_backups`. Split `team.ts` into `team/` directory with 8 sub-modules.
- **Team Vector & Insights** — 5 new team tools bringing the team group from 15 to 20 tools: `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`, `team_get_cross_project_insights`. Added `teamVectorManager` infrastructure for isolated team vector indexing.

### Security
- **CI/CD Hardening**: Added `--provenance` flag to `npm publish` in `publish-npm.yml` for SLSA Build L3 attestation. Added `id-token: write` permission for OIDC provenance token generation.
- **CI/CD Harmonization**:
  - Added `dependabot-auto-merge.yml` (auto-squash patch/minor, manual review for major)
  - Added `security-extended,security-and-quality` CodeQL query sets (was using defaults only)
  - Added `.gitleaks.toml` and `.trivyignore` configuration files

### Changed

- **Code Quality Audit Fixes**: Used `milestoneCompletionPct` helper in milestone tool handlers and extracted `MAX_QUERY_LIMIT` constant/helper in search handlers to DRY up duplication.
- **npm publish gated behind Docker checks** — npm no longer publishes on release creation; instead `docker-publish.yml` calls `publish-npm.yml` via `workflow_call` after Docker Scout passes and images are pushed. Both artifacts ship together or neither ships. Manual `workflow_dispatch` fallback preserved.
- **Dependency Updates** — Bumped `better-sqlite3` from `^12.6.2` to `^12.8.0` (range tightened to explicitly exclude yanked 12.7.x intermediates).
