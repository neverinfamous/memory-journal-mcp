## [Unreleased]

### Added

- **Team Tools Parity** — 12 new team tools bringing the team group from 3 to 15 tools: `team_get_entry_by_id`, `team_list_tags`, `team_search_by_date_range`, `team_update_entry`, `team_delete_entry`, `team_merge_tags`, `team_get_statistics`, `team_link_entries`, `team_visualize_relationships`, `team_export_entries`, `team_backup`, `team_list_backups`. Split `team.ts` into `team/` directory with 8 sub-modules.
- **Team Vector & Insights** — 5 new team tools bringing the team group from 15 to 20 tools: `team_semantic_search`, `team_get_vector_index_stats`, `team_rebuild_vector_index`, `team_add_to_vector_index`, `team_get_cross_project_insights`. Added `teamVectorManager` infrastructure for isolated team vector indexing.
- **`memory://rules` resource** — New resource that serves the full contents of `RULES_FILE_PATH` as `text/markdown`. Returns `{ configured: false }` when env var is not set.
- **`memory://workflows` resource** — New resource that serves the `MEMORY_JOURNAL_WORKFLOW_SUMMARY` env var value via `BriefingConfig.workflowSummary`. Can also be set via `--workflow-summary` CLI flag. Returns `{ configured: false }` when not set.
- **`memory://skills` resource** — New resource that scans `SKILLS_DIR_PATH` for `SKILL.md` files and returns a structured skill index with names, paths, and excerpts.
- **`memory://skills` caching** — Added a 5-minute in-memory TTL cache to prevent expensive synchronous file I/O scans on every read request when the skills directory is large.
- **Error auto-refinement** — `MemoryJournalMcpError` base class now auto-refines generic codes (e.g., `QUERY_FAILED` → `TABLE_NOT_FOUND`) when the message matches a known pattern from `ERROR_SUGGESTIONS`. New `matchSuggestion()` utility in `src/utils/errors/suggestions.ts`.
- **`structuredContent` on error responses** — Tool error responses now include `structuredContent` with `code`, `category`, `suggestion`, and `recoverable` fields when the tool has an `outputSchema`, matching the success path behavior.
- **Query helpers** — New `coerceNumber()`, `coerceBoolean()`, `coerceLimit()`, `buildLimitClause()` utilities in `src/utils/query-helpers.ts` for type-safe MCP input coercion.
- **Resource annotation presets** — Centralized `HIGH_PRIORITY`, `MEDIUM_PRIORITY`, `LOW_PRIORITY`, `ASSISTANT_FOCUSED` presets in `src/utils/resource-annotations.ts`.
- **Dynamic help resources** — `memory://help` (lists all tool groups with descriptions and tool counts) and `memory://help/{group}` (per-group tool reference with parameters and annotations). Content generated at runtime from live tool definitions — stays in sync automatically.
- **Tool invariant tests** — Added `tool-annotations.test.ts` and `tool-output-schemas.test.ts` verifying all tools have annotations (`readOnlyHint`, `openWorldHint`), `outputSchema`, and `ErrorFieldsMixin` compliance.

### Fixed

