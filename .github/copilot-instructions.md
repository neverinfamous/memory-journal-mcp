# Memory Journal MCP — Copilot Code Review Context

## Project Overview

Memory Journal MCP is a TypeScript MCP (Model Context Protocol) server providing persistent memory for AI agents. It has **44 tools** across **10 groups** (core, search, analytics, relationships, export, admin, github, backup, team, codemode), **22 resources**, and **15 prompts**.

**Stack**: TypeScript, Vitest, Zod schemas, sql.js (SQLite), vectra (vector search), @octokit/rest (GitHub API).

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
│   └── ServerInstructions.ts   # Auto-generated (npm run generate:instructions)
├── database/
│   ├── SqliteAdapter.ts        # SQLite operations via sql.js
│   └── schema.ts               # DDL + migrations
├── filtering/
│   └── ToolFilter.ts           # Tool filtering (groups, meta-groups)
├── github/
│   └── GitHubIntegration.ts    # GitHub API (@octokit/rest + GraphQL)
├── handlers/
│   ├── tools/                  # 44 tool handlers (10 groups)
│   ├── resources/              # 22 resource handlers
│   └── prompts/                # 15 prompt handlers
├── server/
│   ├── McpServer.ts            # MCP server setup
│   └── Scheduler.ts            # Recurring task scheduler
├── transports/
│   └── http.ts                 # HTTP/SSE transport
├── types/                      # Type definitions + barrel
├── utils/                      # Logger, error helpers, progress
└── vector/                     # Semantic search (vectra + transformers)
```

## Key Reference Files

| File | Purpose |
|------|---------|
| `src/constants/server-instructions.md` | Full tool parameter reference and behavioral guidance |
| `test-server/code-map.md` | File → tool/handler mapping |
| `test-server/tool-reference.md` | Categorized 44-tool inventory |
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
