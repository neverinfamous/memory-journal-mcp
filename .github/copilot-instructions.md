# Memory Journal MCP — Copilot Code Review Context

## Project Overview

Memory Journal MCP is a TypeScript MCP (Model Context Protocol) server providing persistent memory for AI agents. It has **over 100 tools** across **multiple groups** (Core, Search, Analytics, Backup, Diagnostics, Batch, Flags/Team, Workflows, GitHub, Aliases, CodeMode), **dozens of resources**, and **multiple workflow prompts**.

**Stack**: TypeScript, Vitest, Zod schemas, better-sqlite3 (SQLite), sqlite-vec (vector search), @huggingface/transformers (embeddings), @octokit/rest (GitHub API).

## Session Context

Before starting work on this project, read `memory://briefing/memory-journal-mcp` from the `memory-journal-mcp` server for real-time context:

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
- **Output schemas** — All tools have Zod output schemas; error responses must pass validation
- **Dual Schema Pattern**: All schemas strictly separate input (stringified, loosely typed for LLMs) and output (strict internal domain types) validations. No `argsSchema` for empty or zero-argument prompts.

### Error Handling

All tool handlers must return structured error JSON with \`isError: true\` instead of throwing raw MCP exceptions.
Every tool must return \`{success, error, code, category, suggestion, recoverable}\` to ensure agents get classification, remediation hints, and recoverability signals.

- **Never** throw raw \`McpError\` exceptions which cause agents to crash.
- **Always** return a structured JSON response wrapped in \`{ content: [{ type: 'text', text: JSON.stringify(...) }], isError: true }\`.

### Token Estimation

All resources must dynamically compute and return `_meta.tokenEstimate` within their JSON response blocks using the `Math.ceil(length / 4)` heuristic.

### Database

- Schema migrations in `src/database/core/schema.ts` (using Drizzle ORM)
- Backward compatible with self-healing legacy database retrofitting — never break existing data
- Consider index implications for new queries

## Architectural Rules & Key Concepts

- **Multi-Tenancy**: `workspace_id` is a core concept across multi-tenancy. No split-brain allowed. Workspace orphan ratio is correctly calculated using `workspaceId` instead of hardcoded `default`.
- **Team Support**: Team database tools explicitly require `TEAM_DB_PATH`.
- **Metrics**: Tools support `trust_score` and `impact_score` for analytics.
- **YAML Frontmatter**: Supported natively in entry commands (`memory-journal-mcp entry create`).
- **Docker Tags**: Always use `:latest` docker tags. Check limits (25,000 char) for DOCKER_README.md.
- **Dual-Schema Pattern**: All schemas must separate stringified input from strict internal domain types. Zod schemas are used.
- **Plugin Sync**: Ensure `lib-agent-exec` and `lib-git-history` plugins are kept in sync.
- **Guardrails**: Session Briefing Guardrails added to stop agents and run `mcp-heal` when bugs are encountered.
- **Code Mode Error Proxy**: Code Mode result proxy intercepts errors with "AUTONOMOUS HEALING" prefix.

## Architecture
```
src/
├── cli/                        # CLI entry point (Commander)
├── index.ts                    # Library entry point
├── audit/                      # JSONL audit log, audit resource
├── auth/                       # OAuth 2.1 authentication
├── codemode/                   # Sandboxed JS execution engine
├── constants/
│   └── server-instructions.ts  # Agent prompts and HELP_CONTENT map (Single Source of Truth)
├── database/
│   ├── adapter-factory.ts      # Database adapter factory
│   ├── core/                   # Core database types and interfaces
│   ├── migrations/             # Versioned schema migrations (001-007)
│   └── sqlite-adapter/         # SQLite operations via better-sqlite3
├── filtering/
│   └── tool-filter.ts          # Tool filtering (groups, meta-groups)
├── github/
│   └── github-integration/     # GitHub API (@octokit/rest + GraphQL)
├── handlers/
│   ├── tools/                  # tool handlers (multiple groups)
│   ├── resources/              # resource handlers
│   └── prompts/                # prompt handlers
├── markdown/                   # Markdown import/export (round-trip frontmatter parsing)
├── observability/              # Metrics interceptor, token estimator, latency tracker
├── server/
│   ├── mcp-server.ts           # MCP server setup
│   ├── registration.ts         # Tool/resource/prompt registration
│   └── scheduler.ts            # Recurring task scheduler
├── transports/
│   └── http/                   # HTTP/SSE transport (modularized)
├── types/                      # Type definitions + barrel
├── utils/                      # Logger, error helpers, progress
└── vector/                     # Semantic search (sqlite-vec + transformers)
```

## Key Reference Files

| File                                     | Purpose                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `src/constants/server-instructions.ts` | Server instructions (Agent prompt and composable segments, now uses Adaptive Instruction Architecture pointing to `{prefix}://help`) |
| `test-server/code-map.md`                | File → tool/handler mapping                          |
| `test-server/tool-reference.md`          | Categorized 103-tool inventory                       |
| `CONTRIBUTING.md`                        | Development setup and PR guidelines                  |

## Review Checklist

When reviewing PRs, check for:

- [ ] Hardcoded tool/group counts — should be dynamic or use `getAllToolNames().length`
- [ ] Missing barrel exports in `src/types/index.ts` when new types are added
- [ ] `eslint-disable` usage — always forbidden
- [ ] `@ts-ignore` or `as any` — always forbidden
- [ ] Raw exceptions from tool handlers — forbidden. Must return structured JSON with \`isError: true\` and exact classification codes
- [ ] Files approaching 500 lines — flag for splitting
- [ ] New tools missing from `src/filtering/tool-filter.ts` TOOL_GROUPS
- [ ] Missing Zod output schemas on new tools
- [ ] Kebab-case violations in new filenames
- [ ] `continue-on-error: true` in workflow files — forbidden per project standards
