# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added
- **skills**: Migrated 14 skills from `adamic/skills` to canonical source: `agents-sdk`, `building-ai-agent-on-cloudflare`, `building-mcp-server-on-cloudflare`, `cloudflare`, `durable-objects`, `github-repo-setup`, `mcp-builder`, `next-best-practices`, `next-cache-components`, `next-upgrade`, `sandbox-sdk`, `web-perf`, `workers-best-practices`, `wrangler`
- **skills**: Updated `README.md` inventory table to list all 35 skills
- **skills**: Added `adversarial-security` skill — multi-pass adversarial repo-wide security audit (Threat Modeler + Red Team, 10-category checklist, CVSS-inspired scoring)
- **skills**: Added `adversarial-performance` skill — multi-pass adversarial performance audit (Profiler + Stress Tester, 7-category checklist, impact/frequency scoring)
- **skills**: Added `adversarial-skill-audit` skill — meta-skill auditing agent skill directories (Evaluator + Adversarial User, 12-category checklist, trigger collision detection)
- **skills**: Added `adversarial-workflow-audit` skill — adapted meta-skill for evaluating flat markdown workflows (Evaluator + Adversarial User, HITL gates, execution determinism, loop prevention)
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

### Security
- **codemode**: Added frozen built-in prototypes inside the vm sandbox context — prevents dynamic constructor chain escapes (e.g., `Error().constructor.constructor('return process')()`)
- **codemode**: Nullified `Proxy` constructor in sandbox globals (`Proxy: undefined`) — prevents meta-object protocol abuse
- **codemode**: Added `Reflect.*` blocked pattern (full API coverage, upgraded from `Reflect.construct`-only)
- **codemode**: Added `Symbol.*` blocked pattern — prevents `hasInstance`, `toPrimitive`, and other well-known symbol overrides
- **codemode**: Added `new Proxy(` blocked pattern — defense-in-depth alongside Proxy nullification
- **docs**: Updated `README.md` Code Mode security section with V8 codeGeneration restrictions, frozen prototypes, RPC allowlist, egress boundary, and expanded blocked pattern documentation
- **docs**: Added Code Mode Sandbox Security section to `SECURITY.md` with engine-level restrictions, static validation, and runtime protection details
- **docs**: Updated `SECURITY.md` audit checklist with 7 new Code Mode hardening items

### Changed
- **skills**: Migrated adversarial skill documentation (`adversarial-performance`, `adversarial-planner`, `adversarial-security`, `adversarial-skill-audit`) from deprecated `github-copilot-cli` npm package to the modern `gh copilot` GitHub CLI extension
- **skills**: Restructured `wrangler`, `typescript`, `mcp-builder`, and `skill-builder` by moving verbose content into `references/` directories to optimize agent token limits (progressive disclosure)
- **skills**: Rewrote `shadcn-ui` into a strict agent-facing imperative workflow, removing prior user-facing marketing copy
- **skills**: Expanded `next-upgrade` to enforce specific target versions, decision tree references, and strict code review gates before `npm install`
- **skills**: Disambiguated `cloudflare` and `workers-best-practices` descriptions to prevent trigger collisions with `wrangler` and each other
- **skills**: Added Automated Auditing section to `README.md` referencing the `check-skills.ps1` and `run-copilot.ps1` evaluation scripts in the `adversarial-skill-audit` skill

### Fixed
- **skills**: Added recursive `node_modules` and `package-lock.json` filter to `bin/sync.js` to prevent bloat propagation during sync
- **skills**: Removed stale `gitlab/node_modules` directory (648 orphaned files)
- **skills**: Remediated frontmatter formatting and token bloat issues identified across all 35 skills by the `adversarial-skill-audit` evaluator
