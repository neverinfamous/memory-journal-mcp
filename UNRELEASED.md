# Unreleased Changes

## [Unreleased]

### Added

- Playwright E2E spec (`tests/e2e/payloads-observability.spec.ts`) covering all 5 Phase 2 resources (`memory://metrics/*`, `memory://audit`), `_meta.tokenEstimate` injection on tool responses, and the `memory://health` metrics subsection.
- Hybrid Reciprocal Rank Fusion (RRF) search combining FTS5 and vector similarity scoring to `search_entries`.
- Heuristic query classification (`auto`, `fts`, `semantic`, `hybrid`) via `mode` parameter in `search_entries`.
- Find-related execution bypass via `entry_id` lookup in `semantic_search`.
- Robust metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) in `semantic_search`.
- Byte-length token estimation (`estimateTokens`, `injectTokenEstimate`) for agent context-window awareness via `_meta.tokenEstimate`.
- In-memory `MetricsAccumulator` and interception logging.
- Enterprise JSONL `AuditLogger` with 10 MB rotating file archives and configurable argument redaction.
- Audit interceptor wiring all write/admin tool calls to the JSONL audit trail with scope-based filtering, token estimation, and duration timing.
- CLI flags `--audit-log`, `--audit-redact`, `--audit-reads`, `--audit-log-max-size` and matching `AUDIT_LOG_PATH`, `AUDIT_REDACT`, `AUDIT_READS`, `AUDIT_LOG_MAX_SIZE` environment variables.
- stderr audit mode (`--audit-log stderr`) for containerised deployments.
- Configurable read-scope auditing via `--audit-reads` flag.
- `AuditLogger.recent()` streaming tail-read (64KB window) for O(1) audit resource access.
- Graceful `AuditLogger.close()` lifecycle for clean shutdown flush.
- Session summary (token totals, error count, duration) in the `memory://audit` resource.
- 5 observability and audit MCP resources (`memory://metrics/*`, `memory://audit`).
- Aggregate call, error, and token counts in the `memory://health` metrics section.
- `searchMode` and fusion scoring exposure on `EntriesListOutputSchema`.
- `.env.example` with all environment variables grouped by category for local development setup.

### Changed

- Refactored `AuditLogger` from synchronous `appendFileSync` to async-buffered writes (50-entry high-water mark, 100ms auto-flush) for non-blocking audit I/O.
- Refactored `memory://audit` resource to use `AuditLogger.recent()` instead of full-file I/O.
- Added `AuditConfig` type with `enabled`, `logPath`, `redact`, `auditReads`, `maxSizeBytes` fields.
- Replaced `NullAuditLogger` with `enabled: false` config flag on `AuditLogger`.
- Refactored `search.ts` handler into dedicated `/src/handlers/tools/search/` modules.
- Post-processed `callTool()` results asynchronously to inject token estimates.
- Updated `@huggingface/transformers` to `^4.0.0` and `typescript` to `^6.0.2`.
- Updated all minor and patch cross-dependencies via `npm update`.
**Dependency Updates**
- Bumped `@huggingface/transformers` to `4.0.1`, `@playwright/test` to `1.59.1`, `@types/node` to `25.5.2`, `esbuild` to `0.28.0`, `eslint` to `10.2.0`, and `simple-git` to `3.35.2`.
- Reduced `DOCKER_README.md` from 24,344 to 23,475 bytes (93.9% of Docker Hub 25,000-char limit) by shortening the tagline to meet the 100-char short description limit and collapsing duplicated routing sections.
- Updated `test-server/code-map.md` handler map (`search.ts` → `search/index.ts`) and last-updated date.
- Added `PROJECT_REGISTRY` and `TEAM_DB_PATH` placeholders to `mcp-config-example.json`.
- Refactored monolithic Code Mode test files into four distinct, modular testing prompts (`test-tools-codemode-[1-4].md`) to reduce context window strain.


### Fixed

- Interceptor schemas failing with `-32602` validation errors by bypassing strict output checks.
- Shared context data bleeding in GitHub integration helpers.
- Faulty early returns blocking project registry execution when GitHub context is uninitialized.
- Process crashes from noisy string generation in Code Mode OOM tests.
- Hardcoded position assumptions in health resource test suites by shifting to explicit lookups.
- Missing error boundary parsing in CLI `PROJECT_REGISTRY` payload handlers.
- Documentation drift matching the 28 to 33 resource count update.
- CI badges correctly targeting `gatekeeper.yml`.
- Render issues with markdown checklists in `test-tools2.md` instructions.
- Prioritization of dynamic briefing resolution in server instruction loading.
- `callTool()` progress-token path bypassing both metrics and audit interceptors — fresh handlers from `getAllToolDefinitions()` were invoked raw, skipping all instrumentation. Both cached and progress paths now apply identical metrics + audit wrapping.

### Security

- Pinned `minimatch` to 10.2.5 across dependencies and overrides to combat transitive vulnerabilities.
- Updated Dockerfile base image to `node:24.14.1-alpine` to fix underlying CVEs.
- Fixed `vite` path traversal and arbitrary file read vulnerabilities by overriding with `^8.0.5`.
- Bumped `github/codeql-action` to `v4.35.1` and `trufflesecurity/trufflehog` to `v3.94.2` to resolve static analysis and supply chain security alerts.
