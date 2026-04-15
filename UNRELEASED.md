# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.5.0...HEAD)

### Security
- **Auth**: Enforced strict tool-to-scope verification during MCP server initialization, forcing the server to hard-fault if any tool group is discovered without a mapped scope boundary.
- **Auth**: Modified TokenValidator configuration to fail-closed during constructor instantiation if any JWKS origin or Issuer metadata is misconfigured or inaccessible.
- **Codemode**: Removed the legacy filter bypass for Code Mode tools; executing `mj_execute_code` now cleanly respects the active session's `--tool-filter` context, including when exclusively scoped to Code Mode.
- **Sanitization**: Standardized SQL `LIKE` wildcard escaping logic across database adapters (specifically SQLite) to mitigate native expanding boundaries and excessive table scan exposure.
- **Validation**: Introduced `AutoContextSchema` boundary validation using Zod to safely parse JSON context, replacing unsafe `JSON.parse()` methods inside team and briefing resources.

### Performance
- **Database**: Resolved significant N+1 latency loops inside the `ResourceTools` generation functions by converting sequential relationship boundary queries to batched, in-memory aggregate lookup tables.
- **GitHub**: Integrated an active `Map` caching layer tightly coupled to fully-qualified local repository working paths (CWD) to radially constrain redundant OctoKit and Git instantiation cycles.
- **Database**: Refactored importance score evaluation via `buildImportanceSqlExpression` to use a Common Table Expression (CTE) combined with a `LEFT JOIN` in database searches, eliminating correlated O(N^2) nested subqueries.
- **Initialization**: Optimized startup behavior by hoisting execution-invariant server state (tools, prompts, filter sets) out of `createServerInstance()` to bypass redundant cycles during HTTP/SSE connections.

