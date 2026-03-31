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
- 5 observability and audit MCP resources (`memory://metrics/*`, `memory://audit`).
- Aggregate call, error, and token counts in the `memory://health` metrics section.
- `searchMode` and fusion scoring exposure on `EntriesListOutputSchema`.
- `.env.example` with all environment variables grouped by category for local development setup.

### Changed

- Refactored `search.ts` handler into dedicated `/src/handlers/tools/search/` modules.
- Post-processed `callTool()` results asynchronously to inject token estimates.
- Updated `@huggingface/transformers` to `^4.0.0` and `typescript` to `^6.0.2`.
- Updated all minor and patch cross-dependencies via `npm update`.
- Reduced `DOCKER_README.md` from 24,344 to 23,475 bytes (93.9% of Docker Hub 25,000-char limit) by shortening the tagline to meet the 100-char short description limit and collapsing duplicated routing sections.
- Updated `test-server/code-map.md` handler map (`search.ts` → `search/index.ts`) and last-updated date.
- Added `PROJECT_REGISTRY` and `TEAM_DB_PATH` placeholders to `mcp-config-example.json`.


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

### Security

- Pinned `minimatch` to 10.2.5 across dependencies and overrides to combat transitive vulnerabilities.
- Updated Dockerfile base image to `node:24.14.1-alpine` to fix underlying CVEs.
