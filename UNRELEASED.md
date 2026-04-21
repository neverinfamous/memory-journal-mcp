# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.5.0...HEAD)

### Added
- Explicit HTTP service-level `curl` container health-checks to `docker-compose.yml`.
- True O(1) LRU eviction (using `Map.prototype.keys().next()`) to rate-limiting and user tracking maps to deterministically cap memory under high throughput.
- A `Map` caching layer tied to the local workspace path to minimize redundant OctoKit and Git instantiations.

### Changed
- **Dependencies:** Bumped `node` (Docker) to `24.15.0-alpine`, `@huggingface/transformers` to `4.1.0`, `eslint` to `10.2.1`, `typescript` to `6.0.3`. Updated GitHub Actions (`hashgraph-online/skill-publish`, `dependabot/fetch-metadata`, `docker/build-push-action`, `actions/github-script`, `actions/setup-node`).
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
