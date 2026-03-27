## [Unreleased]

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

- **Configuration**: Added `PROJECT_REGISTRY` environment variable (JSON object mapping repository names to file paths and project numbers), enabling dynamic, multi-project context loading to replace single-repo limitations.
- **GitHub routing**: Issue creation and Kanban tools now auto-resolve project IDs organically via `PROJECT_REGISTRY` mapping before defaulting to `DEFAULT_PROJECT_NUMBER`.
- **Briefing Context**: Added `registeredWorkspaces` injection to the `memory://briefing` resource to automatically provide AI agents with a map of tracked projects and Kanban boards at session start.
- Created dynamic version of the session briefing resource (`memory://briefing/{repo}`) allowing agents to explicitly fetch repo context.
- **Documentation**: Overhauled `README.md` and `DOCKER_README.md` configuration tables and examples to systematically compare Basic vs Advanced server setups and explicitly document legacy vs modern variables.

### Fixed

- **Code Mode & Resources**: Fixed a routing collision in resource template parsing where the `memory://briefing/{repo}` dynamic resource rejected project identifiers containing slashes (e.g., `neverinfamous/memory-journal-mcp`).
- **GitHub Context Resolution**: Fixed an issue where tools like `get_github_context` failed to execute git commands in multi-project registry setups. Tools now accept a repository parameter and dynamically instantiate a local GitHub integration bound to the target project's physical path.
- Fixed an issue where the `memory://briefing` resource would return an empty GitHub section in multi-project registry setups running outside a git repository.
- **Briefing Context**: Fixed `memory://briefing` `clientNote` to explicitly instruct agents on how to use dynamic context tracking.
- `workflows/README.md` — Updated Mermaid diagram and all table entries to reflect the new gatekeeper architecture (fan-out + gate pattern replacing stale `workflow_run` and direct-push triggers)
- **Testing**: Fixed sporadic `ResourceNotFoundError: Backup not found` failures in `sqlite-adapter.test.ts` by fully isolating the test database directory to prevent parallel test execution interference.

### CI/CD

- `secrets-scanning.yml` — Opted `gitleaks/gitleaks-action@v2.3.9` into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ahead of June 2026 GitHub Actions deprecation deadline
- `security-update.yml` — Opted `actions/cache` (invoked transitively by docker/build-push-action) into Node.js 24 via job-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
- `dependency-maintenance.md` — Explicitly whitelisted `package.json` and `package-lock.json` in the `safe-outputs.allowed-files` list to unblock PR generation by the dependency maintenance agent
