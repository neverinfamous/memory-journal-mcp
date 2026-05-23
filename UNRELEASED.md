# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added
- **skills**: Migrated 14 skills from `adamic/skills` to canonical source: `agents-sdk`, `building-ai-agent-on-cloudflare`, `building-mcp-server-on-cloudflare`, `cloudflare`, `durable-objects`, `github-repo-setup`, `mcp-builder`, `next-best-practices`, `next-cache-components`, `next-upgrade`, `sandbox-sdk`, `web-perf`, `workers-best-practices`, `wrangler`
- **skills**: Updated `README.md` inventory table to list all 35 skills
- **skills**: Added `adversarial-security` skill — multi-pass adversarial repo-wide security audit (Threat Modeler + Red Team, 10-category checklist, CVSS-inspired scoring)
- **skills**: Added `adversarial-performance` skill — multi-pass adversarial performance audit (Profiler + Stress Tester, 7-category checklist, impact/frequency scoring)
- **skills**: Added `adversarial-skill-audit` skill — meta-skill auditing agent skill directories (Evaluator + Adversarial User, 12-category checklist, trigger collision detection)

### Fixed
- **skills**: Added recursive `node_modules` and `package-lock.json` filter to `bin/sync.js` to prevent bloat propagation during sync
- **skills**: Removed stale `gitlab/node_modules` directory (648 orphaned files)
