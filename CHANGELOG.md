# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.6.0...HEAD)

## [7.6.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.6.0) - 2026-04-21

### Added

- Explicit HTTP service-level `curl` container health-checks to `docker-compose.yml`.
- True O(1) LRU eviction (using `Map.prototype.keys().next()`) to rate-limiting and user tracking maps to deterministically cap memory under high throughput.
- A `Map` caching layer tied to the local workspace path to minimize redundant OctoKit and Git instantiations.

### Changed

- **Dependencies:** Bumped `node` (Docker) to `24.15.0-alpine`, `@huggingface/transformers` to `4.1.0`, `eslint` to `10.2.1`, `typescript` to `6.0.3`, `@types/node` to `25.6.0`, `@vitest/coverage-v8` to `4.1.5`, `typescript-eslint` to `8.59.0`, `vitest` to `4.1.5`. Updated GitHub Actions (`hashgraph-online/skill-publish`, `dependabot/fetch-metadata`, `docker/build-push-action`, `actions/github-script`, `actions/setup-node`).
- Replaced eager memory-bound directory reads with asynchronous `opendir` streaming in the markdown importer to prevent process OOM.
- Replicated strict 5MB payload truncation limits to `team_export_entries` for consistent memory bounds.
- Enforced strict IP-binding session isolation for Bearer-Token Auth Mode.
- Renamed 'Audit Ledger' to 'Operational Telemetry' to clarify its non-immutable operational scope.
- Centralized `enforceAccessBoundary` in `src/auth/validation.ts` to standardize fail-closed capability checks (`requiresTeamScope`, `requiresAdminScope`, `mutatesState`).
- Implemented an asynchronous decoupled outbox pattern for GitHub mutations, preventing rollback deletions upon external API errors.
- Enforced atomic transaction boundaries and synchronized FTS5/vector indexing during massive rebuilds and soft deletes.
- Decoupled server initialization from database queries to guarantee constant-time startup.
- Hoisted execution-invariant server state (tools, prompts, filter sets) to bypass redundant cycles during client connections.
- Optimized database searches by replacing correlated subqueries with batched, in-memory aggregate lookup tables and CTEs.
- Moved ML vector semantic indexing to an asynchronous background task.
- Replaced the legacy `vm` sandbox mode with production-grade `worker_threads` isolation for `mj_execute_code`.
- Updated `execute_code` payload limit to dynamically use `CODE_MODE_MAX_RESULT_SIZE`.
- Extended `ProjectContext` in GitHub handlers to dynamically bundle a `degraded` array property, exposing partial API failures without crashing.
- Decoupled `create_entry` workflow to safely update personal and team databases synchronously.
- Batched database operations within a single transaction in the markdown importer to improve throughput.
- Transitioned Markdown importer frontmatter parsing to strict JSON validation.
- Added a 24-hour absolute TTL limit to streamable HTTP sessions.
- Enforced absolute path canonicalization and strict Zod validation for `PROJECT_REGISTRY`.
- Implemented filesystem existence verification and logging for `ALLOWED_IO_ROOTS`.
- Reduced `OVERFETCH_MULTIPLIER` in hybrid search from 3 to 2 to improve performance.
- Updated the FTS5 sanitization regex to preserve phrase quotes (`"`) and wildcards (`*`).
- Refactored `VectorSearchManager` vector insertions to utilize a batched `upsertVectors` SQLite interface.
- Replaced the global metrics singleton with instance-scoped `context.runtime.metrics` to ensure tenant boundary integrity.
- Exposed explicit `isReady` semantic index status on the `memory://health` resource.
- Created an explicit repository-local `.npmrc` enforcing `save-exact=true` and `engine-strict=true`.

### Deprecated

- `autoContext` field across the memory journal ecosystem.
- Core `.getRawDb()` and execution mechanisms (now marked `@internal`).

### Fixed

