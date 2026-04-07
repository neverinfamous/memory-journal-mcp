# Changelog

All notable changes to Memory Journal MCP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.0.0...HEAD)

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
