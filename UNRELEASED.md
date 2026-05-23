# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added
- **skills**: Migrated 14 skills from `adamic/skills` to canonical source: `agents-sdk`, `building-ai-agent-on-cloudflare`, `building-mcp-server-on-cloudflare`, `cloudflare`, `durable-objects`, `github-repo-setup`, `mcp-builder`, `next-best-practices`, `next-cache-components`, `next-upgrade`, `sandbox-sdk`, `web-perf`, `workers-best-practices`, `wrangler`
- **skills**: Updated `README.md` inventory table to list all 35 skills
- **skills**: Added `adversarial-security` skill — multi-pass adversarial repo-wide security audit (Threat Modeler + Red Team, 10-category checklist, CVSS-inspired scoring)
- **skills**: Added `adversarial-performance` skill — multi-pass adversarial performance audit (Profiler + Stress Tester, 7-category checklist, impact/frequency scoring)
- **skills**: Added `adversarial-skill-audit` skill — meta-skill auditing agent skill directories (Evaluator + Adversarial User, 12-category checklist, trigger collision detection)
- **skills/mcp-builder**: Added 10 security hardening patterns to `http-security.md` — frozen prototypes, subquery blocking, CORS deny-all default, fail-closed scope default, JWT claims sanitization, constant-time token comparison, bearer auth scope warning, sandbox escape patterns (Reflect/Symbol/Proxy), path traversal validation, filesystem boundary enforcement
- **skills/mcp-builder**: Added Code Mode Security Hardening section to `http-security.md` with frozen built-in prototypes, additional blocked patterns table, and `ALLOWED_IO_ROOTS` filesystem boundary enforcement
- **skills/mcp-builder**: Updated `architecture-reference.md` with audit subsystem directory (`src/audit/`), server registration extraction (`built-in-tools.ts`, `help-resources.ts`, `audit-tools.ts`), auth module submodule variant, `validate-path.ts`, and `insights-manager.ts` utilities
- **skills/mcp-builder**: Updated `SKILL.md` quick reference checklist with 10 new security compliance rows (frozen prototypes, fail-closed scope, constant-time token, JWT sanitization, path traversal, filesystem boundaries, subquery blocking, sandbox escape patterns, bearer auth warning)
- **skills/mcp-builder**: Updated `SKILL.md` Code Mode section with `reportProgress()` utility and Approach C table with `gotchas.md` source file and `generateInstructions()` function signature
- **skills/mcp-builder**: Added privacy/security annotations adoption note to `SKILL.md` — clarifies `privateHint`, `sensitiveHint`, `maliciousActivityHint`, `attribution` are spec-defined but not yet widely adopted
- **skills/mcp-builder**: Updated `code-mode-reference.md` with frozen built-in prototypes in sandbox.ts and worker-script.ts sections, additional blocked patterns, `reportProgress()` utility, subquery blocking, and promoted `outputSchema` pitfall to Tool Handler Pattern section
- **skills/mcp-builder**: Expanded `error-handling.md` subclass table with `TransactionError`, `InternalError`, `AuthenticationError`, `AuthorizationError`, `ExtensionNotAvailableError` as formal entries; extended auto-refinement codes with `VECTOR_NOT_FOUND`, `DUPLICATE_MIGRATION`, `DUPLICATE_VERSION`, `ALREADY_ROLLED_BACK`
- **skills/mcp-builder**: Expanded `testing-reference.md` Layer 4 with db-mcp's granular test structure (sub-group prompts, codemode prompts, advanced stress tests, agent experience scenarios), test count taxonomy, standardized prompt format, WASM degradation testing, lockfile integrity, and Dockerfile patch drift CI patterns
- **skills/mcp-builder**: Updated `oauth-reference.md` with fail-closed scope default (`?? 'admin'`), constant-time token comparison, JWT claims sanitization, bearer auth scope limitation warning, and auth module submodule variant

### Fixed
- **skills**: Added recursive `node_modules` and `package-lock.json` filter to `bin/sync.js` to prevent bloat propagation during sync
- **skills**: Removed stale `gitlab/node_modules` directory (648 orphaned files)
