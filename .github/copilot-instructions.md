# Memory Journal MCP — Copilot Code Review Context

## Project Overview

Memory Journal MCP is a TypeScript MCP (Model Context Protocol) server providing persistent memory for AI agents. It has **a vast array of tools** across **multiple groups** (Core, Search, Analytics, Relationships, IO, Admin, GitHub, Git, Backup, Team, CodeMode), **dozens of resources**, and **multiple workflow prompts**.

**Stack**: TypeScript, Vitest, Zod (`zod` validation schemas), `better-sqlite3-multiple-ciphers` (aliased as `better-sqlite3` for SQLite + SQLCipher encryption), `sqlite-vec` (vector search), `@huggingface/transformers` (embeddings), `@octokit/rest` + `@octokit/graphql` (GitHub REST & Projects v2 GraphQL API), `simple-git`, `express` (Streamable HTTP), `jose` (OAuth 2.1).

## Session Context

If the user has loaded the project briefing context into the chat using the `load-briefing` prompt, review it to understand recent journal entries, GitHub status, and local Git status:

- **Recent journal entries** — what was just worked on by the development agent
- **GitHub status** — open issues, PRs, explicit CI workflow outcomes, milestones
- **Local Git status** — clean, modified, or untracked file counts
- **Workflow runs** — recent CI/CD results
- **Copilot review summaries** — your own recent review findings

For detailed session handoff context, search for entries tagged `session-summary` — these contain end-of-session notes from the development agent.

If you find issues during code review, use `create_entry` with tag `copilot-finding` to record them for the development agent to see in their next session briefing.

## Tooling Standards

- **Copilot CLI**: Always reference and use `gh copilot`, NOT the deprecated binary.
- **Package Manager**: Always use `pnpm`. Do NOT use `npm` or `yarn` (except for installing `pnpm` globally in CI pipelines or querying the npm registry). Use `pnpm install`, `pnpm run build`, `pnpm test`, etc.

## Coding Standards

### Naming

- **Files and folders**: Always kebab-case (`database-adapter.ts`, `tool-filter.ts`, `copilot-tools.ts`)
- **Never** PascalCase or camelCase for filenames

### Modularity

- **File size limit**: Source files stay under ~500 lines
- **Split pattern**: `foo.ts` → `foo/` directory with sub-modules + `foo/index.ts` barrel re-export
- **Logical grouping**: Split by functional cohesion, not arbitrary line counts

### Type Safety

- **Strict TypeScript** — `tsconfig.json` enforces strict mode
- **Never use `eslint-disable`** to evade standards
- **Never use `any`** — use `unknown` and narrow with type guards
- **Never use `as` type assertions** — use `satisfies` operator or strict type guards
- **Never use `@ts-ignore` or `@ts-expect-error`** — fix the underlying type issue
- **Zod schemas** for all tool input validation
- **Output schemas** — All standard domain tools (except `mj_execute_code`, which returns arbitrary sandbox results, and dummy healing tools) define Zod output schemas; error responses must pass validation
- **Dual Schema Pattern**: All standard domain tool schemas separate strict internal validation (`*Schema` preprocessed by `healAgentHallucinations`), MCP wire input schemas (`*SchemaMcp` using `relaxedNumber()` to accept stringified numbers from LLMs), and output schemas (`*OutputSchema`, omitted on `mj_execute_code` and dummy healing tools). `argsSchema` is omitted for zero-argument prompts AND prompts where all arguments are optional (`!hasRequired` in `src/server/registration.ts`), as `z.object({})` rejects `undefined` when clients omit arguments.

### Error Handling

All tool handlers catch errors and return structured error objects via `formatHandlerError(error)` instead of throwing raw MCP exceptions.
Every tool error return matches `{ success: false, error, code, category, suggestion?, recoverable, details? }` to ensure agents get classification, remediation hints, and recoverability signals.

- **Never** throw raw `McpError` exceptions from tool handlers which cause agents to crash.
- **Always** return `formatHandlerError(error)` from tool `catch` blocks; the registration layer (`src/server/mcp-server/tool-registration/`) wraps the structured JSON object into `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result }` (when `outputSchema` is defined on the tool) without setting `isError: true` on caught structured domain errors so clients parse the structured payload cleanly.

### Token Estimation

All resources must dynamically compute and return `_meta.tokenEstimate` within their JSON response blocks using the `Math.ceil(length / 4)` heuristic. Tool call observability uses content-type-aware token estimation in `src/observability/token-estimator.ts` (`4.0` bytes/token for prose, `2.8` for JSON, `3.2` for code).

### Database

- Versioned schema migrations in `src/database/migrations/` (orchestrated by `src/database/migrations/migration-manager.ts` using native better-sqlite3)
- Native connection tuning in `src/database/sqlite-adapter/native-connection.ts`: WAL mode, `busy_timeout = 5000`, `cache_size = -64000` (64MB), `sqlite-vec` `vec0` `chunk_size=256`, and a 256-entry bounded LRU prepared-statement cache (`installStatementCache`) with automatic DDL invalidation
- Backward compatible with self-healing legacy database retrofitting — never break existing data
- Consider index implications and virtual table join order (`CROSS JOIN` when driving from `fts_content` / `vec0`) for new queries

## Architectural Rules & Key Concepts