- Restored project test coverage above 90% by adding targeted unit tests for `MaintenanceManager`, `TokenValidator`, HTTP stateful transports, server registration, and Code Mode handlers.
- Excluded unmeasurable runtime scripts and empty barrel files from Vitest metrics to accurately reflect 90%+ line coverage.
- Multi-project repository fallback failures for naked resource URIs and global GitHub resources by iterating `PROJECT_REGISTRY`.
- `team_create_entry` regression blocking explicit `author` claims in non-OAuth environments.
- OutputSchema compliance bugs in `create_github_issue_with_entry`, `close_github_issue_with_entry`, `team_pass_flag`, and `team_resolve_flag`.
- N+1 query performance bottlenecks during team semantic search and Markdown exports.
- `significantResource` compute overhead by precomputing entry timestamps.
- Re-implemented legacy SSE transport to enforce `MAX_STATEFUL_SESSIONS` boundaries.
- False-positive path traversal errors preventing server initialization on Windows.
- Concurrency-related SQLite lock exhaustion failures by standardizing sequential long-running task locks.
- Memory leak in `CodeModeSecurityManager` by adding explicit `dispose()` cleanup for bounded intervals.
- Backup restore race conditions, stale deadlocks, and SQLite lock swap failures on Windows.
- Silent error suppression in `mcp-server.ts`, `backup.ts`, and `team.ts` by ensuring warnings propagate to `stderr`.
- False-positive `--cors-origin` tooltip configurations back to its `none` baseline.
- Code Mode sandbox crashes when encountering `[Circular]` references.
- Code Mode test regressions where `flagMetadata` was omitted for Hush Protocol flags.
- RFC 9728 `Content-Type` header emission in the OAuth metadata endpoint.
- Standard MCP protocol compliance for legacy SSE transport by supporting `sessionId` in query strings.
- Prompt handler failures now surfacing as proper MCP protocol errors.
- `team_import_markdown` to correctly pass `author` and `project_number` to SQLite insertions.
- Re-enabled `X-Forwarded-For` extraction in `getClientIp` using the `trustProxy` setting.
- `PRAGMA integrity_check` tracking within `NativeConnectionManager` mutation whitelists.
- Consolidated test suite regressions, ESLint violations, and TypeScript strict-mode typing issues.
- Rate limiting test regressions by dropping User-Agent entropy from identity hashes.
- Vector indexing silently reporting success when the underlying boolean indicated failure.
- Team semantic search omitting cross-project vectors by enforcing `project_number` filtering before truncations.
- Enforced hard exceptions on SQLite WAL checkpoint failures to prevent incomplete backups.
- Graceful handling of post-commit lookup failures in `createEntry` via synthesized returns.
- Data inconsistencies during `team_delete_entry` soft-deletes by enforcing synchronous vector cleanup.
- Startup schema migrations in `NativeConnectionManager` by wrapping column injections in atomic transactions.
- Re-added junction table `JOIN` to `entry_tags` to correctly resolve tag constraints during team searches.
- Deferred monolithic FTS5 rebuilding queries in `NativeConnectionManager` to background processes.
- Bounded uncontrolled GitHub API Promise fan-out within `BriefingGitHub` fetches using sequential chunking.
- Code Mode sandbox result size error to properly report the actual serialized payload size.
- Path traversal boundary errors in `memory://rules` and `memory://skills` resource handlers.
- `create_entry` returning a stale entry object lacking the auto-populated `issueUrl`.
- Context resolution and project metadata propagation bugs inside Code Mode sandboxes.
- `owner/repo` matching failures for project registry keys containing only the `repo` name in Code Mode.
- Boundary exception leaks in Code Mode where authorization failures threw raw exceptions instead of structured errors.
- Performance oversight in `GitHubIntegration.getRepoInfo()` causing redundant `git branch` subprocesses.
- `GitHubIntegration` throwing raw 404 exceptions instead of returning `null` for non-existent issues, PRs, and milestones.
- `get_copilot_reviews` throwing unhandled 404 errors for non-existent PRs.
- Semantic search crash where `sqlite-vec` virtual table KNN queries failed due to missing `k = ?` constraints.
- Search tools where `include_team` defaulted to `false` preventing Code Mode from resolving team entries by default.
- `sanitizeFtsQuery` where valid FTS5 boolean queries (AND, OR, NOT) were silently stripped.

### Security

- Updated `hono` to `4.12.14` to resolve a medium severity vulnerability.
- Limited FTS5 query tokens to 500 characters to prevent ReDoS and AST bloat.
- Enforced per-invocation `randomUUID()` for `mj_execute_code` client IDs to isolate unauthenticated `stdio` callers.
- Replaced insecure `JSON.parse()` with Zod `AutoContextSchema` validations in team/briefing resources.
- Enforced strict tool-to-scope verification during server initialization.
- Required explicit `allowedIoRoots` for I/O operations instead of falling back to `PROJECT_REGISTRY`.
- Capped IP `rateLimitMap` and `userCounts` map to 10,000 keys to prevent OOM attacks.
- Truncated large JSON exports to prevent memory exhaustion, returning a `truncated: true` flag.
- Shielded SQLite backup restorations with strict `path.resolve` boundary validations against symlink traversals.
- Enforced post-restore schema validation using `PRAGMA integrity_check` before applying backups.
- Modified `TokenValidator` to fail-closed on misconfigured JWKS origin or Issuer metadata.
- Required `SCOPES.TEAM` (instead of generic `WRITE`) for team operations.
- Rejected claimed authorship (author injection) in team tools outside an authenticated OAuth scope.
- Routed internal Code Mode tool calls through `callTool()` to enforce OAuth scope checks and audits.
- Ensured legacy SSE transport runs inside `requestContextStorage.run()` to apply rate limiters.
- Rejected team tool operations where `input.author` mismatched the authenticated principal's `sub` claim.
- Extracted trusted origin properties from `getAuthContext()` for authenticated authorship tracing.
- Added multi-tenant `project_number` warnings to team search tools to prevent cross-tenant traversals.
- Standardized SQL `LIKE` wildcard escaping across database adapters.
- Refused wildcard CORS (`*`) without explicit authentication.
- Prevented path traversal and symlink escapes in markdown importer/exporter via `fs.realpath` and `fs.lstat`.
- Prevented metadata injection vectors in frontmatter serialization via `quoteYamlString`.
- Mitigated directory TOCTOU symlink attacks in markdown exports via post-open inode validation.
- Obscured absolute host paths from Database Backup logs using `path.basename`.
- Restrained unconstrained input search schemas with explicit `z.string().max(250)`.
- Enforced LLM Content Provenance rules with `<untrusted_remote_content>` wrappers for remote content.
- Mitigated SSRF DNS rebinding in OAuth metadata discovery by replacing `fetch` with pinned `node:https`.
- Parameterized `strftime` format strings in timeline queries to eliminate SQL interpolation risks.
- Narrowed `isPublicPath` scope from `/.well-known/*` wildcards to strict OAuth endpoints.
- Closed TOCTOU race condition in `audit-logger.ts` recent log queries by querying size from the file handle.
- Refactored FTS5 tokenization to an explicit allowlist, neutralizing ReDoS vectors on structural keywords.
- Enforced fail-closed cleanup for stale vector index data during partial rebuild failures.
- Mitigated prompt injection by escaping HTML angle brackets in `markUntrustedContent`.
- Eliminated unbounded GraphQL query fanout in GitHub tools by enforcing explicit API fetch limits.
- Prevented path traversal during GitHub integration initialization by enforcing regex validation against `PROJECT_REGISTRY`.
- Replaced brittle `lstat` checks in markdown exporter with `fs.realpathSync.native()` to prevent TOCTOU symlink swaps.
- Reclassified core mutation tools to require `WRITE` scope to fix capability injection risks.
- Explicitly gated the Code Mode sandbox execution behind an `admin` OAuth scope.
- Prevented memory exhaustion (DoS) by adding strict boundary length protections to tags and relationships.
- Implemented strict 50MB global and 10MB per-item cache memory limits for the GitHub API client.
- Escaped static URI patterns in the dynamic resource router template generation to neutralize ReDoS.