### Fixed
- **Integrity**: Revamped the internal SQLite `restore_backup` pipeline to utilize an atomic `.tmp` swap and secondary rename operation to prevent mid-operation failures from leaving the primary DB permanently malformed.
- **Memory**: Resolved persistent memory leak in `CodeModeSecurityManager` by implementing explicit `dispose()` cleanup for bounded interval timers on cache eviction.
- **Logging**: Eliminated silent `catch` block error suppression inside `mcp-server.ts`, `backup.ts`, and `team.ts`, ensuring warnings appropriately propagate to stderr.
- **Integrity**: Fixed numeric limit validation logic for session thresholds, ensuring robustness against invalid `parseInt` boundaries during HTTP socket instantiations.
- **Testing**: Fixed legacy graceful-empty array fallback assertions in `github-integration` specs to strictly enforce thrown rejected promises reflecting the modernized fail-fast API structures. Updated all template URI expectations in E2E playwright suites.
- **Testing**: Fixed failing analytics test assertions (`analytics-branches.test.ts`) by properly passing tag and distribution data from the `getCrossProjectInsights` query migration.
- **Testing**: Aligned `visualize_relationships` to throw a `ResourceNotFoundError` for missing root nodes, solving assertion divergence in `targeted-gap-closure-2.test.ts` and `tool-handler-coverage.test.ts`.
- **Testing**: Remedied file boundary traversal test failures in `tests/handlers/io-tools.test.ts` and `tests/handlers/team-io-tools.test.ts` by correctly mocking new path boundary bounds via `security-utils`.
- **Testing**: Aligned `tests/transports/http-stateful.test.ts` with the new single-transport global architecture, dropping disconnected multiplex mock assertions and preventing race failures.
- **Testing**: Resolved `[Structured output attached]` assertion failures in `mcp-server.test.ts` by evaluating the modernized `structuredContent` natively mapped from outputSchemas.
- **Testing**: Resolved `teamDb` share tests failing in `tool-handler-coverage.test.ts` by correctly seeding the `author` and structure primitives to the mock memory store.
- **Testing**: Removed deterministic failure in `security-utils.test.ts` regarding `..foo` string processing bounded to `path.relative` instead of CWD startsWith checks. 
- **Linting**: General cleanup in `search.ts`, `core.ts` handling errors dynamically and removing `unnecessary-escape` conditions across the repository.
- **Protocol**: Fixed RFC 9728 Content-Type emission in OAuth metadata endpoint to correctly use `application/oauth-protected-resource-metadata+json`.
- **Security**: Enforced filesystem boundary safety in I/O operations (`io`, `team/io-tools`) by correctly passing explicit `allowedRoots` instead of relying on environment variable fallbacks.
- **Security**: Restored HTTP Transport OAuth scope enforcement middleware, properly checking tool-level permissions against `auth.scopes` and throwing 403 Forbiden for missing grants.
- **Performance**: Eliminated critical N+1 database queries during Markdown Exports and Semantic Search (BM25 fallback) by introducing the batched methods `getEntriesByIdsWithImportance` and `getRelationshipsForEntries`.
- **Security**: Hardened Execution Environment by entirely purging the legacy `vm` sandbox mode, enforcing production-grade `worker` isolation across all `mj_execute_code` executions.
- **Security**: Strengthened Database Access Primitives by renaming all legacy `executeRawQuery` calls to `_executeRawQueryUnsafe`, ensuring explicit developer intent for raw queries.
- **Security**: Enforced LLM Content Provenance rules by meticulously applying `<untrusted_remote_content>` wrappers during briefing context generation bridging external entities.
- **Testing**: Remediated exhaustive testing suite failures by explicitly mocking `_executeRawQueryUnsafe`, `getAuthorStatistics`, and `getAuthorsForEntries` inside Vitest stubs, ensuring flawless test validation.
- **Core**: Resolved TypeScript regressions in `src/auth/scopes.ts` by explicitly mapping `team` and `audit` to intermediate hierarchy indices.
- **Security (SEC-1.3)**: Tightened team tool group scope boundary — `team` group now requires `SCOPES.TEAM` instead of `SCOPES.WRITE`, closing an escalation path where any write-scoped token could invoke team journal mutations. Updated `TOOL_GROUP_SCOPES`, `scope-map.ts` override for `team_import_markdown`, and corresponding unit tests.
- **Security (SEC-1.1)**: Code Mode (`mj_execute_code`) now routes all inner `mj.*` tool calls through the central `callTool()` dispatcher rather than invoking raw tool handlers directly. This ensures OAuth scope checks, maintenance-mode guards, and audit interception apply to every sandbox call.
- **Security (SEC-1.2)**: Code Mode honours the active `--tool-filter` configuration. When a server-level tool filter is active, Code Mode's internal tool universe is restricted to the same enabled set. Exception: when only `mj_execute_code` is enabled (`codemode-only` preset), Code Mode retains full internal access as intended by the preset's design.
- **Security (SEC-2.1)**: Legacy SSE transport (`GET /sse` + `POST /messages`) now runs inside `requestContextStorage.run()`, ensuring per-request context (IP, session ID) is available to rate limiters and audit loggers — the same guarantee already provided by the Streamable HTTP transport.
- **Security (SEC-2.3)**: Team tools (`team_create_entry`, `team_pass_flag`) now hard-reject calls where `input.author` doesn't match the authenticated principal's `sub` claim when OAuth is active, preventing author impersonation. In stdio mode (no auth context), the existing fallback to `resolveAuthor()` is preserved.
- **Fixed (SEC-2.4)**: `team_import_markdown` no longer silently drops `options.author`. Both `createEntry()` call paths in the markdown importer now receive the `author` field from import options, preventing silent attribution loss during bulk team imports.
- **Fixed (SEC-2.8)**: Prompt handler failures are now surfaced as proper MCP protocol errors instead of being caught and returned as synthetic `{success: false}` user messages, which masked failures from clients.
- **Fixed (SEC-3.5)**: Corrected JSDoc comment on `HttpTransportOptions.corsOrigins`: the default is `[]` (strict, no origins allowed), not `["*"]` (all origins). This was documentation drift from a security-hardening change in an earlier release.
- **Testing/Security**: Fully migrated all remaining legacy `_executeRawQueryUnsafe` and `execQuery` calls within Prompt and Resource handlers to strictly typed and parameterized `IDatabaseAdapter` methods.
- **Testing**: Resolved E2E OAuth testing regressions in `tests/e2e/oauth-scopes.spec.ts` by adhering mock configurations to strict Server-Side Issuer-to-JWKS origin match validation.
- **Infrastructure**: Standardized Docker orchestration by adding HTTP service-level `curl` container health-checks to `docker-compose.yml`.
- **Security**: Hardened HTTP transport by refusing wildcard CORS (`'*'`) without explicit authentication, and reordering middleware to execute rate-limiting against authenticated identities (`req.auth.subject`).
- **Security**: Enforced filesystem boundary safety in markdown importer/exporter by explicitly preventing path traversal and symlink boundary escapes via `fs.realpath`/`fs.lstat` protections.
- **Security**: Mitigated metadata-structure injection vectors in frontmatter serialization by implementing rigorous `quoteYamlString` escape barriers.
- **Integrity**: Addressed `EPERM` rollback failures on Windows in `BackupManager` by ensuring database connections are explicitly closed before initiating atomic file swaps. 
- **Integrity**: Fixed `PRAGMA integrity_check` tracking within the `NativeConnectionManager` by updating the mutation Regex whitelist, unlocking array-based constraint evaluation.
- **Integrity**: Eliminated context-bleed vulnerabilities by permanently deprecating the global state cache across GitHub integration pipelines, localizing mutation states exclusively to per-request lifetimes.
- **Testing**: Aligned mock filesystem boundaries and `importer` expected outputs for structural database failures (e.g. vector re-indexing faults) to strictly execute correct `.success = false` expectations.
- **Testing**: Resolved minor TypeScript generic type assertion conflicts and defensive mocking fallbacks for un-mocked `req.get` calls in testing suites.
- **CI/CD**: Promoted the comprehensive Playwright E2E suite to execute synchronously within `.github/workflows/lint-and-test.yml` using the new `npm run test:e2e` execution script target.
