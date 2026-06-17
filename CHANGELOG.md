# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v8.0.1...HEAD)

## [8.0.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v8.0.1) - 2026-05-31

### Fixed

- **reverted**: Docker base image from Debian Slim to Alpine Linux (`node:26.2.0-alpine`) to eliminate 50+ vulnerabilities.
- **implemented**: native `sqlite-vec` compilation from C source on Alpine (musl) to fix missing GLIBC extension load errors.

### Changed

- **bumped**: `docker/metadata-action` from `6.0.0` to `6.1.0` (`2ef31717`)
- **bumped**: `docker/scout-action` from `1.20.4` to `1.21.0` (`0170b866`, `c238bef5`, `78ef35e3`)
- **bumped**: `actions/upload-artifact` from `7.0.0` to `7.0.1`

## [8.0.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v8.0.0) - 2026-05-31

### Added

- **admin**: `project_number`, `significance_type`, and GitHub metadata fields to `update_entry` and `team_update_entry`
- **analytics**: On-read computation with 60s TTL cache, startup snapshot seeding, and live fallback for `memory://insights/digest`
- **auto-prune**: Importance-based garbage collection for old, low-importance entries via CLI flags and environment variables (`e245bd59`)
- **briefing**: Server version, resource/tool counts, test health indicators, workspace paths, git working tree status, code-map availability, `📊 memory://metrics/summary` breadcrumb, and unreleased change summary to `memory://briefing` output
- **codemode**: Enhanced sandbox with `context`/`readonly` parameters, runtime schema introspection, progress notification bindings, and additional aliases
- **docs/misc**: Missing CLI flags, environment variables, auto-prune documentation, and "Customizing the Session Briefing" sections
- **errors**: Valid enum value lists to Zod validation error messages
- **github**: Dependabot configuration scoped to `github-actions` only for passive version update notifications (`224db82d`)
- **instructions**: 14 new `EntryType` values, `architecture`/`security` significance types, missing tool parameters, and `HELP_CONTENT` export (`fe4ccbf2`, `cc081ee7`)
- **metrics**: Dynamic tracking for deprecation warnings (`MetricsAccumulator.recordDeprecationWarning`)
- **prompts**: `adversarial-plan-review` and `flag-dashboard` prompts for multi-pass planning and flag triage (`d5d76825`)
- **resources**: `memory://flags/history` resource showing recently resolved flags with resolution details and average time-to-resolution metrics
- **scripts**: Added `test:scheduler` and `test-progress.mjs` for E2E and integration testing
- **skills/misc**: Added 20+ skills including official vendor integrations, adversarial auditing, and `docs-marketer` (`b30f21d5`, `1a5d3617`)
- **team**: Added `team_list_flags`, `team_update_flag`, and `team_get_flag_analytics` tools for flag management (`699d0185`)
- **ci/cd**: Added Docker smoke test job to `docker-publish.yml` that verifies binary loading and HTTP transport starts successfully before images are pushed to the registry (`1b6a4b12`)

### Changed

