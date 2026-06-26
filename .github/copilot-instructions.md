# Memory Journal MCP — Copilot Code Review Context

## Project Overview

Memory Journal MCP is a TypeScript MCP (Model Context Protocol) server providing persistent memory for AI agents. It has **105 tools** across **11 groups** (Core, Search, Analytics, Backup, Diagnostics, Batch, Flags/Team, Workflows, GitHub, Aliases, CodeMode), **60 resources**, and **30 prompts**.

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
- **Package Manager**: Always use `pnpm`. Do NOT use `npm` or `yarn`. Use `pnpm install`, `pnpm run build`, `pnpm test`, etc.

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

All tool handlers must throw standard `@modelcontextprotocol/sdk/types.js` `McpError` exceptions with exact JSON-RPC codes:

- `-32602`: Invalid params (Zod validation failures)
- `-32002`: Resource not found or unavailable
- `-32603`: Internal server error

Never use custom wrappers or return structured error JSON — rely on the SDK protocol constraints.

### Token Estimation

All resources must dynamically compute and return `_meta.tokenEstimate` within their JSON response blocks using the `Math.ceil(length / 4)` heuristic.

### Database

- Schema migrations in `src/database/migrations/` via `MigrationManager` (versioned 001 to 007)
- Backward compatible with self-healing legacy database retrofitting — never break existing data
- Consider index implications for new queries

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
│   ├── tools/                  # 105 tool handlers (11 groups)
│   ├── resources/              # 60 resource handlers
│   └── prompts/                # 30 prompt handlers
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
| `test-server/tool-reference.md`          | Categorized 105-tool inventory                       |
| `CONTRIBUTING.md`                        | Development setup and PR guidelines                  |

## Review Checklist

When reviewing PRs, check for:

- [ ] Hardcoded tool/group counts — should be dynamic or use `getAllToolNames().length`
- [ ] Missing barrel exports in `src/types/index.ts` when new types are added
- [ ] `eslint-disable` usage — always forbidden
- [ ] `@ts-ignore` or `as any` — always forbidden
- [ ] Raw exceptions from tool handlers — must throw `McpError` with exact JSON-RPC codes (-32002, -32603)
- [ ] Files approaching 500 lines — flag for splitting
- [ ] New tools missing from `src/filtering/tool-filter.ts` TOOL_GROUPS
- [ ] Missing Zod output schemas on new tools
- [ ] Kebab-case violations in new filenames
- [ ] `continue-on-error: true` in workflow files — forbidden per project standards
