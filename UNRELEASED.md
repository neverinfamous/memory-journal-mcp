# Unreleased Changes

## [Unreleased]

### Added
- Implemented **Hush Protocol - Phase 1 (Search Excellence)** for localized AI context scaling:
  - Added hybrid Reciprocal Rank Fusion (RRF) search combining FTS5 and vector similarity scoring.
  - Introduced `mode` parameter to `search_entries` with heuristic query classification (`auto`, `fts`, `semantic`, `hybrid`).
  - Added `entry_id` find-related capability to `semantic_search` to bypass re-embedding costs via ID lookup.
  - Added robust metadata filters (`tags`, `entry_type`, `start_date`, `end_date`) to `semantic_search`.
- Implemented **Hush Protocol - Phase 2 (Observability & Audit)**:
  - Added `src/observability/` module: byte-length token estimator (`estimateTokens`, `injectTokenEstimate`), in-memory `MetricsAccumulator` singleton, and `wrapWithMetrics` interceptor.
  - Added `src/audit/` module: enterprise JSONL `AuditLogger` with 10 MB max-file + 5-archive rotation, configurable arg redaction, and `NullAuditLogger` fallback.
  - Added 5 new MCP resources: `memory://metrics/summary` (HIGH_PRIORITY), `memory://metrics/tokens` (MEDIUM_PRIORITY), `memory://metrics/system` (MEDIUM_PRIORITY), `memory://metrics/users` (LOW_PRIORITY), `memory://audit` (ASSISTANT_FOCUSED).
  - All tool call outputs now include `_meta.tokenEstimate` for agent context-window awareness.
  - `memory://health` now includes a `metrics` subsection with aggregate call/error/token counts.

### Changed
- Refactored and modularized the monolithic `search.ts` handler into a dedicated `src/handlers/tools/search/` directory for better maintainability.
- Added `searchMode` and fusion scoring exposure to the `EntriesListOutputSchema` for greater agentic observability.
- Wrapped `callTool()` dispatch in `src/handlers/tools/index.ts` with a metrics interceptor — every tool handler is instrumented at cache-build time with zero handler-code changes.
- `callTool()` is now `async` and post-processes all results through `injectTokenEstimate()` to inject `_meta.tokenEstimate`.
- `memory://health` now returns a `metrics` subsection populated from the `globalMetrics` singleton.

### Fixed
- Fixed `_meta.tokenEstimate` injection breaking tools with a strict `outputSchema`: `callTool()` now skips `injectTokenEstimate()` when `tool.outputSchema != null`, preventing MCP SDK `-32602` schema validation errors.
- Addressed Copilot PR feedback to remove shared context bleeding in GitHub integration helpers.
- Wrapped CLI `PROJECT_REGISTRY` payload parsing in a `try...catch` block.
- Increased reliability of health resource testing by looking up the specific resource instead of assuming position.
- Removed noisy large string generation in Code Mode OOM tests.
- Fixed documentation drift for resource counts (from 28 to 33) in `README.md` and `DOCKER_README.md`.
- Updated CI badges to point to `gatekeeper.yml`.
- Refined server instructions to prioritize dynamic briefing resolution.

- Fixed markdown checklist rendering issue in `test-tools2.md`.
- Prevented early return in `resolveIssueUrl` from blocking project registry resolution when `context.github` is not initialized.

### Security
- Updated Dockerfile to `node:24.14.1-alpine` to fix CVE vulnerabilities in the base image.
