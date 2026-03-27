## [Unreleased]

### Added

- **Configuration**: Added `PROJECT_REGISTRY` environment variable (JSON object mapping repository names to file paths and project numbers), enabling dynamic, multi-project context loading to replace single-repo limitations.
- **GitHub routing**: Issue creation and Kanban tools now auto-resolve project IDs organically via `PROJECT_REGISTRY` mapping before defaulting to `DEFAULT_PROJECT_NUMBER`.
- **Briefing Context**: Added `registeredWorkspaces` injection to the `memory://briefing` resource to automatically provide AI agents with a map of tracked projects and Kanban boards at session start.
- Created dynamic version of the session briefing resource (`memory://briefing/{repo}`) allowing agents to explicitly fetch repo context.
- **Documentation**: Overhauled `README.md` and `DOCKER_README.md` configuration tables and examples to systematically compare Basic vs Advanced server setups and explicitly document legacy vs modern variables.

### Fixed

- **GitHub Context Resolution**: Fixed an issue where tools like `get_github_context` failed to execute git commands in multi-project registry setups. Tools now accept a repository parameter and dynamically instantiate a local GitHub integration bound to the target project's physical path.
- Fixed an issue where the `memory://briefing` resource would return an empty GitHub section in multi-project registry setups running outside a git repository.
- **Briefing Context**: Fixed `memory://briefing` `clientNote` to explicitly instruct agents on how to use dynamic context tracking.
- `workflows/README.md` — Updated Mermaid diagram and all table entries to reflect the new gatekeeper architecture (fan-out + gate pattern replacing stale `workflow_run` and direct-push triggers)

### CI/CD

- `secrets-scanning.yml` — Opted `gitleaks/gitleaks-action@v2.3.9` into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ahead of June 2026 GitHub Actions deprecation deadline
- `security-update.yml` — Opted `actions/cache` (invoked transitively by docker/build-push-action) into Node.js 24 via job-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