- **Multi-Tenancy**: `workspace_id` is a core concept across multi-tenancy. No split-brain allowed. Workspace orphan ratio is correctly calculated using `workspaceId` instead of hardcoded `default`.
- **Team Support**: Team database tools explicitly require `TEAM_DB_PATH`.
- **Metrics**: Tools support `trust_score`, `impact_score`, and `validation_status` (`passed` | `none` | `failed`) for analytics.
- **YAML Frontmatter**: Supported natively in entry commands (`memory-journal-mcp entry create`).
- **Docker Tags**: Always use `:latest` docker tags. Check limits (25,000 char) for DOCKER_README.md.
- **Dual-Schema Pattern**: All schemas must separate stringified input from strict internal domain types. Zod schemas are used.
- **Vendor Sync**: Ensure vendored libraries in `src/vendor/` (`lib-agent-exec` and `lib-git-history`, tracked in `src/vendor/VENDOR.json`) are kept in sync via `pnpm run sync:vendor` and validated via `pnpm run check:vendor-deps` (executed via `bun scripts/sync-vendor.ts`).
- **Guardrails**: `GOTCHAS_HELP` (`src/constants/instructions/gotchas.ts`) documents critical usage gotchas (covering search/query, backup/restore, GitHub/Kanban, content formatting, and sandbox execution), `memory://briefing` injects the session initialization guardrail, `healAgentHallucinations` (`src/handlers/tools/schemas/hallucination-healer.ts`) autonomously normalizes malformed tool arguments, and the session briefing health alert surfaces maintenance recommendations (via the `optimize-journal` prompt).
- **Code Mode Error Proxy**: Code Mode API, Promise, and Worker proxies intercept and enrich errors with the `🛠️ AUTONOMOUS HEALING:` guidance prefix, while `worker-result-proxy.ts` prefixes `.error` with `[${code}]`.

## Architecture
```
src/
├── cli/                        # CLI entry point (Commander)
├── index.ts                    # Library entry point
├── audit/                      # JSONL audit log, audit resource
├── auth/                       # OAuth 2.1 authentication
├── codemode/                   # Sandboxed JS execution engine
├── constants/
│   ├── icons.ts                # Capability and entity icon constants
│   ├── instructions/           # Modular instruction sections (base, core, gotchas, templates)
│   └── server-instructions.ts  # Dynamic server instructions and HELP_CONTENT map (Single Source of Truth)
├── database/
│   ├── adapter-factory.ts      # Database adapter factory
│   ├── core/                   # Core database types and interfaces
│   ├── migrations/             # Versioned schema migrations (MigrationManager)
│   └── sqlite-adapter/         # SQLite operations via better-sqlite3
├── filtering/
│   ├── tool-constants.ts       # Tool groups and meta-group definitions (TOOL_GROUPS)
│   └── tool-filter.ts          # Tool filtering engine
├── github/
│   └── github-integration/     # GitHub API (@octokit/rest + GraphQL)
├── handlers/
│   ├── tools/                  # tool handlers (multiple groups)
│   ├── resources/              # resource handlers
│   └── prompts/                # prompt handlers
├── markdown/                   # Markdown import/export (round-trip frontmatter parsing)
├── observability/              # Metrics interceptor, token estimator, latency tracker, Prometheus server/formatter
├── server/
│   ├── mcp-server/             # MCP server setup & tool registration
│   ├── auto-prune.ts           # Automated pruning & archiving scheduler
│   ├── digest-reporter.ts      # Scheduled digest report formatting & webhook delivery
│   ├── registration.ts         # Resource & prompt capability registration
│   ├── scheduler.ts            # Periodic maintenance jobs (backup, vacuum, prune, rebuild-index, digest, report)
│   └── subscription-manager.ts # MCP resource subscription notifications
├── transports/
│   └── http/                   # HTTP/SSE transport (modularized)
├── types/                      # Type definitions + barrel
├── utils/                      # Config resolver/manager, workspace resolver, security utils, logger, error helpers, maintenance lock
├── vendor/                     # Vendored internal packages (lib-agent-exec, lib-git-history)
├── vector/
│   └── vector-search-manager/  # Semantic search (sqlite-vec + transformers)
└── version.ts                  # Version SSoT (reads package.json)
```

## Key Reference Files

| File                                     | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `src/constants/server-instructions.ts` | Server instructions (`generateStandardInstructions()`, `generateCodeModeInstructions()`, `SERVER_INSTRUCTIONS`, and `HELP_CONTENT` map; compiled from `src/constants/instructions/markdown/*.md` into `src/constants/instructions/*.ts` via `pnpm run generate:instructions`) |
| `test-server/code-map.md`                | File → tool/handler mapping                          |
| `test-server/tool-reference.md`          | Categorized tool inventory                       |
| `CONTRIBUTING.md`                        | Development setup and PR guidelines                  |

## Review Checklist

When reviewing PRs, check for:

- [ ] Hardcoded tool/group counts — should be dynamic or use `getAllToolNames().length`
- [ ] Missing barrel exports in `src/types/index.ts` when new types are added
- [ ] `eslint-disable` usage — always forbidden
- [ ] `@ts-ignore` or `as any` — always forbidden
- [ ] Raw exceptions from tool handlers — forbidden. Must return structured JSON via `formatHandlerError(error)` with exact classification codes
- [ ] Files approaching 500 lines — flag for splitting
- [ ] New tools missing from `src/filtering/tool-constants.ts` `TOOL_GROUPS` (re-exported by `src/filtering/tool-filter.ts`)
- [ ] Missing Zod output schemas on new standard domain tools (except `mj_execute_code` and dummy healing tools)
- [ ] Kebab-case violations in new filenames
- [ ] `continue-on-error: true` in workflow files — forbidden per project standards
