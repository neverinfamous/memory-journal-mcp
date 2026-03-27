## [Unreleased]

### Added

- **Configuration**: Added `PROJECT_REGISTRY` environment variable (JSON object mapping repository names to file paths and project numbers), enabling dynamic, multi-project context loading to replace single-repo limitations.
- **GitHub routing**: Issue creation and Kanban tools now auto-resolve project IDs organically via `PROJECT_REGISTRY` mapping before defaulting to `DEFAULT_PROJECT_NUMBER`.
- **Briefing Context**: Added `registeredWorkspaces` injection to the `memory://briefing` resource to automatically provide AI agents with a map of tracked projects and Kanban boards at session start.
- **Documentation**: Overhauled `README.md` and `DOCKER_README.md` configuration tables and examples to systematically compare Basic vs Advanced server setups and explicitly document legacy vs modern variables.

### Fixed

- `workflows/README.md` — Updated Mermaid diagram and all table entries to reflect the new gatekeeper architecture (fan-out + gate pattern replacing stale `workflow_run` and direct-push triggers)

### CI/CD

- `secrets-scanning.yml` — Opted `gitleaks/gitleaks-action@v2.3.9` into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ahead of June 2026 GitHub Actions deprecation deadline
- `security-update.yml` — Opted `actions/cache` (invoked transitively by docker/build-push-action) into Node.js 24 via job-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
