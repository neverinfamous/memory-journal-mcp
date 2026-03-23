## [Unreleased]

### Fixed

- `workflows/README.md` — Updated Mermaid diagram and all table entries to reflect the new gatekeeper architecture (fan-out + gate pattern replacing stale `workflow_run` and direct-push triggers)

### CI/CD

- `secrets-scanning.yml` — Opted `gitleaks/gitleaks-action@v2.3.9` into Node.js 24 via `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` ahead of June 2026 GitHub Actions deprecation deadline
- `security-update.yml` — Opted `actions/cache` (invoked transitively by docker/build-push-action) into Node.js 24 via job-level `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`
