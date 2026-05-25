# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added

- **briefing**: Added server version, tool/resource/prompt surface area counts, test health indicators, unreleased change summary, `localTime`, word-boundary truncation (120 chars), and zero-relationship graph suppression to `memory://briefing` output
- **briefing**: Added Config table row surfacing active tool filter, instruction level, IO root count, and registered project names
- **briefing**: Added code-map availability indicator (`📋 code-map`), active filter annotation in System row, unreleased key-items (`Key: ...`), and stale milestone `✅` indicator
- **briefing**: Added a tool reference pointer (`🛠️ tools`) next to the code-map indicator
- **briefing**: Added days-since-release indicator to Unreleased line (parsed from `CHANGELOG.md`)
- **briefing**: Added registered workspace disk paths to briefing for non-IDE agent context
- **briefing**: Added local Git working tree status (clean, modified, untracked) and explicit CI workflow outcomes to the GitHub row
- **briefing**: Added the `📊 memory://metrics/summary` URI breadcrumb and `Local Check: ✅` status indicator to the System row.
- **briefing**: Added conditional `⚠️ Deprecation Warning(s):` section to briefing output for recently utilized legacy fields.
- **metrics**: Added dynamic tracking for deprecation warnings (`MetricsAccumulator.recordDeprecationWarning`).
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

- **briefing**: Improved quality by surfacing `readonly`, `TEAM_DB_PATH`, and `GITHUB_TOKEN` capability statuses directly in the Config row
- **briefing**: Renamed the `Key:` designation inside Unreleased items to `Recent focus:` to prevent misinterpretation by LLMs as a cryptographic or mapping key.
- **briefing**: Injected `(view: memory://graph/recent)` into the Graph stats line to serve as an explicit instruction for traversing relationships.
- **briefing**: Enhanced code-map indicator to include the exact file path and prioritized gatekeeper CI workflows in github status
- **briefing**: Filtered out stale milestones (100% completed and updated > 24h ago) to ensure the briefing cycles to active milestones automatically
- **briefing**: Explicitly noted the 100KB cap in the Code Mode filter summary and removed redundant filter details from the Config row
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

- **briefing**: Fixed dynamic context routing mismatch by gracefully extracting repository names when provided full URI strings (e.g., `memory://briefing/owner/repo`)
- **briefing**: Remedied `undefined` runtime property crash in `context.runtime?.metrics?.getDeprecationWarnings()` logic.
- **briefing**: Ensured the instruction level is always surfaced in the Config row and highlighted the active workspace in the Workspaces footer
- **briefing**: Added the `use mj.* API` breadcrumb to the System row when the codemode filter is active
- **admin/core**: Handled `strict-boolean-expressions` typescript errors when validating the `auto_context` parameter dynamically across tool handler architectures.
- **relationships**: Fixed `visualize_relationships` returning `null` for the mermaid string when no relationships exist, ensuring consistent string types for the structured Code Mode API
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` sizes, and `tool-reference.md` with recent architectural changes
- **docs**: Corrected readonly tool group count across references and synchronized missing environment variables (`TRUST_PROXY`, `PUBLIC_ORIGIN`) in configuration templates
- **docs**: Updated remaining hardcoded resource counts (36 -> 46) across READMEs and Copilot instructions to match the dynamic briefing output
- **instructions**: Corrected Hush Protocol tool names, tag taxonomy examples, and clarified read-only mode behavior
- **instructions**: Removed misleading `mj.export.*` from Code Mode namespace table and expanded `search_entries` docs
- **scripts**: Improved `test-scheduler.mjs` to print actionable setup instructions instead of bare fetch errors
- **skills**: Remediated frontmatter formatting, removed stale `gitlab` dependencies, and fixed sync propagation filtering
- **tests**: Updated Playwright E2E tests (`resources.spec.ts`, `resources-briefing-env.spec.ts`) to correctly assert against markdown `memory://briefing` responses
- **tests**: Fixed Phase 20.12 Code Mode test script to include `project_number` for robust `issueUrl` auto-population in generic CWD environments
- **briefing**: Fixed missing blank line before markdown table in `memory://briefing` and stripped `<untrusted_remote_content>` tags to prevent IDE rendering cutoff
- **briefing**: Grouped table properties into 5 distinct macro-categories via `<br>` elements and removed the inline Mermaid graph to permanently resolve IDE history truncation (graph remains available via `memory://graph/recent`)
- **briefing**: Corrected static `RESOURCE_COUNT` constant from `36` to the audited actual count of `46` (28 static + 18 template)
- **briefing**: Replaced static `RESOURCE_COUNT` constant with lazy dynamic count from live resource registry to prevent future drift
- **briefing**: Switched coverage % source from brittle README badge parsing to `coverage-summary.json` (vitest structured output)
- **briefing**: Deduplicated `Latest:` and `Summary:` entry previews to diversify briefing content when retrospectives dominate recent activity

### Removed

- **github**: Removed Dependabot configuration to reduce PR noise and merge conflicts
- **resources**: Removed redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints as `memory://briefing` now directly returns markdown

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability
