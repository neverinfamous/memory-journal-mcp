# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.5.0...HEAD)

### Fixed
- **Testing**: Fixed 61 failing tests associated with architectural shifts, including fixing obsolete "empty array" expectations in `vector-search-manager.test.ts` to now assert exact structued thrown errors.
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
