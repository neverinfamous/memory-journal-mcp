# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added
- **analytics**: Briefing analytics now compute on-read with 60s TTL cache when no scheduler or persisted snapshot exists, ensuring analytics appear in stdio transport and fresh databases
- **analytics**: Server seeds an initial digest snapshot at startup when none exists, covering both stdio and HTTP transports
- **analytics**: `memory://insights/digest` resource now falls back to live computation instead of returning "no digest available"
- **scripts**: Added `npm run test:scheduler` convenience script for the HTTP scheduler E2E test
- **admin**: `update_entry` and `team_update_entry` now accept `project_number`, `significance_type`, and all GitHub metadata fields (`project_owner`, `issue_number`, `issue_url`, `pr_number`, `pr_url`, `pr_status`, `workflow_run_id`, `workflow_name`, `workflow_status`), matching the field surface of `create_entry`
- **codemode**: Added `copilotReviews`, `exportMarkdown`, and `importMarkdown` aliases to `api-constants.ts`
- **instructions**: Added 14 new `EntryType` values (e.g., `meeting_notes`, `adversarial_review`) and `breakthrough` / `technical_breakthrough` significance types to `overview.md`
- **instructions**: Added `response_to`, `blocked_by`, and `caused` relationship types to Link Entries section
- **instructions**: Documented `target_user` parameter for `team_pass_flag` and `repo` parameter for `get_copilot_reviews`
- **instructions**: Added Code Mode guidance indicating that bare tool names require the `mj.*` namespace when `mj_execute_code` is the only active tool
- **instructions**: Added `HELP_CONTENT` map export for pull-based help delivery via `memory://help/{key}` resources
- **skills**: Migrated 14 skills from `adamic/skills` and updated inventory to track 35 total skills
- **skills**: Added 4 adversarial auditing skills (`adversarial-security`, `adversarial-performance`, `adversarial-skill-audit`, `adversarial-workflow-audit`)
- **skills/mcp-builder**: Expanded reference documentation with 10 new security hardening patterns (e.g., frozen prototypes, fail-closed scope, subquery blocking) and Code Mode sandbox boundaries
- **skills/mcp-builder**: Updated `architecture-reference.md`, `error-handling.md`, `testing-reference.md`, and `oauth-reference.md` with refined test taxonomies, error subclass structures, and OAuth secure defaults
- **skills/mcp-builder**: Updated `SKILL.md` and `code-mode-reference.md` with `reportProgress()` usage, privacy annotation notes, and security checklist compliance

### Changed
- **instructions**: Refactored monolithic `server-instructions.md` to a `server-instructions/` directory architecture, reducing initial payload from ~2,200 tokens to ~1,500 tokens
- **instructions**: Enhanced server instructions with session summary format, tag taxonomy, and significance marking criteria
- **instructions**: Updated `memory://help/{group}` handler to serve static help content alongside tool schema data
- **docs**: Standardized `README.md` layout, badges, and automated auditing references
- **skills**: Migrated adversarial skill docs from `github-copilot-cli` to modern `gh copilot` GitHub CLI extension
- **skills**: Restructured 4 skills (`wrangler`, `typescript`, `mcp-builder`, `skill-builder`) into `references/` directories for token efficiency
- **skills**: Rewrote `shadcn-ui` as a strict agent-facing workflow and expanded `next-upgrade` with strict target versions and review gates
- **skills**: Disambiguated `cloudflare` and `workers-best-practices` to prevent trigger collisions

### Fixed
- **scripts**: `test-scheduler.mjs` now prints actionable prerequisite instructions when the HTTP server is not running instead of bare `Fatal: fetch failed`
- **codemode**: Added missing `add_kanban_item` and `delete_kanban_item` mapping to `inferGroupFromName` in `help.ts`
- **instructions**: Corrected Hush Protocol tool names (`team_pass_flag`, `team_resolve_flag`) and added missing optional parameters
- **instructions**: Corrected tag taxonomy examples to use valid Memory Journal groups instead of database groups
- **instructions**: Clarified `autoContext` deprecation, read-only mode behavior, and split semantic search threshold guidance
- **instructions**: Removed misleading `mj.export.*` row from Code Mode namespace table and expanded `search_entries` mode documentation
- **docs**: Updated `code-map.md` directory tree and `README.md` file sizes to match architectural changes
- **skills**: Remediated frontmatter formatting and token bloat across all 35 skills
- **skills**: Fixed sync propagation by adding recursive `node_modules`/`package-lock.json` filtering and removing stale `gitlab` dependencies
- **docs**: Updated `update_entry` and `team_update_entry` tool descriptions and `tool-reference.md` to reflect the expanded 11 metadata field surface

### Security
- **codemode**: Added frozen built-in prototypes in VM sandbox to prevent dynamic constructor chain escapes
- **codemode**: Nullified `Proxy` constructor and added `Reflect.*`, `Symbol.*`, and `new Proxy(` blocked patterns to prevent meta-object protocol abuse
- **docs**: Updated `README.md` and `SECURITY.md` with engine-level Code Mode sandbox restrictions, RPC allowlists, and static validation details
