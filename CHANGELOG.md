# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v6.1.0...HEAD)

## [6.1.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.0) - 2026-03-22

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
- **Test coverage expansion** — Achieved 91.6% global line coverage by adding comprehensive test suites for Code Mode (`mj_execute_code`), team-core, team-search tools, and utility helpers (`query-helpers.ts`).
- **Vitest Code Mode coverage mock** — Fixed 0% test coverage on `mj_execute_code` routing paths resulting from `node:vm` async IIFEs failing to resolve under Vitest by providing an isolated `createSandboxPool` mock mapping for unit test environments.
- **Per-tool OAuth scope enforcement middleware** — `src/transports/http/server/index.ts` now wires an Express middleware after the OAuth token validator that intercepts `POST /mcp` requests with `method: "tools/call"`, reads the tool name from `params.name`, looks up the required scope via `getRequiredScope()`, and returns HTTP 403 `insufficient_scope` when the token lacks it. This activates the scope-map infrastructure (`scope-map.ts`, auth-context) that previously existed but was not connected to the request pipeline.

### Changed

- **Deleted stale `tools.json`** — Listed only 14 of 61 tools with no consumers. Authoritative references are `tool-reference.md` and `memory://help/{group}`.
- **`server.json` author aligned** — Changed author from `Chris LeRoux` to `Adamic.tech` to match `package.json`.
- **`server.json` description aligned** — Replaced stale description with `package.json` description for consistency across npm and MCP registry.
- **README architecture diagram resource count** — Fixed `Resources (27)` → `Resources (28)` in the ASCII stack diagram.
- **Compact JSON for tool responses** — Success-path responses use `JSON.stringify(result)` (no pretty-print) for ~15-20% payload reduction per mcp-builder §3.1. Error responses remain pretty-printed for readability.
- **Server instructions refactor** — Removed ~55% redundant tool parameter tables from `server-instructions.ts` (511→285 lines) and `.md` (371→147 lines). Tool reference now served dynamically via `memory://help/{group}`. Field notes moved to new `memory://help/gotchas` resource. `standard` level now includes help resource pointers. ~33% token savings at `full` instruction level.
- **Filter-aware server instructions** — `generateInstructions()` now conditionally includes instruction sections based on enabled tool groups: Code Mode section (+ namespace table) only when `codemode` is enabled; Copilot Review Patterns only when `github` is enabled; GitHub Integration patterns only when `github` is enabled; `semantic_search` Quick Access row only when `search` is enabled. New `getEnabledGroups(enabledTools)` helper added to `tool-filter.ts`. Codegen pipeline updated to parse 6 sections (`CORE`, `COPILOT`, `CODE_MODE`, `GITHUB`, `HELP_POINTERS`, `SERVER_ACCESS`). Backward-compatible — callers omitting `enabledGroups` derive it from `enabledTools`. 14 new tests added.
- **`essential` and `starter` shortcuts now include `codemode`** — `META_GROUPS.essential` = `['core', 'codemode']`, `META_GROUPS.starter` = `['core', 'search', 'codemode']`. Matches the documented tool counts (~7 and ~11 respectively) and makes shortcut behavior consistent with the README note that all shortcuts include Code Mode by default. `readonly` unchanged (`['core', 'search', 'analytics', 'relationships', 'export']`).
- **mcp-builder skill updates (S1-S5)** — Updated `SKILL.md` with production-tested patterns from memory-journal-mcp: dynamic help resources as preferred Approach A (S1), single-source instructions alternative (S2), `ToolDefinition` vs `ToolRegistration` type distinction with `mapTool()` example (S3), briefing configuration with 12 env vars table (S4), `inferGroupFromName()` workaround for SDK's missing `group` field (S5).
- **`memory://significant` batched importance (P-R1)** — Replaced N+1 `calculateImportance()` per-entry loop with a single SQL query using LEFT JOIN aggregations for relationship and causal counts. Eliminates N serial subqueries.
- **`help.ts` cached `require()` (P-R2)** — Cached the dynamic `require()` module reference in a module-level variable with `??=` so the circular-dep workaround only resolves the module once.
- **Code Mode Readonly Contract Clarified** — Documentation explicitly defines that calling mutation methods under `--tool-filter readonly` safely halts the sandbox and returns a structured `{ success: false, error: "..." }` response rather than a raw exception.
- **Comprehensive Code Quality Audit** — Completed March 2026 zero-regression code quality baseline audit. Validated 100% adherence to architectural standards, typed error boundaries (`MemoryJournalMcpError`), strict schema constraints (`z.object({}).strict()`), and sanitized SQL parameterization. Overall codebase quality certified as **A+**.
- **Code Quality Audit Fixes** — Used `milestoneCompletionPct` helper in milestone tool handlers and extracted `MAX_QUERY_LIMIT` constant/helper in search handlers to DRY up duplication.
- **npm publish gated behind Docker checks** — npm no longer publishes on release creation; instead `docker-publish.yml` calls `publish-npm.yml` via `workflow_call` after Docker Scout passes and images are pushed. Both artifacts ship together or neither ships. Manual `workflow_dispatch` fallback preserved.
- **Dependency Updates** — Updated 27 npm packages; `eslint` → `10.1.0`, `jose` → `6.2.2`, `sqlite-vec` → `0.1.7`, `typescript-eslint` → `8.57.1`. 0 vulnerabilities.
- **`relaxedNumber()` type-safe union** — Changed from `z.any()` to `z.union([z.number(), z.string()])` for MCP SDK inputSchema registration. Accepts both native numbers and string-typed numbers while rejecting non-numeric types at the SDK level. `z.preprocess()` was evaluated but caused 192 ESLint `@typescript-eslint/no-unsafe-*` cascading errors due to unresolvable `ZodEffects` generics.
- **mcp-builder compliance audit** — Complexity tier 4. Audited error handling, input coercion, and tool/resource patterns against mcp-builder standards. Implemented 10 remediation items including dynamic help resources (R3) and resource annotation preset migration (R2).
- **Version SSoT (`src/version.ts`)** — Created centralized `VERSION` constant. Updated 4 consumers (`cli.ts`, `mcp-server.ts`, `http/handlers.ts`, `briefing/index.ts`) to import from SSoT instead of directly reading `package.json`. Added `VERSION` to public barrel export.
- **`ErrorFieldsMixin` relocated** — Canonical SSoT moved from `handlers/tools/error-fields-mixin.ts` to `utils/errors/error-response-fields.ts`. Old path preserved as re-export stub for backward compatibility.
- **`title` plumbed through `ToolRegistration`** — Added `title` field to `ToolRegistration` type, `mapTool()` mapping in `handlers/tools/index.ts`, and `registerTool()` options in `mcp-server.ts`. Previously `title` was defined on every tool definition but dropped during the mapping step.
- **Tool title invariant test** — `tool-annotations.test.ts` now verifies every tool has a non-empty `title` field.

### Fixed

- **`export_entries` JSON response missing `count` field** — The `json` format response returned `{ format, entries }` but omitted `count`, unlike `team_export_entries` which includes `count: entries.length`. Added `count` to both the handler return and `ExportEntriesOutputSchema`.
- **`test-tool-annotations.mjs` always exiting with code 1** — The 15-second safety-timeout was never cancelled when the script successfully processed the `tools/list` response. Captured the timeout handle with `const killTimeout = setTimeout(...)` and added `clearTimeout(killTimeout)` in the success handler before `process.exit(0)`.
- **Code Mode proxy error wording** — Calling a nonexistent method (e.g., `mj.core.nonexistentMethod()`) in default mode no longer says "not available in read-only mode". Now says "not found in group" for groups with methods, or "no methods (read-only mode?)" for fully-stripped groups. Updated `server-instructions.md` accordingly.
- **Test prompt: incorrect env var** — `test-tools2.md` referenced non-existent `WORKFLOWS_DIR_PATH`; corrected to `MEMORY_JOURNAL_WORKFLOW_SUMMARY` (or `--workflow-summary`).
- **Code Mode last-expression auto-return (CM-1)** — Bare expressions like `mj.help()` now correctly surface their return value from `mj_execute_code`. Previously, the async IIFE wrapper `(async () => { code })()` silently returned `undefined` for non-`return` statements. New `transformAutoReturn()` utility prepends `return` to the last expression statement, mimicking Node REPL semantics. Applied to both VM and Worker sandbox paths.
- **Test prompt: missing verification row** — `test-tools-codemode2.md` Phase 27.4 table omitted `newTagExists` check despite the test code computing it.
- **Test prompt: stale counts and missing coverage** — `test-tools.md` instruction token sizes updated from pre-refactor (~1.2K/~1.4K/~6.7K) to post-refactor (~1.5K/~1.7K/~2.7K). `test-tools2.md` resource count 27→28, template count 7→8, and added `memory://help/gotchas` test row.
- **Test prompt: stale expectations in `test-tools.md`** — Updated 5 test rows following exhaustive Phase 0–5 core test run: (1) FTS5 `architecture` single-word search clarified to note BM25 may rank team entry first; (2) FTS5 phrase search note added about literal-quote requirement in query param; (3) `visualize_relationships` response shape corrected from "raw text" to JSON object with `mermaid` string field; (4) Post-seed verification cross-DB assertion relaxed to match real rank ordering; (5) Inverted date range updated from "empty results (no validation)" to VALIDATION_ERROR structured response reflecting new server-side guard.
- **README/DOCKER_README resource categorization** — `memory://help/{group}` moved from Static to Template resources (20 Static + 8 Template = 28 total).
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
- **Team + GitHub error responses standardized** — 19 `TEAM_DB_NOT_CONFIGURED` responses across all 8 team tool files and 5 GitHub bare errors in `helpers.ts` and `read-tools.ts` now include structured `code`, `category`, `suggestion`, and `recoverable` fields. Added shared `TEAM_DB_ERROR_RESPONSE` constant in `team/helpers.ts`.
- **`formatHandlerError` enriched** — Raw `Error` instances now get matched against `ERROR_SUGGESTIONS` for actionable suggestions and refined error codes instead of always returning bare `INTERNAL_ERROR`.
- **Timer `.unref()` parity** — Added `.unref()` to the session sweep timer (`stateful.ts`) and scheduler job timers (`scheduler.ts`) so they don't prevent clean process exit. The `rateLimitCleanupTimer` already had `.unref()` — this brings all `setInterval` timers into compliance with mcp-builder §2.2.1.
- **`team_link_entries` default `relationship_type`** — Changed relaxed schema default from `'related_to'` (not a valid enum value) to `'references'`, matching the strict schema.
- **`get_github_milestone` structured error fields** — Added missing `code`, `category`, `suggestion`, and `recoverable` fields to the not-found error response. Same fix applied to `create_github_milestone`, `update_github_milestone`, and `delete_github_milestone` failure responses.
- **Vector search lazy init error handling** — Wrapped lazy `initialize()` calls in `addEntry()`, `search()`, and `rebuildIndex()` with try/catch so `better-sqlite3` connection errors return structured responses instead of crashing.
- **`MoveKanbanItemOutputSchema` missing `availableStatuses`** — The `move_kanban_item` handler returns `availableStatuses: string[]` in the status-not-found error path, but this field was missing from the output schema. Could cause `-32602` under strict `structuredContent` validation.
- **Kanban + admin error enrichment** — 5 error responses in `delete_entry`, `merge_tags` (same-tag and domain error), `get_kanban_board` (not-found), and `move_kanban_item` (project/status not-found) now include `code`, `category`, `suggestion`, and `recoverable` fields, matching the `formatHandlerError()` pattern.
- **Team tool error responses enriched** — 10 bare `{success: false, error}` responses across `team/core-tools.ts`, `team/admin-tools.ts`, `team/relationship-tools.ts`, and `team/vector-tools.ts` now include `code`, `category`, `suggestion`, and `recoverable` fields (RESOURCE_NOT_FOUND, VALIDATION_ERROR, or CONFIGURATION_ERROR as appropriate).
- **Reverse-direction relationship duplicate detection removed** — `link_entries` previously treated B→A as a duplicate of A→B (same `relationshipType`), preventing agents from modeling bidirectional relationships. Detection now checks only the exact direction (A→B); reverse links are independent records. `team_link_entries` applies the same directional-only check.
- **Inverted date range validation** — `search_by_date_range` and `team_search_by_date_range` now return a structured `VALIDATION_ERROR` when `start_date > end_date` instead of silently returning empty results.
- **`team_visualize_relationships` tag lookup date bypass** — Modified the fallback tag lookup in `team_visualize_relationships` to use an all-time date range (`1970-01-01` to `2999-12-31`) when fetching entries by tag, ensuring older relationship records are correctly surfaced regardless of the surrounding temporal context.
- **`team_export_entries` `tags` filter ignored without date range** — When no `start_date`/`end_date` was provided, the handler called `getRecentEntries(limit)` and only post-filtered by `entry_type`, silently ignoring any `tags` parameter. Added a client-side tag filter in the no-date-range branch, consistent with how `entry_type` is already filtered. The `tags` filter path in `searchByDateRange` is already correct and unaffected.
- **Test doc: `testedCount` expected value corrected** — `test-tools-codemode2.md` Phase 27.10 table and success criteria listed `19` expected cross-tool error paths, but the test code only generates 18 unique error keys. Corrected to `18` in both locations.
- **`team_link_entries` duplicate field standardized** — `team_link_entries` returned `alreadyExists: true` for duplicate relationships while `link_entries` (personal journal) returned `duplicate: true`. Both now return `duplicate: true`. Updated `TeamLinkEntriesOutputSchema` accordingly.
- **Test doc: `entry_type` casing** — Phase 22.2 of `test-tools-codemode2.md` used `e.entry_type` (snake_case) to map `getRecentEntries` results; the API returns `entryType` (camelCase). Corrected to `e.entryType`.
- **FTS5 ghost entry cleanup on startup** — `migrateSchema()` now detects when the FTS5 index has more rows than active journal entries (indicating ghost entries from hard deletes before the `fts_content_ad` trigger was added) and triggers `INSERT INTO fts_content(fts_content) VALUES('rebuild')` to remove stale tokens. Prevents `searchEntries` from returning IDs that no longer exist.
- **SQLite database path collision in tests** — Addressed test isolation issues that caused intermittent test failures in team tool tests by implementing `beforeAll` cleanup hooks to delete SQLite cache files before each test suite.
- **`help.ts` dynamic import type safety** — Fixed ESLint/TypeScript errors associated with the dynamic schema import cache by using precise `typeof import()` structures without unsafe `any` or `Record<string, unknown>` fallback type casting.
- **`team_export_entries` filter-then-limit ordering** — When `entry_type` or `tags` filters were used without `start_date`/`end_date`, the handler fetched only `limit` entries via `getRecentEntries(limit)` then post-filtered, silently returning fewer results than expected. Now uses `searchByDateRange` with sentinel dates and a larger fetch batch (500) when filters are active, matching the individual `export_entries` fix pattern.

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
- **Trivy false-positive dismissals** (`.trivyignore`):
  - `CVE-2026-32767` (CRITICAL) — Mislabeled/poisoned CVE: SiYuan Note application-level authorization bypass incorrectly attributed to `libexpat` in Trivy's advisory feed (supply chain data corruption). Not a real libexpat vulnerability.
  - `CVE-2026-32777` (MEDIUM) — Legitimate libexpat DoS (infinite loop in DTD parsing), but no attack surface: project is TypeScript/Node.js, no XML/DTD parsing. `libexpat` is a transitive Alpine system dependency only.
  - `CVE-2026-32778` (MEDIUM) — Legitimate libexpat DoS (NULL pointer dereference after OOM), same no-attack-surface rationale.
- **`flatted` 3.4.2** — Prototype Pollution via `parse()` (transitive devDependency via `eslint` → `flat-cache`). Already resolved in local `package-lock.json`; zero production exposure (`npm ci --omit=dev` in Dockerfile).

### Tests

- **E2E coverage expansion (+46 tests, 5 new spec files)** — Closed coverage gaps across 5 areas:
  - `resources-templates.spec.ts` — All 8 template resources (`memory://help/{group}` x5, GitHub-backed templates x7) fetched via HTTP client for the first time; verifies no raw MCP protocol exceptions.
  - `payloads-codemode-api.spec.ts` — `mj.*` API bridge depth: `mj.search.searchEntries()`, `mj.analytics.getStatistics()`, multi-step create-then-search workflow, `await mj.help()` group discovery.
  - `payloads-error-contracts.spec.ts` — Structured error field contracts: `VALIDATION_ERROR` on inverted date range (all 6 fields), minimum `code`+`category` on self-loop link, `{ duplicate: true }` naming verified (not `alreadyExists`).
  - `tool-filtering-presets.spec.ts` — Three filter presets: `essential` (core+codemode, excludes github/team), `codemode`-only (exactly 1 callable tool), `-github` subtractive (45 tools, no github group).
  - `resources-instructions-levels.spec.ts` — `memory://instructions` tool-filter group gating: `core`-only filter strips Code Mode and GitHub Integration sections; `-github` filter strips GitHub Integration while retaining Code Mode and semantic_search Quick Access row.
  - `oauth-scopes.spec.ts` — 3 tests verifying per-tool HTTP-level scope gating: `read` tokens blocked from `write`-group tools, `write` tokens blocked from `admin`-group tools, `admin` tokens permitted full access. Uses raw-fetch session handshake for success paths and bare `tools/call` for 403 interception.
  - `codemode-abuse.spec.ts` — Broadened assertion for unresolving-Promise worker exit to match both `timed out` and `Worker exited` messages. Fixed recovery test to `return 1 + 1` (sandbox wraps code in an async IIFE).

## [6.0.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.0.1) - 2026-03-14

### Changed

- **Docker Image Size Optimization** — Reduced amd64 image from ~733 MB to ~250 MB:
  - Moved npm global upgrade + CVE patches to builder stage only; removed npm/npx from production image
  - Production `npm ci --omit=dev` runs in builder; `node_modules` copied via `COPY --from=builder`
  - Stripped `onnxruntime-web` entirely (browser-only runtime, ~90 MB)
  - Stripped non-Linux `onnxruntime-node` platform binaries (darwin + win32, ~132 MB)

