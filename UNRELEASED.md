## [Unreleased]

### Changed

- **npm publish gated behind Docker checks** — npm no longer publishes on release creation; instead `docker-publish.yml` calls `publish-npm.yml` via `workflow_call` after Docker Scout passes and images are pushed. Both artifacts ship together or neither ships. Manual `workflow_dispatch` fallback preserved.
- **Dependency Updates** — Bumped `better-sqlite3` from `^12.6.2` to `^12.8.0` (range tightened to explicitly exclude yanked 12.7.x intermediates).
