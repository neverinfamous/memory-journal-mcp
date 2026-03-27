# Unreleased Changes

## [Unreleased]

### Fixed
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