- **CI Dependency Updates** — Bumped GitHub Actions dependencies:
  - `github/codeql-action` SHA update (#263)
  - `actions/download-artifact` 7.0.0 → 8.0.1 (#264)
  - `github/gh-aw` 0.57.2 → 0.58.1 (#265)
  - `trufflesecurity/trufflehog` 3.93.7 → 3.93.8 (#266)
  - `docker/scout-action` 1.18.2 → 1.20.2 (#267)

## [6.0.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.0.0) - 2026-03-14

### Fixed

- **HTTP Transport Close-Before-Reconnect** — MCP SDK `McpServer.connect()` now throws when called while already connected. Added `server.close()` before `server.connect()` for subsequent session initializations in both Streamable HTTP (`stateful.ts`) and Legacy SSE (`legacy-sse.ts`) transports. Tracks connection state via `serverConnected` flag on `StatefulContext`. Sequential sessions work correctly; concurrent multi-session is a known SDK limitation (single transport at a time).

- **Copilot Review Fixes** — Addressed 5 code review findings from GitHub Copilot:
  - `tags.ts`: Fixed `usage_count` increment to use a subquery for accurate batch counting instead of flat `+1`
  - `context-section.ts`: Used `TEAM_PREVIEW_LENGTH` instead of `PREVIEW_LENGTH` for team context previews
  - `interfaces.ts`: Expanded `groupBy` union in `IDatabaseAdapter.getStatistics` to include `'year'`
  - `Dockerfile`: Added `tsup.config.ts` to `COPY` instruction to fix `tsup` build failure
  - `server/index.ts`: Replaced inline `import()` type annotation with top-level `import type` to resolve linting error

- **Documentation Updates**
  - `CONTRIBUTING.md`: Corrected schema path to `src/database/core/schema.ts` and updated architecture tree
  - `README.md` / `DOCKER_README.md`: Added `MCP_AUTH_TOKEN` and `MCP_ENABLE_HSTS` environment variables to configuration tables
  - `docs/code-map.md`: Added `test-tools-codemode2.md` entry to Test Infrastructure table

### Added

- **Test Coverage Improvement (73% → 87%)** — Added 10 new test files with 320+ tests, restoring coverage lost after unreleased changes:
  - **Briefing resources**: `briefing-context-section.test.ts`, `briefing-user-message.test.ts`, `briefing-github-section.test.ts` — covers all 4 context builders, the user message formatter, and GitHub section aggregation
  - **HTTP transport**: `http-stateful.test.ts`, `http-legacy-sse.test.ts`, `http-security.test.ts` — covers session sweep, POST/GET/DELETE /mcp routes, SSE lifecycle, rate limiting, CORS, and security headers
  - **GitHub integration**: `pull-requests.test.ts` — covers all 5 PullRequestsManager methods including Copilot bot detection
  - **Tool handlers**: `copilot-tools.test.ts`, `export-tools.test.ts` — covers get_copilot_reviews and export_entries handlers
  - **Utilities**: `github-helpers.test.ts` — covers resolveIssueUrl with all branch paths
  - Fixed existing test breakages from `hostHeaderValidation` middleware injection (middleware indices, mock response `.json()` method, `TokenValidator` import)

- **E2E Test Expansion (71 → 105 tests)** — Added 8 new Playwright E2E spec files and refactored shared helpers:
  - `streaming.spec.ts` — raw SSE stream validation: GET /mcp with session ID, Last-Event-ID reconnection, Legacy SSE /sse endpoint event format (dedicated server on port 3107)
  - `rate-limiting.spec.ts` — 429 trigger, Retry-After header, /health exemption (inline server spawns with MCP_RATE_LIMIT_MAX)
  - `session-advanced.spec.ts` — cross-protocol guard, sequential session isolation, non-existent session ID rejection, post-DELETE session rejection
  - `prompts.spec.ts` — listPrompts (16+ prompts), getPrompt, parameterized prompt (find-related)
  - `resources-expanded.spec.ts` — memory://instructions, memory://significant, memory://graph/recent, memory://tags, unknown URI error handling
  - `payloads-codemode.spec.ts` — mj_execute_code basic execution, multi-step workflow, blocked patterns (require/process), timeout enforcement
  - `tool-filtering.spec.ts` — --tool-filter starter preset validation: correct subset exposed, core tools included, codemode/github/admin excluded (dedicated server on port 3104)
  - `oauth-discovery.spec.ts` — RFC 9728 /.well-known/oauth-protected-resource endpoint with/without OAuth enabled, scope validation, 401 without token (dedicated server on port 3105)
  - Refactored `helpers.ts` with shared `startServer()`/`stopServer()` lifecycle management
  - Refactored `auth.spec.ts` and `stateless.spec.ts` to use shared helpers, eliminating ~60 lines of duplicated boilerplate

  - **Agentic Workflows (GitHub Copilot)** — 4 new workflow scripts for automated repo maintenance using [GitHub Copilot Coding Agent](https://docs.github.com/en/copilot/using-github-copilot/using-copilot-coding-agent-to-work-on-tasks/about-assigning-tasks-to-copilot): `dependency-maintenance.md` (weekly npm + Docker dep updates, patch version bump, PR creation), `docs-drift-detector.md` (PR-triggered documentation accuracy audit), `ci-health-monitor.md` (weekly CI deprecation and action version check), `agentics-maintenance.yml` (daily expired entity cleanup). Includes `.github/workflows/README.md` with workflow map diagram and editing guidelines.

- **WASM SQLite Fallback Removed** — Removed the `sql.js` WASM fallback adapter to simplify the architecture, test matrix, and dependency footprint. The server now runs exclusively on the high-performance native `better-sqlite3` driver. `--sqlite-native` and `--sqlite-wasm` flags have been removed.
- **Harmonized Error Types (`error-types.ts`)** — New `ErrorCategory` enum (9 categories: validation, connection, query, permission, config, resource, authentication, authorization, internal), `ErrorResponse` interface, and `ErrorContext` interface. Part of the harmonized error handling standard across db-mcp, postgres-mcp, mysql-mcp, and memory-journal-mcp
- **`MemoryJournalMcpError` Base Class (`errors.ts`)** — Enriched base error class with `category`, `code`, `suggestion`, `recoverable`, `details`, and `cause` properties. Includes `toResponse()` method returning structured `ErrorResponse`. 6 subclasses: `ConnectionError`, `QueryError`, `ValidationError`, `ResourceNotFoundError`, `ConfigurationError`, `PermissionError`
- **`OAuthError` Extends `MemoryJournalMcpError`** — OAuth errors now inherit full error handling infrastructure (category, suggestion, toResponse()). Auto-categorizes as AUTHENTICATION (401) or AUTHORIZATION (403) based on httpStatus. Deprecated standalone `getWWWAuthenticateHeader()` utility; removed from barrel export
- **`SecurityError` Extends `MemoryJournalMcpError`** — Security validation errors (`InvalidDateFormatError`, `PathTraversalError`) now participate in the enriched error hierarchy with VALIDATION category
- **`formatHandlerError()` Function** — Enriched error formatter in `error-helpers.ts` returning full `ErrorResponse` objects with code, category, suggestion, and recoverable fields. Handles `MemoryJournalMcpError`, `ZodError`, and raw errors

- **Configurable Briefing (`memory://briefing`)** — 5 new env vars / CLI flags to customize the session briefing
  - `BRIEFING_ENTRY_COUNT` / `--briefing-entries` — Number of journal entries (default: 3)
  - `BRIEFING_INCLUDE_TEAM` / `--briefing-include-team` — Include team DB entries in briefing
  - `BRIEFING_ISSUE_COUNT` / `--briefing-issues` — Number of issues to list with titles (0 = count only)
  - `BRIEFING_PR_COUNT` / `--briefing-prs` — Number of PRs to list with titles (0 = count only)
  - `BRIEFING_PR_STATUS` / `--briefing-pr-status` — Show PR status breakdown (open/merged/closed)
  - Issues and PRs row now always displayed in the `userMessage` table when GitHub is available
  - `RULES_FILE_PATH` / `--rules-file` — Path to user rules file; shown in briefing with size and last-modified age
  - `SKILLS_DIR_PATH` / `--skills-dir` — Path to skills directory; shown in briefing with skill count
  - Expanded `## Rule & Skill Suggestions` in server instructions with guidance for adding, updating, and refining rules and skills
  - `BRIEFING_WORKFLOW_COUNT` / `--briefing-workflows` — Number of recent workflow runs to list with names and status icons
  - `BRIEFING_WORKFLOW_STATUS` / `--briefing-workflow-status` — Show workflow run status breakdown (passing/failing/pending/cancelled)
  - CI Status row in briefing enhanced to show named runs (✅ build · ❌ deploy) or aggregated counts
  - `get_copilot_reviews` tool — Fetch Copilot's code review findings for any PR (state, file-level comments with paths/lines)
  - `BRIEFING_COPILOT_REVIEWS` / `--briefing-copilot` — Aggregate Copilot review state across recent PRs in briefing
  - Copilot review patterns in server instructions (learn from reviews, pre-emptive checking, `copilot-finding` tag)

- **OAuth 2.1 Authentication Module** — Full RFC-compliant OAuth 2.0 authentication and authorization for the HTTP transport
  - 10 new files in `src/auth/`: types, errors, scopes, token-validator, oauth-resource-server, authorization-server-discovery, scope-map, auth-context, middleware, barrel
  - RFC 9728 Protected Resource Metadata endpoint (`/.well-known/oauth-protected-resource`)
  - RFC 8414 Authorization Server Metadata discovery with caching
  - JWT validation via `jose` library with JWKS caching and issuer/audience verification
  - 10 tool groups mapped to 3 OAuth scopes: `read` (core, search, analytics, relationships, export), `write` (github, team), `admin` (admin, backup, codemode)
  - `AsyncLocalStorage`-based per-request auth context threading
  - Express middleware for token extraction, validation, and scope enforcement
  - Transport-agnostic utilities: `createAuthenticatedContext`, `validateAuth`, `formatOAuthError`
  - 5 new CLI flags: `--oauth-enabled`, `--oauth-issuer`, `--oauth-audience`, `--oauth-jwks-uri`, `--oauth-clock-tolerance`
  - Environment variable support: `OAUTH_ENABLED`, `OAUTH_ISSUER`, `OAUTH_AUDIENCE`, `OAUTH_JWKS_URI`

- **Code Mode (`mj_execute_code`)** — Sandboxed JavaScript execution for multi-step workflows with 70-90% token reduction
  - 9 new files in `src/codemode/`: types, security manager, VM sandbox, worker-thread sandbox, worker script, sandbox factory, API bridge, API constants, barrel
  - `src/handlers/tools/codemode.ts` — Tool handler with security validation, rate limiting, and API bridge construction
  - `mj.*` namespaced API exposes all 44 tools across 10 groups (core, search, analytics, relationships, export, admin, github, backup, team, codemode)
  - Positional argument support, method aliases, per-group `help()` for discoverability
  - Production sandbox: `node:worker_threads` with V8 isolate boundary, `node:vm` secondary isolation, MessagePort RPC bridge
  - Resource limits: code length (50KB), execution timeout (30s), memory (128MB), rate limiting (60 executions/min), result size (10MB)
  - `--sandbox-mode <mode>` CLI flag: `worker` (production, default) or `vm` (lightweight)
  - Tool count: 42 → 44 tools, tool groups: 9 → 10

### Changed

- **MCP Builder Naming Alignment** — Renamed `ErrorResponseFields` → `ErrorFieldsMixin` and `formatHandlerErrorResponse()` → `formatHandlerError()` to match the cross-server naming convention in the mcp-builder skill. Renamed source file `error-response-fields.ts` → `error-fields-mixin.ts`. Zero logic changes.

- **Server Instructions Session Start** — Replaced numbered-list "Session Start" with bold **REQUIRED** directive to read `memory://briefing` and present `userMessage` to the user. Moved server name discovery plumbing below the action to prevent agents from misinterpreting the section as configuration guidance.

- **Dependency Updates** — `better-sqlite3` bumped from `12.6.2` → `12.8.0` (skips non-viable `12.7.0`/`12.7.1` intermediates — both were yanked due to Electron v41 V8 ABI breakage and the withdrawn SQLite 3.52.0 release). `12.8.0` ships SQLite **3.51.3** (WAL-reset bug fix), resolves the `HolderV2()` V8 API compat issue, and carries no breaking API changes. Also bumped non-breaking transitive dependencies.

- **Unified Audit Fixes**
  - SHA-pinned `actions/checkout` in `auto-release.yml` to commit SHA, matching all other workflows
  - Removed manually-maintained `LABEL version` from `Dockerfile` — Docker tags and OCI metadata already convey version info without drift risk
  - Removed dead `matchesCorsOrigin()` function from `security.ts` — unused since `setCorsHeaders()` was rewritten to use CodeQL-safe record-lookup pattern. Removed 6 associated tests and barrel re-export
  - Removed unused `crypto` import from `sandbox.ts` (only `worker-sandbox.ts` uses it for `poolId`)
  - Wired `enableHSTS` config to CLI via `--enable-hsts` flag and `MCP_ENABLE_HSTS` env var — was previously a dead config path with no way to enable HSTS from CLI or environment

- **MCP Builder Compliance (D3/D7)**
  - Added `openWorldHint: false` to 28 non-GitHub tool annotations across 9 handler files (`core.ts`, `search.ts`, `relationships.ts`, `team.ts`, `backup.ts`, `export.ts`, `analytics.ts`, `admin.ts`, `codemode.ts`) — explicitly declares local-only SQLite operations
  - Added configurable instruction level via `--instruction-level` CLI flag and `INSTRUCTION_LEVEL` env var (values: `essential`, `standard`, `full`; default: `standard`) — controls AI briefing depth in MCP `initialize` response

- **Pass 2 Testing Fixes**
  - Improved `link_entries` error message when source or target entry doesn't exist — now returns `"One or both entries not found (from: X, to: Y)"` instead of raw SQLite `"FOREIGN KEY constraint failed"` error
  - `add_to_vector_index` now surfaces the actual error message from embedding generation/storage failures instead of a generic `"Failed to generate or store embedding"` string — enables diagnosis of model loading, ONNX runtime, or sqlite-vec issues
  - `get_github_issues` and `get_github_prs` `inputSchema` now uses `relaxedNumber()` for `limit` parameter — previously used `z.number()` which caused the MCP SDK to pre-validate and produce raw `-32602` errors instead of structured handler errors when a string was passed
  - Code Mode `mj.admin.help()` examples now list all 5 admin tools (`updateEntry`, `deleteEntry`, `mergeTags`, `rebuildVectorIndex`, `addToVectorIndex`) — previously missing `mergeTags` and `addToVectorIndex`
  - Server instructions Code Mode section now documents `readonly` mode behavior — write-only groups (e.g., `admin`) are empty when `readonly: true`

- **Pass 1 Retest Fixes**
  - `rebuild_vector_index` now returns `failedEntries` count, `firstError` with the actual embedding error message, and sets `success: false` when every entry fails — previously returned `success: true, entriesIndexed: 0` with no indication of failure
  - Added `getRecent` alias for `getRecentEntries` in Code Mode (`mj.core.getRecent()`) — agents commonly try this natural camelCase abbreviation
  - `semantic_search` hint is now governed by a quality floor (0.5) — if all returned results score below 0.5, a hint is included indicating results may be noise, even when `entries.length > 0`. Previously, `hint_on_empty` was effectively dead code because the default `similarity_threshold` (0.25) always returned noise matches from the MiniLM model
  - `semantic_search` quality gate hint is now always shown regardless of `hint_on_empty` — the `hint_on_empty` flag only controls advisory hints for empty indexes and zero-match queries, not the noise detection warning. Previously, `hint_on_empty=false` suppressed all hints including the quality gate, meaning clients received noisy results with no warning
  - `export_entries` `entry_types` filter now scans the full database instead of post-filtering a truncated result set — previously, type-only queries fetched the most recent `limit` entries via `getRecentEntries()` then filtered, silently returning empty results when no matching types existed in the window
  - `merge_tags` now wraps the entire operation in an explicit `db.transaction()` and cleans orphaned `entry_tags` rows (referencing permanently-deleted entries) before re-linking — previously failed with `FOREIGN KEY constraint failed` when both source and target tags existed with overlapping entries
  - Server instructions now specify a **briefing confirmation format** — short bullet list of key facts (entry counts, GitHub status, milestones, template resources, optional metadata) instead of tables or elaborate formatting
  - `test-tools.md` prerequisites no longer instruct agents to read `memory://briefing` separately — detailed briefing testing is deferred to Phase 1.2 to prevent duplicate reads
  - `close_github_issue_with_entry` with `move_to_done: true` now uses `addProjectItem` (idempotent) to resolve the item ID directly — bypasses the race condition where a newly-added item was not yet visible on the board during the immediately-following close call

- **MCP Builder Compliance Audit Fixes**
  - Added `error` field to `ErrorFieldsMixin` — centralizes the 6th ErrorResponse field that was previously defined per-schema, preventing future omissions
  - Added DNS rebinding protection (`hostHeaderValidation()`) to HTTP transport — applies MCP SDK middleware when no auth is configured as defense-in-depth against CVE-2025-66414
  - SHA-pinned all GitHub Actions across 6 workflow files (`lint-and-test.yml`, `codeql.yml`, `publish-npm.yml`, `secrets-scanning.yml`, `security-update.yml`, `docker-publish.yml`) to prevent supply chain injection via force-pushed tags

- **Performance Audit Fixes (Round 4)**
  - Enabled tsup `splitting: true` — shared code between `cli.js` and `index.js` is now extracted into a common chunk, reducing total dist size from 875 KB to 455 KB (~48% reduction, ~420 KB saved)
  - Migrated `TagsManager` and `RelationshipsManager` from legacy `exec()` (which translated rows to `{ columns, values }` arrays) to direct `db.prepare()` calls, matching the pattern already used by `EntriesManager`. Eliminates row-format translation overhead and the manual `rowToObject` helper. Uses native `result.lastInsertRowid` instead of `SELECT last_insert_rowid()` query.

- **Code Quality Audit Fixes (Round 10)**
  - Extracted `MAX_CONTENT_LENGTH = 50_000` constant into `schemas.ts`, replacing 4 inline `max(50000)` literals in `core.ts` and `team.ts`
  - Extracted `DATE_MIN_SENTINEL` / `DATE_MAX_SENTINEL` constants into `schemas.ts`, replacing 3 inline `'1970-01-01'` / `'2999-12-31'` literals in `export.ts`
  - Extracted `CORS_PREFLIGHT_MAX_AGE_SECONDS = 86_400` constant into `types.ts`, replacing inline `'86400'` in `security.ts`
  - Extracted `JSONRPC_SERVER_ERROR = -32000` and `JSONRPC_INTERNAL_ERROR = -32603` constants into `types.ts`, replacing 6 inline literals across `stateless.ts`, `stateful.ts`, and `legacy-sse.ts`
  - Cached `collectNonCodeModeTools()` result in `codemode.ts` using referential identity check on `ToolContext`, matching the caching pattern in `handlers/tools/index.ts`

- **Stale sql.js Comment Cleanup** — Updated 8 stale comment references to sql.js across 5 source files (`scheduler.ts`, `schema.ts`, `interfaces.ts`, `native-connection.ts`, `sqlite-adapter/index.ts`) to accurately reflect the better-sqlite3 native-only architecture. Comment-only changes, zero functional impact.

- **Copilot Instructions Path Fixes** — Updated `.github/copilot-instructions.md` architecture tree to reflect kebab-case renames (`server-instructions.ts`, `sqlite-adapter/`, `tool-filter.ts`, `github-integration/`, `mcp-server.ts`, `scheduler.ts`, `http/`) and moved reference file paths (`test-server/` → `docs/`). Updated descriptions to reflect better-sqlite3 native-only architecture and modularized directory structures.

- **Code Quality Audit Fixes (Round 9)**
  - Consolidated 4 duplicate `resolveOwnerRepo` implementations (in `milestone-tools.ts`, `read-tools.ts`, `copilot-tools.ts`, and inlined in `insights-tools.ts`) into the single shared helper in `helpers.ts` with optional `entityLabel` parameter
  - Extracted resource and prompt registration from `mcp-server.ts` (457 lines) into new `server/registration.ts` module, reducing the main server file to ~375 lines

- **Code Map Audit Fixes** — Corrected handler→tool mapping table: swapped `update_entry`/`delete_entry` from core to admin, and `test_simple`/`list_tags` from admin to core to match actual source files. Fixed GitHub sub-handler tool counts (`issue-tools.ts` 4→2, `kanban-tools.ts` 1→2, removed non-existent `add_project_item`). Added missing `src/index.ts` to directory tree. Fixed backup tool name `create_backup`→`backup_journal`. Moved `confirm-briefing` prompt from `github.ts` to `workflow.ts` listing (workflow: 9→10, github: 7→6). Removed phantom `database/core/index.ts` barrel from directory tree.

- **README/DOCKER_README Audit Fixes** — Fixed tool filter `full` count (43→44) to match `tool-reference.md` source of truth. Fixed coverage badge URL encoding (`%78`→`%25`) and updated stale badge values (coverage 74%, tests 910). Updated stack diagram tool count (43→44). Corrected MCP annotations date reference (2025-11-25→2025-03-26) in README Security section.

- **README/DOCKER_README Session Initialization Rule** — Added a `## Rule` section with explicit instructions for AI agents to read `memory://briefing` before processing user requests. This supplements the MCP `instructions` field (which not all clients surface) by providing a README-level directive that clients like Claude Desktop and Cursor parse directly, making briefing initialization 100% reliable across all MCP clients.

- **README/DOCKER_README Cross-Agent Memory** — Added **Cross-Agent Memory** feature row to both README and DOCKER_README feature tables, highlighting the IDE ↔ Copilot bridge via journal entries. Added Copilot Setup Guide link to Documentation & Resources sections.

- **Wiki: Copilot Integration Page** — Created dedicated `Copilot-Integration.md` wiki page documenting the cross-agent memory bridge between IDE agents and GitHub Copilot (three usage patterns, setup for both directions, recommended workflow, security notes). Added to `_Sidebar.md` and `Home.md` navigation. Fixed stale tool counts (43→44) in `Home.md`.

- **README/DOCKER_README "What Sets Us Apart" Table** — Converted the 14-bullet "Key Benefits" list into a 17-row feature table matching db-mcp's "What Sets Us Apart" format. Added rows for Configurable Briefing, OAuth 2.1 + Access Control, HTTP Streaming Transport, Production-Ready Security, Strict TypeScript, and MCP 2025-03-26 compliance. Removed all WASM/Dual-Backend/sql.js references (variant rows, stack diagram, Technical Highlights, security bullets) to reflect the native-only `better-sqlite3` architecture. Applied same changes to `DOCKER_README.md`.

- **Performance Audit Fixes (Round 3)**
  - Pre-compiled `IS_MUTATION_RE` regex as module-level constant in `native-connection.ts` — eliminates repeated regex compilation on every `exec()` call
  - Replaced `new Date()` object allocation in `mergeAndDedup` sort comparator with `localeCompare()` in `search.ts` — ISO 8601 timestamps sort lexicographically without parsing
  - Moved `fetchCopilotReviews` into main `Promise.all` block in `github-section.ts` — runs in parallel with 4 other GitHub API calls instead of sequentially after them

- **FTS5 Full-Text Search** — Replaced `LIKE '%query%'` substring matching in `search_entries` with SQLite FTS5 full-text search. Adds BM25 relevance ranking, phrase queries (`"exact match"`), prefix matching (`auth*`), and boolean operators (`error NOT warning`). Uses `content=memory_journal` content-sync mode (no duplicate storage), Porter stemmer with unicode61 tokenizer, and three auto-sync triggers (INSERT/UPDATE/DELETE). Gracefully falls back to LIKE on FTS5 syntax errors (e.g. SQL injection payloads, special characters). Existing databases auto-populate the FTS5 index on first migration via `rebuild` command. Updated `search_entries` tool description and server instructions with FTS5 query syntax documentation.

- **Generator Script Fix** — Fixed `scripts/generate-server-instructions.ts` to output kebab-case `server-instructions.ts` (was PascalCase `ServerInstructions.ts`, a dead file with wrong import path). Fixed import from `ToolFilter.js` → `tool-filter.js`. Removed stale `_resources: ResourceDefinition[]` parameter from `server-instructions-function-body.ts` to match actual callers. Deleted orphaned `ServerInstructions.ts`.

- **Test Artifact Consolidation** — Consolidated scattered test output directories (`coverage/`, `test-results/`, `test-server/*.db*`, `test-server/backups/`, `backups/`) into a single `.test-output/` directory with `coverage/` (vitest), `playwright/` (Playwright results), and `e2e/` (E2E databases and scheduler backups). Moved `code-map.md`, `test-tools.md`, and `tool-reference.md` from `test-server/` to `docs/`. Updated `.gitignore` and `.dockerignore` to use single `.test-output/` entry. No source code changes needed — the backup system auto-adapts via `dirname(dbPath)` path derivation.

- **Vector Search Backend** — Replaced `vectra` with `sqlite-vec` for vector search. Embeddings now stored in the main SQLite database via a `vec0` virtual table (`vec_embeddings`), eliminating the separate `.vectra_index/` directory and 86 transitive dependencies (460→376 packages). KNN search uses SQL `WHERE embedding MATCH ? ORDER BY distance LIMIT ?` queries directly. `removeEntry()` and `getStats()` are now synchronous (better-sqlite3 is synchronous). NativeConnectionManager loads the sqlite-vec extension on init with a race-condition guard for concurrent close during async import.

- **Build Tooling** — Replaced `tsc` with `tsup` (esbuild) for production builds. Output reduced from 372 files (1.04 MB) to 6 files (875 KB) with tree-shaking. Build speed: ~9s vs 19s. Type checking remains as a separate `npm run typecheck` step (`tsc --noEmit`).
- **ML Embedding Library** — Migrated from `@xenova/transformers` v2 (archived, unmaintained) to `@huggingface/transformers` v3.8.1 (official Hugging Face org, actively maintained). API change: `quantized: true` → `dtype: 'q8'`. Same `Xenova/all-MiniLM-L6-v2` model, same embedding quality. Updated README, SECURITY, and DOCKER_README references.

- **Performance Audit Fixes (Round 2)**
  - Replaced N+1 `getEntryById` calls in `semantic_search` handler with batch `getEntriesByIds()` — single `WHERE id IN(…)` query + `batchGetTagsForEntries` instead of N separate lookups
  - Replaced per-item sequential `deleteItem()` loop in `rebuildIndex()` with O(1) directory wipe + recreate — eliminates O(n) serial file I/O during vector index rebuilds
  - Parallelized 4 independent GitHub API calls (`fetchCiStatus`, `fetchIssuesAndPrs`, `fetchMilestones`, `fetchInsights`) in briefing resource using `Promise.all()` — reduces cold-load latency from additive to max of the 4 calls

- **Performance Audit Fixes**
  - Replaced `getStatistics('week')` with `getActiveEntryCount()` in `buildJournalContext()` and `buildTeamContext()` — briefing only needs `totalEntries`, not the full stat breakdown (~5× fewer queries per session start)
  - Replaced N+1 exist-check loop in `mergeTags()` with bulk pre-fetch + batch `INSERT OR IGNORE` — O(1) vs O(N) queries during tag merge operations

- **Code Quality Audit Fixes (Round 8)**
  - Extracted `milestoneCompletionPct()` helper into `resources/shared.ts`, replacing 4 inline duplicate calculations across `resources/github.ts` (×3) and `briefing/github-section.ts` (×1)
  - Added `logger.debug()` to 8 empty `catch {}` blocks in `briefing/context-section.ts` (team context, rules file, skills dir) and `briefing/github-section.ts` (CI status, issues/PRs, milestones, traffic, insights) for improved troubleshooting

- **Code Quality Audit Fixes (Round 7)**
  - Replaced two remaining `inactiveThresholdDays: 7` literals with `INACTIVE_THRESHOLD_DAYS` constant in `analytics.ts`
  - Hoisted `DEDUP_KEY_LENGTH` from local function scope to module-level named constant in `search.ts`
  - Removed misleading `async` keyword from `DatabaseAdapterFactory.create()` in `adapter-factory.ts` (synchronous constructor wrapped in `Promise.resolve()`)

- **Code Quality Audit Fixes (Round 6)**
  - Eliminated 10 `@typescript-eslint/no-non-null-assertion` lint errors in `resources/github.ts` by threading the narrowed `github` instance through `GitHubRepoResolved` from `resolveGitHubRepo()` — downstream handlers now destructure `github` instead of using `context.github!`
  - Extracted `MS_PER_DAY` constant in `prompts/workflow.ts`, replacing 3 inline `86400000` magic values

- **Code Quality Audit Fixes (Round 5)**
  - Extracted `resolveGitHubRepo()` + `isResourceError()` guard helper into `resources/shared.ts`, eliminating ~60 lines of duplicated GitHub availability checks across 4 resource handlers and the briefing section
  - Added debug logging to 4 silent `catch {}` blocks in `vector-search-manager.ts` (`removeEntry`, `rebuildIndex` deletion/embedding, `getStats`) for improved troubleshooting
  - Extracted 5 inline API limits into named constants (`RESOURCE_ISSUE_LIMIT`, `RESOURCE_PR_LIMIT`, `RESOURCE_WORKFLOW_LIMIT`, `RESOURCE_STATUS_MILESTONE_LIMIT`, `RESOURCE_MILESTONE_LIMIT`) in `resources/github.ts`
  - Parallelized 6 serial GitHub API calls in `github/status` resource handler using `Promise.allSettled()` for reduced latency

- **Code Quality Audit Fixes (Round 4)**
  - Added debug logging to 8 silent `catch {}` blocks across `github-section.ts`, `resources/github.ts`, `core.ts`, and `backup.ts` for improved debuggability
  - Wrapped `github/milestones` and `milestones/{number}` resource handler returns in `{ data, annotations }` structure for consistency with other GitHub resource handlers
  - Parallelized sequential `getCopilotReviewSummary()` API calls in `fetchCopilotReviews()` using `Promise.all()` for faster briefing generation

- **Code Quality Audit Fixes (Round 3)**
  - Extracted duplicated `resolveIssueUrl()` logic from `core.ts` and `team.ts` into shared `utils/github-helpers.ts`
  - Replaced magic numbers with named constants: `INACTIVE_THRESHOLD_DAYS`, `MS_PER_DAY`, `MAX_TAGS_PER_PROJECT` in `analytics.ts`; `MERMAID_CONTENT_PREVIEW_LENGTH` in `relationships.ts`; `DEDUP_KEY_LENGTH` in `search.ts`; `LATEST_ENTRY_PREVIEW_LENGTH` in `server-instructions.ts`
  - Fixed N+1 tag query in `team_search` with batch `SELECT ... WHERE entry_id IN (...)` query
  - Consolidated 4 serial `SELECT COUNT(*)` queries in `getHealthStatus()` into a single subquery
  - Moved `scheduler` declaration before `handleResourceRead` closure to eliminate temporal hazard
  - Removed unused `_resources` parameter and `ResourceDefinition` type from `generateInstructions()`
  - Split `auth/middleware.ts` (519 lines) by extracting transport-agnostic auth functions to `auth/transport-agnostic.ts`

- **Code Quality Audit Fixes (Round 2)**
  - Extracted `ToolRegistration` interface for typed `getTools()` return, eliminating ~10 unsafe `as` casts in `mcp-server.ts` tool registration
  - Added typed `pragma(command: string)` method to `IDatabaseAdapter` and `IDatabaseConnection` interfaces, eliminating unsafe `getRawDb() as { pragma/run }` casts in `scheduler.ts` and `backup.ts`
  - Typed `getStatistics()` return from `unknown` to `Record<string, unknown>` on `IDatabaseAdapter`
  - Added `queryRow()` / `queryRows()` typed query helpers to entries shared module
  - Extracted `autoIndexEntry()` helper into `utils/vector-index-helpers.ts`, removing 3-way fire-and-forget vector indexing duplication across `core.ts` and `admin.ts`
  - Extracted `handleResourceRead()` helper in `mcp-server.ts`, removing ~30 lines of duplicated resource response formatting between template and static resource registration
  - Replaced magic numbers with named constants: `MAX_RELATIONSHIP_SCORE_AT`, `MAX_CAUSAL_SCORE_AT`, `RECENCY_WINDOW_DAYS` in `importance.ts`; `MAX_PERIOD_ROWS` in `statistics.ts`; `MAX_BACKUP_NAME_LENGTH` in `backup.ts`
  - Removed no-op `await Promise.resolve()` calls in `scheduler.ts` (`runBackup`, `runVacuumOptimize`)
  - Added debug-level logging to previously silent WAL checkpoint error catch block in `backup.ts`

- **Code Quality Audit Fixes (Round 1)**
  - Renamed 7 `PascalCase` files to kebab-case to match workspace standards (`sqlite-adapter.ts`, `tool-filter.ts`, `github-integration.ts`, `mcp-server.ts`, `mcp-logger.ts`, `vector-search-manager.ts`, `server-instructions.ts`, `scheduler.ts`) and updated 27 import references across the codebase
  - Converted 13 bare `throw new Error(...)` statements to typed error classes (`ConfigurationError`, `ResourceNotFoundError`, `ConnectionError`, `QueryError`, `ValidationError`) for consistent error handling and standard structured error responses (`vector-search-manager.ts`, `sqlite-adapter.ts`, `handlers/resources/index.ts`, `handlers/prompts/index.ts`, `authorization-server-discovery.ts`, `sandbox-factory.ts`)
  - Renamed `src/types/sql.js.d.ts` to `sql-js.d.ts` to ensure strict compliance with kebab-case naming standard
  - Eliminated `eslint-disable-next-line` pragmas where possible (e.g. `no-control-regex` solved natively in `security-utils.ts`, `no-explicit-any` removed in `backup.ts`)
  - Strictified `z.object({})` Zod schemas by appending `.strict()` for safer payload validation on empty schemas (`admin.ts`, `backup.ts`, `core.ts`, `search.ts`, `read-tools.ts`)
  - Consolidated duplicated `resolveAuthor` / `resolveTeamAuthor` logic from `core.ts` and `team.ts` into shared `resolveAuthor()` in `security-utils.ts`
  - Removed `as unknown as Record<string, unknown>` type cast in `crud.ts` by adding `timestamp?: string` to `CreateEntryInput` interface
  - Removed deprecated `SERVER_INSTRUCTIONS` constant from `server-instructions.ts` (zero consumers)
  - Split 603-line `briefing.ts` into `briefing/` directory: `github-section.ts`, `context-section.ts`, `user-message.ts`, `index.ts` (all under 260 lines)
  - Replaced N+1 author queries in `team.ts` with single batch `SELECT ... WHERE id IN (...)` via `batchFetchAuthors()` helper
  - Replaced N+1 per-project tag queries in `analytics.ts` with single batch query grouped by `project_number`

- **Performance Optimization (I/O)** — Refactored blocking synchronous file system operations (`fs.writeFileSync`, `fs.readFileSync`, `fs.mkdirSync`, `fs.copyFileSync`, `fs.statSync`) in `BackupManager` to asynchronous `fs.promises` equivalents to prevent freezing the Node.js event pool during journal backups.
- **Performance Optimization (I/O)** — Refactored synchronous `fs.mkdirSync` and `fs.rmSync` in `VectorSearchManager` to asynchronous `fs.promises` equivalents for non-blocking directory operations during index initialization and rebuilding.
- **Performance Optimization (Build)** — Disabled generating `.map` source maps in production build (disabled `sourceMap` in `tsconfig.json`), saving approx 1-2MB in the final compiled bundle.
- **Performance Optimization (Memory)** — Refactored unbounded `SELECT * FROM memory_journal` queries across core handlers (`entries.ts`, `templates.ts`, `github.ts`, `core.ts`, `stats.ts`, `graph.ts`, `workflow.ts`) to use explicit `ENTRY_COLUMNS` projections, reducing I/O latency and WASM memory overhead.
- **Performance Optimization (Bundle)** — `WasmSqliteAdapter` initialization is now strictly loaded via a dynamic `await import` block inside `DatabaseAdapterFactory.create`. This keeps the heavy WASM binaries fully isolated from the top-level bundle payload on native platforms.
- **Performance Optimization (Database)** — Unbounded `SELECT * FROM relationships` wildcard lookups have been restricted to strict `id, from_entry_id, to_entry_id, relationship_type, description, created_at` column mappings.
- **Performance Optimization (Sandbox)** — Capped Code Mode Result serialization using strict buffer tracking logic to prevent `JSON.stringify` from creating maximum V8 strings that blow through native application memory.
- **GitHub API Caching** — Implemented a bounded (max 100 items), TTL-aware LRU cache strategy in `GitHubClient` to prevent memory leaks on long-running instances.
- **Core Handlers Modularized**:
  - **SQLite Adapter** — Split monolithic `src/database/sqlite-adapter.ts` (1640 lines) into `src/database/sqlite-adapter/` containing `connection.ts`, `tags.ts`, `entries.ts`, `relationships.ts`, `backup.ts`, and `index.ts`.
  - **GitHub Integration** — Split monolithic `src/github/github-integration.ts` (1707 lines) into `src/github/github-integration/` containing focused modules (`auth.ts`, `repos.ts`, `issues.ts`, `pull-requests.ts`, `search.ts`, `copilot.ts`, `index.ts`).
  - **Core Resources** — Split monolithic `src/handlers/resources/core.ts` (823 lines) into `src/handlers/resources/core/` containing `briefing.ts`, `instructions.ts`, `stats.ts`, and `index.ts`.
  - **Briefing Resource** — Split monolithic `src/handlers/resources/core/briefing.ts` (603 lines) into `src/handlers/resources/core/briefing/` containing focused builders (`github-section.ts`, `context-section.ts`, `user-message.ts`) and `index.ts`.
- **Test Directory Renamed** — Renamed `src/auth/__tests__` to `src/auth/tests` to comply with the project's strict kebab-case naming standard.
- **HTTP Transport Modularized** — Continued splitting `src/transports/http.ts` and `src/transports/http/server.ts` into a fully modularized directory:
  - `types.ts` — Configuration interface (`HttpTransportConfig`), constants, rate limiting types
  - `security.ts` — Client IP extraction, built-in rate limiting, CORS (exact-match multi-origin), security headers
  - `handlers.ts` — Health check, root info, bearer token auth middleware
  - `server/` — Split `server.ts` into `stateless.ts`, `stateful.ts`, `legacy-sse.ts`, and `index.ts`
  - `index.ts` — Barrel re-export
- **CORS Configuration** — `corsOrigin: string` changed to `corsOrigins: string[]` for multi-origin support. CLI `--cors-origin` accepts comma-separated values. Exact-match origins only (CodeQL-safe record-lookup pattern).
- **HSTS Configuration** — HSTS is now config-driven via `enableHSTS: true` instead of auto-detecting from `X-Forwarded-Proto` header.
- **Cache-Control Header** — Strengthened from `no-store` to `no-store, no-cache, must-revalidate`.

- **Dependency Updates**
  - `@types/node`: 25.3.5 → 25.4.0 (minor)
  - `express-rate-limit`: 8.3.0 → 8.3.1 (patch)
  - `simple-git`: 3.32.3 → 3.33.0 (minor)
  - `typescript-eslint`: 8.56.1 → 8.57.0 (minor)
  - `tar` override: 7.5.10 → 7.5.11 (patch) — npm + Docker layers
  - `axios` override: 1.13.5 → 1.13.6 (patch)
  - `tmp` override: 0.2.4 → 0.2.5 (patch)
  - GitHub Actions: `docker/setup-buildx-action` (v3 → v4), `docker/metadata-action` (v5 → v6), `docker/login-action` (v3 → v4), `aquasecurity/trivy-action` (0.34.1 → 0.35.0), `docker/scout-action` (v1.20.1 reverted to v1.18.2 — upstream 403 on asset download)

### Fixed

- **Cross-DB `is_personal` Filter Bypass** — `search_entries`, `search_by_date_range`, and `semantic_search` now correctly honor `is_personal: true` when a team DB is present. Previously, team entries (which are never personal) were included in results even when `is_personal: true` was explicitly specified: `searchEntries` and `searchByDateRange` now skip the team DB entirely when `is_personal: true`, and `semanticSearch` now post-filters results by `isPersonal` when the parameter is set.

- **Cross-DB Search Limit Bug** — `search_entries` and `search_by_date_range` now use `Math.min(limit * 2, 500)` for per-database queries when a team DB is present, then apply the user's requested limit during the final `mergeAndDedup` step. Previously, the user's limit (default 10) was passed directly to each individual database query, causing FTS5 BM25 ranking in the larger personal DB to silently drop matching entries that ranked below position N, even when the total matching entries across both databases was well under the limit.

- **Mermaid Graph Resources Return Raw Text** — `memory://graph/recent`, `memory://graph/actions`, and `memory://kanban/{n}/diagram` now return raw Mermaid diagram strings instead of JSON envelopes (`{ format, diagram, ... }`). Output is directly pasteable into [mermaid.live](https://mermaid.live/) without `UnknownDiagramError`. The `text/plain` mimeType now correctly matches the response body.

- **Vector Index sqlite-vec Compatibility** — Fixed two sqlite-vec `vec0` virtual table incompatibilities that prevented all vector operations (`rebuild_vector_index`, `add_to_vector_index`, `semantic_search`):
  1. Entry IDs must be `BigInt` through `better-sqlite3` bindings — regular JavaScript `number` values are rejected with `"Only integers are allows for primary key values"`. Fixed by coercing with `BigInt()`, matching the [official sqlite-vec Node.js example](https://github.com/asg017/sqlite-vec/blob/main/examples/simple-node/demo.mjs).
  2. `vec0` virtual tables don't support `INSERT OR REPLACE` conflict resolution — upserts fail with `"UNIQUE constraint failed"`. Changed `addEntry()` to DELETE+INSERT pattern.

- Resolved Zod `4.3.6` dependency resolution conflict with OpenAI SDK via explicit `package.json` overrides.
- Replaced `as unknown` type assertions with strict types where appropriate (`wasm-connection.ts`, `backup.ts`) and auth test mocks with properly mapped `QueryResult` types and `Object.create(Type.prototype)` mock instantiation.
- Resolved native driver (better-sqlite3) `datatype mismatch` and `more than one statement` exceptions by strictly enforcing `IDatabaseConnection`'s `exec` implementation in analytical routes.
- Abstracted `rawDb.exec` within the `relationships` tool group to an integrated adapter `executeRawQuery` to prevent query injection bypasses.
- Secured native snapshot backups by switching from blocked in-memory blob exports to transactional file-system copies with `wal_checkpoint(TRUNCATE)`.
- Fixed empty-array query result assertions across analytics, team, prompts, and resource handlers caused by SQLite native driver mismatching original `sql.js` row-wrapping (`rawDb.exec()`) structures natively by safely standardizing `executeRawQuery` mapping.
- **Code Mode `timeout` Parameter Ignored** — The `timeout` parameter on `mj_execute_code` was parsed by the Zod schema but never forwarded to the sandbox pool. All executions used the default 30s timeout regardless of the user-specified value. Added per-call `timeoutMs` override to `ISandbox`, `ISandboxPool`, and all sandbox/pool implementations (`WorkerSandbox`, `WorkerSandboxPool`, `CodeModeSandbox`, `SandboxPool`). Handler now destructures `timeout` and passes it to `pool.execute()`.

### Security

- **Dependency Updates** — Bumped `undici` to 7.24.1 to address multiple CVEs (CVE-2026-1525, CVE-2026-1528, CVE-2026-2581, CVE-2026-1527, CVE-2026-2229, CVE-2026-1526) causing request smuggling, DoS, and memory exhaustion risks.
- **Built-in Rate Limiting** — Replaced `express-rate-limit` dependency with zero-dependency implementation. Health endpoint bypass, `Retry-After` header on 429, periodic cleanup with `.unref()`.
- **Server Timeouts** — Added HTTP request (120s), keep-alive (65s), and headers (66s) timeouts to mitigate DoS attacks.
- **CORS Enhancements** — `Access-Control-Max-Age: 86400`, `Vary: Origin` for specific origin matching, `corsAllowCredentials` option.
- **Trust Proxy** — `trustProxy` config option for correct `X-Forwarded-For` client IP extraction behind reverse proxies.
- **Max Body Size** — Configurable `maxBodySize` (default: 1MB) to prevent large request body attacks.

### Removed

- **`express-rate-limit` Dependency** — Replaced by built-in rate limiter.

## [5.1.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v5.0.1...v5.1.0) - 2026-03-07

### Added

- **`session-summary` Prompt** — New workflow prompt that creates a session summary journal entry. Fetches recent entries for context and guides the agent to create a `retrospective` entry tagged `session-summary` capturing accomplishments, pending items, and next-session context. Invoked by the user when ready (e.g., `/session-summary`). Replaces the unreliable automatic session-end behavior. Prompt count: 15 → 16.

### Performance

- **`calculateImportance` Query Consolidation** — Merged 3 separate SQL queries (entry data, relationship count, causal count) into a single query with subqueries, reducing SQLite roundtrips 3→1.
- **`linkTagsToEntry` Batch Operations** — Replaced per-tag `INSERT OR IGNORE` + `UPDATE` loop (2N SQL calls) with batched multi-row `INSERT`, `SELECT ... IN (...)`, and `UPDATE ... IN (...)` (4 SQL calls total for any N tags).
- **`createEntry` Redundant Fetch Elimination** — Removed post-INSERT `getEntryById()` re-fetch (full SELECT + tag query). Entry is now constructed directly from input values + `last_insert_rowid()` + `datetime(CURRENT_TIMESTAMP)`.
- **`updateEntry` Pre-check Elimination** — Removed pre-UPDATE `getEntryById()` existence check. Uses `UPDATE ... WHERE deleted_at IS NULL` + `SELECT changes()` to detect missing entries in one SQL call instead of a full SELECT + tag query.
- **SQLite Performance PRAGMAs** — Added `PRAGMA journal_mode = MEMORY`, `synchronous = OFF`, and `temp_store = MEMORY` at initialization. sql.js operates in-memory with manual disk serialization; these eliminate unnecessary internal journal overhead.
- **Composite Covering Index for `getRecentEntries`** — Added `idx_memory_journal_recent` on `(deleted_at, timestamp DESC, id DESC)` to enable index-only scan for the `WHERE deleted_at IS NULL ORDER BY timestamp DESC, id DESC` query pattern.
- **`addEntry` Native Upsert** — Replaced `deleteItem()` + `insertItem()` pattern with vectra's native `upsertItem()`, eliminating a full exception path on every new entry insertion.
- **`getTools` Cached Output** — Extracted shared `ensureToolCache()` for both `getTools` and `callTool`. Unfiltered `getTools` calls now return a cached mapped array instead of rebuilding 42 tool objects and mapping them on every invocation (~4800x faster than tool execution).
- **Lazy Module Loading for Startup** — Deferred `@xenova/transformers` (1.5s) and `vectra` (0.9s) from top-level imports in `VectorSearchManager.ts` to dynamic `import()` inside `initialize()`. These heavyweight modules are now loaded only when vector search is first used, reducing server cold-start by ~1.8s (VectorSearchManager import: 1515ms → 12ms).

### Documentation

- **Test Counts Updated** — Updated the `README.md` and `DOCKER_README.md` test count badges and the testing breakdown table to reflect the combined total of Vitest unit/integration tests and Playwright E2E tests (785 total tests).
- **Performance Benchmark Claims Updated** — Updated benchmark numbers in `README.md` and `DOCKER_README.md` to reflect post-optimization measurements: vector ops >640 ops/sec, `getTools` ~4800x faster than tool execution, `getRecentEntries` ~4x faster via composite index.

### Removed

- **Automatic Session End Behavior** — Removed `## Session End` section from server instructions (`ServerInstructions.ts`, `server-instructions.md`). Agents cannot reliably detect when a thread/session ends. Replaced by the user-invoked `session-summary` prompt.
- **`hooks/` Directory** — Deleted the entire hooks directory (`hooks/cursor/`, `hooks/kiro/`, `hooks/kilo-code/`, `hooks/README.md`). All hook files were session-end related. Session start is handled by server instructions.

### Security

- **Docker Compose Network Isolation (L-1)** — Added custom `mcp-net` bridge network to both services. Prevents MCP containers from accessing or being accessed by unrelated containers on the default Docker bridge.
- **Docker Compose `no-new-privileges` (L-2)** — Added `security_opt: ["no-new-privileges:true"]` to both services. Prevents privilege escalation via `setuid`/`setgid` binaries inside containers.
- **Author Input Sanitization (L-5)** — `resolveAuthor()` and `resolveTeamAuthor()` in `team.ts` and `core.ts` now strip ASCII control characters (`0x00`–`0x1F`, `0x7F`) and cap author strings at 100 characters. Prevents crafted `TEAM_AUTHOR` env or git config values from injecting control characters into the database `author` column or `autoContext` JSON payloads.
- **Consolidated `sanitizeAuthor` (Audit)** — Moved duplicated `sanitizeAuthor()` from `core.ts` and `team.ts` into `security-utils.ts` as a single-source-of-truth export. Eliminates risk of divergent sanitization logic.
- **Docker Compose `cap_drop: ALL` (Audit)** — Added `cap_drop: ALL` to both Docker Compose services, dropping all Linux capabilities (NET_RAW, SYS_CHROOT, etc.) that are unnecessary for a Node.js MCP server.
- **CI Unit Test Gate (Audit)** — Added `npm run test` step to `lint-and-test.yml` workflow so unit tests run on every push/PR, not just lint/typecheck/build.

### Fixed

- **Output schema mismatches causing MCP -32602 errors** — Three `outputSchema` definitions didn't match actual handler output, causing `structuredContent does not match the tool's output schema` errors:
  - `EntryOutputSchema` (schemas.ts) — Added `source` field (`'personal' | 'team'`) for cross-database search results that include a source marker
  - `VectorStatsOutputSchema` (search.ts) — Updated to match `VectorSearchManager.getStats()` return shape (`itemCount`, `modelName`, `dimensions` instead of `entryCount`, `indexSize`)
  - `BackupInfoSchema` (backup.ts) — Added `path` field to match `SqliteAdapter.listBackups()` output
- **`get_statistics` Date Filtering** — `start_date` and `end_date` parameters now filter all statistics queries (total count, type breakdown, period breakdown, decision density). Previously parsed by Zod but ignored by the handler. Returns `dateRange` echo in the response when dates are provided.
- **`get_statistics` Project Breakdown** — `project_breakdown: true` now returns a `projectBreakdown` array with per-project entry counts. Previously parsed but ignored.
- **`export_entries` Filter Bypass** — Handler was calling `db.getRecentEntries(limit)` and ignoring all parsed filter parameters (`start_date`, `end_date`, `entry_types`, `tags`). Now correctly uses `db.searchByDateRange()` for date/tag filters and post-filters by `entry_types`.
- **GitHub Error Consistency** — All GitHub tool error responses (`get_github_issue`, `get_github_pr`, `get_github_context`, `get_repo_insights`, `resolveOwnerRepo`, `resolveOwner`) now include `success: false` field, matching the `{success: false, error}` pattern used by all other tools.
- **`get_vector_index_stats` Missing `success` Field** — Handler now returns `success: true/false` in all response paths for schema consistency.
- **No-Argument Prompts Failing with MCP `-32602`** — Prompts with no arguments (e.g., `session-summary`, `confirm-briefing`, `prepare-standup`) failed when the client called `prompts/get` without `arguments`. The registration code passed an empty `argsSchema: {}` to `registerPrompt`, which the SDK wrapped in `z.object({})` and attempted to validate against `undefined`. Now omits `argsSchema` entirely for argumentless prompts so the SDK skips validation.
- **`get_github_milestone` Error Missing `success: false`** — Error response for non-existent milestones returned `{ error }` without `success` field. Now returns `{ success: false, error }` matching the consistent error shape used by all other tools.
- **`get_kanban_board` Error Missing `success: false`** — Error response for non-existent projects returned `{ error }` without `success` field. Now returns `{ success: false, error }` matching the consistent error shape used by all other tools.
- **`search_by_date_range` Silent Filter Bug** — `issue_number`, `pr_number`, and `workflow_run_id` parameters were accepted by the Zod schema but silently ignored — the handler never passed them to the database query. Now correctly forwards all three filters to `SqliteAdapter.searchByDateRange()`, which applies them as SQL WHERE clauses.

### Improved

- **Zod Boundary Leak Prevention** — Created separate relaxed MCP schemas (without `min`/`max` constraints) for 7 tools so boundary violations reach the handler for structured `{success: false, error}` responses instead of leaking as raw MCP `-32602` error frames. Affected tools: `get_recent_entries`, `create_entry`, `create_entry_minimal`, `search_entries`, `search_by_date_range`, `semantic_search`, `export_entries`, `cleanup_backups`, `visualize_relationships`.
- **Numeric Coercion in MCP Schemas** — Replaced all `z.number()` / `z.coerce.number()` with `relaxedNumber()` (`z.any()`) in relaxed MCP input schemas across 10 tool files. Non-numeric values (e.g., `limit: "abc"`) now pass SDK-level Zod validation and are caught by handler strict schemas as structured `{success: false, error}` responses instead of raw MCP `-32602` errors. New shared helper: `relaxedNumber()` in `schemas.ts`. Added 4 new relaxed schemas: `GetEntryByIdSchemaMcp`, `DeleteEntrySchemaMcp`, `TeamGetRecentSchemaMcp`, `TeamSearchSchemaMcp`.

### Changed

- **CI `publish-npm.yml` Node Version Alignment (L-4)** — Updated Node.js version from 22.x to 24.x to match `engines.node: >=24.0.0` in `package.json` and the Dockerfile base image (`node:24-alpine`).

- **Dependency Updates**
  - `eslint`: 10.0.2 → 10.0.3 (patch)

## [5.0.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v5.0.0...v5.0.1) - 2026-03-06

### Security

- **GHSA-qffp-2rhf-9h96 (tar)** — Manually patched npm's bundled `tar` → `7.5.10` in Dockerfile to fix HIGH severity path traversal vulnerability (CVSS 8.2). Also updated npm override.

### Changed

- **Dependency Updates**
  - `tar` override: 7.5.9 → 7.5.10 (patch) — npm + Docker layers

## [5.0.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.5.0...v5.0.0) - 2026-03-06

### Added

- **Playwright E2E Test Suite** — 8 spec files testing HTTP/SSE transport layer end-to-end with Playwright:
  - `health.spec.ts` — Health endpoint, root info, MCP initialization
  - `protocols.spec.ts` — Streamable HTTP and Legacy SSE protocol error handling
  - `security.spec.ts` — Security headers (6), CORS, HSTS, body size limits, 404 handler
  - `auth.spec.ts` — Bearer token authentication enforcement (separate server with `--auth-token`)
  - `sessions.spec.ts` — Session lifecycle: init → use → terminate → reject stale
  - `tools.spec.ts` — MCP SDK client tool execution via Streamable HTTP (`test_simple`, `create_entry_minimal`, validation errors)
  - `resources.spec.ts` — MCP SDK client resource reads via Streamable HTTP (`memory://health`, `memory://briefing`, etc.)
  - `stateless.spec.ts` — Stateless mode: SSE disabled (405), DELETE no-op (204), no legacy SSE
  - `scheduler.spec.ts` — Scheduler activation verification via `memory://health` resource
  - New `test:e2e` npm script (`playwright test`)
  - New devDependency: `@playwright/test`

### Fixed

- **Legacy SSE transport `start()` redundancy** — `setupLegacySSE` called `sseTransport.start()` after `server.connect()` which already auto-calls `start()`, causing "SSEServerTransport already started!" errors and preventing SDK clients from using Legacy SSE

- **Legacy SSE Transport** — HTTP transport now supports both Streamable HTTP (MCP 2025-03-26) and Legacy SSE (MCP 2024-11-05) protocols simultaneously (stateful mode only)
  - `GET /sse` — Opens Legacy SSE connection for backward-compatible clients
  - `POST /messages?sessionId=<id>` — Routes messages to Legacy SSE transport
  - Cross-protocol guard: SSE session IDs rejected on `/mcp` and vice versa
- **Health Endpoint** — `GET /health` returns `{ status: "healthy", timestamp }` for monitoring and load balancer probes
- **Root Info Endpoint** — `GET /` returns server name, version, description, all available endpoints, and documentation link
- **404 Handler** — Unknown paths now return `404 { error: "Not found" }` instead of Express default HTML
- **`DB_PATH` Environment Variable** — CLI `--db` flag now accepts `DB_PATH` as a fallback (precedence: CLI flag > `DB_PATH` env > `./memory_journal.db`). Enables database path configuration via MCP client env blocks without needing CLI args.
- **Team Collaboration (Redesign)** — Rebuilt team collaboration from scratch with proper architecture:
  - **Separate team database** — `TEAM_DB_PATH` env var / `--team-db` CLI flag for a public, git-tracked `.db` file
  - **Author attribution** — Auto-detected from `TEAM_AUTHOR` env or `git config user.name`
  - **3 dedicated tools** — `team_create_entry`, `team_get_recent`, `team_search` (new `team` tool group)
  - **`share_with_team`** — Optional parameter on `create_entry` to copy entries to team DB
  - **Cross-database search** — `search_entries` and `search_by_date_range` auto-merge team results with `source` marker
  - **2 team resources** — `memory://team/recent` (author-enriched entries), `memory://team/statistics` (author breakdown)
  - **Briefing integration** — `memory://briefing` shows team entry count when team DB configured
  - **Health integration** — `memory://health` includes team database status block
  - **Server instructions** — Team collaboration section + team tool reference at standard+ level
  - **`ICON_TEAM`** — Users group SVG icon for team tools
  - Tool count: 39 → 42, tool groups: 8 → 9, resources: 20 → 22

### Removed

- **Legacy Team Collaboration System** — Removed non-functional team collaboration feature (remnant of Python-era architecture), then rebuilt from scratch (see Added > Team Collaboration)
  - Removed old `share_with_team` parameter, `memory://team/recent` resource, and `ICON_TEAM` constant
  - Deleted unused `.memory-journal-team.db` file
  - Database files reorganized into `data/` directory
- **Database Files Reorganized** — Moved `memory_journal.db` and `backups/` into `data/` directory for cleaner project structure
- **Tool Handler Modularized** — Replaced 3,428-line monolith `src/handlers/tools/index.ts` with 12 focused modules + barrel file (~140 lines):
  - `core.ts` (6), `search.ts` (4), `analytics.ts` (2), `relationships.ts` (2), `export.ts` (1), `admin.ts` (5), `backup.ts` (4)
  - `github/` sub-directory: `read-tools.ts` (5), `mutation-tools.ts` (4), `milestone-tools.ts` (5), `insights-tools.ts` (1), `schemas.ts`
  - Shared Zod output schemas extracted to `schemas.ts` and `github/schemas.ts`
  - Public API (`getTools`, `callTool`) unchanged — zero breaking changes for `McpServer.ts`
- **Types Modularized** — Split `types/index.ts` (652 lines) into `types/filtering.ts`, `types/entities.ts`, `types/github.ts` with barrel re-exports
- **Database Schema Extracted** — Extracted SQL DDL + `CreateEntryInput` from `SqliteAdapter.ts` into `database/schema.ts`
- **Resource Handlers Modularized** — Split `resources/index.ts` (1,692 lines) into 5 sub-modules + barrel (~120 lines):
  - `shared.ts` (types/helpers), `core.ts` (8 resources), `graph.ts` (3), `github.ts` (4), `templates.ts` (6)
- **Prompt Handlers Modularized** — Split `prompts/index.ts` (587 lines) into `workflow.ts` (9 prompts), `github.ts` (6 prompts) + barrel (~95 lines)
- **Mutation Tools Modularized** — Split `mutation-tools.ts` (660 lines) into `helpers.ts`, `kanban-tools.ts` (2 tools), `issue-tools.ts` (2 tools) + barrel
- **Deterministic Error Handling** — All 42 tool handlers wrapped with `try/catch` + `formatHandlerError()` returning `{ success: false, error }` instead of throwing raw MCP errors. Matches the error handling standard from mysql-mcp.
  - New utility: `src/utils/error-helpers.ts` — `formatHandlerError()`, `formatZodError()`
  - `ToolDefinition.handler` return type changed from `Promise<unknown>` to `unknown` (supports both sync and async handlers)
  - GitHub `resolveOwnerRepo()` helpers now return validated `github` instance, eliminating all non-null assertions
- **`Permissions-Policy` Header** — Added `Permissions-Policy: camera=(), microphone=(), geolocation=()` to security headers (6 headers total)
- **`--auth-token` CLI Option** — New `--auth-token <token>` CLI flag and `MCP_AUTH_TOKEN` environment variable for optional bearer token authentication on the HTTP transport. When configured, all endpoints except `GET /health` require `Authorization: Bearer <token>`. Backward compatible — no auth required when not set.

### Security

- **Trigger Name Validation in `migrateSchema()` (H-1)** — Added `SAFE_IDENTIFIER_RE` regex check (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) before interpolating trigger names into DDL during legacy FTS5 trigger cleanup. Prevents potential SQL injection if a legacy database contains a crafted trigger name. Unsafe names are now logged and skipped.
- **Query Limit Caps (M-4)** — All `limit` parameters across tool handlers now enforce `.max(500)` via Zod schema validation, preventing unbounded memory-loading queries. Applied to 10 schemas across `core.ts`, `search.ts`, `team.ts`, `relationships.ts`, and `export.ts`.
- **TruffleHog Pinned to Release Tag (M-2)** — `trufflesecurity/trufflehog@main` → `@v3.93.7` in `secrets-scanning.yml` to eliminate supply-chain risk from floating `@main` tag.
- **Docker Scout Official Action (M-3)** — Replaced `curl | sh` Docker Scout CLI installer with `docker/scout-action@v1.18.2` in `docker-publish.yml`, eliminating supply-chain risk from executing arbitrary remote scripts in CI with elevated permissions.
- **Gitleaks Blocking on Failure (L-4)** — Removed `continue-on-error: true` from Gitleaks step in `secrets-scanning.yml` so detected secret leaks now fail the workflow.
- **HTTP Bearer Token Authentication (F-1)** — Optional bearer token middleware for HTTP transport. Logs a warning when HTTP mode starts without authentication configured.
- **Gitleaks Pinned to Release Tag (F-3)** — `gitleaks/gitleaks-action@v2` → `@v2.3.9` in `secrets-scanning.yml` to eliminate supply-chain risk from floating major version tag.
- **SSE Session Timeout Sweep (F-4)** — Legacy SSE sessions are now tracked in `sessionLastActivity` and expired by the 30-minute idle sweep, matching the behavior of Streamable HTTP sessions. Previously SSE sessions were only cleaned up on client disconnect.
- **`searchByDateRange` Query Limit (F-6)** — Added `LIMIT` clause (default: 500, max: 500) to `searchByDateRange` SQL query to prevent unbounded result sets from broad date ranges. New `limit` parameter on `search_by_date_range` tool.
- **Docker Production-Only Dependencies (I-2)** — Production image now runs `npm ci --omit=dev` instead of copying the full builder `node_modules`. Removes devDependencies (vitest, eslint, typescript, etc.) from the production image, reducing attack surface.
- **CORS `Authorization` Header** — Added `Authorization` to `Access-Control-Allow-Headers` for bearer token authentication support.
- **Timing-Safe Auth Token Comparison (L-1)** — Replaced string `!==` comparison with `crypto.timingSafeEqual()` for bearer token authentication, eliminating a timing side-channel that could theoretically leak token contents character-by-character.
- **HSTS Header for Reverse Proxy (L-2)** — Added conditional `Strict-Transport-Security: max-age=31536000; includeSubDomains` header when `X-Forwarded-Proto: https` is detected, preventing downgrade attacks in TLS-terminating reverse proxy deployments.
- **Docker Compose Auth Token (L-3)** — Added commented `MCP_AUTH_TOKEN` environment variable to the HTTP service in `docker-compose.yml`, making authentication configuration discoverable for production deployments.
- **Shell-Free Git Author Detection (I-1)** — Replaced `execSync('git config user.name')` with `execFileSync('git', ['config', 'user.name'])` in `core.ts` and `team.ts` to avoid implicit shell invocation, reducing the surface for potential command injection if the call site were ever modified.
- **Docker Compose Read-Only Filesystem** — Added `read_only: true` and `tmpfs: /tmp:noexec,nosuid,nodev` to both Docker Compose services. Limits container write surface to the `/app/data` volume and `/tmp` tmpfs, preventing filesystem-based persistence attacks.
- **Docker Compose Generic Token Placeholder** — Replaced `ghp_your_token_here` placeholder with `<your-github-token>` to avoid false positive noise in secret scanners.
- **Docker Compose Explicit `NODE_ENV`** — Added `NODE_ENV=production` to the HTTP service environment block for visibility and to prevent accidental override.
- **CVE-2026-27171 (zlib)** — Explicitly install zlib from Alpine edge in Dockerfile builder and production stages to fix MEDIUM severity denial of service via infinite loop in CRC32 combine functions.
- **Gitleaks `GITHUB_TOKEN`** — Pass `GITHUB_TOKEN` to `gitleaks/gitleaks-action@v2.3.9` in `secrets-scanning.yml` as now required for PR scanning.

### Improved

- **Batch Tag Fetching (N+1 Elimination)** — Multi-row methods (`getRecentEntries`, `getEntriesPage`, `searchEntries`, `searchByDateRange`) now batch-fetch tags in a single `IN (...)` query via `batchGetTagsForEntries()` + `rowsToEntries()`, eliminating the N+1 per-row `getTagsForEntry` pattern. `getRecentEntries(50)` reduced from 51 queries to 2.
- **Batch Tag Linking** — `linkTagsToEntry()` batches tag inserts and lookups: single `INSERT OR IGNORE` for all tags, single `SELECT ... WHERE name IN (...)` for IDs, reducing from 4N to 2+2N SQL statements per entry.
- **Tool Dispatch Cache** — `callTool()` now caches tool definitions in a `Map` for O(1) lookup instead of rebuilding all 42 `ToolDefinition` objects and doing a linear scan on every call. Cache invalidates when context parameters change.
- **Conditional JOIN in `searchByDateRange`** — Tag tables (`entry_tags`, `tags`) are only JOINed when a tag filter is provided, avoiding unnecessary `DISTINCT` and row multiplication for the common no-tag-filter case.
- **Consolidated `getStatistics` Queries** — Reduced from 5 sequential `db.exec()` calls to 3 using multi-statement `exec()`: combined total+type counts, period+density via `SUM(CASE ...)`, and relationship+causal counts.
- **Simplified `rebuildIndex` Cleanup** — Removed redundant orphan detection pass that preceded a delete-all pass. Now performs a single delete-all before re-indexing.
- **Dual-Schema Validation for Structured Errors** — All tools now use a dual-schema pattern to ensure Zod validation errors produce structured `{ success: false, error }` responses instead of raw MCP `-32602` error frames. Relaxed schemas (`z.string()`) are passed to the SDK's `inputSchema` for type-level validation, while strict schemas (`z.enum()`, `z.string().regex()`) are used inside handlers via `.parse()` with `formatHandlerError()` catch. Applied across 8 tool files covering 13 enum fields and 8 date regex fields: `core.ts`, `search.ts`, `export.ts`, `analytics.ts`, `admin.ts`, `relationships.ts`, `github/read-tools.ts`, `github/milestone-tools.ts`.

### Fixed

- **Entry Type Enum Completeness** — Added 6 missing entry types to the `EntryType` union and `ENTRY_TYPES` Zod enum: `technical_note`, `development_note`, `enhancement`, `milestone`, `system_integration_test`, `test_entry`. These types existed in the database (from prior usage) but were rejected by input validation, preventing creation of entries with these types. Updated `server-instructions.md` Entry Types section accordingly.

- **`get_github_milestones` State Filter** — Fixed `state: "all"` parameter being converted to `undefined` before passing to the GitHub REST API, causing the API to default to `"open"` and silently exclude closed milestones. The GitHub REST API natively supports `"all"` as a valid state value; the conversion was unnecessary.

- **Legacy Database Schema Migration** — Added `migrateSchema()` to `SqliteAdapter.initialize()` that checks for missing columns via `PRAGMA table_info` and adds them with `ALTER TABLE`. `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables, so columns added after initial creation (e.g., `significance_type`, `auto_context`, `deleted_at`, GitHub fields) were never added to databases created before those columns existed. Also drops legacy FTS5 triggers from the Python era that cause `no such module: fts5` on INSERT/UPDATE/DELETE (sql.js WASM does not include FTS5; the TypeScript codebase uses LIKE queries).
- **`list_tags` Null Usage Count** — Fixed `list_tags` output schema validation failure (`expected number, received null`) on databases with corrupted `usage_count` values. `listTags()` query now uses `COALESCE(usage_count, 0)` and `TagOutputSchema.count` is `z.number().nullable()`. Also added data repair in `migrateSchema()` to fix null `usage_count` values in the `tags` table.
- **Output Schema Validation for Error Responses** — All tool output schemas now accept error responses (`{ success: false, error: "..." }`) from `formatHandlerError()`. Previously, schemas with required success-path fields (e.g., `entries`, `count`, `relationship`, `entry`) rejected error responses with output validation `-32602` errors. Made success-path fields optional and added `success`/`error` fields across 9 schema files: `schemas.ts`, `core.ts`, `search.ts`, `export.ts`, `analytics.ts`, `admin.ts`, `relationships.ts`, `github/schemas.ts`.
- **Multi-Session Connect Crash** — Fixed `Already connected to a transport` error when creating 2+ concurrent Streamable HTTP sessions
  - SDK's `McpServer.connect()` only supports one active transport; second `connect()` threw
  - Added close-before-reconnect pattern wrapping `server.connect()` in try-catch
- **Backup Tool Error Path Output Schema** — Backup tool error responses from `formatHandlerError()` (returning `{ success: false, error }`) now pass Zod output validation. Previously, `BackupResultOutputSchema`, `BackupsListOutputSchema`, `RestoreResultOutputSchema`, and `CleanupBackupsOutputSchema` required non-optional fields (`message`, `filename`, `path`, `sizeBytes`, etc.) that error responses don't include, causing raw MCP `-32602` errors on error paths like path traversal in backup names.
- **Vector Benchmark `beforeAll` Timeout** — Added `benchmark.hookTimeout: 30000` to `vitest.config.ts` to accommodate transformer model loading in benchmark `beforeAll` hooks.
- **Mermaid Arrow Inconsistency for `caused`** — Fixed `memory://graph/recent` using `-.->` (two-dot Mermaid syntax) for `caused` relationship type instead of `-.->` (single-dot), which is the canonical style used by `visualize_relationships` tool. Both now consistently use `-.->`.

### Changed

- **HTTP Transport Modularized** — Extracted HTTP transport code from `McpServer.ts` (813 → ~450 lines) into a dedicated `src/transports/http.ts` module with `HttpTransport` class, matching the architecture of mysql-mcp, postgres-mcp, and db-mcp

- **Dependency Updates**
  - `@types/node`: 25.3.3 → 25.3.5 (patch)
  - `express-rate-limit`: 8.2.1 → 8.3.0 (minor)
  - `sql.js`: 1.14.0 → 1.14.1 (patch)

### CI/CD

- **CodeQL Default Setup Disabled** — Disabled GitHub's CodeQL "Default Setup" to resolve persistent "Error when processing the SARIF file" warning. Both the Default Setup and the custom `codeql.yml` workflow were uploading SARIF results for `javascript-typescript`, causing a conflict during ingestion. The custom workflow is now the sole CodeQL scanner.
- **CodeQL `actions` Language Coverage** — Added `actions` to the CodeQL workflow language matrix to replace coverage previously provided by the Default Setup. The workflow now scans both `javascript-typescript` and `actions`.
- **Trivy Action Update** — Updated `aquasecurity/trivy-action` 0.34.0 → 0.34.1 in `security-update.yml` (bundles Trivy scanner 0.69.2)

## [4.5.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.4.2...v4.5.0) - 2026-03-02

### Fixed

- **Session Start briefing in Cursor** — Added Cursor-specific `FetchMcpResource` server name (`user-memory-journal-mcp`) to the Session Start instructions. Cursor prefixes MCP server names with `user-`, so agents using the generic name would get "Server not found" errors when fetching `memory://briefing`.
- **`deleteOldBackups` Test Isolation** — Fixed flaky `should delete old backups keeping only keepCount` test by cleaning up pre-existing backups before creating test backups. Previously, leftover backups from other tests caused the assertion to fail non-deterministically.
- **`deleteOldBackups` NaN Guard** — `keepCount` parameter now rejects `NaN` values. Previously, `NaN < 1` evaluated to `false`, bypassing the guard. With `NaN`, `backups.slice(0, NaN)` returns an empty array and `backups.slice(NaN)` returns all backups, causing every backup to be deleted.
- **`restoreFromFile` Foreign Key Enforcement** — `PRAGMA foreign_keys = ON` is now applied after restoring a database from backup. Previously, `restoreFromFile()` bypassed `initialize()`, so `ON DELETE CASCADE` constraints in `entry_tags`, `relationships`, and `embeddings` tables were silently unenforced for the rest of the server's lifetime.

### Improved

- **Test Coverage → 92%** — Expanded test suite from 549 → 590 tests, raising line coverage from 88.59% → 92.06%. Key areas covered:
  - SIGINT shutdown handlers for stdio, stateless HTTP, and stateful HTTP transports
  - Prompt handlers with proper arguments (`analyze-period`, `find-related`, `goal-tracker`, `get-context-bundle`, `prepare-retro`)
  - `SqliteAdapter` backup edge cases (missing backups dir, invalid keepCount, missing backup file)
  - `create_github_milestone` no-GitHub integration error path
  - Kanban diagram resource no-GitHub fallback

### Added

- **Automated Scheduler (HTTP/SSE only)** — New in-process scheduler runs periodic maintenance jobs for long-running HTTP/SSE server processes. Configured via CLI flags:
  - `--backup-interval <minutes>` — Automated backup interval (0 = disabled, default: 0). Backups are created with `exportToFile()` and old backups cleaned up automatically.
  - `--keep-backups <count>` — Max backups to retain during automated cleanup (default: 5).
  - `--vacuum-interval <minutes>` — Database optimize interval (0 = disabled, default: 0). Runs `PRAGMA optimize` and flushes the database to disk.
  - `--rebuild-index-interval <minutes>` — Vector index rebuild interval (0 = disabled, default: 0). Full vector index rebuild from all entries.
  - Scheduler status is reported in the `memory://health` resource under the `scheduler` field.
  - Stdio transport ignores scheduler options with a warning log — use OS-level scheduling for stdio.
  - Each job is error-isolated: failures are logged but don't affect other scheduled jobs.
  - New module: `src/server/Scheduler.ts` — clean separation from `McpServer.ts`.

### Changed

- **Dependency Updates**
  - `@types/node`: 25.3.2 → 25.3.3 (patch)
  - `globals`: 17.3.0 → 17.4.0 (minor)
  - `minimatch` override: 10.2.3 → 10.2.4 (patch) — npm + Docker layers
  - `tar` override: 7.5.8 → 7.5.9 (patch) — npm + Docker layers

### Security

- **Wire Dead-Code Security Utilities (F-001)** — `sanitizeSearchQuery()` and `assertNoPathTraversal()` from `security-utils.ts` were defined but never imported or called. Now wired into active code paths:
  - `SqliteAdapter.searchEntries()` applies `sanitizeSearchQuery()` to LIKE patterns with `ESCAPE '\\\\'` clause, preventing wildcard injection (F-002)
  - `SqliteAdapter.restoreFromFile()` uses `assertNoPathTraversal()` instead of inline checks, throwing `PathTraversalError`
- **HTTP Security Headers (F-003)** — Added three additional security headers to HTTP transport middleware:
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` — prevents XSS and framing
  - `Cache-Control: no-store` — prevents caching of sensitive journal data
  - `Referrer-Policy: no-referrer` — prevents referrer leakage
- **PRAGMA foreign_keys = ON (F-005)** — SQLite foreign key enforcement now enabled on database initialization. `ON DELETE CASCADE` constraints in `entry_tags`, `relationships`, and `embeddings` tables are now enforced at the database level.
- **CORS Wildcard Warning (F-006)** — Server now logs a warning when HTTP transport CORS origin is `*` (the default), advising operators to set `--cors-origin` or `MCP_CORS_ORIGIN` for production deployments.
- **Constrain `entry_type` / `significance_type` to Enums** — `entry_type` now validated against 19 allowed values and `significance_type` against 7 allowed values via Zod enums. Previously accepted arbitrary strings; invalid types now rejected at schema validation. Removes unsafe `as EntryType` / `as SignificanceType` casts.
- **Date Format Validation** — All date string fields (`start_date`, `end_date`) across `SearchByDateRangeSchema`, `GetStatisticsSchema`, `ExportEntriesSchema`, and `CrossProjectInsightsSchema` now validate `YYYY-MM-DD` format via regex. Prevents malformed dates from reaching the database layer.
- **HTTP Rate Limiting** — Added `express-rate-limit` middleware for HTTP transport (100 requests/minute per IP). Returns `429 Too Many Requests` on excess. Only applies to HTTP mode; stdio transport unaffected.
- **Remove Dead SQL Injection Detection Code** — Removed `containsSqlInjection()`, `assertNoSqlInjection()`, `SqlInjectionError`, and `SQL_INJECTION_PATTERNS` from `security-utils.ts`. These regex-based detection functions were never called anywhere and provided a false sense of security. Parameterized queries (used consistently throughout) are the actual defense.
- **`exportToFile()` Path Traversal Protection** — Added `assertNoPathTraversal()` check to backup export, matching the pattern already used in `restoreFromFile()`. Rejects malicious backup names containing `/`, `\\`, or `..`.
- **`getRawDb()` Safety Documentation** — Added `@internal` JSDoc tag warning callers to use parameterized queries when accessing the raw database handle.
- **Logger `LOG_LEVEL` Validation (L1)** — `LOG_LEVEL` environment variable is now validated against known levels (`debug`, `info`, `notice`, `warning`, `error`, `critical`). Invalid values fall back to `info` instead of silently setting `minLevel` to `undefined`, which would disable all logging.
- **Logger `setLevel()` Guard (L2)** — `Logger.setLevel()` now validates the level parameter before applying, preventing invalid values from disabling logging.
- **CI `security-scan` Node Version Alignment (L3)** — Updated Node.js version in `security-scan` job from 22.x to 24.x to match `engines.node: >=24.0.0`.
- **CI Trivy SARIF Upload Guard** — `security-update.yml` upload-sarif step now checks that `trivy-results.sarif` exists before attempting upload. Previously, `if: always()` caused the step to fail when the Docker build failed upstream and no SARIF file was produced.

### Documentation

- **Cursor Rule for Session Management** — Added `hooks/cursor/memory-journal.mdc`, an `alwaysApply` Cursor rule that instructs agents to read `memory://briefing` at session start and create a retrospective summary at session end. This is the most reliable mechanism for session behavior in Cursor, replacing the previous reliance on MCP server instructions alone.
- **Fixed Cursor sessionEnd Hook Format** — Rewrote `hooks/cursor/hooks.json` from a non-standard format to Cursor's documented `version: 1` schema. Added companion `hooks/cursor/session-end.sh` audit script. Corrected documentation: Cursor's `sessionEnd` hook is fire-and-forget (cannot inject messages); session summary creation is handled by the Cursor rule and server instructions.
- **Revised hooks/README.md** — Rewritten to accurately describe progressive enhancement: Cursor rule (primary) > server instructions (fallback) > hooks (audit only). Removed incorrect claim that Cursor `sessionEnd` does message injection. Added rule setup as Step 1 for Cursor users.
- **Updated Session Management in README.md and DOCKER_README.md** — Session Management sections now lead with the Cursor rule as the primary setup mechanism, with a three-column table showing primary (agent behavior) vs optional (audit/logging) configurations per IDE.
- **SECURITY.md Accuracy (F-004)** — Rewrote Database Security section to accurately reflect sql.js in-memory architecture. Removed false claims about WAL mode and 7 PRAGMAs that are not applicable to sql.js. Updated security checklist to reference actual function names (`assertNoPathTraversal`, `sanitizeSearchQuery`, `validateDateFormatPattern`). Updated HTTP security headers list to include CSP, Cache-Control, and Referrer-Policy.
- **SECURITY.md Tag Filtering Correction** — Replaced inaccurate claim that dangerous characters are blocked in tags with accurate statement that tags are safely handled via parameterized queries.
- **Team Collaboration in READMEs** — Added team collaboration feature to Key Benefits in both `README.md` and `DOCKER_README.md`.
- **Wiki Security Page Updates** — Added LIKE pattern sanitization, path traversal protection, HTTP security headers, rate limiting, and team database security note to the wiki Security.md page. Expanded self-audit checklist from 10 to 16 items.
- **Rate Limiting Documentation** — Added rate limiting mention to README.md Security section.

### Fixed

- **Path Traversal Test Assertion** — Updated `sql-injection.test.ts` to assert `PathTraversalError` type instead of old inline error message string, matching refactored `assertNoPathTraversal()` usage.
- **Tool Handler Test Fix** — Updated `tool-handlers.test.ts` to use valid entry_type enum value (`project_decision` instead of `decision`), matching the new enum constraint.
- **`share_with_team` Not Setting `isPersonal`** — `create_entry` with `share_with_team: true` now correctly sets `isPersonal: false`, making the entry visible in team-scoped resources like `memory://team/recent`. Previously, the `share_with_team` parameter was parsed but never applied to the `isPersonal` field.

### Removed

- **Unused `cors` Dependency** — Removed `cors` and `@types/cors` packages. CORS is handled by custom middleware in `McpServer.ts`.

## [4.4.2](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.4.0...v4.4.2) - 2026-02-27

### Security

- **CVE-2026-27903 + CVE-2026-27904 (minimatch)** — Manually patched npm's bundled `minimatch` → `10.2.3` in Dockerfile to fix HIGH severity ReDoS and algorithmic complexity vulnerabilities (CVSS 7.5). The v4.4.1 npm override only affected project dependencies; Docker Scout detected the vulnerable copy inside npm's own bundled packages. Also added npm override.

## [4.4.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.3.1...v4.4.0) - 2026-02-27

### Added

- **Performance Benchmarking Suite** — Added a `vitest bench` powered benchmarking suite to measure baseline performance for database operations, vector indexing, and tool execution overhead. Included new `"bench"` npm script.

- **GitHub Milestones Integration** — Full CRUD support for GitHub Milestones
  - 5 new tools: `get_github_milestones`, `get_github_milestone`, `create_github_milestone`, `update_github_milestone`, `delete_github_milestone` (39 total tools)
  - 2 new resources: `memory://github/milestones` (list view) and `memory://milestones/{number}` (detail view) (20 total resources)
  - Session briefing (`memory://briefing`) now includes milestone progress in the user message table
  - GitHub status resource (`memory://github/status`) now includes milestone summary data
  - `create_github_issue_with_entry` now accepts optional `milestone_number` parameter to assign issues to milestones
  - `get_github_issues` and issue resources now include milestone association data
  - New `ICON_MILESTONE` flag icon for milestone tools and resources
  - Milestone tools reference added to `ServerInstructions.ts` for agent guidance
- **Server Host Bind Parameter** — New `--server-host` CLI option and `MCP_HOST` environment variable for configuring HTTP transport bind address
  - Defaults to `localhost`; set to `0.0.0.0` for container deployments
  - Also reads `HOST` environment variable as fallback
  - CLI flag takes precedence over environment variables

- **Repository Insights/Traffic Tool** — New `get_repo_insights` tool and `memory://github/insights` resource for monitoring repository health
  - 1 new tool: `get_repo_insights` (39 total tools, github group: 14 → 15)
  - 1 new resource: `memory://github/insights` — compact summary of stars, forks, and 14-day traffic totals (~150 tokens)
  - **Token-efficient sections parameter**: `stars` (~50 tokens), `traffic` (~100), `referrers` (~100), `paths` (~100), or `all` (~350)
  - Surfaces stars, forks, watchers, clone/view aggregates (14-day rolling), top referrer sources, and popular repository pages
  - Uses extended 10-minute cache TTL (vs 5-minute for other GitHub data) since traffic data changes slowly
  - 4 new `GitHubIntegration` methods: `getRepoStats()`, `getTrafficData()`, `getTopReferrers()`, `getPopularPaths()`
  - New types: `RepoStats`, `TrafficData`, `TrafficReferrer`, `PopularPath`
  - Requires push access to repository for traffic endpoints

### Changed

- **Dependency Updates**
  - `@eslint/js`: 9.39.2 → 10.0.1 (major)
  - `@modelcontextprotocol/sdk`: 1.26.0 → 1.27.1 (minor)
  - `@types/node`: 25.2.0 → 25.3.2 (minor)
  - `eslint`: 9.39.2 → 10.0.2 (major)
  - `simple-git`: 3.28.0 → 3.32.3 (minor)
  - `sql.js`: 1.12.0 → 1.14.0 (minor)
  - `typescript-eslint`: 8.54.0 → 8.56.1 (minor)
  - `axios` override: 1.13.2 → 1.13.5 (patch) — fixes GHSA-43fc-jf86-j433 (DoS via `__proto__` key in `parseConfig`)

### Documentation

- **Server Instructions Fixes** — Added missing Kanban optional `owner` parameters and the four new Phase 6 GitHub template resources to `ServerInstructions.ts`'s Key Resources table to ensure agents have complete tool/resource context.
- **Testing Prompt Polish** — Fixed minor typos and phase numbering inconsistencies in the comprehensive verification plan (`test-memory-journal-mcp.md`).
- **AntiGravity IDE Guidance** — Added explicit note in README.md and DOCKER_README.md that AntiGravity does not currently support MCP server instructions, with workaround to manually provide `ServerInstructions.ts` contents
- **`memory://milestones/{N}` Behavior Clarified** — Updated `test-memory-journal-mcp.md` to accurately document that this resource is designed to return milestone metadata + issue counts + `completionPercentage` + a `hint` to use `get_github_issues` for individual issue details (not full issue arrays)

### Improved

- **`get_entry_by_id` Importance Scoring Breakdown** — Tool now returns `importanceBreakdown` alongside the `importance` score, showing weighted component contributions: `significance` (30%), `relationships` (35%), `causal` (20%), `recency` (15%). Gives agents transparency into _why_ an entry scored a given importance level.
- **`get_cross_project_insights` Inactive Threshold Visibility** — Tool output now includes `inactiveThresholdDays: 7` field, making the hardcoded inactive project classification criteria self-documenting. Previously, consumers saw an empty `inactive_projects` array with no way to know the cutoff.
- **Database I/O — Debounced Save** — Mutation methods (`createEntry`, `updateEntry`, `deleteEntry`, `linkEntries`, `mergeTags`) now use a 500ms debounced `scheduleSave()` instead of synchronous `save()` on every call, batching rapid writes into a single disk flush. `close()` and `restoreFromFile()` still flush immediately for data safety.
- **Vector Index Rebuild — Paginated Fetching** — `rebuildIndex()` now uses `getEntriesPage(offset, limit)` with `REBUILD_PAGE_SIZE=200` instead of loading all entries at once via `getRecentEntries(10000)`, reducing peak memory usage for large journals.
- **Vector Index Rebuild — Parallel Batch Embedding** — Entries are embedded in parallel batches of 5 (`REBUILD_BATCH_SIZE`) via `Promise.all` instead of sequentially, improving rebuild throughput.
- **Vector Index Rebuild — Sequential Insertion** — Embeddings are generated in parallel batches for throughput, but vectra insertions are sequential to avoid file I/O race conditions. Index is pre-cleaned in bulk to eliminate per-item upsert deletes.
- **Server Startup — `getTools()` Deduplication** — Eliminated a duplicate `getTools()` call during server startup; tool names for instruction generation are now extracted from the same array used for registration, saving one full tool-construction pass.
- **GitHub API — TTL Response Cache** — Read methods (`getIssues`, `getIssue`, `getPullRequests`, `getPullRequest`, `getWorkflowRuns`, `getRepoContext`, `getMilestones`, `getMilestone`) now cache responses for 5 minutes. Mutation methods (`createIssue`, `closeIssue`, `createMilestone`, `updateMilestone`, `deleteMilestone`, `moveProjectItem`, `addProjectItem`) automatically invalidate related caches. Public `clearCache()` method available for manual invalidation.

### Fixed

- **`memory://instructions` Active Tool Count** — Fixed resource returning `Active Tools (3)` instead of `Active Tools (N)` when no tool filter is configured. The handler incorrectly fell back to a hardcoded 3-tool set (`create_entry`, `search_entries`, `get_recent_entries`) when `filterConfig` is `null`. Now correctly uses `getAllToolNames()` so the count reflects all enabled tools (e.g., `Active Tools (39)`). Added regression test to `resource-handlers.test.ts`.

- **`get_github_issue` Missing Milestone Field** — `getIssue()` in `GitHubIntegration.ts` now maps `issue.milestone` from the GitHub API response into the returned `IssueDetails` object. Previously the field was silently excluded, so `get_github_issue` and other callers never reflected milestone assignment even when the issue had one.
- **`ServerInstructions.ts` Entry Types Corrected** — Updated `## Entry Types` reference list from 7 stale v4-era types (`technical_note`, `progress_update`, `deployment`, etc.) to the full 13 types in the `EntryType` union (`personal_reflection`, `project_decision`, `technical_achievement`, `bug_fix`, `feature_implementation`, `code_review`, `meeting_notes`, `learning`, `research`, `planning`, `retrospective`, `standup`, `other`). The most impactful addition is `planning`, which is the type auto-assigned by `create_github_issue_with_entry` and `close_github_issue_with_entry`. Updated the corresponding test in `server-instructions.test.ts`.
- **`memory://milestones/{N}` Description Clarified** — Updated resource description to accurately state it returns milestone metadata + issue counts (`openIssues`, `closedIssues`) rather than full issue arrays. Added a `hint` field to the response directing users to the `get_github_issues` tool for individual issue details.
- **Docker Hub Short Description** — Corrected "HTTPS" → "HTTP/SSE" and formatting in `docker-publish.yml` short-description field
- **`delete_entry` Permanent Delete of Soft-Deleted Entries** — `delete_entry(id, permanent: true)` now works on previously soft-deleted entries. Added `getEntryByIdIncludeDeleted()` so permanent deletion can find entries regardless of soft-delete state. Previously returned `{ success: false, error: "Entry not found" }` for soft-deleted entries.
- **`list_tags` Zero-Count Tag Filtering** — `list_tags` tool and `memory://tags` resource no longer return orphan tags with zero usage count, reducing clutter from deleted or merged tags
- **`delete_entry` Existence Check (P154)** — Tool now pre-checks entry existence before mutation, returning `{ success: false, error: "Entry X not found" }` for nonexistent entries instead of always returning `success: true`
- **`link_entries` Existence Check (P154)** — Tool now pre-checks both source and target entry existence before creating relationship, returning `{ success: false, message: "Source/Target entry X not found" }` instead of silently creating orphan relationships
- **`visualize_relationships` Existence Disambiguation (P154)** — When `entry_id` parameter specifies a nonexistent entry, tool now returns `{ message: "Entry X not found" }` instead of the ambiguous `"No entries found with relationships matching your criteria"`
- **`memory://health` Tool Count** — Health resource now dynamically computes tool count from `TOOL_GROUPS` instead of a hardcoded value. Previously reported 33 tools; now correctly reports 38 after milestone tools were added.
- **`memory://significant` Importance Sort Correctness** — Fixed resource returning entries sorted by timestamp instead of importance when the database has more than 20 significant entries. Previously, `LIMIT 20` was applied in SQL (`ORDER BY timestamp DESC LIMIT 20`) before the JavaScript importance sort, meaning older but higher-importance entries were excluded before sorting ran. Now all significant entries are fetched, sorted by `importance` descending in JavaScript, then the top 20 are returned. Added regression test verifying sort order across entries with different relationship counts.

- **`delete_github_milestone` Structured Error** — Tool now returns `{ success: false, milestoneNumber, message, error }` matching `DeleteMilestoneOutputSchema` when deletion fails. Previously returned only `{ error }` without structured fields.
- **`JournalEntry` GitHub Metadata** — Entry output now includes 10 GitHub integration fields (`issueNumber`, `issueUrl`, `prNumber`, `prUrl`, `prStatus`, `projectNumber`, `projectOwner`, `workflowRunId`, `workflowName`, `workflowStatus`) in all tool responses. Previously stored in DB but omitted from `create_entry`, `get_entry_by_id`, `get_recent_entries`, and search results.

### CI/CD

- **Removed Dependabot Auto-Merge Workflow** — Deleted `dependabot-auto-merge.yml`; dependency PRs now require manual review and merge
- **Trivy Action Update** — Updated `aquasecurity/trivy-action` 0.33.1 → 0.34.0 in `security-update.yml` (bundles Trivy scanner 0.69.1)
- **CI Test Matrix Alignment** — Updated Node.js test matrix from `[20.x, 22.x, 25.x]` to `[24.x, 25.x]` to match `engines.node: >=24.0.0`
- **Blocking npm audit** — Removed `continue-on-error: true` from `npm audit` step in lint-and-test.yml; known vulnerabilities now fail the pipeline
- **Blocking Secret Scanning** — Removed `continue-on-error: true` from TruffleHog step in secrets-scanning.yml; verified secret leaks now fail the pipeline

### Security

- **GHSA-w7fw-mjwx-w883 (qs)** — Updated `qs` 6.14.1 → 6.14.2 to fix low-severity arrayLimit bypass in comma parsing that allows denial of service
- **CVE-2026-26960 (tar)** — Manually patched npm's bundled `tar` → `7.5.8` in Dockerfile to fix HIGH severity path traversal vulnerability (CVSS 7.1). Also updated npm override.
- **HTTP Transport Hardening** — Comprehensive security improvements for HTTP mode:
  - **Configurable CORS** — New `--cors-origin` CLI flag and `MCP_CORS_ORIGIN` env var (default: `*`). Previously hardcoded `Access-Control-Allow-Origin: *`.
  - **Request Body Size Limit** — Added 1MB limit to `express.json()` to prevent memory exhaustion DoS attacks
  - **Security Headers** — Added `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` on all HTTP responses
  - **Session Timeout** — Stateful HTTP sessions now expire after 30 minutes of inactivity (5-minute sweep interval). Prevents unbounded memory growth from abandoned sessions.
- **Error Log Token Scrubbing** — Logger now automatically sanitizes `error` context fields to redact GitHub tokens (classic `ghp_`, fine-grained `github_pat_`), Bearer tokens, and Authorization headers before writing to stderr. New `sanitizeErrorForLogging()` in `security-utils.ts`.
- **SECURITY.md Rewrite** — Complete rewrite for TypeScript era. Removed all outdated Python references. Added documentation for HTTP transport security (CORS, headers, session timeout, body limits), GitHub token handling, and CI/CD security pipeline.
- **docker-compose.yml Rewrite** — Replaced Python-era configuration with TypeScript commands. Removed SSH/gitconfig root mounts, deprecated `version` key, and `PYTHONPATH`. Added HTTP transport service with resource limits and secure volume mount options.
- **Dockerfile Version Label** — Updated hardcoded `4.0.0` → `4.3.1` to match actual package version
- **Dockerfile Healthcheck** — Replaced no-op `console.log` healthcheck with `process.exit(0)` validation. Added documentation for HTTP-mode override using `curl`.
- **Legacy Cleanup** — Removed leftover Python `__pycache__` directories from `src/` subtree

## [4.3.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.3.0...v4.3.1) - 2026-02-05

### Changed

- **Dependency Updates**
  - `@modelcontextprotocol/sdk`: 1.25.3 → 1.26.0 (minor)
  - `@types/node`: 25.0.10 → 25.2.0 (minor)
  - `commander`: 14.0.2 → 14.0.3 (patch)
  - `globals`: 17.1.0 → 17.3.0 (minor)

### Fixed

- **`get_cross_project_insights` Output Schema Validation** — Fixed empty result case returning incomplete object
  - When no projects met minimum entry threshold, handler returned only `message` and `projects`
  - Now returns all required fields: `project_count`, `total_entries`, `inactive_projects`, `time_distribution`
  - Fixes MCP outputSchema validation error when tool returns empty results

### Security

- **CVE-2026-24515 (libexpat)** — Explicit libexpat install from Alpine edge fixes CRITICAL severity null pointer dereference vulnerability.
- **CVE-2026-25210 (libexpat)** — Same patch fixes MEDIUM severity integer overflow information disclosure/data integrity issue.
- **CVE-2026-23950 + CVE-2026-24842 (tar)** — Manually patched npm's bundled `tar` → `7.5.7` in Dockerfile to fix HIGH severity vulnerabilities (path traversal, CVSS 8.2). Also added npm override for project dependencies.

## [4.3.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.2.0...v4.3.0) - 2026-01-18

### Added

- **Causal Relationship Types** — 3 new relationship types for decision tracing and failure analysis
  - `blocked_by`: Entry was blocked by another (e.g., blocker → resolution)
  - `resolved`: Entry resolved/fixed an issue from another
  - `caused`: Entry caused or led to another outcome
  - Distinct Mermaid arrow styles: `--x` for blocked_by, `==>` for resolved, `-.->` for caused
  - Updated Field Notes with guidance on when to use causal types

- **Enhanced Analytics** — `get_statistics` now returns 4 additional metrics for deeper insights
  - `decisionDensity`: Significant entries per period (entries with `significanceType`)
  - `relationshipComplexity`: Total relationships / total entries average
  - `activityTrend`: Period-over-period growth percentage
  - `causalMetrics`: Counts for `blocked_by`, `resolved`, `caused` relationships

- **Significance Gradients** — Computed `importance` scores (0.0-1.0) for entries
  - Formula weights: significance type (30%), relationship count (35%), causal relationships (20%), recency (15%)
  - `get_entry_by_id` now returns `importance` field
  - `memory://significant` resource sorts entries by importance (highest first)

### Fixed

- **Docker Workflow Duplicate Builds** — Removed `push: tags: ['v*']` trigger that caused duplicate image sets when releasing versions
  - Docker builds now only trigger via `workflow_run` after "Lint and Test" passes
  - Version tags still applied based on `package.json` version
  - Removed obsolete `preflight-check` job

### Improved

- **`memory://significant` Secondary Sort** — Entries with equal importance scores are now sorted by timestamp (newest first)
  - Previously, entries with identical importance could appear in non-deterministic order
  - Secondary sort ensures consistent, chronological ordering for ties
- **`create_entry` Auto-populates `issueUrl`** — When creating an entry with `issue_number` but no `issueUrl`, the URL is now auto-constructed from cached repository info
  - Requires GitHub integration and prior `getRepoInfo()` call (happens naturally during briefing)
  - Eliminates need to manually provide `issueUrl` when linking to issues
- **Harmonized Graph Arrow Styles** — `memory://graph/recent` now uses the same arrow mappings as `visualize_relationships` tool
  - Added causal relationship types: `blocked_by` (--x), `resolved` (==>), `caused` (-.->)
  - Added missing types: `clarifies` (-.->) and `response_to` (<-->)
  - Standardized `implements` to use `==>` (was `-.->`) for consistency

## [4.2.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.1.0...v4.2.0) - 2026-01-17

### Added

- **HTTP/SSE Transport** — Run the server in HTTP mode for remote access and web-based clients
  - New `--transport http --port 3000` CLI options
  - `POST /mcp` — JSON-RPC requests (initialize, tools/call, resources/read, etc.)
  - `GET /mcp` — SSE stream for server-to-client notifications (supports resumability via `Last-Event-ID`)
  - `DELETE /mcp` — Session termination
  - **Stateful mode** (default): Session management via `mcp-session-id` header
  - **Stateless mode** (`--stateless`): No session management, ideal for serverless deployments
    - Trade-off: Progress notifications and SSE streaming unavailable in stateless mode
  - Uses MCP SDK's `StreamableHTTPServerTransport` with Express
  - New dependencies: `express@^5.1.0`, `@types/express` (devDependency)
- **New Tool: `cleanup_backups`** — Automatic backup rotation to prune old backups
  - `keep_count` parameter specifies how many recent backups to retain (default: 5)
  - Returns list of deleted filenames and count of kept backups
  - Added to `backup` tool group in ToolFilter
- **New Tool: `merge_tags`** — Tag normalization for consolidating similar tags
  - Merge duplicate/similar tags (e.g., `phase-2` → `phase2`)
  - Source tag is deleted after merge; target tag created if not exists
  - Updates all entry-tag links and usage counts
  - Added to `admin` tool group in ToolFilter
- **Tool Count**: 31 → 33 tools (backup: 3 → 4, admin: 4 → 5)

### Improved

- **`semantic_search` Hint Enhancement** — Improved feedback when no results found
  - Hint now includes the current `similarity_threshold` value (e.g., "0.3")
  - Suggests lowering threshold (e.g., "Try 0.2 for broader matches.")
  - Helps users understand why queries return empty and how to adjust
- **`restore_backup` Enhanced Warning** — Improved feedback about reverted changes
  - Warning message now explicitly mentions tag merges, new entries, and relationships are reverted
  - New `revertedChanges` field in output with specific details about reverted data
  - `tagMerges` message now clarifies: "Previously merged tags will reappear as separate tags."
  - Added Field Note in `memory://instructions` documenting restore behavior
- **`memory://prs/{pr_number}/timeline` Enhancement** — Live PR metadata from GitHub API
  - New `prMetadata` field with title, state, draft, mergedAt, closedAt, author, headBranch, baseBranch
  - New `timelineNote` field with human-readable PR status (e.g., "PR #67 is merged (merged)")
  - Differentiates timeline from simpler `memory://prs/{pr_number}/entries` resource

### Documentation

- **`memory://tags` vs `list_tags` Schema** — Documented intentional difference between resource and tool output
  - Resource includes `id`, `name`, `count` (for reference/management use cases)
  - Tool returns only `name`, `count` (optimized for filtering/display)
  - Added to `ServerInstructions.ts` Field Notes section
- **Tag Naming Conventions** — Added guidance for consistent tag naming patterns
  - Recommends lowercase with dashes (e.g., `bug-fix`, `phase-2`)
  - Documents `merge_tags` tool for consolidating duplicates
- **`semantic_search` Threshold Guidance** — New Field Note documenting threshold recommendations
  - Default 0.3, broader matches at 0.2-0.25, strict matches at 0.4+
  - Added `similarity_threshold` to tool parameter reference table

### Changed

- **`memory://instructions` Default Level** — Changed from `standard` to `full` so agents always receive complete tool parameter reference and field notes (~600 tokens)
- **Briefing `clientNote`** — Simplified from "If prompts unavailable or Dynamic Context Management behaviors missing..." to clearer "For complete tool reference and field notes, read memory://instructions."
- **Expanded StructuredContent Coverage** — 7 additional tools now return `structuredContent` with Zod validation
  - `test_simple`, `export_entries`, `rebuild_vector_index`, `add_to_vector_index`
  - `move_kanban_item`, `create_github_issue_with_entry`, `close_github_issue_with_entry`
  - All 33 tools with response data now have formal output schemas

### Fixed

- **CI Status "unknown" for Cancelled Workflows** — Fixed `memory://briefing` and `memory://github/status` reporting "unknown" when latest workflow was cancelled
  - Added proper handling for `cancelled` conclusion alongside `success` and `failure`
  - CI status type now includes `passing | failing | pending | cancelled | unknown`

## [4.1.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v4.0.0...v4.1.0) - 2026-01-17

### Added

- **Auto-rebuild Vector Index on Startup** — New `--auto-rebuild-index` CLI flag and `AUTO_REBUILD_INDEX` env var
  - When enabled, server rebuilds the vector index from all database entries during startup
  - Ensures `memory://health` reports accurate `itemCount` matching `entryCount`
  - Useful for deployments where the in-memory index needs to be synchronized after server restarts
- **`move_to_done` Option for `close_github_issue_with_entry`** — Automatically move Kanban item to "Done" when closing an issue
  - New `move_to_done` boolean parameter (default: `false`)
  - New `project_number` parameter (uses `DEFAULT_PROJECT_NUMBER` if not specified)
  - Finds the issue on the Kanban board and moves it to the "Done" column
  - Output includes `kanban` field with move result
- **`autoContext` Field Documentation** — Added "Field Notes" section to server instructions explaining the reserved field
- **MCP Progress Notifications** — Long-running operations now emit `notifications/progress` for improved user experience
  - **`rebuild_vector_index`**: Reports progress every 10 entries with total count
  - **`restore_backup`**: Reports 3-phase progress (backup → restore → verify)
  - **`export_entries`**: Reports 2-phase progress (fetch → process)
  - Requires client support for `progressToken` in request `_meta` (MCP 2025-11-25)
  - New utility module: `src/utils/progress-utils.ts`
- **MCP Icons Array Support** — Tools, resources, and prompts now include optional `icons` for visual representation in MCP clients
  - Follows MCP 2025-11-25 specification with `src`, `mimeType`, `sizes` properties
  - **31 tools** with group-based icons (core, search, analytics, github, backup, etc.)
  - **15 resources** with context-appropriate icons (briefing, recent, graph, health, github, etc.)
  - **15 prompts** with message bubble icon
  - Uses SVG data URIs for self-contained distribution (no external dependencies)
  - New type: `McpIcon` in `src/types/index.ts`
  - New module: `src/constants/icons.ts` with centralized icon definitions
- **Expanded StructuredContent Coverage** — Extended Zod output schemas from 5 to 24 tools
  - **17 new output schemas** defined in `src/handlers/tools/index.ts`
  - **Phase 1 (Core Read)**: `SemanticSearchOutputSchema`, `TagsListOutputSchema`, `VectorStatsOutputSchema`, `VisualizationOutputSchema`, `CrossProjectInsightsOutputSchema`
  - **Phase 2 (Mutations)**: `CreateEntryOutputSchema`, `UpdateEntryOutputSchema`, `DeleteEntryOutputSchema`, `LinkEntriesOutputSchema`
  - **Phase 3 (GitHub)**: `GitHubIssuesListOutputSchema`, `GitHubIssueResultOutputSchema`, `GitHubPRsListOutputSchema`, `GitHubPRResultOutputSchema`, `GitHubContextOutputSchema`, `KanbanBoardOutputSchema`
  - **Phase 4 (Backup)**: `BackupResultOutputSchema`, `BackupsListOutputSchema`, `RestoreResultOutputSchema`
  - Clients supporting `structuredContent` receive validated JSON for programmatic consumption
- **`semantic_search` Hint Control** — New `hint_on_empty` parameter (default: `true`) to control hint display
  - When `false`, suppresses hints about empty results or index status
  - Useful for programmatic consumers that handle empty results differently
- **PR Resource Empty Hints** — `memory://prs/{pr_number}/entries` and `memory://prs/{pr_number}/timeline` now include a `hint` field when no entries are linked
  - Hint: "No journal entries linked to this PR. Use create_entry with pr_number to link entries."

### Documentation

- **GitHub Fallback Behavior** — Documented in both `README.md` and `DOCKER_README.md`
  - Explains what happens when GitHub tools cannot auto-detect repository information
  - Shows example `requiresUserInput: true` response when `owner` and `repo` parameters are needed

### Known Limitations

- **Icons not visible in protocol output** — MCP SDK v1.25.2 has `icons` in type definitions but `registerTool()`, `registerResource()`, and `registerPrompt()` don't pass icons through to protocol responses. Server-side implementation is correct and future-ready; will work when SDK adds proper passthrough.

### Fixed

- **`list_tags` Output Schema Validation** — Fixed tool returning `usageCount` instead of `count` required by `TagsListOutputSchema`
  - Handler now maps database `usageCount` field to schema-expected `count` field
  - Fixes "expected number for tags[*].count, received undefined" validation error
- **`semantic_search` Misleading Hint** — Fixed hint always showing "No entries in vector index" even when index had items
  - Now checks actual index stats to determine if index is truly empty
  - Shows appropriate hint: "No entries matched your query above the similarity threshold" when items exist but don't match
- **`getRecentEntries` Deterministic Ordering** — Added secondary sort by ID for consistent results
  - Entries with identical timestamps now sorted by `id DESC` for deterministic ordering
  - Prevents non-reproducible results when entries share timestamps
- **GHSA-73rr-hh4g-fpgx (diff DoS)** — Manually patched npm's bundled `diff@8.0.2` → `8.0.3` in Dockerfile
  - npm team hasn't released fix yet, so we patch it directly via `npm pack` + replace
- **CVE-2026-23745 (tar)** — Manually patched npm's bundled `tar@7.5.2` → `7.5.3` in Dockerfile
  - Addresses high-severity vulnerability (CVSS 8.2) in npm's bundled tar package
- **`memory://health` Vector Index Field Name** — Aligned `indexedEntries` → `itemCount` for consistency with `get_vector_index_stats` tool
- **`memory://tags` Field Naming** — Mapped `usageCount` → `count` for consistency with `list_tags` tool output
- **`create_github_issue_with_entry` Default Status** — Issues added to projects now default to "Backlog" column when `initial_status` is not specified
- **`delete_entry` Vector Index Cleanup** — Deleting entries now removes them from the vector index, preventing orphaned index entries and `itemCount` discrepancy between vector index and database
- **`memory://instructions` Query Parameter Documentation** — Removed misleading description about query parameter support (`?level=essential|standard|full`) since MCP SDK performs exact URI matching at the SDK level before invoking handlers
- **Docker Security Gate** — Restructured workflow to scan BEFORE push:
  - `security-scan` now runs FIRST (before any images are pushed)
  - `build-platform` only runs after security scan passes
  - Uses `--only-fixed` to block only on fixable CVEs
  - Unfixable upstream CVEs (Alpine zlib, busybox) do not block deploys
- **Docker Build Optimization** — Comprehensive `.dockerignore` rewrite reducing build context by ~200MB:
  - Added `node_modules/` (~195MB) — reinstalled in builder stage
  - Added `mcp-publisher.exe` (6.3MB) — local publishing tool
  - Added dev tooling files (`.prettierrc`, `eslint.config.js`, etc.)
  - Added `releases/` directory and security scanning configs
  - Organized into logical sections with clear documentation

## [4.0.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.5...v4.0.0) - 2026-01-16

### Added

- **GitHub Issue Lifecycle Tools** — Integrated issue management with automatic journal entries
  - **`create_github_issue_with_entry`**: Creates GitHub issue AND linked journal entry
    - **New**: `initial_status` parameter to set Kanban column (e.g., "Backlog", "Ready")
  - **`close_github_issue_with_entry`**: Closes issue AND creates resolution entry with significance
  - Auto-detects owner/repo from git context
  - Custom entry content optional with sensible auto-generated defaults
- **New `GitHubIntegration` Methods**: `createIssue()`, `closeIssue()` for Octokit operations
- **Tool Count**: 29 → 31 tools (github group: 7 → 9)
- **New Prompt: `confirm-briefing`** — Session context acknowledgment for users
  - Generates formatted acknowledgment message showing what context the agent received
  - Displays journal stats, latest entries preview, and behavioral guidance
  - Helps users understand what context the AI agent has before continuing
- **Briefing Resource Enhancement** — `memory://briefing` now includes:
  - `userMessage`: Pre-formatted context summary for agents to show users
  - `autoRead` and `sessionInit` annotations: Hints for clients that support auto-subscribe behavior
  - `templateResources`: Array of 6 template resource URIs (projects, issues, PRs, kanban) for full discoverability
  - Enhanced description: "AUTO-READ AT SESSION START" for discoverability
  - `clientNote`: Pointer to `memory://instructions` for clients that don't auto-inject ServerInstructions
- **New `memory://instructions` Resource** — Universal access to full server behavioral guidance
  - Exposes the same instructions that `ServerInstructions.ts` provides to auto-inject clients
  - Enables AntiGravity and other clients to access Dynamic Context Management patterns
  - Resource count: 17 → 18 resources (12 static + 6 template)
- **structuredContent Text Fallback** — Tools with `outputSchema` now return both:
  - `structuredContent`: Validated JSON for clients that support it (Cursor, Claude Desktop)
  - `content`: Formatted JSON text for clients that don't (AntiGravity)
  - Fixes "tool call completed" display issue in AntiGravity for 5 tools
- **Session Start Guidance** — Enhanced `ServerInstructions.ts` with acknowledgment step
  - Step 1: Read `memory://briefing` for project context
  - Step 2: **Show the `userMessage` to the user**
  - Step 3: Proceed with user's request
- **Prompt Count** — 14 → 15 prompts (added `confirm-briefing`)
- **MCP 2025-11-25 Resource Annotations** — Added `lastModified` (ISO 8601 timestamp) to key dynamic resources
  - Compact behavioral guidance (when to create/search entries)
  - Latest 3 entries preview with truncated content
  - GitHub status summary (repo, branch, CI, open issues/PRs)
  - Quick access links to related resources
  - Priority 1.0 (highest) — designed to be read first at session start
  - Optimized for clients that don't auto-inject server instructions (Antigravity, VSCode, etc.)
- **MCP 2025-11-25 Tool `outputSchema`** — Structured output validation for high-value tools
  - Tools return `structuredContent` (validated against schema) instead of raw text `content`
  - **5 tools with `outputSchema`**: `get_recent_entries`, `search_entries`, `search_by_date_range`, `get_entry_by_id`, `get_statistics`
  - New Zod schemas: `EntryOutputSchema`, `EntriesListOutputSchema`, `RelationshipOutputSchema`, `EntryByIdOutputSchema`, `StatisticsOutputSchema`
  - SDK validates output at runtime — ensures response matches declared schema

### Changed

- **Resource Handler Architecture** — Added `ResourceResult` interface for typed resource responses with annotations
  - Handlers can now return `{ data, annotations: { lastModified } }` structure
  - Backward compatible: existing handlers returning raw data still work
- **Confirmed OpenWorldHint Compliance** — All 7 GitHub tools already have `openWorldHint: true` annotation
- **Tiered Server Instructions** — `generateInstructions()` now supports `level` parameter
  - `essential` (~200 tokens): Core behavioral guidance only
  - `standard` (~400 tokens): + GitHub integration patterns (default)
  - `full` (~600 tokens): + tool/resource/prompt listings
- **Resource Count** — 16 → 17 → 18 resources (added `memory://briefing`, then `memory://instructions`)
- **Node.js 24 LTS Engines Alignment** — Updated `package.json` engines field to match Dockerfile baseline
  - `engines.node`: >=18.0.0 → >=24.0.0 (Dockerfile already using `node:24-alpine`)
- **Enhanced AI Agent Behavioral Guidance** — Added new `Behavioral Guidance` section to `ServerInstructions.ts`
  - **When to Query Project Context** — Encourages agents to fetch `memory://recent` or use `semantic_search` at conversation start; includes time awareness via `memory://health`
  - **When to Create Entries** — Clear triggers for documenting implementations, decisions, bug fixes, and milestones
  - **Building the Knowledge Graph** — Guidance on using `link_entries` to connect related work
  - **GitHub Integration Workflows** — Guidance on linking entries to Issues/PRs, documenting GitHub activity, and Kanban patterns
  - **Initial Context Strategy** — Guidance on dynamically choosing context based on user prompt
- **Initial Briefing Optimization** — Server instructions now include latest entry snapshot for immediate context
- **New `memory://github/status` Resource** — Compact GitHub overview with progressive disclosure (CI status, commit SHA, issue/PR numbers, Kanban summary)
- **Optimized `get-context-bundle` Prompt** — Now uses compact entry summaries (~85% token reduction) instead of full content
- **ServerInstructions Token Optimization** — Reduced BASE_INSTRUCTIONS by ~53% (207→97 lines) with client-agnostic server naming
- **Dynamic Context Management Documentation** — Promoted new feature in README.md and DOCKER_README.md Key Benefits
- **Wiki Documentation Updates** — Added Dynamic Context Management to Home.md, Quick-Start.md, Architecture.md, Tools.md, Installation.md
- **Client Compatibility Notes** — Documented AntiGravity IDE limitations in README.md, DOCKER_README.md, and Installation.md
  - ServerInstructions not injected: AntiGravity does not call `getServerInstructions()`
  - Resource hints not honored: `autoRead`/`sessionInit` annotations ignored
  - Workaround: Manual briefing read or user rules
- **Dependency Updates**
  - `@types/node`: 25.0.8 → 25.0.9
  - `vectra`: 0.11.1 → 0.12.3 (unpinned, packaging bug fixed)

### Documentation

- **GitHub Management Capabilities** — Added hybrid workflow documentation explaining MCP + gh CLI approach
  - New section in `README.md` and `DOCKER_README.md` with capability matrix
  - Enhanced `Git-Integration.md` wiki page with comprehensive capability table
  - Includes example issue lifecycle workflow demonstrating journal linking with gh CLI operations

### Fixed

- **Trivy Security Scan Workflow** — Fixed workflow that hadn't run since September 2025
  - Updated `aquasecurity/trivy-action` from unstable `@master` to stable `@0.33.1`
  - Added `push` trigger on `main` branch for Dockerfile/package changes to ensure regular scans
  - Added `pull_request` trigger for security validation before merging
- **Dependabot Label Configuration** — Created missing `npm` label in GitHub repository. Dependabot requires labels to exist before it can apply them to pull requests.
- **Vectra Type Definitions** — Now unpinned in v3.1.6. Previously pinned to v0.11.1 due to a packaging bug in v0.12.x where TypeScript type definitions (`.d.ts` files) were not included in the published npm package.
- **Docker Latest Tag** — Fixed `latest` tag not being applied on `workflow_run` triggered builds. Two issues were fixed: (1) The `{{is_default_branch}}` template doesn't evaluate correctly for `workflow_run` events - replaced with explicit branch detection. (2) The `security-scan` and `merge-and-push` jobs were being skipped due to cascading skip behavior from the skipped `preflight-check` job - added `always()` with explicit success checks for direct dependencies.
- **Semantic Search Timing** — Fixed race condition where search returned 0 results immediately after rebuild. Previous attempt using 100ms delay was insufficient; now using explicit index synchronization to ensure vectra's internal state is refreshed.
- **Auto-Indexing** — Fixed missing auto-indexing for `create_entry`, `create_entry_minimal`, and `update_entry` tools. New and updated entries are now immediately available for semantic search without requiring a full index rebuild.
- **CI Status Discrepancy** — Aligned `memory://github/status` logic with `memory://briefing` to use the latest _completed_ run for status determination. Previous logic incorrectly reported "failing" if _any_ of the last 5 runs failed, causing confusion when the latest run was passing.
- **GitHub Actions Resource** — `memory://actions/recent` now fetches live workflow runs from GitHub API and presents them as virtual journal entries, aligning with the graph view.
- **Project Board Automation** — `create_github_issue_with_entry` now accepts `project_number` to automatically add the created issue to a GitHub Project v2 Kanban board.
- **Search Filter Accuracy** — Fixed `search_entries` ignoring filters when `query` is empty. Now correctly filters by `issue_number`, `pr_number`, etc.
- **Default Project Number** — Added `--default-project` CLI option and `DEFAULT_PROJECT_NUMBER` environment variable to auto-add issues to a specific project if no `project_number` is provided.
- **Documentation Updates** — Updated README and DOCKER_README to document default project configuration and correct `mcp-config-example.json`.
- **`export_entries` Limit Parameter** — Added missing `limit` parameter to `export_entries` tool. Previously always exported 100 entries; now respects the `limit` parameter (default: 100).
- **`get_statistics` GroupBy Visibility** — Added `groupBy` field to statistics output so callers can verify which grouping was applied.
- **Entry Output Schema Completeness** — Added missing GitHub metadata fields to `EntryOutputSchema`: `projectOwner`, `issueUrl`, `prUrl`, `prStatus`, `workflowName`, `workflowStatus`.
- **Vector Index Stats Inconsistency** — Fixed `memory://health` reporting 0 indexed entries after `rebuild_vector_index`. Changed `getStats()` to use vectra's `getIndexStats()` API which explicitly loads from disk for authoritative stats.

### Documentation

- **GitHub Management Capabilities** — Added hybrid workflow documentation explaining MCP + gh CLI approach
  - New section in `README.md` and `DOCKER_README.md` with capability matrix
  - Enhanced `Git-Integration.md` wiki page with comprehensive capability table
  - Includes example issue lifecycle workflow demonstrating journal linking with gh CLI operations
- **`get_github_context` Clarification** — Updated description to clarify it only returns **open** items (closed items excluded).
- **`move_kanban_item` Case Sensitivity** — Documented that status matching is case-insensitive and to use exact status names from `get_kanban_board`.
- **Virtual Entry IDs** — Documented in Resources.md that `memory://actions/recent` returns virtual entries with negative IDs (negated workflow run IDs) to distinguish from database entries.
- **Resource Annotations Note** — Added note in Resources.md that MCP 2025-11-25 annotations (e.g., `lastModified`) may not be visible in all clients due to SDK/client limitations.

## [3.1.5](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.4...v3.1.5) - 2026-01-11

### Security

- **Remove protobufjs CLI** — Eliminates CVE-2019-10790 (taffydb), CVE-2025-54798 (tmp), CVE-2025-5889 (brace-expansion). CLI folder not needed at runtime.

## [3.1.4](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.3...v3.1.4) - 2026-01-11

### Fixed

- **Docker npm Upgrade** — Added `npm install -g npm@latest` to production stage (was only in builder stage). Fixes CVE-2025-64756 (glob) and CVE-2025-64118 (tar) in final Docker image.

## [3.1.3](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.2...v3.1.3) - 2026-01-11

### Security

- **Docker CVE Fixes** — Active remediation for 7 CVEs:
  - npm global upgrade fixes CVE-2025-64756 (glob) and CVE-2025-64118 (tar)
  - Alpine edge for curl fixes CVE-2025-14524, CVE-2025-14819, CVE-2025-14017
  - protobufjs cli cleanup fixes CVE-2025-54798 (tmp) and CVE-2025-5889 (brace-expansion)
- **Reduced CVE Allowlist** — Only truly unfixable CVEs remain (zlib with no upstream fix, taffydb unmaintained)

## [3.1.2](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.1...v3.1.2) - 2026-01-11

### Fixed

- **CI Build Pipeline** — Added `.npmrc` with `legacy-peer-deps=true` to resolve `npm ci` failures from optional peer dependency conflicts (vectra's zod@^3.23.8 vs zod@^4.x)
- **Docker Workflow Gating** — Added `preflight-check` job to docker-publish.yml; tag pushes now run lint/typecheck/build before Docker deployment

## [3.1.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.1.0...v3.1.1) - 2026-01-11

### Security

- **Docker Image Security** — Added `apk upgrade --no-cache` to builder stage for latest security patches
  - Fixes CVE-2026-22184 (zlib critical)
  - Fixes CVE-2025-14524, CVE-2025-14819, CVE-2025-14017 (curl)
- **NPM Dependency Override** — Added `glob@^11.1.0` override to fix CVE-2025-64756 (ReDoS)

### Fixed

- **CI Build** — Regenerated `package-lock.json` to fix lock file desync with MCP SDK peer dependencies

## [3.1.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v3.0.0...v3.1.0) - 2026-01-11

### Added

- **GitHub Projects v2 Kanban Support** — View and manage GitHub Project boards directly from AI agents
  - **New Tool: `get_kanban_board`** — Fetch project items grouped by Status columns (Backlog, Ready, In progress, In review, Done)
  - **New Tool: `move_kanban_item`** — Move items between status columns using GraphQL mutations
  - **New Resource: `memory://kanban/{project_number}`** — JSON board data with items grouped by status
  - **New Resource: `memory://kanban/{project_number}/diagram`** — Mermaid visualization of Kanban board
  - **Multi-level project discovery** — Searches user → repository → organization level projects automatically
  - **Dynamic status columns** — Supports any Status field configuration per project
- **Server Instructions** — Usage instructions are now automatically provided to AI agents via the MCP protocol's `instructions` capability during server initialization. See [`src/constants/ServerInstructions.ts`](https://github.com/neverinfamous/memory-journal-mcp/blob/main/src/constants/ServerInstructions.ts).
- **Comprehensive AI Agent Instructions** — Rewritten `ServerInstructions.ts` with:
  - Explicit MCP access patterns (`CallMcpTool`, `ListMcpResources`, `FetchMcpResource`)
  - Tool parameter reference tables for all 29 tools
  - Default GitHub Projects v2 status column documentation
  - Guidance for finding correct project by `projectTitle`

### Fixed

- **Dependabot Configuration** — Migrated from deprecated `pip` ecosystem to `npm` ecosystem
  - **Root Cause**: The v3.0.0 TypeScript rewrite removed all Python dependency files, but Dependabot was still configured for `pip`
  - **Symptom**: Dependabot security scans failed with `dependency_file_not_found: / not found`
  - **Resolution**: Replaced `pip` ecosystem with `npm` ecosystem and updated dependency groups to match TypeScript/Node.js packages (MCP SDK, Zod, sql.js, vectra, build tools, linting)

### Changed

- **Docker Base Image** — Upgraded from `node:22-alpine` to `node:24-alpine` (Active LTS)
  - Node.js 24 is the current Active LTS release (support through April 2028)
  - Node.js 25 was skipped as it's a non-LTS "Current" release (EOL June 2026)
- **Dependency Updates**
  - `@modelcontextprotocol/sdk` 1.25.1 → 1.25.2 (patch)
  - `@octokit/rest` 21.1.1 → 22.0.1 (major)
  - `globals` 16.5.0 → 17.0.0 (major)
  - `typescript-eslint` 8.50.1 → 8.52.0 (minor)
  - `vectra` 0.9.0 → 0.11.1 (minor) — Updated `queryItems` call to new API signature with BM25 hybrid search support
  - `zod` 4.2.1 → 4.3.5 (minor)

## [3.0.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v2.2.0...v3.0.0) - 2025-12-28

### 🎉 Complete TypeScript Rewrite

This release is a **complete ground-up rewrite in TypeScript**, delivering a pure JavaScript stack with zero native dependencies. The Python codebase is deprecated and archived in `archive/python-v2`.

### Added - Backup & Restore Tools

- **New Tool Group: `backup`** - Never lose your journal data again
  - `backup_journal` - Create timestamped database backups with custom naming
  - `list_backups` - List all available backup files with metadata
  - `restore_backup` - Restore from any backup (auto-creates safety backup before restore)

### Added - Server Health Resource

- **New Resource: `memory://health`** - Comprehensive server diagnostics
  - Database stats: path, size, entry count, relationship count, tag count
  - Backup info: directory, count, last backup details
  - Vector index: availability, indexed entries, model name
  - Tool filter: active status, enabled/total counts

### Added - Tool Annotations (MCP 2025-11-25)

- All **29 tools** now include behavioral hints for AI safety:
  - `readOnlyHint` - Indicates read-only operations
  - `destructiveHint` - Warns of data modification
  - `idempotentHint` - Safe to retry
  - `openWorldHint` - External service calls (GitHub)

### Added - Dynamic Structured Logging

- **RFC 5424 severity levels** - emergency, alert, critical, error, warning, notice, info, debug
- **Module-prefixed codes** - Operation-specific like `DB_CONNECT`, `VECTOR_SEARCH`
- **Centralized logger** - All output to stderr (stdout reserved for MCP protocol)
- **Debug mode** - Enable with `DEBUG=true` environment variable

### Changed - Technology Stack

- **Language**: Python → TypeScript (Node.js 18+)
- **Database**: Python sqlite3 → sql.js (pure JavaScript)
- **Vector Search**: FAISS + sentence-transformers → vectra + @xenova/transformers
- **Distribution**: PyPI → npm
- **Installation**: `pip install memory-journal-mcp` → `npm install -g memory-journal-mcp`

### Changed - CI/CD Modernization

- **Native ARM64 Builds** - No more slow QEMU emulation
- **NPM Publishing** - Replaces PyPI distribution
- **CodeQL Analysis** - JavaScript/TypeScript static security analysis
- **Docker Scout** - Container vulnerability scanning with blocking gates
- **Dependabot Auto-Merge** - Automatic patch/minor updates

### Capabilities Summary

| Category        | Count | Notes                                                                  |
| --------------- | ----- | ---------------------------------------------------------------------- |
| **Tools**       | 29    | +2 Kanban tools (get_kanban_board, move_kanban_item)                   |
| **Tool Groups** | 8     | core, search, analytics, relationships, export, admin, github, backup  |
| **Prompts**     | 14    | Unchanged from v2.x                                                    |
| **Resources**   | 16    | +2 Kanban resources (memory://kanban/{n}, memory://kanban/{n}/diagram) |

### Migration from v2.x

**Breaking change:** Installation now via npm:

```bash
# Old (Python)
pip install memory-journal-mcp

# New (TypeScript)
npm install -g memory-journal-mcp
```

**Database compatibility:** ✅ Existing databases work without migration!

### Security

- **Input validation** - Zod schemas for all tool parameters
- **Path traversal protection** - Backup filename validation
- **SQL injection prevention** - Parameterized queries throughout
- **Content size limits** - Configurable per field

## [2.2.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v2.1.0...v2.2.0) - 2025-12-08

### Added - Tool Filtering for Token Efficiency

- **Tool Filtering** - Selectively enable/disable tools via `MEMORY_JOURNAL_MCP_TOOL_FILTER` environment variable
  - **Up to 69% token reduction** - Disable unused tools to save context window space
  - **7 tool groups**: `core` (5), `search` (2), `analytics` (2), `relationships` (2), `export` (1), `admin` (2), `test` (2)
  - **Filter syntax**: `-group` to disable group, `-tool` to disable specific tool, `+tool` to re-enable
  - **Left-to-right processing**: Rules applied in order for precise control
  - **Useful for MCP clients with tool limits** (e.g., Windsurf's 100-tool limit)
  - **Default behavior**: All 16 tools enabled (backward compatible)
  - **Token savings by configuration**:
    - Production (`-test`): ~12% reduction (14 tools)
    - Read-only (`-admin`): ~15% reduction (14 tools)
    - Lightweight (core only): **~69% reduction** (5 tools)
- **New module**: `src/tool_filtering.py` with complete filtering logic
- **Comprehensive tests**: `tests/test_tool_filtering.py` with 100% coverage
- **Documentation**: New wiki page [Tool-Filtering](Tool-Filtering) with detailed examples

### Improved - Dark Mode Visualization

- **Actions Visual Graph** (`memory://graph/actions`) - Improved color scheme for dark mode readability
  - Medium-saturated fill colors with better contrast
  - Black text on colored backgrounds for legibility
  - Darker stroke/border colors for node definition
  - Compact class-based Mermaid styling for smaller output
  - Streamlined footer (single line vs multi-line legend)

### Changed

- **Server integration** - `handle_list_tools()` and `handle_call_tool()` now respect filtering configuration
- **Error handling** - Disabled tools return clear error message when called
- **Constants** - Actions graph colors moved to `src/constants.py` for easy customization

### Documentation

- Updated [README.md](https://github.com/neverinfamous/memory-journal-mcp#tool-filtering-optional) with tool filtering section and token savings
- Updated [DOCKER_README.md](https://github.com/neverinfamous/memory-journal-mcp/blob/main/DOCKER_README.md#tool-filtering) with Docker-specific examples
- Updated `mcp-config-example.json` with environment variable example
- New wiki page: [Tool-Filtering.md](Tool-Filtering) with comprehensive guide

### Technical Details

- **Environment variable**: `MEMORY_JOURNAL_MCP_TOOL_FILTER` - comma-separated filter rules
- **Caching**: Uses `@lru_cache(maxsize=1)` for performance
- **Logging**: Info/warning messages logged to stderr for debugging
- **Type safety**: Maintains Pyright strict compliance

## [2.1.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v2.0.1...v2.1.0) - 2025-11-26

### Added - Actions Visual Graph Resource

- **New Resource: `memory://graph/actions`** - CI/CD narrative visualization
  - Generates Mermaid diagrams showing workflow runs, failures, investigation entries, and deployments
  - **Narrative flow**: `Commit → Workflow Run → Failure → Investigation Entry → Fix Commit → Success → Deployment`
  - **Node types**: Commits (hexagon), PRs (stadium), Workflow runs (rectangle), Failed jobs (parallelogram), Journal entries, Deployments
  - **Query parameters**: `?branch=X&workflow=Y&limit=15` for filtering
  - Identifies "fix patterns" - when failed workflows are followed by successful ones
  - Links journal entries to workflow run investigations
  - Color-coded styling: green (success), red (failure), yellow (pending), blue (entries)

### Fixed - Pyright Strict Type Compliance

- **700+ type issues fixed** - Complete Pyright strict mode compliance achieved
- **All exclusions removed** from `pyrightconfig.json`:
  - Removed `reportMissingTypeStubs` exclusion
  - Removed `reportUnknownVariableType` exclusion
  - Removed `reportUnknownMemberType` exclusion
  - Removed `reportUnknownArgumentType` exclusion
  - Removed `reportUnknownParameterType` exclusion
  - Removed `reportUnknownLambdaType` exclusion
- **Type safety badge now accurate** - `[![Type Safety](https://img.shields.io/badge/Pyright-Strict-blue.svg)]` reflects true strict compliance
- All `Any` types replaced with proper TypedDicts and explicit annotations
- Improved code maintainability and IDE support through complete type coverage

### Added - GitHub Actions Failure Summarizer Prompt

- **New Prompt: `actions-failure-digest`** - Comprehensive GitHub Actions failure analysis
  - Generates digest of recent CI/CD failures with root cause analysis
  - **Failing Jobs Summary** - Lists failed workflows, jobs, and specific failed steps
  - **Linked Journal Entries** - Finds entries connected to affected commits/PRs
  - **Recent Code/PR Changes** - Context from current branch and associated PRs
  - **Previous Similar Failures** - Semantic search for recurring patterns
  - **Possible Root Causes** - AI-assisted analysis of failure patterns
  - **Next Steps** - Actionable recommendations for resolution
  - Optional filters: `branch`, `workflow_name`, `pr_number`, `days_back`, `limit`
  - Leverages existing semantic search, clustering, and relationship enumeration
- **New API Helper Function**: `get_workflow_run_jobs()` - Fetch job-level details for workflow runs
- **New API Helper Function**: `get_failed_workflow_runs()` - Convenience function for fetching recent failures

### Added - GitHub Actions Resources

- **4 New MCP Resources for CI/CD Visibility** - Expose GitHub Actions as first-class resources
  - `memory://actions/recent` - Recent workflow runs with filtering (JSON)
    - Query params: `?branch=X&workflow=Y&commit=SHA&pr=N&limit=10`
    - Returns: CI status, run list, related journal entries
  - `memory://actions/workflows/{workflow_name}/timeline` - Workflow-specific timeline (Markdown)
    - Blends: workflow runs, journal entries, PR events
  - `memory://actions/branches/{branch}/timeline` - Branch CI timeline (Markdown)
    - Blends: workflow runs, journal entries, PR lifecycle events
  - `memory://actions/commits/{sha}/timeline` - Commit-specific timeline (Markdown)
    - Blends: workflow runs for commit, related journal entries
- **New API Helper Functions** (in `src/github/api.py`):
  - `get_workflow_runs_by_name()` - Filter runs by workflow name (case-insensitive)
  - `get_unique_workflow_names()` - Extract unique workflow names from recent runs
- **Enhanced Resource URI Parsing** - Support for query parameters and new action patterns

### Added - GitHub Actions Integration (Phase 1)

- **GitHub Actions Workflow Runs Support** - Foundation layer for CI/CD integration
  - Link journal entries to workflow runs via `workflow_run_id`, `workflow_name`, `workflow_status` parameters
  - Automatic CI status detection in context bundle (`passing`, `failing`, `pending`, `unknown`)
  - Search and filter entries by workflow run ID
  - Database migration adds `workflow_run_id`, `workflow_name`, `workflow_status` columns with index
- **Enhanced Context Capture** - Project context now includes:
  - Up to 5 recent workflow runs for current branch
  - Overall CI status computed from latest workflow runs
  - Automatic caching (5 min TTL) for workflow run data
- **New API Functions** (in `src/github/api.py`):
  - `get_repo_workflow_runs()` - Fetch workflow runs with caching, branch/status filters
  - `get_workflow_run_details()` - Get detailed workflow run information
  - `get_workflow_runs_for_commit()` - Find runs for a specific commit SHA
  - `get_workflow_runs_for_pr()` - Find runs associated with a PR
  - `compute_ci_status()` - Compute overall CI status from workflow runs
  - All functions include `gh` CLI fallbacks
- **Enhanced Search Capabilities**
  - `search_entries` tool: New filter for `workflow_run_id`
  - `search_by_date_range` tool: New filter for `workflow_run_id`
  - Find all journal entries related to specific workflow runs
- **Enhanced Entry Display**
  - `get_entry_by_id` now shows linked workflow runs with name and status
  - Entry creation confirms workflow linkage (e.g., "Linked to: Workflow Run #12345 (CI Tests) [completed]")
- **New TypedDict Model**: `GitHubWorkflowRunDict` for type-safe workflow run data

### Added - GitHub Issues & Pull Requests Integration

- **GitHub Issues Support** - Complete integration with GitHub Issues
  - Auto-link entries to issues via branch name detection (patterns: `issue-123`, `#123`, `feature/issue-456`)
  - Manual issue linking via `issue_number` and `issue_url` parameters
  - Issue context automatically captured from GitHub API (open issues for current repo)
  - Search and filter entries by issue number
  - Database migration adds `issue_number` and `issue_url` columns
- **GitHub Pull Requests Support** - Full PR integration with auto-detection
  - Auto-detect current PR from branch (finds matching head branch)
  - Manual PR linking via `pr_number`, `pr_url`, and `pr_status` parameters
  - PR status tracking (draft, open, merged, closed)
  - PR context automatically captured including linked issues, reviewers, and stats
  - Search and filter entries by PR number and status
  - Database migration adds `pr_number`, `pr_url`, `pr_status` columns
- **Enhanced Context Capture** - Project context now includes:
  - Up to 10 recent open issues from current repository
  - Up to 5 recent open PRs from current repository
  - Current PR detection based on active branch
  - Automatic caching (15 min TTL) to minimize API calls
- **Enhanced Search Capabilities**
  - `search_entries` tool: New filters for `issue_number`, `pr_number`, `pr_status`
  - `search_by_date_range` tool: New filters for `issue_number`, `pr_number`
  - Find all journal entries related to specific issues or PRs
- **Enhanced Entry Display**
  - `get_entry_by_id` now shows linked issues and PRs with URLs
  - Entry creation confirms GitHub linkage (e.g., "Linked to: Issue #123, PR #456 (open)")

### Fixed

- **Missing GitHub Issues Implementation** - Fixed incomplete `github_issues` field in models
  - Was referenced in `ContextData` but never populated
  - Now fully implemented with API functions, caching, and context integration

### Technical Details

- **New API Functions** (in `src/github/api.py`):
  - `get_repo_issues()` - Fetch repository issues with caching
  - `get_issue_details()` - Get detailed issue information
  - `get_repo_pull_requests()` - Fetch repository PRs with caching
  - `get_pr_details()` - Get detailed PR information including stats
  - `get_pr_from_branch()` - Find PR by head branch name
  - `_parse_linked_issues()` - Extract issue references from PR bodies
  - All functions include `gh` CLI fallbacks for environments without `requests` library
- **Database Schema Changes**:
  - Added `issue_number`, `issue_url` columns to `memory_journal` table
  - Added `pr_number`, `pr_url`, `pr_status` columns to `memory_journal` table
  - Created indexes for efficient filtering: `idx_memory_journal_issue_number`, `idx_memory_journal_pr_number`
  - Automatic migrations run on server startup
- **New Models** (in `src/models.py`):
  - `GitHubIssueDict` - Type definition for issue data
  - `GitHubPullRequestDict` - Type definition for PR data with review stats
  - Updated `EntryDict` with issue and PR fields
  - Updated `ContextData` with `github_issues`, `current_pr`, `github_pull_requests` fields
- **Branch Name Patterns** - Auto-detection supports:
  - `issue-123`, `issue/123`, `fix/issue-456`
  - `#123` (shorthand)
  - `/123-` or `/123/` patterns
- **Backward Compatibility** - All new fields are optional; existing databases migrate seamlessly

## [2.0.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v2.0.0...v2.0.1) - 2025-10-28

### Fixed - Windows Platform Support

- **Git subprocess hang fix** - All Git operations now work reliably on Windows
  - Migrated all `subprocess.run()` calls to `Popen()` with `stdin=subprocess.DEVNULL`
  - Prevents stdin inheritance from MCP server's stdio channel
  - Eliminates deadlocks/hangs when running Git commands
  - Affected files: `database/context.py`, `github/integration.py`
- **Working directory detection** - Server now reliably detects Git context
  - Added `os.chdir(project_root)` on server startup
  - Server automatically changes to project root directory
  - Resolves "Not a Git repository" errors
  - Recommendation: Add `"cwd"` parameter to MCP configuration

### Changed - GitHub Projects v2 Migration

- **GraphQL API migration** - Migrated from deprecated REST API to GraphQL
  - Old REST API endpoints return HTTP 410 Gone (deprecated)
  - New GraphQL API (`projectsV2` query) for Projects v2
  - **New module**: `github/graphql.py` with GraphQL query definitions
  - **Token requirement**: `read:project` or `project` scope now required
  - Supports both user and organization projects
  - Returns same data structure for backward compatibility
- **Enhanced debugging** - Added comprehensive debug logging throughout Git and GitHub operations
  - Tracks subprocess execution times
  - Logs API call results
  - Helps diagnose configuration issues

### Documentation

- Updated Configuration.md with Windows-specific troubleshooting
- Updated GitHub-Projects-Integration.md with GraphQL migration notes
- Updated Architecture.md with v2.0.1 technical improvements
- Added token scope requirements and MCP configuration examples

## [2.0.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.2...v2.0.0) - 2025-10-28

### Added - Git-Based Team Collaboration

- **Team Collaboration Feature** - Share journal entries with your team via Git while maintaining privacy
  - **Two-database architecture**: Personal DB (local) + Team DB (Git-tracked)
  - **Explicit opt-in sharing**: `share_with_team` parameter on entry creation
  - **Privacy-first design**: All entries private by default, sharing requires explicit consent
  - **New database file**: `.memory-journal-team.db` (Git-tracked for team synchronization)
  - **New database column**: `share_with_team` (integer, default 0) in `memory_journal` table
  - **Automatic schema migration**: Existing databases updated automatically
- **New Module**: `src/database/team_db.py` - TeamDatabaseManager class
  - Copy entries to team database
  - Query team entries with filters (tags, date range, entry type)
  - Git status checking for synchronization
  - Entry count and statistics
- **Enhanced Search**: All search operations automatically query both personal and team databases
  - `search_entries` - Returns combined results with team indicator (👥)
  - `search_by_date_range` - Includes team entries in date-based queries
  - Results show source (personal vs team) for clarity
- **New Resource**: `memory://team/recent` - Access recent team-shared entries
  - Returns JSON with team entry count and formatted entries
  - Marked with `source: team_shared` for identification
- **Enhanced Tool**: `create_entry` gains `share_with_team` parameter
  - Set to `true` to copy entry to team database
  - Confirmation message shows sharing status
  - Preserves all entry data (tags, significance, relationships, GitHub Projects)

### Changed - Major Refactoring

- **Complete Internal Architecture Refactoring** - Transformed from monolithic codebase to modular architecture
  - **96% reduction** in main file size (4,093 lines → 175 lines)
  - **30 focused modules** organized into logical layers (~150-300 lines each)
  - **Clear separation of concerns** - Database, GitHub, MCP handlers isolated
  - **Module structure**:
    - `server.py` (175 lines) - Entry point & MCP protocol dispatchers
    - `database/` (4 modules) - MemoryJournalDB, operations, context management, team_db
    - `github/` (3 modules) - Integration, caching, API operations
    - `handlers/` (20 modules) - MCP tools, prompts, resources
    - Core utilities - constants, exceptions, utils, vector_search
  - **Design patterns implemented**:
    - Dispatcher pattern for MCP protocol routing
    - Dependency injection for component initialization
    - Module-level state for handler dependencies
  - **Benefits**:
    - 10x improvement in code maintainability
    - Independent, testable components
    - Self-documenting structure
    - Easier debugging and optimization
    - Foundation for rapid feature development

### Added

- **Custom exception classes** - Centralized error handling with specific exception types
- **Constants module** - All configuration and magic values extracted (including team DB path)
- **Utilities module** - Common functions deduplicated (FTS5 escaping, Mermaid sanitization, etc.)
- **Enhanced documentation** - REFACTORING_SUMMARY.md with complete architecture analysis
- **Team Collaboration Wiki Page** - Comprehensive guide to Git-based entry sharing

### Performance

- ✅ **No degradation** - All async operations preserved
- ✅ **Same startup time** - 2-3 seconds maintained
- ✅ **Same operation speed** - No overhead from modularization

### Compatibility

- ✅ **100% backward compatible** - Zero breaking changes
- ✅ **API unchanged** - All 16 tools, 10 prompts, 4 resources work identically
- ✅ **Database schema** - No changes required
- ✅ **Environment variables** - Same configuration
- ✅ **Seamless upgrade** - Simply update and restart

### Documentation

- Updated Architecture Wiki with complete v2.0.0 module documentation
- Updated Performance Wiki with refactoring analysis
- Added REFACTORING_SUMMARY.md with detailed technical breakdown
- Updated all README files with v2.0.0 highlights

## [1.2.2](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.1...v1.2.2) - 2025-10-26

### Security

- **URL Parsing Vulnerability Fix (CodeQL #110, #111)** - Fixed incomplete URL substring sanitization in GitHub remote URL parsing
  - **Impact**: Prevented potential URL spoofing attacks where malicious URLs could bypass GitHub hostname checks
  - **Root Cause**: Used substring checks (`'github.com' in url`) instead of proper URL parsing
  - **Fix**: Implemented proper `urllib.parse.urlparse()` validation with exact hostname matching
  - **Details**:
    - SSH URLs: Explicit prefix validation with `startswith('git@github.com:')`
    - HTTPS/HTTP URLs: Parse with `urlparse()` and verify `hostname == 'github.com'`
    - Prevents bypasses like `http://evil.com/github.com/fake` or `http://github.com.evil.com/fake`
  - **Severity**: Medium (limited to Git remote URL parsing in local repository context)
  - **Reference**: [CWE-20: Improper Input Validation](https://cwe.mitre.org/data/definitions/20.html)

## [1.2.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.2.0...v1.2.1) - 2025-10-26

### Fixed

- **Semantic search initialization** - Resolved async/lazy loading race condition that could cause semantic_search to hang on first use
  - Moved ML dependency imports to module-level initialization
  - Eliminated async lock deadlock during model loading
  - First semantic search call now completes in <1 second (previously could timeout)
- **Thread pool optimization** - Increased worker count from 2 to 4 to prevent contention during ML model loading

### Changed

- Improved initialization progress messages with step-by-step feedback (Step X/3)
- Added explicit stderr flushing for real-time progress updates

## [1.2.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.3...v1.2.0) - 2025-10-26

### Added - Phase 3: Organization Support

- **Organization-Level GitHub Projects** - Full support for org-level projects alongside user projects
  - Automatic owner detection (user vs organization)
  - Dual project lookup showing both user and org projects
  - Separate `GITHUB_ORG_TOKEN` support for org-specific permissions
  - All Phase 2 analytics work with org projects
- **Enhanced Phase 2 Features for Organizations**
  - Cross-project insights spanning user and org projects
  - Status summaries for org project teams
  - Milestone tracking with org-level milestones
  - Smart caching (80%+ API reduction, 24hr owner type cache)

### Added - Phase 2: Advanced Project Analytics

- **New Tool:** `get_cross_project_insights` - Multi-project analysis and pattern detection
- **New Prompts:**
  - `project-status-summary` - Comprehensive GitHub Project status reports
  - `project-milestone-tracker` - Milestone progress with velocity tracking
- **New Resource:** `memory://projects/{number}/timeline` - Live activity feed combining journal + GitHub events
- **Enhanced:** `get_statistics` with `project_breakdown` parameter for per-project metrics
- **Smart Caching System** - GitHub API response caching with configurable TTLs (1hr projects, 15min items)

### Added - Phase 1: GitHub Projects Integration

- **GitHub Projects Support** - Connect journal entries with GitHub Projects (user & org)
  - Entry creation with `project_number`, `project_item_id`, `github_project_url` parameters
  - Automatic project detection from repository context
  - Search and filter entries by project
  - Project context in context bundles
- **New Database Columns:** `project_number`, `project_item_id`, `github_project_url`
- **Graceful Degradation:** Works without GitHub token (project features disabled)

### Fixed

- **FTS5 Search Query Escaping** - Special characters (hyphens, dots, colons) in search queries now handled correctly
  - Organization names like "my-company" now searchable
  - Version numbers like "v1.2.0" work properly
  - Implemented `escape_fts5_query()` function with quote wrapping

## [1.1.3](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.2...v1.1.3) - 2025-10-04

### Fixed

- **Migration Logic** - Fixed schema migration check to properly handle fresh database installations

## [1.1.2](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.1...v1.1.2) - 2025-10-04

### Security

- **CVE-2025-8869** - Mitigated pip symbolic link vulnerability by upgrading to pip >=25.0

## [1.1.1](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.1.0...v1.1.1) - 2025-10-04

### Fixed

- **F-String Syntax** - Fixed Python syntax error preventing builds on clean environments

## [1.1.0](https://github.com/neverinfamous/memory-journal-mcp/compare/v1.0.2...v1.1.0) - 2025-10-04

### Added

- **Entry Relationships** - Link entries with typed relationships (references, implements, clarifies, evolves_from, response_to)
- **New Tool:** `link_entries` - Create relationships between entries
- **New Tool:** `visualize_relationships` - Generate Mermaid diagrams of entry connections
- **New Resource:** `memory://graph/recent` - Live relationship graph visualization
- **New Prompts:** `find-related`, `get-context-bundle`
- **Soft Delete** - Entries can be soft-deleted and recovered
- **Database Schema Enhancements** - `relationships` table, `deleted_at` column

### Fixed

- **Database Locking** - Eliminated race conditions in concurrent tag updates
- **Thread Safety** - Single-connection transactions prevent conflicts

### Changed

- **Performance:** 10x faster startup (14s → 2-3s) through lazy loading of ML dependencies
- **Optimized Database:** Removed expensive PRAGMA operations from startup

### Documentation

- Created comprehensive GitHub Wiki (17 pages)
- Enhanced README with feature overview
- Added Docker Hub README

## [1.0.2](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v1.0.2) - 2025-09-15

### Initial Beta Release

- 13 MCP tools for journal management
- Triple search system (FTS5, date range, semantic)
- 6 workflow prompts
- 2 MCP resources
- Git and GitHub CLI integration
- SQLite FTS5 full-text search
- Optional FAISS semantic search
