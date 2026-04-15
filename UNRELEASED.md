# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.5.0...HEAD)

### Fixed
- **Testing**: Fixed 61 failing tests associated with architectural shifts, including fixing obsolete "empty array" expectations in `vector-search-manager.test.ts` to now assert exact structued thrown errors.
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