- **briefing**: Enhanced rendering with filtered milestones, capability statuses, and prioritized CI workflows (`879303d1`, `5970be7e`)
- **codemode**: Optimized dynamically generated TypeScript declarations and removed redundant strings to save tokens (`56271066`)
- **docker**: Bumped Node.js base image to `26.2.0-alpine` (#563)
- **docs/misc**: Highlighted auto-prune, standardized `README.md` layout, and simplified agent briefing instructions
- **prompts**: Enhanced `flag-dashboard` and surfaced team flags in standup/retro prompts (`afb11754`)
- **resources**: Changed `memory://briefing` and `memory://briefing/{repo}` to return `text/markdown` directly instead of JSON objects for token efficiency
- **schemas**: Enforced strict `project_number` validation across Core and Team tools with formatted validation errors
- **skills/misc**: Restructured large skills, expanded `mcp-builder`, and upgraded `adversarial-planner` to embed `gh copilot` scans (`626f16e9`)

### Removed

- **instructions**: `gotchas.md`, `codemode.md`, and `server-access.md` static help files to reduce agent distraction and token usage (`00bb555d`)
- **resources**: Redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints

### Fixed

- **annotations**: Added missing `destructiveHint: false` to 62 tools and `idempotentHint: false` to `delete_entry`
- **briefing**: Fixed dynamic context routing, deduplicated entry previews, and rendering cutoff issues (`b24ccfce`)
- **codemode**: Comprehensive hallucination interception for API aliases, missing parameters, and unsupported cross-server database queries
- **codemode**: Expanded global sandbox bindings, proxy mappings, and parameter coercions for robust agent interactions (`a6af8bc7`)
- **codemode**: Improved error handling and validation for legacy payloads, syntax errors, and missing fields
- **core**: Enforced strict validation for significance types and fixed `auto_context` persistence mapping
- **docs/misc**: Synchronized `code-map.md`, `README.md`, environment variables, and tool counts across documentation
- **github**: Fixed parameter hallucinations in repo insights, payload truncation flags, and repository resolution fallbacks (`6ff67c4b`, `f35079c0`, `d4479c31`)
- **instructions**: Fixed hallucinated JSON parsing instructions, corrected tool schemas, and restored missing `gotchas.md` help content (`00bb555d`)
- **io**: Fixed `export_entries` ignoring limits and increased ceiling to 5000 (`52043357`, `3eaf6941`)
- **progress**: Fixed step numbering gaps and missing notifications in export and backup sequences (`2e7a04b9`)
- **relationships**: Fixed `visualize_relationships` returning `null` when empty, and intercepted hallucinated schema parameters (`703f3f75`)
- **resources**: Fixed `memory://help` failing to extract parameters from ZodPipelines
- **repo**: Mapped `repo_name` fallback to `repo` within `mj_execute_code` sanitization to prevent context loss (`4abe0db4`)
- **scripts**: Improved E2E scheduler test scripts and help pointer mapping logic
- **server**: Fixed structured error responses for Zod validations and payload limits, preventing raw JSON-RPC leakages (`bf9b234c`, `fb7d9039`)
- **skills/misc**: Remediated frontmatter, database triggers, and stub implementations across migrated skills
- **team**: Fixed parameter parsing, path traversal checks, schema errors, and `project_number` filtering across team tools

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs/misc**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills/misc**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability (`e8085ff3`, `c3ff58af`, `5530ef51`)

## [7.7.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.7.1) - 2026-05-15

### Changed

- **Dependency Updates**:
  - Bumped Docker base image `node` from 24.15.0-alpine to 26.1.0-alpine
  - Bumped GitHub Actions (`trufflesecurity/trufflehog`, `github/codeql-action`, `github/gh-aw-actions`)

## [7.7.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.7.0) - 2026-05-06

### Added

- **`adversarial-planner`**: skill: multi-pass adversarial planning and review with structured critique stages and Copilot CLI validation
- New entry types: `plan_draft`, `adversarial_review`, `plan_refinement`, `copilot_validation`

### Changed

- **Dependency Updates**:
  - Bumped GitHub Actions (`github/gh-aw-actions`, `aquasecurity/trivy-action`, `github/codeql-action`)

### Fixed

- **stale**: version `7.6.0` in `server.json` (version field and OCI identifier) → updated to `7.7.0` (`fee53990`, `39d64936`, `b66c375a`)
- **stale**: skill name `mastering-typescript` in server instructions → corrected to `typescript`
- **added**: `adversarial-planner` and `copilot-audit` to the native skills listing in server instructions (`c8970362`, `dc642d51`, `048f4fe3`)
- **fixed**: `assertSafeFilePath` validation in `buildRulesFileInfo` and `buildSkillsDirInfo` swallowing the output of `memory://briefing` metadata when paths were outside explicitly allowed IO roots.
- **fixed**: `INTERNAL_ERROR` during `restore_backup` in Code Mode by migrating atomic database swap from `fs.rename` to `fs.copyFile` to bypass Windows `EBUSY` file locks from `sqlite-vec`. (`0e4e3ea8`)
- **fixed**: `search_by_date_range` omitting the `source: 'personal'` metadata field when skipping cross-database merging. (`8aa66d39`)
- **fixed**: `restore_backup` returning a raw MCP JSON-RPC exception when called with missing required parameters by relaxing the outer schema. (`05896c8b`, `32508c7b`, `f5707995`)

### Security

- **fixed**: XSS vulnerability in `ip-address` by overriding version to `10.2.0`
- **fixed**: HIGH severity Trivy code scanning alert (CVE-2026-27135) by explicitly upgrading `nghttp2-libs` from Alpine edge repository in Dockerfile (`4da305ad`)

## [7.6.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.6.1) - 2026-04-22

### Fixed

- **code**: Mode and standard test failures when creating, resolving, or searching global team flags by resolving strict `project_number` nullish schema validation errors.
- **internal**: crash in `team_search` and `team_search_by_date_range` when filtering global flags by conditionally bypassing the strict multi-tenant `project_number` requirements when explicitly searching for `flag:` tags or `entry_type === 'flag'`.

### Changed

- **Dependency Updates**:
  - Bumped `aquasecurity/trivy-action` from `v0.35.0` to `v0.36.0`. (`8c2111f8`)
  - Bumped `github/codeql-action` from `v4.35.1` to `v4.35.2`.
  - Bumped `trufflesecurity/trufflehog` from `v3.94.3` to `v3.95.2`.
  - Bumped `actions/attest-build-provenance` from `v2` to `v4.1.0` (SHA-pinned). (`be8f7f89`, `a317583b`)

## [7.6.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.6.0) - 2026-04-21

### Added

- **explicit**: HTTP service-level `curl` container health-checks to `docker-compose.yml`.
- **true**: O(1) LRU eviction (using `Map.prototype.keys().next()`) to rate-limiting and user tracking maps to deterministically cap memory under high throughput.
- A `Map` caching layer tied to the local workspace path to minimize redundant OctoKit and Git instantiations.

### Changed

- **replaced**: eager memory-bound directory reads with asynchronous `opendir` streaming in the markdown importer to prevent process OOM.
- **replicated**: strict 5MB payload truncation limits to `team_export_entries` for consistent memory bounds.
- **enforced**: strict IP-binding session isolation for Bearer-Token Auth Mode.
- **renamed**: 'Audit Ledger' to 'Operational Telemetry' to clarify its non-immutable operational scope.
- **centralized**: `enforceAccessBoundary` in `src/auth/validation.ts` to standardize fail-closed capability checks (`requiresTeamScope`, `requiresAdminScope`, `mutatesState`).
- **implemented**: an asynchronous decoupled outbox pattern for GitHub mutations, preventing rollback deletions upon external API errors.
- **enforced**: atomic transaction boundaries and synchronized FTS5/vector indexing during massive rebuilds and soft deletes.
- **decoupled**: server initialization from database queries to guarantee constant-time startup.
- **hoisted**: execution-invariant server state (tools, prompts, filter sets) to bypass redundant cycles during client connections.
- **optimized**: database searches by replacing correlated subqueries with batched, in-memory aggregate lookup tables and CTEs.
- **moved**: ML vector semantic indexing to an asynchronous background task. (`d8cd5d16`, `2c6a2ec2`)
- **replaced**: the legacy `vm` sandbox mode with production-grade `worker_threads` isolation for `mj_execute_code`. (`8d4fbb30`, `f50027d9`)
- **updated**: `execute_code` payload limit to dynamically use `CODE_MODE_MAX_RESULT_SIZE`. (`b7a947e2`, `7765e07c`)
- **extended**: `ProjectContext` in GitHub handlers to dynamically bundle a `degraded` array property, exposing partial API failures without crashing.
- **decoupled**: `create_entry` workflow to safely update personal and team databases synchronously.
- **batched**: database operations within a single transaction in the markdown importer to improve throughput. (`5b1faa3c`, `51676e72`, `f0ed5f98`)
- **transitioned**: Markdown importer frontmatter parsing to strict JSON validation.
- **added**: a 24-hour absolute TTL limit to streamable HTTP sessions.
- **enforced**: absolute path canonicalization and strict Zod validation for `PROJECT_REGISTRY`.
- **implemented**: filesystem existence verification and logging for `ALLOWED_IO_ROOTS`. (`cb6f386d`, `c9652bef`)
- **reduced**: `OVERFETCH_MULTIPLIER` in hybrid search from 3 to 2 to improve performance.
- **updated**: the FTS5 sanitization regex to preserve phrase quotes (`"`) and wildcards (`*`).
- **replaced**: the global metrics singleton with instance-scoped `context.runtime.metrics` to ensure tenant boundary integrity.
- **exposed**: explicit `isReady` semantic index status on the `memory://health` resource.
- **created**: an explicit repository-local `.npmrc` enforcing `save-exact=true` and `engine-strict=true`. (`731b05c9`, `73148fb1`)

### Deprecated

- **`autocontext`**: field across the memory journal ecosystem.
- **core**: `.getRawDb()` and execution mechanisms (now marked `@internal`).

### Fixed

- **excluded**: unmeasurable runtime scripts and empty barrel files from Vitest metrics to accurately reflect 90%+ line coverage.
- **multi-project**: repository fallback failures for naked resource URIs and global GitHub resources by iterating `PROJECT_REGISTRY`.
- **`team_create_entry`**: regression blocking explicit `author` claims in non-OAuth environments.
- **outputschema**: compliance bugs in `create_github_issue_with_entry`, `close_github_issue_with_entry`, `team_pass_flag`, and `team_resolve_flag`. (`fc3df644`)
- N+1 query performance bottlenecks during team semantic search and Markdown exports.
- **`significantresource`**: compute overhead by precomputing entry timestamps. (`4886f8c8`, `e87a137a`)
- **re-implemented**: legacy SSE transport to enforce `MAX_STATEFUL_SESSIONS` boundaries.
- **false-positive**: path traversal errors preventing server initialization on Windows. (`bdddffcc`, `50983200`)
- **concurrency-related**: SQLite lock exhaustion failures by standardizing sequential long-running task locks.
- **backup**: restore race conditions, stale deadlocks, and SQLite lock swap failures on Windows.
- **silent**: error suppression in `mcp-server.ts`, `backup.ts`, and `team.ts` by ensuring warnings propagate to `stderr`. (`0a6b348d`)
- **false-positive**: `--cors-origin` tooltip configurations back to its `none` baseline.
- **code**: Mode sandbox crashes when encountering `[Circular]` references.
- **code**: Mode test regressions where `flagMetadata` was omitted for Hush Protocol flags.
- RFC 9728 `Content-Type` header emission in the OAuth metadata endpoint.
- **standard**: MCP protocol compliance for legacy SSE transport by supporting `sessionId` in query strings.
- **prompt**: handler failures now surfacing as proper MCP protocol errors.
- **`team_import_markdown`**: to correctly pass `author` and `project_number` to SQLite insertions.
- **re-enabled**: `X-Forwarded-For` extraction in `getClientIp` using the `trustProxy` setting.
- **`pragma**: integrity_check` tracking within `NativeConnectionManager` mutation whitelists.
- **rate**: limiting test regressions by dropping User-Agent entropy from identity hashes. (`7367a809`)
- **vector**: indexing silently reporting success when the underlying boolean indicated failure. (`4015f34f`, `9e9f4b8d`)
- **team**: semantic search omitting cross-project vectors by enforcing `project_number` filtering before truncations.
- **enforced**: hard exceptions on SQLite WAL checkpoint failures to prevent incomplete backups. (`35c18b67`, `49c3d465`, `05896c8b`)
- **graceful**: handling of post-commit lookup failures in `createEntry` via synthesized returns. (`5bcc97df`)
- **startup**: schema migrations in `NativeConnectionManager` by wrapping column injections in atomic transactions.
- **re-added**: junction table `JOIN` to `entry_tags` to correctly resolve tag constraints during team searches.
- **deferred**: monolithic FTS5 rebuilding queries in `NativeConnectionManager` to background processes.
- **bounded**: uncontrolled GitHub API Promise fan-out within `BriefingGitHub` fetches using sequential chunking.
- **code**: Mode sandbox result size error to properly report the actual serialized payload size.
- **path**: traversal boundary errors in `memory://rules` and `memory://skills` resource handlers.
- **`create_entry`**: returning a stale entry object lacking the auto-populated `issueUrl`. (`88b2dcbf`)
- **context**: resolution and project metadata propagation bugs inside Code Mode sandboxes.
- **`owner/repo`**: matching failures for project registry keys containing only the `repo` name in Code Mode.
- **boundary**: exception leaks in Code Mode where authorization failures threw raw exceptions instead of structured errors.
- **performance**: oversight in `GitHubIntegration.getRepoInfo()` causing redundant `git branch` subprocesses.
- **`githubintegration`**: throwing raw 404 exceptions instead of returning `null` for non-existent issues, PRs, and milestones.
- **`get_copilot_reviews`**: throwing unhandled 404 errors for non-existent PRs.
- **semantic**: search crash where `sqlite-vec` virtual table KNN queries failed due to missing `k = ?` constraints.
- **search**: tools where `include_team` defaulted to `false` preventing Code Mode from resolving team entries by default.
- **`sanitizeftsquery`**: where valid FTS5 boolean queries (AND, OR, NOT) were silently stripped. (`d0928188`, `b48e5328`, `c7f6232f`)

### Security

- **updated**: `hono` to `4.12.14` to resolve a medium severity vulnerability. (`32109b37`)
- **limited**: FTS5 query tokens to 500 characters to prevent ReDoS and AST bloat. (`2fd2f8f9`)
- **enforced**: per-invocation `randomUUID()` for `mj_execute_code` client IDs to isolate unauthenticated `stdio` callers.
- **replaced**: insecure `JSON.parse()` with Zod `AutoContextSchema` validations in team/briefing resources.
- **enforced**: strict tool-to-scope verification during server initialization.
- **required**: explicit `allowedIoRoots` for I/O operations instead of falling back to `PROJECT_REGISTRY`.
- **capped**: IP `rateLimitMap` and `userCounts` map to 10,000 keys to prevent OOM attacks.
- **truncated**: large JSON exports to prevent memory exhaustion, returning a `truncated: true` flag. (`514bbf7d`)
- **shielded**: SQLite backup restorations with strict `path.resolve` boundary validations against symlink traversals.
- **enforced**: post-restore schema validation using `PRAGMA integrity_check` before applying backups.
- **modified**: `TokenValidator` to fail-closed on misconfigured JWKS origin or Issuer metadata.
- **required**: `SCOPES.TEAM` (instead of generic `WRITE`) for team operations.
- **rejected**: claimed authorship (author injection) in team tools outside an authenticated OAuth scope.
- **routed**: internal Code Mode tool calls through `callTool()` to enforce OAuth scope checks and audits.
- **ensured**: legacy SSE transport runs inside `requestContextStorage.run()` to apply rate limiters.
- **rejected**: team tool operations where `input.author` mismatched the authenticated principal's `sub` claim.
- **extracted**: trusted origin properties from `getAuthContext()` for authenticated authorship tracing.
- **added**: multi-tenant `project_number` warnings to team search tools to prevent cross-tenant traversals.
- **standardized**: SQL `LIKE` wildcard escaping across database adapters.
- **refused**: wildcard CORS (`*`) without explicit authentication.
- **prevented**: path traversal and symlink escapes in markdown importer/exporter via `fs.realpath` and `fs.lstat`.
- **prevented**: metadata injection vectors in frontmatter serialization via `quoteYamlString`.
- **mitigated**: directory TOCTOU symlink attacks in markdown exports via post-open inode validation.
- **obscured**: absolute host paths from Database Backup logs using `path.basename`.
- **restrained**: unconstrained input search schemas with explicit `z.string().max(250)`.
- **enforced**: LLM Content Provenance rules with `<untrusted_remote_content>` wrappers for remote content.
- **mitigated**: SSRF DNS rebinding in OAuth metadata discovery by replacing `fetch` with pinned `node:https`.
- **parameterized**: `strftime` format strings in timeline queries to eliminate SQL interpolation risks.
- **narrowed**: `isPublicPath` scope from `/.well-known/*` wildcards to strict OAuth endpoints.
- **closed**: TOCTOU race condition in `audit-logger.ts` recent log queries by querying size from the file handle.
- **mitigated**: prompt injection by escaping HTML angle brackets in `markUntrustedContent`.
- **eliminated**: unbounded GraphQL query fanout in GitHub tools by enforcing explicit API fetch limits.
- **prevented**: path traversal during GitHub integration initialization by enforcing regex validation against `PROJECT_REGISTRY`.
- **replaced**: brittle `lstat` checks in markdown exporter with `fs.realpathSync.native()` to prevent TOCTOU symlink swaps.
- **reclassified**: core mutation tools to require `WRITE` scope to fix capability injection risks. (`59c162c9`)
- **explicitly**: gated the Code Mode sandbox execution behind an `admin` OAuth scope.
- **prevented**: memory exhaustion (DoS) by adding strict boundary length protections to tags and relationships.
- **implemented**: strict 50MB global and 10MB per-item cache memory limits for the GitHub API client.
- **escaped**: static URI patterns in the dynamic resource router template generation to neutralize ReDoS.

## [7.5.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.5.0) - 2026-04-13

### Added

- **Skills**: Integrated `github-copilot-cli` skill for interactive, terminal-native code reviews.
- **Workflows**: Added `copilot-audit` pre-push review loop for evaluating uncommitted changes via Copilot.
- **Hush Protocol**: Introduced a machine-actionable team communication system:
  - Tools: Added `team_pass_flag` and `team_resolve_flag`.
  - Resources: Added `memory://flags` dashboard and `memory://flags/vocabulary`.
  - Config: Added `--flag-vocabulary` CLI argument and `FLAG_VOCABULARY` env var.
  - Core: Added `'flag'` entry type, `ICON_FLAG`, and behavioral instructions.
- **Briefing**: Integrated active flags summary and added `localTime` for chronological grounding. (`2b472736`)

### Changed

- **Dependency Updates**:
  - Bumped `better-sqlite3` to v12.9.0 (`13649056`, `846c73c8`, `4a72e042`)
  - Bumped `globals` to v17.5.0
  - Bumped `simple-git` to v3.36.0
  - Bumped `diff` from 8.0.4 to 9.0.0 (docker bundle optimization) (`e51e8638`, `ec792382`)
  - Bumped `trufflesecurity/trufflehog` to 3.94.3
  - Bumped `hashgraph-online/skill-publish` to 1.0.13
  - Bumped `github/gh-aw-actions` (c7a6a831 to 0048fdad) (`b2434695`)
  - Bumped `docker/login-action` to 4.1.0
  - Bumped `actions/upload-artifact` to 7.0.1
- **Briefing**: Renamed the ambiguous `Matrix Density` insight label to `Relationship density`.

### Fixed

- **Types**: Added missing `importanceScore` property to `JournalEntry` interface.
- **Search**: Fixed early `.slice()` truncation that dropped high-relevance results prior to importance sorting.
- **Analytics**: Fixed SQLite `%Y-Q` quarterly grouping calculation by explicitly deriving months.
- **Constraints**: Fixed raw limit evaluation by strictly enforcing `MAX_QUERY_LIMIT` (500) across Team Searches.
- **Consistency**: Hardened `teamCollaborationResource` return payload structure.
- **Hush Protocol**: Fixed SQLite mapping bug inadvertently casting `autoContext` JSON strings to booleans. (`c5194432`)
- **Analytics**: Fixed an issue in `get_statistics` where the date range filter was inadvertently ignored for causal relationship metrics. (`5970be7e`)
- **Transport**: Resolved an E2E testing timeout in `session-advanced.spec.ts` caused by dangling MCP SDK Server transports preventing sequential reconnections. `server.close()` is now wrapped in a `Promise.race` to forcefully detach SDK transport state and unblock the event loop.

## [7.4.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.4.0) - 2026-04-11

### Added

- New agent skills: `python`, `docker`, `tailwind-css`, and `github-actions` (`neverinfamous-agent-skills` updated to `1.1.0`).
- **`sort_by`**: parameter (`timestamp` or `importance`) for personal and team search tools.
- **`team_get_collaboration_matrix`**: tool for analyzing author activity density and cross-collaboration patterns.
- **proactive**: Data Analytics tasks for background repository health snapshots (configured via `--digest-interval`).
- **`memory://insights/digest`**: and `memory://insights/team-collaboration` resources for analytics snapshots.
- **injected**: analytics metrics into `memory://briefing` payloads.

### Fixed

- **missing**: `{ success: true }` wrapper on `team_get_cross_project_insights` payload.
- **output**: validation crash when calling `close_github_issue_with_entry` with `move_to_done: true` and no configured `project_number`. (`0b1cffcc`)
- **missing**: `sortBy` delegation in text search and sorting logic during cross-database merges.
- **missing**: `mj.export.*` API documentation in Code Mode instructions.
- **incorrect**: mapping of `io.ts` in `test-server/code-map.md`.

## [7.3.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.3.0) - 2026-04-10

### Added

- **metadata**: filters (`tags`, `entry_type`, date range) for `team_semantic_search` to achieve parity with personal searches.

### Changed

- **standardized**: `success: true` response field across all read-only tools.
- **centralized**: `passMetadataFilters` evaluation for consistency across search handlers.

### Fixed

- **validation**: crash in `create_github_issue_with_entry` when Kanban additions fail or boards are unknown. (`fc3df644`)
- **vector**: and semantic index filtering failing to properly drop matches after evaluating in-memory criteria.
- Low result variety in vector searches when metadata filters were applied (resolved via explicit 10x oversampling).
- **inconsistent**: validation errors; schema and programmatic failures now uniformly emit `VALIDATION_ERROR`. (`be20bf9e`)
- **`get_entry_by_id`**: incorrectly accepting float values instead of strict integers. (`e94a11eb`)
- **prompt**: handlers throwing raw MCP protocol exceptions instead of wrapping them in user-visible boundary messages. (`de478ba4`, `cfd764cb`)
- **`link_entries`**: allowing the creation of relationships to soft-deleted entries.

## [7.2.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.2.0) - 2026-04-09

### Added

- **bundled**: native foundational agent skills (`bun`, `github-commander`, `golang`, `mysql`, `playwright-standard`, `postgres`, `react-best-practices`, `rust`, `shadcn-ui`, `skill-builder`, `sqlite`, `typescript`, `vitest-standard`) for out-of-the-box system context
- **`roadmap-kickoff`**: and `update-deps` workflows
- **`docs/deployment.md`**: documentation
- **`add_kanban_item`**: and `delete_kanban_item` tools for GitHub project boards
- **configuration**: variables (`BRIEFING_MILESTONE_COUNT`, `BRIEFING_SUMMARY_COUNT`, `CODE_MODE_MAX_RESULT_SIZE`) and their corresponding CLI flags
- **`summary_only`**: and `item_limit` parameters for `get_kanban_board`
- **`truncate_body`**: parameter for `get_github_issue` and `get_github_pr` (`e33decc4`)
- **`include_comments`**: parameter for `get_github_issue` (`e33decc4`)
- **`"latest**: Summary"` field in `memory://briefing` to surface the most recent session summary
- **agent-guidance**: error messages for Code Mode result size violations (`f6af8ad3`, `a7460f96`, `82cb02d4`)
- **metadata**: fields `bodyTruncated`, `bodyFullLength` for GitHub issue/PR schemas, and `itemCount`, `truncated`, `summaryOnly` for Kanban output schemas (`b48e5328`)

### Changed

- **reduced**: Code Mode default max result size from 10 MB to 100 KB
- **enforced**: a 500-item maximum limit in `get_recent_entries`, `get_github_issues`, and `get_github_prs` (`d71482a5`)
- **implemented**: payload truncation in GitHub prompts to prevent excessive context allocation (`0f4f6c44`)
- **added**: in-memory TTL caching for GitHub issue comments and `memory://rules` resource
- **updated**: `@vitest/coverage-v8` and `vitest` dependency versions to `4.1.4` (`23640bf2`, `8e40f5da`)

### Fixed

- **fixed**: missing lower-bound validation constraint on `limit` parameters
- **empty**: parameter objects (`{}`) in `search_entries` bypassing validation, now correctly returning structured `VALIDATION_ERROR`
- **code**: Mode `mj_execute_code` failing to block write operations when `readonly` is requested (`b7a947e2`, `7765e07c`)
- **`link_entries`**: ignoring soft-deleted state when creating new relationships
- **cross-project**: context leakage in `memory://briefing` query scoping
- **incorrect**: milestone sort direction in the `memory://briefing` reference
- **missing**: `OAUTH_CLOCK_TOLERANCE` environment variable fallback in CLI configuration parsing (`a2c7e433`)
- **incorrect**: mapping of IO tool group to `export.ts` instead of `io.ts` in `code-map.md`
- **shortened**: `DOCKER_README.md` to adhere to Docker Hub's 25,000 character limits (`61a56d97`, `45a747d1`, `c1e07179`)

## [7.1.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.1.0) - 2026-04-08

### Security

- **disabled**: OIDC token minting in the HOL validation workflow (`id-token: none`) as a Least Privilege security best practice (resolves PR #378 intent).
- **removed**: deprecated `gitleaks-action` from the secret scanning workflow in favor of the active `trufflehog` step to resolve Node.js 20 deprecation warnings.
- **updated**: `docker/scout-action` to `v1.20.4` to clear pending security scanning CI warnings. (`0170b866`, `c238bef5`, `78ef35e3`)

### Added

- **created**: the `io` tool group to manage bidirectional data portability and cross-domain data indexing.
- **added**: `export_markdown` and `import_markdown` tools for full round-trip entry synchronization using semantic YAML frontmatter parsing.
- **added**: `team_export_markdown` and `team_import_markdown` tools to support seamless data synchronization for team databases.
- **included**: `assertSafeDirectoryPath` core security guardrail for path traversal protection on directory-based APIs.
- **added**: `relationship_type` filtering flag to `visualize_relationships` tool to isolate specific graph edge connections.

### Fixed

- **removed**: unnecessary `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` environment flag from the Trivy security scanning job.
- **applied**: explicit version pinning comments (`# v1.0.11`) to the `skill-publish` workflow step for transparent auditability.

### Changed

- **deprecated**: `ICON_EXPORT` constant in favor of `ICON_IO` utilizing a bidirectional SVG visual design to signal interoperable data flow.
- **lowercased**: group mappings for API Code Mode proxies. (`12a98d99`, `2f18485e`)

## [7.0.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.0.1) - 2026-04-07

### Added

- **`.github/workflows/hol-skill-validate.yml`:**: HOL skill validation CI gate — validates `skills/github-commander` package structure on push/PR via `hashgraph-online/skill-publish` in validate-only mode (no secrets, no publishing). Scoped to skill directory changes via `paths:` filter. Incorporates PR [#360](https://github.com/neverinfamous/memory-journal-mcp/pull/360) with corrections: standard checkout SHA, `main`-only trigger, path filtering.

### Fixed

- **`docker_readme.md`:**: repaired broken env var table (two fragments with missing header separator merged into one); removed deprecated `GITHUB_REPO_PATH` row (removed in v7.0.0)
- **core/docs:**: purged stale references to `GITHUB_REPO_PATH` across codebase and template error strings, replacing them with `PROJECT_REGISTRY` guidance

## [7.0.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v7.0.0) - 2026-04-07

### Added

- **playwright**: E2E observability testing for `/metrics` and `/audit` resources. (`b8e03515`)
- **hybrid**: Reciprocal Rank Fusion (RRF), heuristic query classification, and exposed `searchMode` for `search_entries`.
- **direct**: `entry_id` bypass and metadata filters for semantic search tools. (`a0254d24`, `aa332002`)
- **token**: estimation and `_meta.tokenEstimate` injection for context awareness.
- **async**: JSONL `AuditLogger` with rotating archives, redaction, interceptor hooks, and observability resources (`memory://audit`, `memory://metrics/*`).
- **categorized**: placeholders in `.env.example` and `mcp-config-example.json`. (`3a0f1bdb`)

### Changed

- **modularized**: `search.ts` into folder-based handlers. (`2448bfcc`)
- **reduced**: `DOCKER_README.md` size to comply with Docker Hub constraints. (`61a56d97`, `45a747d1`, `c1e07179`)
- **restructured**: `test-errors.md` into domain checklists.
- **expanded**: CodeMode exception bounding in `suggestions.ts`.
- **updated**: `README.md` to display benchmark ranges for performance metrics to better reflect run-to-run variance.
- **updated**: 11 packages including `vitest` and `@vitest/coverage-v8` to `4.1.3`. (`23640bf2`, `8e40f5da`)

### Removed

- **BREAKING**: Legacy `GITHUB_REPO_PATH` environment variable in favor of `PROJECT_REGISTRY`.
- **experimental**: `dependency-maintenance` and `auto-release` workflows with related documentation.

### Fixed

- **interceptor**: schemas incorrectly failing with `-32602` validation errors. (`66813987`, `06d1aa95`)
- **`calltool()`**: progress-token path bypassing interceptors.
- **github**: context data bleeding across shared helpers and faulty early returns in registries.
- **github**: cache fallback loop failing to resolve missing repository info in `issueUrl`. (`88b2dcbf`)
- **missing**: error boundary parsing in CLI `PROJECT_REGISTRY` handlers.
- **base**: URI template parsing logic in `@modelcontextprotocol/sdk` converting `{repo}` to `{+repo}`. (`5046f167`, `9e7e1816`, `3675bfe7`)
- **omitted**: metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) in `search_entries` FTS and Hybrid pipelines.
- **missing**: `entry_id` query support in `team_semantic_search`. (`a0254d24`, `aa332002`)
- **`vectorsearchmanager`**: caching a closed database connection, causing index rebuild failures.
- **silent**: database synchronization failures caused by incorrect `fts_content_docsize` shadow table queries.
- **markdown**: rendering issues in agent instructions. (`91551eb4`)
- **prioritization**: bug where server instructions overshadowed dynamic briefing resolution.
- **misleading**: "Could not detect repository" hint for multi-project users.
- **documentation**: mismatch regarding the total resource count. (`42de3d95`, `fe4ccbf2`)
- **github**: CI badge workflow targets.

### Security

- **pinned**: `minimatch` to `10.2.5` to resolve transitive vulnerabilities. (`af64aac9`, `67943cfe`)
- **updated**: container base image to `node:24.14.1-alpine`.
- **overrode**: `vite` to `^8.0.5` to patch path traversal vulnerabilities.
- **bumped**: CodeQL and TruffleHog GitHub Actions versions. (`91fe90ec`)

## [6.3.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.3.0) - 2026-03-27

### Added

- **`team_get_cross_project_insights`**: added to the `admin` tool group.
- **initial**: support for Multi-Project Workspaces configured via `PROJECT_REGISTRY`.
- **explicit**: `owner` and `repo` support in `get_github_context` for dynamic directory mounting.
- **`memory://briefing/{repo}`**: template resource for explicit context resolution across workspaces.
- **documentation**: outlining the `session-summary` workflow capabilities and cross-project routing.
- E2E testing for multi-project context resolution load stability.

### Changed

- **`github-section`**: context builder dynamically iterates over all available projects inside the `PROJECT_REGISTRY`.
- **handlers**: tied to GitHub APIs perform dynamic contextual lookup using explicit `repo` arguments when present.

### Fixed

- **stale**: context being returned on `memory://briefing` reads referencing an empty default repository.
- **`issueurl`**: tracking referencing the PR branch API instead of expected Issue URL when handling batched objects.
- Zod date coercion exceptions resulting from malformed ISO date strings in `create_github_milestone`.
- **`update_entry`**: leaking raw MCP schema validation boundaries upon large text description insertions. (`35c18b67`)
- **`get_kanban_board`**: status reporting mismatched strings across GitHub Project v2 configurations.

## [6.2.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.2.1) - 2026-03-23

### Added

- CI Gatekeeper workflow to block deployments containing failing security and quality reports. (`7881163b`)
- **comprehensive**: Dual-Schema pattern documentation for API tool surfaces. (`968ea6ed`)

### Changed

- **github**: Commander skill integrations unified with new security scan patterns.

### Fixed

- **escaping**: schema validation exceptions in entry and search tools by relaxing the SDK-facing object representations.
- **rejection**: bugs in `create_github_issue_with_entry` and `create_github_milestone` by unpinning minimum length limits in the external schemas. (`fc3df644`)
- **outdated**: documentation parameters referring to `source_id/target_id` syntax.

## [6.2.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.2.0) - 2026-03-23

### Added

- **extensive**: E2E Playwright test bundles validating HTTP streaming limits and API parsing schemas (~115 tests). (`7cf8ce76`, `cdeb2543`)
- E2E `codemode-groups` validation suite ensuring parity for code mode API environments.
- **github**: Commander skill workflow enabling structured triage, milestone completion validation, and CI audits. (`053fa89a`, `03e7c694`)
- **auto-discovery**: mechanism of default/supplied skills natively available from the `memory://skills` resource tree.
- **wiki**: Drift Detector action identifying PR deviations against current Wiki repository guides. (`9b1c75ca`, `57a7e155`)

### Changed

- **refined**: NPM tarball packaging configurations to inject dependencies without bloat.
- **stubbed**: unused transitive ML dependencies (e.g., `onnxruntime-web`, `sharp`) out of the final package build to reduce overall footprint sizes.
- **updated**: core application constraints via generic dependency patching.

### Fixed

- **`restore_backup`**: incorrectly passing internal errors when omitting user confirmation instead of prompting the user. (`e94a11eb`)
- **`team_link_entries`**: relationships returning incorrect references to self-referential IDs.

## [6.1.2](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.2) - 2026-03-22

### Fixed

- **ghost**: script import issues resolving across the unit testing structure. (`6cfe5b13`, `b40fd6ae`)

### Security


## [6.1.1](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.1) - 2026-03-22

### Fixed


### Security


## [6.1.0](https://github.com/neverinfamous/memory-journal-mcp/releases/tag/v6.1.0) - 2026-03-22

### Added

- 12 new tools bringing complete parity to team collaboration endpoints (`team_update_entry`, `team_delete_entry`, `team_export_entries`, etc.).
- 5 new clustering and semantic tools targeting Team indices (`team_semantic_search`, `team_add_to_vector_index`, `team_get_cross_project_insights`, etc.).
- **`memory://rules`,**: `memory://workflows`, and `memory://skills` resources detailing external context and configuration information.
- **universal**: caching optimizations backing `memory://skills` queries to decrease expensive I/O blocks.
- **smart**: Auto-refinement system intercepting and translating generic SQL code errors into transparent, normalized categories.
- **http-level**: express boundaries enabling explicit OAuth gating restrictions tied directly to mapped API token usages. (`39859dd0`, `c7f6232f`, `dd4f3787`)

### Changed

- **deprecated**: and removed legacy undocumented `tools.json` definitions. (`5415d73c`)
- **refined**: npm and deployment metadata to map registry values appropriately.
- **overhauled**: and minimized `server-instructions`, enabling dynamic filtering and injecting tool instructions accurately against actively enabled scopes instead of delivering bulk schemas. (`7f96ea77`, `a41d04f7`, `792e532a`)
- **modified**: default `starter` and `essential` filters to utilize the `codemode` context by default.
- **reconfigured**: npm deployment behaviors restricting publishing actions until the underlying containerized platform successfully validates dependencies.
- **updated**: cross-system dependencies to modern requirements.

### Fixed

- **re-architected**: `mj_execute_code` expression returns ensuring that inline actions surface explicit evaluation values back to the agent wrapper successfully. (`b7a947e2`, `7765e07c`)
- **implemented**: proxy traps targeting the `readonly` execution mode, properly suppressing arbitrary exception traces from mutation methods.
- **repaired**: inaccurate `search_entries` parameters ignoring exact tag subsets resulting in incorrectly broadened match findings.
- **improved**: index synchronization strategies resolving cases where FTS5 queries maintained ghost pointers to previously expunged resources. (`76b9ae0a`, `588ba395`)
- **formalized**: bidirectional constraints, stopping redundant mapping loops between connected journal interactions.

### Security

- **inserted**: global injection sanitizers parsing out malicious code structures spanning stderr serialization channels.
- **hardened**: CI/CD architectures incorporating SLSA build attestations, unprivileged environments, and exact SHA actions.
- **disabled**: trivially exploitable library chains directly within builder boundaries to isolate vulnerable transitive dependencies.

## [6.0.1] - 2026-03-14

### Changed

- **updated**: system dependencies and isolated the Docker image building layers.

### Security

- **manually**: patched npm's bundled `tar` dependency in Dockerfile to fix HIGH severity path traversal vulnerability.

## [6.0.0] - 2026-03-14

### Added

- **added**: comprehensive Playwright end-to-end testing verifying HTTP transport and session logic.
- **added**: automated repository maintenance workflows for use with the GitHub Copilot Agent. (`3a0f1bdb`, `2b46c60e`, `8cd9f3ee`)
- **structured**: error taxonomy utilizing the new `ErrorCategory` enum mapping precise server failures.
- **implemented**: configurable briefing contexts exposing system limits and template resources natively.
- **introduced**: fully functional RFC-compliant OAuth 2.1 authorization module enabling dynamic scopes across the HTTP transport framework. (`b8e03515`, `d1354bf1`, `95a48d40`)
- **added**: a deterministic execution sandbox (`Code Mode`) reducing token payload sizes and delivering programmatic script execution dynamically.

### Changed

- **switched**: completely to the native `better-sqlite3` driver, removing the `sql.js` WASM dependency. (`846c73c8`, `4a72e042`)
- **normalized**: internal typings to adhere strictly with documented builder naming strategies.
- **redesigned**: Agent System prompts mandating a session initialization process tied to reading explicit briefing paths.
- **implemented**: high performance SQLite FTS5 queries enabling exact phrasing and optimized indexing.
- **grouped**: scattered testing artifacts mapping outputs cohesively in single directories.
- **overhauled**: Vector tracking utilizing `sqlite-vec`. (`64f14235`)
- **accelerated**: production compilations and reduced total assets delivered by shifting to `tsup` bundler paradigms. (`151dd4ce`, `a908bf01`)
- **discarded**: unmaintained translation packages in factor of `@huggingface/transformers`. (`9683f91a`, `8db8fe20`, `a908bf01`)
- **unified**: file naming schemas and isolated individual modules.

### Removed

- **dropped**: `express-rate-limit` adopting a zero-dependency approach for internal rate limits.
- **removed**: unused and unsupported GitHub hook integrations and legacy tracking methodologies.

### Fixed

- **supported**: seamless HTTP stream lifecycle reloading suppressing native SDK socket connection crashes.
- **corrected**: filter anomalies allowing Team elements to supersede personal journal search requests uninvitedly.
- **resolved**: vector queries breaking during asynchronous virtual table operations tied explicitly to standard ID parameters.
- **restored**: missing arguments parameter validations mapping accurately on search conditions.
- **secured**: native database deployments enforcing transactional limits avoiding concurrent write panics randomly. (`ffd26b06`)
- **repaired**: specific Mermaid graph elements returning raw texts instead of encoded string arrays blocking typical client renderings. (`0b81cd9b`, `7087c803`)

### Security

- **replaced**: vulnerable transitive `undici` packages resolving DoS request smuggling defects.
- **enforced**: explicit internal rate-limit mechanisms isolating application components completely.
- **bounded**: payload object ingestion thresholds minimizing uncontrolled injection scales securely.
- **restricted**: system architectures using bridging protocols blocking internal Docker exploitations entirely.
- **revoked**: potential authorization escalations via explicit `no-new-privileges` bounds absolutely.

## [5.1.0] - 2026-03-07

### Added

- **added**: `session-summary` workflow prompt mitigating unreliable session closeout behaviors manually.

### Changed

- **combined**: complex calculations generating entry importance metrics securely in a single command. (`214b00be`)
- **converted**: individual linkage queries to execute nested tags rapidly avoiding internal loops. (`04773206`)
- **enforced**: strict parameter mapping to capture handled SDK failures appropriately. (`f6fa0e45`)
- **increased**: base disk operations toggling in-memory boundaries to process logic natively faster.

### Removed

- **trashed**: unsupported SDK termination guidelines causing false anomalies continuously. (`dc7efddc`)

### Fixed

- **wired**: isolated parameter limits fetching metric arrays exclusively according to matching bounds correctly.
- **mapped**: internal success statuses returning boolean results correctly alongside standard exceptions comprehensively.
- **adjusted**: return configurations passing missing flags correctly matching declared interface definitions securely.

### Security

- **evaluated**: missing validation gaps appending rigorous ASCII limits strictly protecting JSON serialization entirely. (`be20bf9e`, `2325f4ab`)

## [5.0.1] - 2026-03-06

### Changed

- **updated**: system dependencies to maintain reliable CI boundaries heavily.

### Security

- **remediated**: embedded tar configurations bypassing dangerous path vulnerabilities seamlessly.

## [5.0.0] - 2026-03-06

### Added

- **extended**: functional platform validations explicitly using new Playwright bindings covering all transport pathways automatically. (`b8e03515`, `d1354bf1`, `95a48d40`)
- **multi-row**: queries batching tag operations resolving latency faults systematically.
- **re-architected**: Team Collaboration implementing separate tracking paradigms and correct user assignments. (`6af1db7a`)

### Changed

- **refined**: Tool dispatch caching, eliminating redundant rebuild cycles unconditionally. (`dbef7f71`, `65caf574`)
- **optimized**: Database path configurations, moving structured entries to `data/` directories cleanly.
- **consolidated**: internal execution streams minimizing boundaries massively.

### Removed

- **removed**: Legacy Team Collaboration components rendered obsolete by parallel DB deployments.

### Fixed

- **harmonized**: error output enforcing structured API exceptions resolving raw format leaks globally.
- **supported**: seamless HTTP stream lifecycle restarts reliably without crashing session limits.
- **addressed**: 404 handlers parsing accurate mappings completely bypassing generic Express errors successfully. (`de478ba4`, `cfd764cb`)

### Security

- **patched**: unsafe identifier constraints sanitizing raw interpolations explicitly.
- **locked**: system containers eliminating excessive dependencies granting node escalation privileges perfectly.
- **blocked**: Gitleaks boundaries actively intercepting undetected PRs immediately.

## [4.5.0] - 2026-03-02

### Added

- **added**: Automated Scheduler for recurring backups, optimization, and system restorations asynchronously. (`3a0f1bdb`, `2b46c60e`, `8cd9f3ee`)

### Changed

- **applied**: specific Session tracking hooks resolving unpredictable session context issues automatically. (`0b81cd9b`, `7087c803`)

### Fixed

- **mapped**: missing `(NaN)` parameters resolving backup exclusions inaccurately.

### Security

- **accelerated**: foreign keys restrictions enforcing dependencies successfully. (`1a029f8e`)
- **imposed**: rigorous Content-Security policies validating specific limits comprehensively.

## [4.4.2] - 2026-02-27

### Security

- **patched**: `minimatch` dependency fixing isolated ReDoS conditions inherently. (`af64aac9`, `67943cfe`)

## [4.4.0] - 2026-02-27

### Added

- **added**: comprehensive GitHub Milestones integrations bridging issues and workflows directly.
- **added**: GitHub Repository Insights endpoint displaying granular traffic interactions dynamically. (`35e046ee`)

### Changed

- **improved**: Vector Index algorithms parallelizing array embeddings ensuring faster rebuild speeds.
- **refined**: Importance Metrics generating specific percentage transparency breakdowns openly.

### Fixed

- **remediated**: missing Tool counts resolving inaccurate outputs randomly on instruction calls. (`17741232`)

### Security

- **bound**: specific deployment gating protecting against failed security uploads heavily. (`0b81cd9b`, `7087c803`)

## [4.3.1] - 2026-02-05

### Fixed

- **mapped**: empty arrays returning safe fields ensuring project-insight evaluations gracefully handled missing dependencies natively. (`394f061a`)

### Security

- **upgraded**: libexpat bounds securing missing Null pointer limits efficiently.

## [4.3.0] - 2026-01-18

### Added

- **created**: Causal Relationship parameters assigning `caused`, `resolved`, and `blocked_by` bindings logically. (`fab18e7c`)

### Changed

- **implemented**: cached integrations applying external GitHub values populating entry dependencies automatically.

### Fixed

- **enforced**: strict condition execution repairing pipeline tags pushing unexpected Docker loads improperly.

## [4.2.0] - 2026-01-17

### Added

- **shipped**: HTTP/SSE Streaming endpoints serving independent remote clients interchangeably. (`7367a809`)

### Changed

- **provided**: dynamic threshold guidance prompting clients intelligently mapping query boundaries optimally.

### Fixed

- **detected**: and assigned "unknown" states parsing invalid cancellation hooks directly from CI executions truthfully.

## [4.1.0] - 2026-01-17

### Added

- **added**: MCP Streaming Notifications passing updates reliably throughout extensive bulk imports automatically. (`7367a809`)
- **generated**: Visual Icons integrating representations uniquely across 31 endpoints securely.

### Changed

- **normalized**: explicit error definitions guiding consumers safely navigating invalid boundaries consistently.

### Fixed

- **eliminated**: invalid results referencing deleted bounds executing asynchronous operations gracefully. (`f33fc95d`, `eb20e5da`, `587d17fb`)

## [4.0.0] - 2026-01-16

### Added

- **added**: GitHub Lifecycle Tools binding implementations explicitly spanning `close_github_issue_with_entry`. (`0b1cffcc`)

### Changed

- **filtered**: payload responses via dynamic `structuredContent` boundaries mitigating payload bottlenecks easily. (`86ad8fc9`, `fb7d9039`)

### Fixed

- **rebuilt**: native `SemanticSearch` handlers auto-detecting exact metrics bypassing full rebuild boundaries seamlessly. (`d8cd5d16`, `6a9fffbe`)

## [3.1.5] - 2026-01-11

### Security


## [3.1.4] - 2026-01-11

### Fixed

- **handled**: `glob` patches accurately restricting upstream node versions smoothly.

## [3.1.3] - 2026-01-11

### Security

- **maintained**: Alpine image patches executing continuous downstream bindings reliably. (`a679bff8`)

## [3.1.2] - 2026-01-11

### Fixed

- **resynced**: dependencies loading standard builds ensuring exact lock versions strictly accurately.

## [3.1.1] - 2026-01-11

### Security

- **repatched**: system dependencies eliminating known internal system loops seamlessly.

## [3.1.0] - 2026-01-11

### Added

- **added**: comprehensive GitHub Projects v2 Kanban mappings mapping explicit statuses alongside system variables securely.

### Changed


## [3.0.0] - 2025-12-28

### Security

- **implemented**: Zod system schemas strictly assigning valid conditions universally.

## [2.2.0] - 2025-12-08

### Changed

- **disabled**: unnecessary tool logic actively dropping unused endpoint routes transparently. (`a5db7d59`, `9500b9cf`)

## [2.1.0] - 2025-11-26

### Fixed

- **resolved**: `github_issues` missing linkage paths establishing context dynamically directly. (`e33decc4`)

## [2.0.1] - 2025-10-28

### Changed

- **assorted**: platform corrections rendering documentation correctly reflecting cross-platform setups dependably.

## [2.0.0] - 2025-10-28

### Added

- **deployed**: comprehensive exception classifications maintaining explicit error routing natively.

## [1.2.2] - 2025-10-26

### Security

- **patched**: local substring boundaries restricting injection mappings securely on git URL endpoints safely. (`aa7ed193`)

## [1.2.1] - 2025-10-26

### Changed

- **appended**: tracking messages allowing direct state insights accurately globally.

### Fixed

- **restructured**: synchronous boundaries accelerating `semantic_search` bounds initializing ML endpoints cleanly.

## [1.2.0] - 2025-10-26

### Fixed

- **addressed**: boundary matching parsing missing characters bypassing string injections correctly natively.

## [1.1.3] - 2025-10-04

### Fixed

- **implemented**: standard database creations correctly parsing fresh dependencies explicitly quickly.

## [1.1.2] - 2025-10-04

### Security

- **addressed**: known vulnerable boundaries securing basic Python references appropriately.

## [1.1.1] - 2025-10-04

### Fixed

- **mapped**: unsupported variables fixing direct startup execution errors predictably smoothly. (`dc7efddc`)

## [1.1.0] - 2025-10-04

### Added

- **added**: direct linkages supporting structured `relationship` patterns tracking boundaries properly. (`151dd4ce`)

## [1.0.2] - 2025-09-15

### Added

- **initial**: project scaffolding initialized successfully natively securely.