## [7.5.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.5.0) - 2026-04-13

### Added

- **Skills**: Integrated `github-copilot-cli` skill for interactive, terminal-native code reviews.
- **Workflows**: Added `copilot-audit` pre-push review loop for evaluating uncommitted changes via Copilot.
- **Hush Protocol**: Introduced a machine-actionable team communication system:
  - Tools: Added `team_pass_flag` and `team_resolve_flag`.
  - Resources: Added `memory://flags` dashboard and `memory://flags/vocabulary`.
  - Config: Added `--flag-vocabulary` CLI argument and `FLAG_VOCABULARY` env var.
  - Core: Added `'flag'` entry type, `ICON_FLAG`, and behavioral instructions.
- **Briefing**: Integrated active flags summary and added `localTime` for chronological grounding.

### Changed

- **Dependency Updates**:
  - Bumped `better-sqlite3` to v12.9.0
  - Bumped `globals` to v17.5.0
  - Bumped `simple-git` to v3.36.0
  - Bumped `typescript-eslint` from 8.58.1 to 8.58.2
  - Bumped `diff` from 8.0.4 to 9.0.0 (docker bundle optimization)
  - Bumped `trufflesecurity/trufflehog` to 3.94.3
  - Bumped `hashgraph-online/skill-publish` to 1.0.13
  - Bumped `github/gh-aw-actions` (c7a6a831 to 0048fdad)
  - Bumped `docker/login-action` to 4.1.0
  - Bumped `actions/upload-artifact` to 7.0.1
- **Briefing**: Renamed the ambiguous `Matrix Density` insight label to `Relationship density`.

### Fixed

- **Types**: Added missing `importanceScore` property to `JournalEntry` interface.
- **Search**: Fixed early `.slice()` truncation that dropped high-relevance results prior to importance sorting.
- **Analytics**: Fixed SQLite `%Y-Q` quarterly grouping calculation by explicitly deriving months.
- **Constraints**: Fixed raw limit evaluation by strictly enforcing `MAX_QUERY_LIMIT` (500) across Team Searches.
- **Consistency**: Hardened `teamCollaborationResource` return payload structure.
- **Hush Protocol**: Fixed SQLite mapping bug inadvertently casting `autoContext` JSON strings to booleans.
- **Analytics**: Fixed an issue in `get_statistics` where the date range filter was inadvertently ignored for causal relationship metrics.
- **Transport**: Resolved an E2E testing timeout in `session-advanced.spec.ts` caused by dangling MCP SDK Server transports preventing sequential reconnections. `server.close()` is now wrapped in a `Promise.race` to forcefully detach SDK transport state and unblock the event loop.

## [7.4.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.4.0) - 2026-04-11

### Added

- New agent skills: `python`, `docker`, `tailwind-css`, and `github-actions` (`neverinfamous-agent-skills` updated to `1.1.0`).
- `sort_by` parameter (`timestamp` or `importance`) for personal and team search tools.
- `team_get_collaboration_matrix` tool for analyzing author activity density and cross-collaboration patterns.
- Proactive Data Analytics tasks for background repository health snapshots (configured via `--digest-interval`).
- `memory://insights/digest` and `memory://insights/team-collaboration` resources for analytics snapshots.
- Injected analytics metrics into `memory://briefing` payloads.

### Fixed

- Missing `{ success: true }` wrapper on `team_get_cross_project_insights` payload.
- Output validation crash when calling `close_github_issue_with_entry` with `move_to_done: true` and no configured `project_number`.
- Missing `sortBy` delegation in text search and sorting logic during cross-database merges.
- Missing `mj.export.*` API documentation in Code Mode instructions.
- Incorrect mapping of `io.ts` in `test-server/code-map.md`.

## [7.3.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.3.0) - 2026-04-10

### Added

