# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.1.0...HEAD)

### CI/CD

- Gate `publish` job in `gatekeeper.yml` to tag pushes only (`startsWith(github.ref, 'refs/tags/v')`); squash-merge pushes to `main` now run lint/test/security checks only, eliminating the double pipeline run on every release