- **`visualize_relationships` missing success field** — The handler returned a `message` but omitted `success: false` when an entry was not found, violating the common structured error format. Added `success: false` to the failure response.
- **`team_list_tags` output validation error** — Handler passed raw `listTags()` result with `usageCount` field directly, but `TagOutputSchema` expects `count`. Added mapping to match the personal `list_tags` handler pattern.
- **FTS5 phrase search (`"error handling"` returns 0 results)** — The porter stemmer indexes `handling` → `handl`, so FTS5 phrase queries requiring exact token sequences never match stemmed content. Added `sanitizeFtsQuery` helper in `search.ts` that detects pure quoted phrases (e.g. `"error handling"`) and rewrites them as AND-joined terms (`error AND handling`), letting the stemmer apply per-word and correctly finding matches.
- **Sandbox readonly `TypeError`** — Calling a mutation method (e.g. `mj.relationships.linkEntries`) in `readonly: true` mode threw `TypeError: mj.relationships.linkEntries is not a function` because the stripped method was `undefined`. Wrapped each group proxy in a `Proxy` with a `get` trap that returns a structured `{ success: false, error: "Operation '...' is not available..." }` for any unknown method.
- **`server-instructions.md` readonly wording** — Corrected the description of `readonly: true` mode: mutation calls now return a structured error object instead of throwing, and the misleading "Write-only groups will be empty" language has been removed.
- **`restore_backup(confirm: false)` leaks raw MCP error** — `confirm: z.literal(true)` in the `inputSchema` caused Zod to reject `false` before the handler's try/catch could run, bypassing `formatHandlerError`. Changed to `z.boolean()` with an explicit handler-level guard returning a structured `VALIDATION_ERROR`.
- **`search_entries` filter regressions (BUG-S1/S2)** — `pr_status` and `workflow_run_id` filters were missing in `DatabaseAdapter.searchEntries` WHERE clauses and the tool handler's `hasFilters` check, causing them to be ignored or improperly shortcut to `getRecentEntries`. Propagated the type and SQL generation across all 5 adapter layers.
- **`link_entries` self-loop & validation shapes (BUG-R1/R2)** — The tool no longer allows an entry to link to itself. Non-existent entry errors also now return a structured `{ code: 'NOT_FOUND' }` object instead of a `{ message: '...' }` object matching the project's standardized error formats.
- **Sandbox readonly mode behavior (BUG-C2/C3)** — Writing functions (e.g. `mj.core.create()`) in a `readonly: true` evaluation now correctly throw a captured Error (via `Promise.reject()`) failing the block immediately instead of silently succeeding with `undefined`. Corrected documentation in `server-instructions.md` indicating that `readonly` methods throw on access. Added missing return shape docs for `mj.core.recent()`.
- **`team_get_cross_project_insights` scaling trap** — Added a `limit` parameter to the schema (default 100, max 500) and mapped it to the SQL `LIMIT` clauses for active/inactive project aggregations. This bounds the queries, explicitly enforcing the project's internal `MAX_QUERY_LIMIT` architecture, and strictly guarantees the subsequent tag index lookup (`IN (?,?,...)`) can never exceed SQLite's 999 maximum variable bindings, preventing O(n²) memory and parsing overhead during heavy team database load.
- **Ad-hoc error responses standardized** — 8 handler error responses across `core.ts`, `admin.ts`, and `search.ts` that returned bare `{ success: false, error }` now include `code`, `category`, `suggestion`, and `recoverable` fields.
- **`formatHandlerError` enriched** — Raw `Error` instances now get matched against `ERROR_SUGGESTIONS` for actionable suggestions and refined error codes instead of always returning bare `INTERNAL_ERROR`.

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

- **Code Mode Readonly Contract Clarified** — Documentation explicitly defines that calling mutation methods under `--tool-filter readonly` safely halts the sandbox and returns a structured `{ success: false, error: "..." }` response rather than a raw exception.
- **Comprehensive Code Quality Audit** — Completed March 2026 zero-regression code quality baseline audit. Validated 100% adherence to architectural standards, typed error boundaries (`MemoryJournalMcpError`), strict schema constraints (`z.object({}).strict()`), and sanitized SQL parameterization. Overall codebase quality certified as **A+**.
- **Code Quality Audit Fixes**: Used `milestoneCompletionPct` helper in milestone tool handlers and extracted `MAX_QUERY_LIMIT` constant/helper in search handlers to DRY up duplication.
- **npm publish gated behind Docker checks** — npm no longer publishes on release creation; instead `docker-publish.yml` calls `publish-npm.yml` via `workflow_call` after Docker Scout passes and images are pushed. Both artifacts ship together or neither ships. Manual `workflow_dispatch` fallback preserved.
- **Dependency Updates** — Updated 27 npm packages; `eslint` → `10.1.0`, `jose` → `6.2.2`, `sqlite-vec` → `0.1.7`, `typescript-eslint` → `8.57.1`. 0 vulnerabilities.
- **`relaxedNumber()` type-safe union** — Changed from `z.any()` to `z.union([z.number(), z.string()])` for MCP SDK inputSchema registration. Accepts both native numbers and string-typed numbers while rejecting non-numeric types at the SDK level. `z.preprocess()` was evaluated but caused 192 ESLint `@typescript-eslint/no-unsafe-*` cascading errors due to unresolvable `ZodEffects` generics.
- **mcp-builder compliance audit** — Complexity tier 4. Audited error handling, input coercion, and tool/resource patterns against mcp-builder standards. Implemented 10 remediation items including dynamic help resources (R3) and resource annotation preset migration (R2).
