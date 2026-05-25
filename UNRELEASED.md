# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added

- **admin**: Added `project_number`, `significance_type`, and GitHub metadata fields to `update_entry` and `team_update_entry`
- **analytics**: Added on-read computation with 60s TTL cache, startup snapshot seeding, and live fallback for `memory://insights/digest`
- **auto-prune**: Added importance-based garbage collection for old, low-importance entries via CLI flags and environment variables
- **codemode**: Added runtime schema introspection (`.schema()`) for proxy tools and dynamically injected TypeScript declarations for the `mj_execute_code` payload
- **codemode**: Added `copilotReviews`, `exportMarkdown`, and `importMarkdown` aliases to `api-constants.ts`
- **docs**: Added missing CLI flags, environment variables, and auto-prune documentation to the Wiki and configuration examples
- **errors**: Added valid enum value lists to Zod validation error messages to assist agent self-correction
- **instructions**: Added 14 new `EntryType` values, `architecture`/`security` significance types, and `response_to`/`blocked_by`/`caused` relationships
- **instructions**: Added missing tool parameters (`target_user`, `repo`) and Code Mode guidance (`mj.*` namespace, parameter casing)
- **instructions**: Added `HELP_CONTENT` export for pull-based help delivery via `memory://help/{key}`
- **scripts**: Added `test:scheduler` npm script for HTTP scheduler E2E testing
- **skills**: Added 4 adversarial auditing skills, the `journal-optimizer` skill, and migrated 14 skills from `adamic`

### Changed

- **docs**: Highlighted auto-prune in feature tables and radically simplified agent briefing instructions to resolve Docker Hub limit violations
- **docs**: Standardized `README.md` layout, badges, and automated auditing references
- **instructions**: Refactored monolithic `server-instructions.md` into a modular directory, reducing initial payload by ~700 tokens
- **instructions**: Enhanced session summary formatting, tag taxonomy, and significance marking criteria
- **instructions**: Updated `memory://help/{group}` handler to serve static content alongside tool schema data
- **instructions**: Renamed the `technical_breakthrough` significance type to `breakthrough`
- **resources**: Refactored `memory://briefing` and `memory://briefing/{repo}` to return `text/markdown` directly instead of JSON objects to improve token efficiency
- **skills**: Restructured large skills (`wrangler`, `typescript`, `mcp-builder`, `skill-builder`) into `references/` directories for token efficiency
- **skills**: Expanded `mcp-builder` with security patterns and rewrote `shadcn-ui` as a strict workflow
- **skills**: Disambiguated `cloudflare` from `workers-best-practices` and migrated adversarial skills to `gh copilot`
- **Dependency Updates**: Bumped npm dependencies (`@types/node`, `eslint`, `tsx`, `typescript-eslint`, `vitest`) to latest minor/patch versions

### Fixed

- **relationships**: Fixed `visualize_relationships` returning `null` for the mermaid string when no relationships exist, ensuring consistent string types for the structured Code Mode API
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` sizes, and `tool-reference.md` with recent architectural changes
- **docs**: Corrected readonly tool group count across references and synchronized missing environment variables (`TRUST_PROXY`, `PUBLIC_ORIGIN`) in configuration templates
- **instructions**: Corrected Hush Protocol tool names, tag taxonomy examples, and clarified read-only mode behavior
- **instructions**: Removed misleading `mj.export.*` from Code Mode namespace table and expanded `search_entries` docs
- **scripts**: Improved `test-scheduler.mjs` to print actionable setup instructions instead of bare fetch errors
- **skills**: Remediated frontmatter formatting, removed stale `gitlab` dependencies, and fixed sync propagation filtering
- **tests**: Verified Phase 27 Code Mode capabilities (Admin, Backup, and Export) with complete functional parity
- **tests**: Updated Playwright E2E tests (`resources.spec.ts`, `resources-briefing-env.spec.ts`) to correctly assert against markdown `memory://briefing` responses
- **tests**: Fixed Phase 20.12 Code Mode test script to include `project_number` for robust `issueUrl` auto-population in generic CWD environments

### Removed

- **github**: Removed Dependabot configuration to reduce PR noise and merge conflicts
- **resources**: Removed redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints as `memory://briefing` now directly returns markdown

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability
