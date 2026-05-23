# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added
- **admin**: Expanded `update_entry` and `team_update_entry` to accept `project_number`, `significance_type`, and all GitHub metadata fields, reaching parity with `create_entry`
- **analytics**: Enabled on-read computation with a 60s TTL cache, startup snapshot seeding, and live fallback for `memory://insights/digest` to ensure availability across all transports
- **auto-prune**: Added importance-based garbage collection that soft-deletes old, low-importance entries on server startup via `--prune-older-than-days` / `PRUNE_OLDER_THAN_DAYS` and `--prune-importance-threshold` / `PRUNE_IMPORTANCE_THRESHOLD`
- **codemode**: Added `copilotReviews`, `exportMarkdown`, and `importMarkdown` aliases to `api-constants.ts`
- **instructions**: Added 14 new `EntryType` values, `breakthrough` significance types, new relationship types (`response_to`, `blocked_by`, `caused`), and missing tool parameters (`target_user`, `repo`)
- **instructions**: Added Code Mode guidance for using the `mj.*` namespace and a `HELP_CONTENT` export for pull-based help delivery via `memory://help/{key}`
- **scripts**: Added the `npm run test:scheduler` convenience script for HTTP scheduler E2E testing
- **skills**: Added 4 adversarial auditing skills and migrated 14 skills from `adamic`, bringing the tracked inventory to 35 skills
- **skills**: Added `journal-optimizer` skill with 5 guided workflows for database pruning and optimization using soft-delete safety and importance score transparency
- **skills**: Expanded the `mcp-builder` reference with 10 security hardening patterns, refined test taxonomies, error structures, OAuth secure defaults, and sandbox boundaries

### Changed
- **docs**: Standardized `README.md` layout, badges, and automated auditing references
- **instructions**: Refactored the monolithic `server-instructions.md` into a modular directory, reducing the initial payload from ~2,200 to ~1,500 tokens
- **instructions**: Enhanced session summary formatting, tag taxonomy, and significance marking criteria in the core instructions
- **instructions**: Updated the `memory://help/{group}` handler to serve static content alongside tool schema data
- **skills**: Migrated adversarial skill documentation to the modern `gh copilot` CLI extension
- **skills**: Restructured `wrangler`, `typescript`, `mcp-builder`, and `skill-builder` into `references/` directories for token efficiency
- **skills**: Rewrote `shadcn-ui` as a strict workflow, expanded `next-upgrade` with version gates, and disambiguated `cloudflare` from `workers-best-practices`

### Fixed
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` file sizes, and `tool-reference.md` with recent architectural and field surface changes
- **docs**: Added `TRUST_PROXY`, `PUBLIC_ORIGIN`, `OAUTH_CLOCK_TOLERANCE` to `mcp-config-example.json`
- **docs (wiki)**: Added auto-prune CLI flags, `CODEMODE_INTERNAL_FULL_ACCESS` env var, and modular instructions directory to Configuration, Code-Mode, and Architecture wiki pages
- **docs (wiki)**: Added 13 missing CLI flags, 6 missing env vars, and Auto-Prune (Garbage Collection) section to Configuration wiki page
- **instructions**: Corrected Hush Protocol tool names, fixed tag taxonomy examples, and clarified `autoContext` deprecation and read-only mode behavior
- **instructions**: Removed the misleading `mj.export.*` row from the Code Mode namespace table and expanded `search_entries` documentation
- **scripts**: `test-scheduler.mjs` now prints actionable setup instructions instead of a bare fetch failure when the HTTP server is offline
- **skills**: Fixed sync propagation by filtering `node_modules` recursively and removing stale `gitlab` dependencies
- **skills**: Remediated frontmatter formatting and token bloat across all 35 skills

### Security
- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to the VM sandbox to prevent meta-object protocol abuse and dynamic constructor chain escapes
- **docs**: Documented engine-level Code Mode sandbox restrictions, RPC allowlists, and static validation details in `SECURITY.md` and `README.md`
