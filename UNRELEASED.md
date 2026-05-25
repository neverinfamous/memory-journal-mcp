# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added

- **admin**: Added `project_number`, `significance_type`, and GitHub metadata fields to `update_entry` and `team_update_entry`
- **analytics**: Added on-read computation with 60s TTL cache, startup snapshot seeding, and live fallback for `memory://insights/digest`
- **auto-prune**: Added importance-based garbage collection for old, low-importance entries via CLI flags and environment variables
- **briefing**: Added server version, resource/tool counts, test health indicators, workspace paths, git working tree status, code-map availability, `📊 memory://metrics/summary` breadcrumb, and unreleased change summary to `memory://briefing` output
- **codemode**: Added runtime schema introspection (`.schema()`) for proxy tools and dynamically injected TypeScript declarations for the `mj_execute_code` payload
- **codemode**: Added `copilotReviews`, `exportMarkdown`, and `importMarkdown` aliases to `api-constants.ts`
- **docs**: Added missing CLI flags, environment variables, and auto-prune documentation to the Wiki and configuration examples
- **errors**: Added valid enum value lists to Zod validation error messages to assist agent self-correction
- **instructions**: Added 14 new `EntryType` values, `architecture`/`security` significance types, missing tool parameters, and `HELP_CONTENT` export for pull-based help delivery
- **metrics**: Added dynamic tracking for deprecation warnings (`MetricsAccumulator.recordDeprecationWarning`)
- **scripts**: Added `test:scheduler` npm script for HTTP scheduler E2E testing
- **skills**: Added 4 adversarial auditing skills, the `journal-optimizer` skill, and migrated 14 skills from `adamic`

### Changed

- **briefing**: Improved output clarity and token efficiency by surfacing capability statuses directly in the Config row and renaming designations to prevent LLM misinterpretation
- **briefing**: Enhanced the code-map indicator to include exact file paths and prioritized gatekeeper CI workflows in github status
- **briefing**: Filtered out stale milestones (100% completed and updated > 24h ago) to ensure the briefing cycles automatically
- **codemode**: Optimized dynamically generated TypeScript declarations and removed redundant strings to save tokens in `mj_execute_code` prompts
- **docs**: Highlighted auto-prune, standardized `README.md` layout, and radically simplified agent briefing instructions to resolve Docker Hub limit violations
- **instructions**: Refactored monolithic `server-instructions.md` into a modular directory, reducing initial payload by ~700 tokens
- **instructions**: Enhanced session summary formatting, updated help handlers, and renamed `technical_breakthrough` significance type to `breakthrough`
- **resources**: Refactored `memory://briefing` and `memory://briefing/{repo}` to return `text/markdown` directly instead of JSON objects to improve token efficiency
- **skills**: Restructured large skills, expanded `mcp-builder`, disambiguated terminology, and upgraded `adversarial-planner` to embed `gh copilot` performance/security scans directly in the planning document
- **system**: Bumped npm dependencies (`@types/node`, `eslint`, `tsx`, `typescript-eslint`, `vitest`) to latest minor/patch versions

### Fixed

- **admin/core**: Handled `strict-boolean-expressions` TypeScript errors when validating the `auto_context` parameter dynamically
- **briefing**: Fixed dynamic context routing mismatch, remedied `undefined` runtime property crash, and corrected missing blank lines/tags to prevent IDE rendering cutoff
- **briefing**: Corrected static `RESOURCE_COUNT` to lazy dynamic count, switched coverage % source to vitest structured output, and deduplicated entry previews
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` sizes, missing environment variables, and tool reference counts with recent architectural changes
- **instructions**: Corrected tool schemas, removed deprecated `auto_context` field, and embedded behavior defaults directly into tool schemas
- **relationships**: Fixed `visualize_relationships` returning `null` for the mermaid string when no relationships exist
- **scripts**: Improved `test-scheduler.mjs` to print actionable setup instructions instead of bare fetch errors
- **skills**: Remediated frontmatter formatting, removed stale `gitlab` dependencies, and fixed sync propagation filtering
- **tests**: Fixed Code Mode scripts to include `project_number` and updated Playwright specs to correctly assert against markdown `memory://briefing` responses

### Removed

- **github**: Removed Dependabot configuration to reduce PR noise and merge conflicts
- **instructions**: Removed `gotchas.md`, `codemode.md`, and `server-access.md` static help files to reduce agent distraction and token usage
- **resources**: Removed redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability
