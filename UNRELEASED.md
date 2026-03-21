## [Unreleased]

### Added

- **Team Tools Parity** — 12 new team tools bringing the team group from 3 to 15 tools: `team_get_entry_by_id`, `team_list_tags`, `team_search_by_date_range`, `team_update_entry`, `team_delete_entry`, `team_merge_tags`, `team_get_statistics`, `team_link_entries`, `team_visualize_relationships`, `team_export_entries`, `team_backup`, `team_list_backups`. Split `team.ts` into `team/` directory with 8 sub-modules.
- **Team Vector & Insights** — 5 new team tools bringing the team group from 15 to 20 tools: `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`, `team_get_cross_project_insights`. Added `teamVectorManager` infrastructure for isolated team vector indexing.
- **`memory://rules` resource** — New resource that serves the full contents of `RULES_FILE_PATH` as `text/markdown`. Returns `{ configured: false }` when env var is not set.
- **`memory://workflows` resource** — New resource that serves the `MEMORY_JOURNAL_WORKFLOW_SUMMARY` env var value via `BriefingConfig.workflowSummary`. Can also be set via `--workflow-summary` CLI flag. Returns `{ configured: false }` when not set.
- **`memory://skills` resource** — New resource that scans `SKILLS_DIR_PATH` for `SKILL.md` files and returns a structured skill index with names, paths, and excerpts.

### Fixed

- **`team_list_tags` output validation error** — Handler passed raw `listTags()` result with `usageCount` field directly, but `TagOutputSchema` expects `count`. Added mapping to match the personal `list_tags` handler pattern.
- **FTS5 phrase search (`"error handling"` returns 0 results)** — The porter stemmer indexes `handling` → `handl`, so FTS5 phrase queries requiring exact token sequences never match stemmed content. Added `sanitizeFtsQuery` helper in `search.ts` that detects pure quoted phrases (e.g. `"error handling"`) and rewrites them as AND-joined terms (`error AND handling`), letting the stemmer apply per-word and correctly finding matches.
- **Sandbox readonly `TypeError`** — Calling a mutation method (e.g. `mj.relationships.linkEntries`) in `readonly: true` mode threw `TypeError: mj.relationships.linkEntries is not a function` because the stripped method was `undefined`. Wrapped each group proxy in a `Proxy` with a `get` trap that returns a structured `{ success: false, error: "Operation '...' is not available..." }` for any unknown method.
- **`server-instructions.md` readonly wording** — Corrected the description of `readonly: true` mode: mutation calls now return a structured error object instead of throwing, and the misleading "Write-only groups will be empty" language has been removed.
- **`restore_backup(confirm: false)` leaks raw MCP error** — `confirm: z.literal(true)` in the `inputSchema` caused Zod to reject `false` before the handler's try/catch could run, bypassing `formatHandlerError`. Changed to `z.boolean()` with an explicit handler-level guard returning a structured `VALIDATION_ERROR`.

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