- Cleanup utility (`test-server/scripts/cleanup-seed-data.mjs`) to purge testing data without affecting core project entries.
- Metadata filters (`tags`, `entry_type`, date range) for `team_semantic_search` to achieve parity with personal searches.

### Changed

- Standardized `success: true` response field across all read-only tools.
- Centralized `passMetadataFilters` evaluation for consistency across search handlers.

### Fixed

- Validation crash in `create_github_issue_with_entry` when Kanban additions fail or boards are unknown.
- Vector and semantic index filtering failing to properly drop matches after evaluating in-memory criteria.
- Low result variety in vector searches when metadata filters were applied (resolved via explicit 10x oversampling).
- `memory://github/status` layout formatting when there are no active milestones.
- Inconsistent validation errors; schema and programmatic failures now uniformly emit `VALIDATION_ERROR`.
- `get_entry_by_id` incorrectly accepting float values instead of strict integers.
- Prompt handlers throwing raw MCP protocol exceptions instead of wrapping them in user-visible boundary messages.
- `link_entries` allowing the creation of relationships to soft-deleted entries.

## [7.2.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.2.0) - 2026-04-09

### Added

- Expanded comprehensive test coverage suites across github integrations, workflow prompts, generic utilities, and vector search edge cases, pushing vitest overall line coverage above the 97% threshold
- Bundled native foundational agent skills (`bun`, `github-commander`, `golang`, `mysql`, `playwright-standard`, `postgres`, `react-best-practices`, `rust`, `shadcn-ui`, `skill-builder`, `sqlite`, `typescript`, `vitest-standard`) for out-of-the-box system context
- `roadmap-kickoff` and `update-deps` workflows
- `docs/deployment.md` documentation
- `add_kanban_item` and `delete_kanban_item` tools for GitHub project boards
- Configuration variables (`BRIEFING_MILESTONE_COUNT`, `BRIEFING_SUMMARY_COUNT`, `CODE_MODE_MAX_RESULT_SIZE`) and their corresponding CLI flags
- `summary_only` and `item_limit` parameters for `get_kanban_board`
- `truncate_body` parameter for `get_github_issue` and `get_github_pr`
- `include_comments` parameter for `get_github_issue`
- `"Latest Summary"` field in `memory://briefing` to surface the most recent session summary
- Agent-guidance error messages for Code Mode result size violations
- Metadata fields `bodyTruncated`, `bodyFullLength` for GitHub issue/PR schemas, and `itemCount`, `truncated`, `summaryOnly` for Kanban output schemas

### Changed

- Reduced Code Mode default max result size from 10 MB to 100 KB
- Enforced a 500-item maximum limit in `get_recent_entries`, `get_github_issues`, and `get_github_prs`
- Implemented payload truncation in GitHub prompts to prevent excessive context allocation
- Added in-memory TTL caching for GitHub issue comments and `memory://rules` resource
- Refactored `rulesResource`, `skillsResource`, and `scanSkillsDir` to use asynchronous File System APIs
- Updated `@vitest/coverage-v8` and `vitest` dependency versions to `4.1.4`

### Fixed

- Fixed missing lower-bound validation constraint on `limit` parameters
- Empty parameter objects (`{}`) in `search_entries` bypassing validation, now correctly returning structured `VALIDATION_ERROR`
- Code Mode `mj_execute_code` failing to block write operations when `readonly` is requested
- `link_entries` ignoring soft-deleted state when creating new relationships
- Cross-project context leakage in `memory://briefing` query scoping
- Incorrect milestone sort direction in the `memory://briefing` reference
- Missing `OAUTH_CLOCK_TOLERANCE` environment variable fallback in CLI configuration parsing
- Incorrect mapping of IO tool group to `export.ts` instead of `io.ts` in `code-map.md`
- Shortened `DOCKER_README.md` to adhere to Docker Hub's 25,000 character limits

## [7.1.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.1.0) - 2026-04-08

### Security

