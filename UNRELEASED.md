# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added

- **admin**: `project_number`, `significance_type`, and GitHub metadata fields to `update_entry` and `team_update_entry`
- **analytics**: On-read computation with 60s TTL cache, startup snapshot seeding, and live fallback for `memory://insights/digest`
- **auto-prune**: Importance-based garbage collection for old, low-importance entries via CLI flags and environment variables
- **briefing**: Server version, resource/tool counts, test health indicators, workspace paths, git working tree status, code-map availability, `📊 memory://metrics/summary` breadcrumb, and unreleased change summary to `memory://briefing` output
- **codemode**: `context` parameter to `mj_execute_code` schema, injected into the VM worker thread to prevent string escaping syntax errors
- **codemode**: Runtime schema introspection (`.schema()`) for proxy tools and dynamically injected TypeScript declarations for `mj_execute_code` payload
- **codemode**: `copilotReviews`, `exportMarkdown`, and `importMarkdown` aliases to `api-constants.ts`
- **docs**: Missing CLI flags, environment variables, and auto-prune documentation to the Wiki and configuration examples
- **errors**: Valid enum value lists to Zod validation error messages
- **instructions**: 14 new `EntryType` values, `architecture`/`security` significance types, missing tool parameters, and `HELP_CONTENT` export
- **metrics**: Dynamic tracking for deprecation warnings (`MetricsAccumulator.recordDeprecationWarning`)
- **scripts**: `test:scheduler` npm script for HTTP scheduler E2E testing
- **skills**: 4 adversarial auditing skills, the `journal-optimizer` skill, and migrated 14 skills from `adamic`
- **skills**: Official vendor skills for AWS, GCP, Azure, and Render added to the inventory

### Changed

- **briefing**: Surfaced capability statuses directly in the Config row and renamed designations for clarity
- **briefing**: Enhanced the code-map indicator to include exact file paths and prioritized gatekeeper CI workflows in github status
- **briefing**: Filtered out stale milestones (100% completed and updated > 24h ago) to ensure the briefing cycles automatically
- **codemode**: Optimized dynamically generated TypeScript declarations and removed redundant strings to save tokens in `mj_execute_code` prompts
- **docs**: Highlighted auto-prune, standardized `README.md` layout, and simplified agent briefing instructions
- **instructions**: Refactored monolithic `server-instructions.md` into a modular directory, reducing initial payload by ~700 tokens
- **instructions**: Enhanced session summary formatting, updated help handlers, and renamed `technical_breakthrough` significance type to `breakthrough`
- **resources**: `memory://briefing` and `memory://briefing/{repo}` now return `text/markdown` directly instead of JSON objects to improve token efficiency
- **skills**: Restructured large skills, expanded `mcp-builder`, disambiguated terminology, and upgraded `adversarial-planner` to embed `gh copilot` performance/security scans directly in the planning document
- **system**: Bumped npm dependencies (`@types/node`, `eslint`, `tsx`, `typescript-eslint`, `vitest`) to latest minor/patch versions

### Fixed

- **skills**: Addressed critical findings from the adversarial skill audit (removed `{{ORG_NAME}}` placeholder from `github-repo-setup`, removed duplicate description fragment from `adversarial-performance`, added missing `disable-model-invocation: true` to `mcp-builder`).
- **admin/core**: Handled `strict-boolean-expressions` TypeScript errors when validating the `auto_context` parameter dynamically
- **briefing**: Fixed dynamic context routing mismatch, `undefined` runtime property crash, and missing blank lines/tags causing IDE rendering cutoff
- **briefing**: Corrected static `RESOURCE_COUNT` to lazy dynamic count, switched coverage % source to vitest structured output, and deduplicated entry previews
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` sizes, missing environment variables, and tool reference counts with recent architectural changes
- **instructions**: Corrected tool schemas, removed deprecated `auto_context` field, and embedded behavior defaults directly into tool schemas
- **relationships**: Fixed `visualize_relationships` returning `null` for the mermaid string when no relationships exist
- **scripts**: Improved `test-scheduler.mjs` to print actionable setup instructions instead of bare fetch errors
- **skills**: Remediated frontmatter formatting, removed stale `gitlab` dependencies, and fixed sync propagation filtering
- **skills**: Elaborated 4 stub skills, delineated Cloudflare and testing topologies, and verified database triggers per the adversarial skill audit
- **tests**: Fixed Code Mode scripts to include `project_number` and updated Playwright specs to assert against markdown `memory://briefing` responses
- **tests**: Fixed formatting assertions in briefing user message tests

### Removed

- **github**: Dependabot configuration to reduce PR noise and merge conflicts
- **instructions**: `gotchas.md`, `codemode.md`, and `server-access.md` static help files to reduce agent distraction and token usage
- **resources**: Redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability
