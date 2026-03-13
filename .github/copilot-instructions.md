# Memory Journal MCP — Copilot Code Review Context

## Project Overview

Memory Journal MCP is a TypeScript MCP (Model Context Protocol) server providing persistent memory for AI agents. It has **44 tools** across **10 groups** (core, search, analytics, relationships, export, admin, github, backup, team, codemode), **22 resources**, and **15 prompts**.

**Stack**: TypeScript, Vitest, Zod schemas, better-sqlite3 (SQLite), sqlite-vec (vector search), @huggingface/transformers (embeddings), @octokit/rest (GitHub API).

## Session Context

Before starting work on this project, read `memory://briefing` from the `memory-journal-mcp` server for real-time context:
- **Recent journal entries** — what was just worked on by the development agent
- **GitHub status** — open issues, PRs, CI status, milestones
- **Workflow runs** — recent CI/CD results
- **Copilot review summaries** — your own recent review findings

For detailed session handoff context, search for entries tagged `session-summary` — these contain end-of-session notes from the development agent.

If you find issues during code review, use `create_entry` with tag `copilot-finding` to record them for the development agent to see in their next session briefing.

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
- **Zod schemas** for all tool input validation
- **Output schemas** — All tools have Zod output schemas; error responses must pass validation
- **Dual-schema pattern** — Relaxed schemas for SDK registration (to handle MCP client coercion), strict schemas inside handlers

### Error Handling

All tool handlers return structured error responses — never raw exceptions:

```typescript
{
  success: false,
  error: string,        // Human-readable message
  code: string,         // Module-prefixed code (e.g., "ENTRY_NOT_FOUND")
  category: string,     // ErrorCategory enum (validation, connection, query, etc.)
  suggestion: string,   // Actionable fix for the agent
  recoverable: boolean  // true = user can fix, false = server error
}
```

- Use `formatHandlerErrorResponse()` from `src/utils/error-helpers.ts` for enriched errors
- Use `MemoryJournalMcpError` subclasses (`ValidationError`, `ResourceNotFoundError`, etc.) for typed errors
- Existing `formatHandlerError()` preserved for backward compatibility

### Database

- Schema migrations in `src/database/schema.ts` via `migrateSchema()`
- Backward compatible — never break existing data
- Consider index implications for new queries

## Architecture

```
src/
├── cli.ts                      # CLI entry point (Commander)
├── index.ts                    # Library entry point
├── auth/                       # OAuth 2.1 authentication
├── codemode/                   # Sandboxed JS execution engine
├── constants/
│   ├── server-instructions.md  # Source for server instructions
│   └── server-instructions.ts  # Auto-generated (npm run generate:instructions)
├── database/
│   ├── adapter-factory.ts      # Database adapter factory
│   ├── core/                   # Core database types and interfaces
│   └── sqlite-adapter/         # SQLite operations via better-sqlite3
├── filtering/
│   └── tool-filter.ts          # Tool filtering (groups, meta-groups)
├── github/
│   └── github-integration/     # GitHub API (@octokit/rest + GraphQL)
├── handlers/
│   ├── tools/                  # 44 tool handlers (10 groups)
│   ├── resources/              # 22 resource handlers
│   └── prompts/                # 15 prompt handlers
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

| File | Purpose |
|------|---------|
| `src/constants/server-instructions.md` | Full tool parameter reference and behavioral guidance |
| `docs/code-map.md` | File → tool/handler mapping |
| `docs/tool-reference.md` | Categorized 44-tool inventory |
| `CONTRIBUTING.md` | Development setup and PR guidelines |

## Review Checklist

When reviewing PRs, check for:

- [ ] Hardcoded tool/group counts — should be dynamic or use `getAllToolNames().length`
- [ ] Missing barrel exports in `src/types/index.ts` when new types are added
- [ ] `eslint-disable` usage — always forbidden
- [ ] Raw exceptions from tool handlers — must use `formatHandlerErrorResponse()`
- [ ] Files approaching 500 lines — flag for splitting
- [ ] New tools missing from `src/filtering/ToolFilter.ts` TOOL_GROUPS
- [ ] Missing Zod output schemas on new tools
- [ ] Kebab-case violations in new filenames