- Disabled OIDC token minting in the HOL validation workflow (`id-token: none`) as a Least Privilege security best practice (resolves PR #378 intent).
- Removed deprecated `gitleaks-action` from the secret scanning workflow in favor of the active `trufflehog` step to resolve Node.js 20 deprecation warnings.
- Updated `docker/scout-action` to `v1.20.4` to clear pending security scanning CI warnings.

### Added

- Created the `io` tool group to manage bidirectional data portability and cross-domain data indexing.
- Added `export_markdown` and `import_markdown` tools for full round-trip entry synchronization using semantic YAML frontmatter parsing.
- Added `team_export_markdown` and `team_import_markdown` tools to support seamless data synchronization for team databases.
- Included `assertSafeDirectoryPath` core security guardrail for path traversal protection on directory-based APIs.
- Added `relationship_type` filtering flag to `visualize_relationships` tool to isolate specific graph edge connections.

### Fixed

- Removed unnecessary `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` environment flag from the Trivy security scanning job.
- Applied explicit version pinning comments (`# v1.0.11`) to the `skill-publish` workflow step for transparent auditability.

### Changed

- Refactored the legacy `export` tool group into the unified `io` interface, adopting the `mj.io.*` namespace inside Code Mode (the `export` alias is preserved for backwards compatibility).
- Deprecated `ICON_EXPORT` constant in favor of `ICON_IO` utilizing a bidirectional SVG visual design to signal interoperable data flow.
- Lowercased group mappings for API Code Mode proxies.

### Dependencies

- `typescript-eslint` from 8.57.0 to 8.58.1

## [7.0.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.0.1) - 2026-04-07

### Added

- `.github/workflows/hol-skill-validate.yml`: HOL skill validation CI gate — validates `skills/github-commander` package structure on push/PR via `hashgraph-online/skill-publish` in validate-only mode (no secrets, no publishing). Scoped to skill directory changes via `paths:` filter. Incorporates PR [#360](https://github.com/neverinfamous/memory-journal-mcp/pull/360) with corrections: standard checkout SHA, `main`-only trigger, path filtering.

### Fixed

- `DOCKER_README.md`: repaired broken env var table (two fragments with missing header separator merged into one); removed deprecated `GITHUB_REPO_PATH` row (removed in v7.0.0)
- Core/Docs: purged stale references to `GITHUB_REPO_PATH` across codebase and template error strings, replacing them with `PROJECT_REGISTRY` guidance

## [7.0.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.0.0) - 2026-04-07

### Added

- Playwright E2E observability testing for `/metrics` and `/audit` resources.
- Hybrid Reciprocal Rank Fusion (RRF), heuristic query classification, and exposed `searchMode` for `search_entries`.
- Dynamic Vitest coverage badge generation via `scripts/update-badges.ts`.
- Direct `entry_id` bypass and metadata filters for semantic search tools.
- Token estimation and `_meta.tokenEstimate` injection for context awareness.
- Async JSONL `AuditLogger` with rotating archives, redaction, interceptor hooks, and observability resources (`memory://audit`, `memory://metrics/*`).
- Categorized placeholders in `.env.example` and `mcp-config-example.json`.

### Changed

- Modularized `search.ts` into folder-based handlers.
- Reduced `DOCKER_README.md` size to comply with Docker Hub constraints.
- Refactored `.mjs` testing files into modular suites.
- Restructured `test-errors.md` into domain checklists.
- Expanded CodeMode exception bounding in `suggestions.ts`.
- Updated dependencies including `typescript` 6.0.2, `@playwright/test` 1.59.1, and `eslint` 10.2.0.
- Updated `README.md` to display benchmark ranges for performance metrics to better reflect run-to-run variance.
- Updated 11 packages including `vitest` and `@vitest/coverage-v8` to `4.1.3`.

### Removed

- **BREAKING**: Legacy `GITHUB_REPO_PATH` environment variable in favor of `PROJECT_REGISTRY`.
- Experimental `dependency-maintenance` and `auto-release` workflows with related documentation.

### Fixed

- Interceptor schemas incorrectly failing with `-32602` validation errors.
- `callTool()` progress-token path bypassing interceptors.
- GitHub context data bleeding across shared helpers and faulty early returns in registries.
- GitHub cache fallback loop failing to resolve missing repository info in `issueUrl`.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` handlers.
- Base URI template parsing logic in `@modelcontextprotocol/sdk` converting `{repo}` to `{+repo}`.
- Omitted metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) in `search_entries` FTS and Hybrid pipelines.
- Missing `entry_id` query support in `team_semantic_search`.
- `VectorSearchManager` caching a closed database connection, causing index rebuild failures.
- Silent database synchronization failures caused by incorrect `fts_content_docsize` shadow table queries.
- ISO 8601 payload formatting for GitHub milestones.
- Markdown rendering issues in agent instructions.
- Prioritization bug where server instructions overshadowed dynamic briefing resolution.
- Misleading "Could not detect repository" hint for multi-project users.
- Documentation mismatch regarding the total resource count.
- GitHub CI badge workflow targets.
- Test suite stability issues including Zod validation gaps, random string generation crashes, and mock injection errors.

### Security

- Pinned `minimatch` to `10.2.5` to resolve transitive vulnerabilities.
- Updated container base image to `node:24.14.1-alpine`.
- Overrode `vite` to `^8.0.5` to patch path traversal vulnerabilities.
- Bumped CodeQL and TruffleHog GitHub Actions versions.

## [6.3.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.3.0) - 2026-03-27

### Added

- `team_get_cross_project_insights` added to the `admin` tool group.
- Initial support for Multi-Project Workspaces configured via `PROJECT_REGISTRY`.
- Explicit `owner` and `repo` support in `get_github_context` for dynamic directory mounting.
- `memory://briefing/{repo}` template resource for explicit context resolution across workspaces.
- Documentation outlining the `session-summary` workflow capabilities and cross-project routing.
- E2E testing for multi-project context resolution load stability.

### Changed

- `github-section` context builder dynamically iterates over all available projects inside the `PROJECT_REGISTRY`.
- Handlers tied to GitHub APIs perform dynamic contextual lookup using explicit `repo` arguments when present.

### Fixed

- Stale context being returned on `memory://briefing` reads referencing an empty default repository.
- `issueUrl` tracking referencing the PR branch API instead of expected Issue URL when handling batched objects.
- Zod date coercion exceptions resulting from malformed ISO date strings in `create_github_milestone`.
- `update_entry` leaking raw MCP schema validation boundaries upon large text description insertions.
- `get_kanban_board` status reporting mismatched strings across GitHub Project v2 configurations.

## [6.2.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.2.1) - 2026-03-23

### Added

- CI Gatekeeper workflow to block deployments containing failing security and quality reports.
- Comprehensive Dual-Schema pattern documentation for API tool surfaces.

### Changed

- GitHub Commander skill integrations unified with new security scan patterns.
- Wiki Drift Detector configured with verified lock files.
- Test suite reliability improvements via dependency sandboxing.

### Fixed

- Escaping schema validation exceptions in entry and search tools by relaxing the SDK-facing object representations.
- Rejection bugs in `create_github_issue_with_entry` and `create_github_milestone` by unpinning minimum length limits in the external schemas.
- Outdated documentation parameters referring to `source_id/target_id` syntax.

## [6.2.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.2.0) - 2026-03-23

### Added

- Extensive E2E Playwright test bundles validating HTTP streaming limits and API parsing schemas (~115 tests).
- E2E `codemode-groups` validation suite ensuring parity for code mode API environments.
- GitHub Commander skill workflow enabling structured triage, milestone completion validation, and CI audits.
- Auto-discovery mechanism of default/supplied skills natively available from the `memory://skills` resource tree.
- Wiki Drift Detector action identifying PR deviations against current Wiki repository guides.

### Changed

- Refined NPM tarball packaging configurations to inject dependencies without bloat.
- Stubbed unused transitive ML dependencies (e.g., `onnxruntime-web`, `sharp`) out of the final package build to reduce overall footprint sizes.
- Updated core application constraints via generic dependency patching.

### Fixed

- `restore_backup` incorrectly passing internal errors when omitting user confirmation instead of prompting the user.
- `team_link_entries` relationships returning incorrect references to self-referential IDs.

## [6.1.2](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.2) - 2026-03-22

### Fixed

- Ghost script import issues resolving across the unit testing structure.

### Security

- Resolved missing SHA references and unverified repository actions in `docker-publish.yml` to curb potentially untrusted code checkout risks during build execution.

## [6.1.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.1) - 2026-03-22

### Fixed

- Code cleanup resulting in the removal of dead initial variables, stale constants, and unreferenced imports.

### Security

- Hardened default build process execution to only utilize explicitly verified commit references during the checkout procedure to prevent malicious modifications.

## [6.1.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.0) - 2026-03-22

### Added

- 12 new tools bringing complete parity to team collaboration endpoints (`team_update_entry`, `team_delete_entry`, `team_export_entries`, etc.).
- 5 new clustering and semantic tools targeting Team indices (`team_semantic_search`, `team_add_to_vector_index`, `team_get_cross_project_insights`, etc.).
- `memory://rules`, `memory://workflows`, and `memory://skills` resources detailing external context and configuration information.
- Universal caching optimizations backing `memory://skills` queries to decrease expensive I/O blocks.
- Smart Auto-refinement system intercepting and translating generic SQL code errors into transparent, normalized categories.
- Built-in `structuredContent` properties matching standard formatting across specific exceptions.
- HTTP-level express boundaries enabling explicit OAuth gating restrictions tied directly to mapped API token usages.

### Changed

- Deprecated and removed legacy undocumented `tools.json` definitions.
- Refined npm and deployment metadata to map registry values appropriately.
- Overhauled and minimized `server-instructions`, enabling dynamic filtering and injecting tool instructions accurately against actively enabled scopes instead of delivering bulk schemas.
- Modified default `starter` and `essential` filters to utilize the `codemode` context by default.
- Modernized Code Quality testing benchmarks enforcing typed error configurations and schema limitations resulting in an A+ internal audit rating.
- Reconfigured npm deployment behaviors restricting publishing actions until the underlying containerized platform successfully validates dependencies.
- Updated cross-system dependencies to modern requirements.

### Fixed

- Re-architected `mj_execute_code` expression returns ensuring that inline actions surface explicit evaluation values back to the agent wrapper successfully.
- Implemented proxy traps targeting the `readonly` execution mode, properly suppressing arbitrary exception traces from mutation methods.
- Repaired inaccurate `search_entries` parameters ignoring exact tag subsets resulting in incorrectly broadened match findings.
- Improved index synchronization strategies resolving cases where FTS5 queries maintained ghost pointers to previously expunged resources.
- Formalized bidirectional constraints, stopping redundant mapping loops between connected journal interactions.
- Added systematic consistency logic formatting fallback anomalies and incomplete parameters throughout search endpoints, kanban queries, and entry aggregation tables.

### Security

- Inserted global injection sanitizers parsing out malicious code structures spanning stderr serialization channels.
- Hardened CI/CD architectures incorporating SLSA build attestations, unprivileged environments, and exact SHA actions.
- Disabled trivially exploitable library chains directly within builder boundaries to isolate vulnerable transitive dependencies.

## [6.0.1] - 2026-03-14

### Changed

- Updated system dependencies and isolated the Docker image building layers.

### Security

- Manually patched npm's bundled `tar` dependency in Dockerfile to fix HIGH severity path traversal vulnerability.

## [6.0.0] - 2026-03-14

### Added

- Expanded test coverage across resources and integrations resulting in 87% overall test coverage.
- Added comprehensive Playwright end-to-end testing verifying HTTP transport and session logic.
- Added automated repository maintenance workflows for use with the GitHub Copilot Agent.
- Structured error taxonomy utilizing the new `ErrorCategory` enum mapping precise server failures.
- Implemented configurable briefing contexts exposing system limits and template resources natively.
- Introduced fully functional RFC-compliant OAuth 2.1 authorization module enabling dynamic scopes across the HTTP transport framework.
- Added a deterministic execution sandbox (`Code Mode`) reducing token payload sizes and delivering programmatic script execution dynamically.

### Changed

- Switched completely to the native `better-sqlite3` driver, removing the `sql.js` WASM dependency.
- Normalized internal typings to adhere strictly with documented builder naming strategies.
- Redesigned Agent System prompts mandating a session initialization process tied to reading explicit briefing paths.
- Addressed code quality constraints, pruning stale tests, unused endpoints, and configuring robust HSTS bindings explicitly.
- Implemented high performance SQLite FTS5 queries enabling exact phrasing and optimized indexing.
- Grouped scattered testing artifacts mapping outputs cohesively in single directories.
- Overhauled Vector tracking utilizing `sqlite-vec`.
- Accelerated production compilations and reduced total assets delivered by shifting to `tsup` bundler paradigms.
- Discarded unmaintained translation packages in factor of `@huggingface/transformers`.
- Unified file naming schemas and isolated individual modules.
- Refactored `getTools` cache and initialization lazy loading ensuring massive drops in server boot-up overhead.

### Removed

- Dropped `express-rate-limit` adopting a zero-dependency approach for internal rate limits.
- Removed unused and unsupported GitHub hook integrations and legacy tracking methodologies.

### Fixed

- Supported seamless HTTP stream lifecycle reloading suppressing native SDK socket connection crashes.
- Corrected filter anomalies allowing Team elements to supersede personal journal search requests uninvitedly.
- Resolved vector queries breaking during asynchronous virtual table operations tied explicitly to standard ID parameters.
- Restored missing arguments parameter validations mapping accurately on search conditions.
- Secured native database deployments enforcing transactional limits avoiding concurrent write panics randomly.
- Repaired specific Mermaid graph elements returning raw texts instead of encoded string arrays blocking typical client renderings.

### Security

- Replaced vulnerable transitive `undici` packages resolving DoS request smuggling defects.
- Enforced explicit internal rate-limit mechanisms isolating application components completely.
- Bounded payload object ingestion thresholds minimizing uncontrolled injection scales securely.
- Restricted system architectures using bridging protocols blocking internal Docker exploitations entirely.
- Revoked potential authorization escalations via explicit `no-new-privileges` bounds absolutely.

## [5.1.0] - 2026-03-07

### Added

- Added `session-summary` workflow prompt mitigating unreliable session closeout behaviors manually.

### Changed

- Combined complex calculations generating entry importance metrics securely in a single command.
- Converted individual linkage queries to execute nested tags rapidly avoiding internal loops.
- Enforced strict parameter mapping to capture handled SDK failures appropriately.
- Increased base disk operations toggling in-memory boundaries to process logic natively faster.

### Removed

- Trashed unsupported SDK termination guidelines causing false anomalies continuously.

### Fixed

- Wired isolated parameter limits fetching metric arrays exclusively according to matching bounds correctly.
- Mapped internal success statuses returning boolean results correctly alongside standard exceptions comprehensively.
- Adjusted return configurations passing missing flags correctly matching declared interface definitions securely.

### Security

- Evaluated missing validation gaps appending rigorous ASCII limits strictly protecting JSON serialization entirely.

## [5.0.1] - 2026-03-06

### Changed

- Updated system dependencies to maintain reliable CI boundaries heavily.

### Security

- Remediated embedded tar configurations bypassing dangerous path vulnerabilities seamlessly.

## [5.0.0] - 2026-03-06

### Added

- Extended functional platform validations explicitly using new Playwright bindings covering all transport pathways automatically.
- Multi-row queries batching tag operations resolving latency faults systematically.
- Re-architected Team Collaboration implementing separate tracking paradigms and correct user assignments.

### Changed

- Refined Tool dispatch caching, eliminating redundant rebuild cycles unconditionally.
- Optimized Database path configurations, moving structured entries to `data/` directories cleanly.
- Consolidated internal execution streams minimizing boundaries massively.

### Removed

- Removed Legacy Team Collaboration components rendered obsolete by parallel DB deployments.

### Fixed

- Harmonized error output enforcing structured API exceptions resolving raw format leaks globally.
- Supported seamless HTTP stream lifecycle restarts reliably without crashing session limits.
- Addressed 404 handlers parsing accurate mappings completely bypassing generic Express errors successfully.

### Security

- Patched unsafe identifier constraints sanitizing raw interpolations explicitly.
- Locked system containers eliminating excessive dependencies granting node escalation privileges perfectly.
- Blocked Gitleaks boundaries actively intercepting undetected PRs immediately.

## [4.5.0] - 2026-03-02

### Added

- Added Automated Scheduler for recurring backups, optimization, and system restorations asynchronously.

### Changed

- Improved overall test coverage to 92.06%.
- Applied specific Session tracking hooks resolving unpredictable session context issues automatically.

### Fixed

- Mapped missing `(NaN)` parameters resolving backup exclusions inaccurately.

### Security

- Accelerated foreign keys restrictions enforcing dependencies successfully.
- Imposed rigorous Content-Security policies validating specific limits comprehensively.

## [4.4.2] - 2026-02-27

### Security

- Patched `minimatch` dependency fixing isolated ReDoS conditions inherently.

## [4.4.0] - 2026-02-27

### Added

- Added comprehensive GitHub Milestones integrations bridging issues and workflows directly.
- Added GitHub Repository Insights endpoint displaying granular traffic interactions dynamically.

### Changed

- Improved Vector Index algorithms parallelizing array embeddings ensuring faster rebuild speeds.
- Refined Importance Metrics generating specific percentage transparency breakdowns openly.

### Fixed

- Remediated missing Tool counts resolving inaccurate outputs randomly on instruction calls.

### Security

- Bound specific deployment gating protecting against failed security uploads heavily.

## [4.3.1] - 2026-02-05

### Fixed

- Mapped empty arrays returning safe fields ensuring project-insight evaluations gracefully handled missing dependencies natively.

### Security

- Upgraded libexpat bounds securing missing Null pointer limits efficiently.

## [4.3.0] - 2026-01-18

### Added

- Created Causal Relationship parameters assigning `caused`, `resolved`, and `blocked_by` bindings logically.

### Changed

- Implemented cached integrations applying external GitHub values populating entry dependencies automatically.

### Fixed

- Enforced strict condition execution repairing pipeline tags pushing unexpected Docker loads improperly.

## [4.2.0] - 2026-01-17

### Added

- Shipped HTTP/SSE Streaming endpoints serving independent remote clients interchangeably.
- Added explicit data management endpoints via `cleanup_backups` and `merge_tags` APIs dynamically.

### Changed

- Provided dynamic threshold guidance prompting clients intelligently mapping query boundaries optimally.

### Fixed

- Detected and assigned "unknown" states parsing invalid cancellation hooks directly from CI executions truthfully.

## [4.1.0] - 2026-01-17

### Added

- Added MCP Streaming Notifications passing updates reliably throughout extensive bulk imports automatically.
- Generated Visual Icons integrating representations uniquely across 31 endpoints securely.

### Changed

- Normalized explicit error definitions guiding consumers safely navigating invalid boundaries consistently.

### Fixed

- Eliminated invalid results referencing deleted bounds executing asynchronous operations gracefully.

## [4.0.0] - 2026-01-16

### Added

- Added GitHub Lifecycle Tools binding implementations explicitly spanning `close_github_issue_with_entry`.

### Changed

- Filtered payload responses via dynamic `structuredContent` boundaries mitigating payload bottlenecks easily.

### Fixed

- Rebuilt native `SemanticSearch` handlers auto-detecting exact metrics bypassing full rebuild boundaries seamlessly.

## [3.1.5] - 2026-01-11

### Security

- Excluded unverified `protobufjs` boundaries eliminating isolated node escalation exploits fully.

## [3.1.4] - 2026-01-11

### Fixed

- Handled `glob` patches accurately restricting upstream node versions smoothly.

## [3.1.3] - 2026-01-11

### Security

- Maintained Alpine image patches executing continuous downstream bindings reliably.

## [3.1.2] - 2026-01-11

### Fixed

- Resynced dependencies loading standard builds ensuring exact lock versions strictly accurately.

## [3.1.1] - 2026-01-11

### Security

- Repatched system dependencies eliminating known internal system loops seamlessly.

## [3.1.0] - 2026-01-11

### Added

- Added comprehensive GitHub Projects v2 Kanban mappings mapping explicit statuses alongside system variables securely.

### Changed

- Refactored server instructions bounding token loads natively resolving long text expansions correctly.

## [3.0.0] - 2025-12-28

### Security

- Implemented Zod system schemas strictly assigning valid conditions universally.

## [2.2.0] - 2025-12-08

### Changed

- Disabled unnecessary tool logic actively dropping unused endpoint routes transparently.

## [2.1.0] - 2025-11-26

### Fixed

- Resolved `github_issues` missing linkage paths establishing context dynamically directly.

## [2.0.1] - 2025-10-28

### Changed

- Assorted platform corrections rendering documentation correctly reflecting cross-platform setups dependably.

## [2.0.0] - 2025-10-28

### Added

- Deployed comprehensive exception classifications maintaining explicit error routing natively.

## [1.2.2] - 2025-10-26

### Security

- Patched local substring boundaries restricting injection mappings securely on git URL endpoints safely.

## [1.2.1] - 2025-10-26

### Changed

- Appended tracking messages allowing direct state insights accurately globally.

### Fixed

- Restructured synchronous boundaries accelerating `semantic_search` bounds initializing ML endpoints cleanly.

## [1.2.0] - 2025-10-26

### Fixed

- Addressed boundary matching parsing missing characters bypassing string injections correctly natively.

## [1.1.3] - 2025-10-04

### Fixed

- Implemented standard database creations correctly parsing fresh dependencies explicitly quickly.

## [1.1.2] - 2025-10-04

### Security

- Addressed known vulnerable boundaries securing basic Python references appropriately.

## [1.1.1] - 2025-10-04

### Fixed

- Mapped unsupported variables fixing direct startup execution errors predictably smoothly.

## [1.1.0] - 2025-10-04

### Added

- Added direct linkages supporting structured `relationship` patterns tracking boundaries properly.

## [1.0.2] - 2025-09-15

### Added

- Initial project scaffolding initialized successfully natively securely.
