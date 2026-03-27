## [Unreleased]

### Verified

- Executed and passed all exhaustive scenarios for Phase 0-6 Core & Mutation testing (`test-tools.md`), verifying FTS5 logic, date boundaries, causal relationships, analytics, semantic search similarity, index rebuilding, and tag administration with zero functional regressions.
- Executed and passed the Phase 6 Automated Scheduler script via HTTP/SSE transport, verifying that all background cleanup and maintenance jobs fire successfully according to their configured intervals without interrupting protocol stability.
- Executed and passed all 55 scenarios for Pass 3 Code Mode testing over Sandbox execution, CRUD operations, Search, and Analytics. Parity confirmed between direct capabilities and dynamic API bridge.
- Executed and passed all exhaustive scenarios for Phase 0-2 Schemas, Resources, & GitHub testing (`test-tools.md`), verifying outputSchema compliance, multi-project resource routing, and integration lifecycle tools (issue and milestone management).
- Executed and passed all exhaustive scenarios for Phase 3-7 Error Handling, Integrity & Edge Cases (`test-tools3.md`), verifying structured error responses, data isolation, backup/restore parity, boundary constraints, and ensuring zero raw MCP error leaks.
- Executed and passed all exhaustive scenarios for Phase 10 Team Collaboration testing (`test-tools-team.md`), verifying 100% operational certification across Team Entry Creation, Analytics, Vector/Semantic Search, Entity Relationships, Export workflows, and Cross-Project Insights with guaranteed metadata attribution (PR numbers, URLs, and Status fields).

### Security

- Updated `tar` to 7.5.13 in Dockerfile to patch CVE-2026-23950, CVE-2026-24842, CVE-2026-26960, GHSA-qffp-2rhf-9h96
- Updated npm-bundled `diff` to 8.0.4 in Dockerfile to patch GHSA-73rr-hh4g-fpgx
- Resolved moderate severity vulnerabilities via lockfile updates (`npm audit fix`)

### Changed

**Dependency Updates**

- `esbuild`: `^0.25.0` → `^0.27.4`
- `typescript-eslint` tools: `v8.57.0` → `v8.57.2`
- `@modelcontextprotocol/sdk`: `1.27.1` → `1.28.0`
- `vitest` and `@vitest/coverage-v8`: `4.1.0` → `4.1.2`

### Added

- **Team Prompts**: Added `team-session-summary` prompt handler to support retrospective session summaries in the team journal domain. Safely isolates execution context by threading `teamDb` through the prompt registration architecture.

- **Configuration**: Added `PROJECT_REGISTRY` environment variable (JSON object mapping repository names to file paths and project numbers), enabling dynamic, multi-project context loading to replace single-repo limitations.
- **GitHub routing**: Issue creation and Kanban tools now auto-resolve project IDs organically via `PROJECT_REGISTRY` mapping before defaulting to `DEFAULT_PROJECT_NUMBER`.
- **Briefing Context**: Added `registeredWorkspaces` injection to the `memory://briefing` resource to automatically provide AI agents with a map of tracked projects and Kanban boards at session start.
- Created dynamic version of the session briefing resource (`memory://briefing/{repo}`) allowing agents to explicitly fetch repo context.
- **Documentation**: Overhauled `README.md` and `DOCKER_README.md` configuration tables and examples to systematically compare Basic vs Advanced server setups and explicitly document legacy vs modern variables.

### Fixed

- **Code Mode GitHub Context**: Implemented a `repo` context injection parameter for the `mj_execute_code` sandbox, restoring complete GitHub and Kanban parity with direct tool calls by dynamically mapping `PROJECT_REGISTRY` values.
- **GitHub Issue URL Resolution**: Fixed an issue where `create_entry` generated `issueUrl: null` in multi-project registry setups. The GitHub integration now accurately pre-populates its cache on startup and correctly hydrates injected sandbox contexts, guaranteeing reliable issue URL auto-population for both direct tools and Code Mode execution.
- **Code Mode & Resources**: Fixed a routing collision in resource template parsing where the `memory://briefing/{repo}` dynamic resource rejected project identifiers containing slashes (e.g., `neverinfamous/memory-journal-mcp`).
- **GitHub Context Resolution**: Fixed an issue where tools like `get_github_context` failed to execute git commands in multi-project registry setups. Tools now accept a repository parameter and dynamically instantiate a local GitHub integration bound to the target project's physical path.
- Fixed an issue where the `memory://briefing` resource would return an empty GitHub section in multi-project registry setups running outside a git repository.
- **GitHub Status Resources**: Added dynamic `{repo}` routing variants for all GitHub resources (`status`, `insights`, `milestones`) to allow explicit repository targeting in multi-project registry setups, fixing "Could not detect repository" errors.
- **Briefing Context**: Fixed `memory://briefing` `clientNote` to explicitly instruct agents on how to use dynamic context tracking.
- `workflows/README.md` — Updated Mermaid diagram and all table entries to reflect the new gatekeeper architecture (fan-out + gate pattern replacing stale `workflow_run` and direct-push triggers)
- **Testing**: Fixed sporadic `ResourceNotFoundError: Backup not found` failures in `sqlite-adapter.test.ts` by fully isolating the test database directory to prevent parallel test execution interference.
- **Testing**: Added explicit seeding instruction to Phase 21 of `test-tools-codemode.md` to guarantee deterministic Core CRUD search outcomes.

### CI/CD

- `secrets-scanning.yml` — Opted `gitleaks/gitleaks-action@v2.3.9` into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ahead of June 2026 GitHub Actions deprecation deadline
- `security-update.yml` — Opted `actions/cache` (invoked transitively by docker/build-push-action) into Node.js 24 via job-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
- `dependency-maintenance.md` — Explicitly whitelisted `package.json` and `package-lock.json` in the `safe-outputs.allowed-files` list to unblock PR generation by the dependency maintenance agent
