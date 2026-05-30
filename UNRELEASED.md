# Unreleased Changes

## [Unreleased](https://github.com/neverinfamous/memory-journal-mcp/compare/v7.7.1...HEAD)

### Added

- **github**: Re-added Dependabot configuration scoped to `github-actions` only (no npm, no auto-merge) for passive version update notifications
- **prompts**: `adversarial-plan-review` prompt bootstrapping multi-pass adversarial planning with structured review dimensions, scoring rubric, and prior plan context from the journal
- **prompts**: `flag-dashboard` prompt for triaging active Hush Protocol flags with severity grouping, staleness detection, and resolution guidance
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
- **skills**: `docs-marketer` skill for documentation marketability auditing with 10-category scoring, optional adversarial dual-agent mode, and Copilot validation
- **docs**: Added "Customizing the Session Briefing" sections to `README.md`, `DOCKER_README.md`, and wiki `Configuration.md` with three-dimensional customization guide (depth, journal content, GitHub enrichment), context injections, repo-scoped briefings, and preset recipes

### Changed

- **tests**: Standardized 42+ testing prompt files across `standard/` and `codemode/` directories, fixing phase numbering collisions, tool name discrepancies (`team_pass_flag`), header templates, and resource coverage gaps

- **deps**: Bumped `commander` to `^15.0.0` and `eslint` to `10.4.1`
- **docker**: Bumped Node.js base image from `26.1.0-alpine` to `26.2.0-alpine` (#563)
- **briefing**: Surfaced capability statuses directly in the Config row and renamed designations for clarity
- **prompts**: `prepare-standup` and `prepare-retro` now surface active team flags as contextual signals alongside analytics digest
- **briefing**: Enhanced the code-map indicator to include exact file paths and prioritized gatekeeper CI workflows in github status
- **briefing**: Filtered out stale milestones (100% completed and updated > 24h ago) to ensure the briefing cycles automatically
- **codemode**: Optimized dynamically generated TypeScript declarations and removed redundant strings to save tokens in `mj_execute_code` prompts
- **docs**: Highlighted auto-prune, standardized `README.md` layout, and simplified agent briefing instructions
- **instructions**: Refactored monolithic `server-instructions.md` into a modular directory, reducing initial payload by ~700 tokens
- **instructions**: Enhanced session summary formatting, updated help handlers, and renamed `technical_breakthrough` significance type to `breakthrough`
- **resources**: `memory://briefing` and `memory://briefing/{repo}` now return `text/markdown` directly instead of JSON objects to improve token efficiency
- **skills**: Restructured large skills, expanded `mcp-builder`, disambiguated terminology, and upgraded `adversarial-planner` to embed `gh copilot` performance/security scans directly in the planning document
- **system**: Bumped npm dependencies (`@types/node`, `eslint`, `tsx`, `typescript-eslint`, `vitest`) to latest minor/patch versions

### Removed

- **instructions**: `gotchas.md`, `codemode.md`, and `server-access.md` static help files to reduce agent distraction and token usage
- **resources**: Redundant `memory://briefing-message` and `memory://briefing-message/{repo}` endpoints

### Fixed

- **scripts**: Fixed `generate-server-instructions.ts` help pointer mapping logic to handle global vs group-specific help resources, resolving `test-filter-instructions.mjs` test failures
- **codemode**: Added `shimMj` proxy fallback in worker sandbox to seamlessly intercept and route common agent API hallucinations (e.g., `sqlite.mj.executeCode`, `memory.journal.addEntry`, `memory.append`) to valid tools
- **codemode**: Refined static security blocked patterns (e.g., `http.`, `fs.`, `process.`) with negative lookbehinds (`(?<![.-])`) to eliminate false positives when these sequences appear within legitimate filenames or safe property chains (e.g., `streamable-http.spec.ts`)
- **codemode**: Added `writeQuery` as an alias to `createEntry` in the core API group to gracefully handle cross-server agent hallucinations attempting to log database queries directly into the journal
- **codemode**: Intercepted Code Mode `SyntaxError` exceptions (e.g., missing parenthesis) to append actionable tips advising the use of template literals (backticks) for long, multi-line markdown payloads to prevent escaping errors
- **codemode**: Handled common agent parameter hallucinations by dynamically mapping `id` keys to `entry_id` within the `normalizeParams` pipeline, fixing `deleteEntry({ id: ... })` failures
- **codemode**: Mapped `sqlite_journal_add_entry` as a global alias to `createEntry` to gracefully intercept flat global function hallucinations
- **codemode**: Added fallback serialization in `normalizeParams` to format missing `content` fields into markdown strings when agents hallucinate arbitrary keys (e.g., `description`, `context`) during entry creation
- **skills**: Addressed critical findings from the adversarial skill audit (removed `{{ORG_NAME}}` placeholder from `github-repo-setup`, removed duplicate description fragment from `adversarial-performance`, added missing `disable-model-invocation: true` to `mcp-builder`).
- **admin/core**: Handled `strict-boolean-expressions` TypeScript errors when validating the `auto_context` parameter dynamically
- **briefing**: Fixed dynamic context routing mismatch, `undefined` runtime property crash, and missing blank lines/tags causing IDE rendering cutoff
- **briefing**: Corrected static `RESOURCE_COUNT` to lazy dynamic count, switched coverage % source to vitest structured output, and deduplicated entry previews
- **codemode**: Mapped `mj.addEntry`, `mj.entries`, and `mj.core.searchEntries` as dynamic proxies to natively fulfill frequent agent hallucinations without erroring
- **codemode**: Added root Proxy boundary to catch hallucinated top-level flat methods (e.g. `mj.addEntry`) and return structured error recommendations instead of raw TypeErrors
- **codemode**: Excluded flat top-level method aliases (e.g., `createEntry`, `getStatistics`) from the "Available groups" list in the Code Mode Proxy error boundary
- **codemode**: Excluded `memory` and `entries` aliases from the `groups` list returned by `mj.help()` to ensure accurate discoverability count
- **codemode**: Dynamically intercepted legacy `mj_create_entry` hallucinated payloads sent directly to `mj_execute_code` (missing `code` field) to seamlessly wrap them in valid native sandbox execution scripts without throwing Zod errors
- **codemode**: Refined hallucinated parameter smoothing in `mj_execute_code` to natively support aliases (`script`, `javascript`, `query`, `snippet`) and correctly delegate invalid structures to `createEntry` while preserving strict Zod failure behavior for purely empty objects
- **core**: Silently dropped unrecognized `significance_type` string hallucinations (e.g., `"minor"`) in parameter coercion to prevent Zod validation failures during entry creation
- **codemode**: Mapped `sqlite`, `postgres`, `mysql`, and `db` as top-level globals in the VM sandbox to prevent `ReferenceError` during cross-server tool hallucinations
- **codemode**: Mapped `memory` to `core` and aliased `appendInsight` to `createEntry` to seamlessly fulfill `sqlite.memory.appendInsight` cross-server tool hallucinations
- **codemode**: Mapped `add_kanban_item` and `delete_kanban_item` correctly in `inferGroupFromName`
- **docs**: Synchronized `code-map.md`, `README.md` sizes, missing environment variables, and tool reference counts with recent architectural changes
- **docs**: Synchronized prompt count (18 → 19) and `flag-dashboard` marketing across `README.md`, `DOCKER_README.md`, `CONTRIBUTING.md`, `copilot-instructions.md`, `test-errors.md`, and 6 wiki pages
- **instructions**: Corrected tool schemas, removed deprecated `auto_context` field, and embedded behavior defaults directly into tool schemas
- **relationships**: Fixed `visualize_relationships` returning `null` for the mermaid string when no relationships exist
- **scripts**: Improved `test-scheduler.mjs` to print actionable setup instructions instead of bare fetch errors
- **skills**: Remediated frontmatter formatting, removed stale `gitlab` dependencies, and fixed sync propagation filtering
- **skills**: Elaborated 4 stub skills, delineated Cloudflare and testing topologies, and verified database triggers per the adversarial skill audit
- **tests**: Fixed Code Mode scripts to include `project_number` and updated Playwright specs to assert against markdown `memory://briefing` responses
- **tests**: Fixed formatting assertions in briefing user message tests
- **codemode**: Expanded `METHOD_ALIASES` with ~25 predicted high-probability hallucination aliases covering CRUD verb confusion (`newEntry`, `insert`, `write`, `log`, `record`, `note`, `save`, `getEntry`, `fetch`, `read`, `list`, `all`, `latest`), search verb variants (`query`, `lookup`, `findEntries`), admin verb variants (`editEntry`, `modifyEntry`, `modify`, `removeEntry`), and backup shortcuts (`create`, `backup`)
- **codemode**: Added `PARAM_ALIASES` map to `convertKeysToSnakeCase` to silently remap hallucinated parameter names (`text`/`body`/`note` → `content`, `entry` → `entry_id`, `q` → `query`, `issue` → `issue_number`, `pr` → `pr_number`, `project` → `project_number`) with conflict-safe guards
- **codemode**: Added singular `tag` → `tags` array coercion in parameter normalization to handle agents passing `{ tag: "foo" }` instead of `{ tags: ["foo"] }`
- **codemode**: Expanded `JournalApi` constructor cross-group wiring to route admin operations (`deleteEntry`, `updateEntry`, `mergeTags`) and io/backup operations (`exportEntries`, `backupJournal`) through `core` group, and mapped db-mcp admin operations (`backup`, `restore`, `analyze`) to their journal equivalents
- **codemode**: Added db-mcp bleedover cross-wiring: `readQuery` → `searchEntries`, `upsert` → `createEntry`, `count`/`listTables`/`describeTable` → `getStatistics`, `exists` → `getEntryById` for agents confused about which MCP server they're talking to
- **codemode**: Added `DB_TO_JOURNAL` mapping in `shimMj` proxy to silently route 10 db-mcp-specific top-level method hallucinations (`listTables`, `describeTable`, `count`, `analyze`, `vacuum`, `integrityCheck`, `exists`, `upsert`, `batchInsert`, `readQuery`) to their closest journal equivalents
- **codemode**: Extended top-level sandbox bindings with 7 additional flat-function aliases (`find`, `recent`, `listTags`, `semanticSearch`, `linkEntries`, `mergeTags`, `exportEntries`)
- **resources**: Added `RESOURCE_URI_ALIASES` with `generateResourceAliases` to register 6 alias resource URIs (`memory://journal/recent`, `memory://journal/briefing`, `memory://entries/recent`, `memory://status`, `memory://server`, `memory://tools`) at the SDK level, delegating to canonical handlers to silently resolve common agent URI hallucinations
- **codemode**: Promoted all callable top-level methods from `shimMj` (e.g., `createEntry`, `find`, `recent`, `searchEntries`, `deleteEntry`) as standalone VM sandbox globals, allowing agents to call `find({...})` without the `mj.` prefix
- **annotations**: Added missing explicit `destructiveHint: false` annotations to 62 tools across all handlers and `idempotentHint: false` to `delete_entry` to achieve 100% rigor against the `db-mcp` audit standards

### Security

- **codemode**: Nullified `Proxy`/`Reflect`/`Symbol` constructors and added frozen built-in prototypes to VM sandbox to prevent meta-object protocol abuse
- **docs**: Documented engine-level Code Mode sandbox restrictions and RPC allowlists in `SECURITY.md` and `README.md`
- **skills**: Bumped `qs` dependency in `gitlab` skill to resolve a remotely triggerable DoS vulnerability
