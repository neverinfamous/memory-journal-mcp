<!-- mcp-name: io.github.neverinfamous/memory-journal-mcp -->

# 🤖 Agent-Optimized Reference: memory-journal-mcp

> **Notice to AI Agents:** You are reading the Agent-Optimized README. Do not read the human-facing `README.md` unless explicitly instructed to. This document condenses the architectural rules, validation patterns, and token-optimization strategies required to navigate and modify this repository effectively.

---

## 🗺️ Context & Navigation

The Memory Journal MCP is a multi-tenant SQLite-backed MCP server. It provides tools for journal management, GitHub integration, analytics, vector search, and team collaboration.

**Critical Reference Files:**
- **Code Map**: `test-server/code-map.md` - Start here for any architectural questions. It documents the directory tree, handler-to-tool mappings, error hierarchy, and key constants.
- **Tool Reference**: `test-server/tool-reference.md` - Complete reference of all tools organized into logical tool groups.
- **Security Policy**: `SECURITY.md` - Defines strict security and validation boundaries.

---

## ⚡ Maximum Token Efficiency: Code Mode (`mj_execute_code`)

When orchestrating workflows or performing multi-step operations on behalf of a user, **always prioritize Code Mode**. 

- **Token Optimization**: Enables multi-step logic composition across all tool groups within a single sandboxed execution.
- **Sandbox Security**: Executes in a pre-warmed `node:worker_threads` V8 isolate pool + secondary `vm.createContext` boundary with V8 `codeGeneration: { strings: false, wasm: false }`, frozen prototypes and `mj.*` API surfaces, `Proxy: undefined`, host-side RPC allowlist, static validation rules (50KB code cap), 30s timeout, and 100KB result egress cap with auto-compaction.
- **API Surface**: Exposed via the `mj.*` API (e.g., `mj.core.createEntry()`, `mj.search.searchEntries()`, `mj.github.getGithubIssues()`).
- **Readonly Contract**: `--tool-filter readonly` (env: `MEMORY_JOURNAL_MCP_TOOL_FILTER=readonly`, config key `toolFilter`) keeps the `core`, `search`, `analytics`, `relationships`, `io`, `git`, and `codemode` groups, then drops tools whose `readOnlyHint` is not `true` from registration, `tools/list`, and `tools/call`. `update_configuration` and `mj_execute_code` stay registered. Code Mode also limits `mj.*` dispatch to `readOnlyHint: true`.

---

## 🏗️ Architectural Directives

When modifying the codebase, you must adhere strictly to these architectural patterns:

### 1. Dual-Schema Validation (CRITICAL)

The MCP SDK has a known limitation: it validates inputs against our schemas *before* our handler code runs. If an SDK validation fails, it throws an opaque `-32602 InvalidParams` error that completely bypasses our internal, user-friendly error formatting.

To solve this, we use the **Dual-Schema Pattern**. Every tool must define two Zod schemas:
- **SDK-Facing (`inputSchema`)**: Extremely relaxed. `register-tools.ts` applies `.partial().loose()` to `inputSchema` (and `.loose()` to `outputSchema`) at SDK registration time while `list-interceptor.ts` filters `tools/list` against the active tool filter, allowing `{}` or missing fields to pass through the SDK boundary. Any SDK-level `-32602` validation errors on preprocessed/piped schemas are intercepted by `call-interceptor.ts` and converted into structured `{ success: false, code: "VALIDATION_ERROR" }` responses.
- **Handler-Internal**: Extremely strict. Inside the tool handler, the `try/catch` block uses a rigid schema with exact requirements.

If internal validation fails (either via `strictSchema.parse(params)` throwing a `ZodError` or by explicitly throwing a `ValidationError`), `formatHandlerError(error)` catches it and returns a structured `{ success: false, error: "...", code: "VALIDATION_ERROR", category: "validation", recoverable: false }` response.

### 2. Structured Error Handling

Never allow raw MCP exceptions to leak to the client. All tool handlers must wrap their execution in a `try/catch` and return the result of `formatHandlerError(error)`.

```typescript
// Adjust relative depth: '../../' from src/handlers/tools/*.ts, '../../../' from src/handlers/tools/<group>/*.ts, etc.
import { ValidationError } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'

export const handler = async (params: unknown) => {
    try {
        // Strict internal validation
        const input = strictSchema.parse(params);
        // ... tool logic ...
        return { success: true, ...result };
    } catch (error) {
        return formatHandlerError(error); // Serializes gracefully
    }
}
```

All errors must extend `MemoryJournalMcpError` (`ValidationError`, `ResourceNotFoundError`, `QueryError`, `ConnectionError`, `ConfigurationError`, `PermissionError` re-exported from `src/types/index.js`; `AuthorizationError`, `ConflictError`, `AggregateMcpError` exported directly from `src/types/errors.js`; `SecurityError`, `InvalidDateFormatError`, `PathTraversalError` in `src/utils/security-utils.js`; and `OAuthError` (plus concrete `OAuthError` subclasses in `src/auth/errors.js`)).

### 3. Multi-Tenancy & `workspace_id`

The server supports strict data isolation using `workspace_id`.
- All CRUD, Search, and Analytics tools accept a `workspace_id`. 
- If omitted, the server auto-resolves `workspace_id` from `project_number` (via `PROJECT_REGISTRY`) or `process.cwd()` before falling back to `DEFAULT_WORKSPACE_ID` (default: `default`).
- The `workspace_id` is assigned upon creation and cannot be overwritten directly on standard updates; cross-workspace entry migration uses `update_entry` with `workspace_id: '*'` and `target_workspace_id` (omitting `project_number` when `target_workspace_id` is registered so destination `project_number` resolves automatically without triggering source-project ownership rejection).
- Read, search, and visualization tools accept `workspace_id: "*"` to query across all workspaces (`resolveWorkspaceId('*')` preserves wildcard sentinel `'*'`); `create_entry` uses `resolveProjectContext`, which treats `workspace_id: '*'` as omitted so `'*'` is never stored (and supports cross-workspace `relationships` at creation time). `update_entry`, `delete_entry`, `restore_entry`, `batch_update_entries`, `batch_delete_entries`, and `team_link_entries` keep `'*'` as a cross-workspace caller scope, whereas `link_entries` requires a concrete `workspace_id` or `project_number` and links entries within that workspace. A stored workspace changes only when `target_workspace_id` is set and is not `'*'`.

### 4. Knowledge Graph Relationships & Parameter Healing

- Tools creating entries (`create_entry`, `team_create_entry`, `batch_create_entries`, and `team_batch_create_entries`) accept a canonical `relationships: [{ targetId, relationType }]` array (and `create_entry` supports `auto_link: true` to auto-link up to 2 high-confidence `same-session`/`shared-anchor` entries when `relationships` is omitted).
- Autonomous agents frequently supply top-level relationship fields (`evolves_from`, `references`, `implements`, `related_to`, `clarifies`, `response_to`, `blocked_by`, `resolved`, `resolves`, `caused`, `depends_on`, or their camelCase equivalents).
- `healAgentHallucinations` autonomously intercepts and translates top-level relationship parameters into the canonical `relationships` structure and purges the top-level keys before strict Zod validation, ensuring zero friction across single and batch creation flows.

---

## 📡 Session Initialization & Context

Read the workspace briefing via `memory://briefing/{+repo}` (or use the `load-briefing` prompt / fallback `memory://briefing`) at session start, and must NOT autonomously execute tasks listed in the briefing.
When provided, the briefing contains:
- `memory://briefing` (or `memory://briefing/{+repo}` for multi-repo environments)
- This provides ~350–450 tokens of high-value ambient context: server health, GitHub CI status, active milestones, unreleased changes, and compact graph pivots (degrees on recent/summary IDs, active graph threads, commit→entry map, 14d linkage rate; disable via `--no-briefing-graph` or `BRIEFING_GRAPH=false`).
- A repo-scoped briefing read pins the session's active workspace/project scope; append `?pin_session=false` (e.g. `memory://briefing/{+repo}?pin_session=false`) to preview a secondary repo without re-pinning.
Review it thoroughly before proceeding. For mid-session context recovery (project number, workspace, or agent ID), query `memory://agent-context` / `memory://agent-context/{+repo}` (append `?session_id=<conversation-id>` after context compaction to recover recent link targets), and read `memory://graph` / `memory://graph/{+repo}` to scan recent 14-day edges (default 15, `?limit=` up to 100) and unlinked IDs without fetching full entry bodies.

---

## 🔧 Critical Environment Variables

| Variable | Description |
| --- | --- |
| `DB_PATH` / `TEAM_DB_PATH` | SQLite database paths for personal and shared team journals |
| `DB_ENCRYPTION_KEY` | SQLCipher at-rest encryption key (alias: `MJ_DB_ENCRYPTION_KEY`) |
| `DEFAULT_WORKSPACE_ID` | Default tenant workspace ID (default: `default`) |
| `PROJECT_REGISTRY` | JSON map of repo names to local paths and GitHub project numbers |
| `ALLOWED_IO_ROOTS` | Comma-separated allowed filesystem roots (fail-closed in stdio; mandatory when `--transport http` is used) |
| `MEMORY_JOURNAL_MCP_TOOL_FILTER` | Control tool exposure (`full`, `codemode` [`mj_execute_code` + `update_configuration`], `starter`, `essential`, `core`, `readonly`, `-github`; CLI: `--tool-filter`, `memory-journal.config.{yaml,yml,json}` key: `"toolFilter"`. `TOOL_FILTER` is not read by the filter parser. Set `MEMORY_JOURNAL_MCP_TOOL_FILTER`, `--tool-filter`, or config key `toolFilter`.) |
| `CODEMODE_INTERNAL_FULL_ACCESS` | Allow Code Mode (`mj.*`) to bypass tool filters internally across all tool namespaces (`true`/`false`, default: `false`, CLI: `--codemode-internal-full-access`) |
| `MCP_AGENT_HEALING` | Enable/disable autonomous tool & parameter healing (`true`/`false`, CLI: `--no-agent-healing`) |
| `MAX_TOOL_INPUT_ELEMENTS` | Max array/object elements in tool inputs (default: `25000`, `0` or `Infinity` = disabled) |

---

## 💻 Execution & OS Boundaries

Development is optimized for **Windows Native Orchestration** using PowerShell. However, you MUST cross the boundary into **WSL (e.g., via `pnpm run test:wsl` / `pnpm run test:e2e:wsl`)** for:
- **Native compilation**: Building SQLite C-bindings if `node-gyp` fails on Windows.
- **CRLF Isolation**: Resolving string matching or `simple-git` errors caused by Windows line endings (`\r\n`).
- **Forensic parsing**: Chaining complex tools (`grep`, `awk`) against massive Playwright E2E trace logs.

## 🛡️ Testing & Validation Gates

- `pnpm run check` runs ESLint, the 500-line ceiling, `tsc --noEmit`, regenerates `test-server/code-map.md`, and the unassigned-entry check, then `pnpm test` and `pnpm run test:e2e`. Static-only runs are `pnpm run lint` and `pnpm run typecheck`.
- Hard fail on security checks; never use `continue-on-error: true` in CI pipelines.

## Repository Map

<!-- BEGIN: REPO_TREE -->
```text
memory-journal-mcp/
├── .github/ (19 files)                      # GitHub Actions CI, Docker, CodeQL, and Dependabot workflows
├── examples/                                # Portable monitoring, Keycloak OAuth, and YAML config templates
│   ├── configs/ (2 files)                   # Annotated YAML configuration example and precedence guide
│   ├── oauth-keycloak/ (3 files)            # Local Keycloak 26.4.7 OAuth 2.1 Compose stack and realm export
│   ├── observability/ (15 files)            # Prometheus, Grafana, Loki, Alloy, and Datadog AD templates
│   └── README.md                            # Examples index and deployment cross-links
├── releases/ (45 files)                     # Release notes archive
├── scripts/                                 # Codegen, vendor sync, DB encryption, and QA automation scripts
│   ├── check-orphans.mjs                    # Scans readonly SQLite DB for orphaned journal entries
│   ├── check-unassigned-entries.ts          # Audits DB entries missing workspace/project assignment
│   ├── commit.ts                            # Vendored conventional commit and journal linker CLI
│   ├── encrypt-db.ts                        # SQLCipher database encryption utility
│   ├── generate-instructions.ts             # Compiles markdown help into src/constants/instructions/*.ts
│   ├── print-summary.ts                     # Prints live session-summary prompt output from a temp DB
│   ├── query.ts                             # Quick readonly SQLite inspection helper script
│   ├── README.md                            # Repository scripts usage reference
│   ├── run-checks.ts                        # Runs sequential lint, line-limit, and typecheck gates
│   ├── sync-vendor-guards.ts                # Safety lock and path-neutrality checks for vendor sync
│   ├── sync-vendor.ts                       # Syncs lib-agent-exec/lib-git-history/commit from upstream
│   ├── test-import.ts                       # Smoke checks compiled tool, resource, and prompt imports
│   ├── update-badges.ts                     # Updates README test and coverage badges
│   ├── update-code-map.ts                   # Regenerates test-server/code-map.md from live registries
│   └── vendor-doc-neutralizer.ts            # Strips host-local references from synced vendor docs
├── skills/ (1 file)                         # Bundled SEP-2640 memory-journal-mcp agent skill
├── src/                                     # Memory Journal MCP Server TypeScript source
│   ├── audit/ (8 files)                     # AuditInterceptor and JSONL audit log writers
│   ├── auth/ (15 files)                     # OAuth 2.1, JWKS, and scope validation middleware
│   ├── cli/ (30 files)                      # CLI option parsing, config loading, and admin subcommands
│   ├── codemode/ (71 files)                 # V8 isolate Code Mode sandbox and mj.* API bridges
│   ├── constants/ (32 files)                # Markdown SSoT and generated server instruction modules
│   ├── database/ (84 files)                 # SQLite (better-sqlite3/FTS5) & Team DB schema/adapters
│   ├── filtering/ (3 files)                 # Dynamic tool-group filter parser and presets
│   ├── github/ (14 files)                   # GitHub Issues, PRs, Actions, and Projects v2 client
│   ├── handlers/ (226 files)                # MCP tools, resources, prompts, schemas, and healers
│   ├── markdown/ (14 files)                 # Markdown journal export/import formatters
│   ├── observability/ (8 files)             # OpenTelemetry metrics, server (:9465), and trace helpers
│   ├── server/ (25 files)                   # MCP server factory, briefing, and capability wiring
│   ├── transports/ (12 files)               # stdio, Streamable HTTP, and Legacy SSE transports
│   ├── types/ (8 files)                     # Core journal, relationship, and protocol TypeScript types
│   ├── utils/ (36 files)                    # Security, error formatting, token estimation, and path helpers
│   ├── vector/ (8 files)                    # Embedding provider and hybrid vector similarity index
│   ├── vendor/ (109 files)                  # Vendored commit/exec/git-history tooling (managed by sync-vendor)
│   ├── index.ts                             # CLI and server startup entrypoint
│   └── version.ts                           # Runtime package.json version loader
├── test-server/                             # Manual QA coordinators, Docker infra, and code maps
│   ├── codemode/ (57 files)                 # Code Mode manual test prompts and coordinator workflow
│   ├── infrastructure/ (32 files)           # Docker Compose observability stack (:3002/:9091/:3102/:8082)
│   ├── scripts/ (13 files)                  # Prompt standardization generator and tool-map.json
│   ├── standard/ (68 files)                 # Direct MCP tool manual test prompts and coordinator workflow
│   ├── usability/ (69 files)                # Hallucination/fuzzing prompts and coordinator workflow
│   ├── code-map.md                          # Auto-regenerated architecture and tool/resource/prompt map
│   ├── prompts-reference.md                 # Complete reference of built-in MCP prompts
│   ├── README.md                            # Manual QA suite overview
│   ├── test-preflight.md                    # Pre-flight server instructions and resource check
│   └── tool-reference.md                    # Complete MCP tool catalog and parameter reference
├── tests/                                   # Automated Vitest and Playwright test suites
│   ├── audit/ (3 files)                     # Audit logging unit tests
│   ├── auth/ (11 files)                     # OAuth 2.1 and scope middleware tests
│   ├── codemode/ (11 files)                 # Code Mode sandbox isolation and mj.* tests
│   ├── constants/ (1 file)                  # Instruction module and server-instructions tests
│   ├── database/ (22 files)                 # SQLite adapter, migrations, FTS5, and Team DB tests
│   ├── e2e/ (70 files)                      # Playwright MCP protocol, transport, and OAuth E2E specs
│   ├── filtering/ (1 file)                  # Tool filtering preset tests
│   ├── github/ (9 files)                    # GitHub API integration and mocking tests
│   ├── handlers/ (64 files)                 # Tool, resource, prompt, and schema handler tests
│   ├── integration/ (5 files)               # End-to-end database/server integration specs
│   ├── markdown/ (6 files)                  # Markdown export/import round-trip tests
│   ├── observability/ (6 files)             # Metrics and telemetry endpoint tests
│   ├── security/ (3 files)                  # Injection, path traversal, and SSRF guard tests
│   ├── server/ (8 files)                    # Server wiring, briefing, and startup tests
│   ├── transports/ (6 files)                # HTTP/SSE/stdio transport tests
│   ├── unit/ (131 files)                    # Focused unit tests including vendor-doc-neutralizer
│   ├── utils/ (12 files)                    # Utility and validation tests
│   ├── vector/ (5 files)                    # Embedding and vector search tests
│   ├── build-externals.test.ts              # Built dist/ externals verification test
│   ├── codemode-healing-guardrails.test.ts  # Code Mode autonomous healing guardrail tests
│   ├── edge-cases.test.ts                   # Anti-hallucination payload normalization edge-case tests
│   ├── global-teardown.ts                   # Cleans temporary test backup artifacts after Vitest runs
│   └── README.md                            # Automated test execution guide
├── AGENT_README.md                          # Agent-optimized repository quick reference
├── AGENTS.md                                # Repository-local rules (pnpm gates, codegen, vendor parity)
├── CHANGELOG.md                             # Version changelog
├── DOCKER_README.md                         # Docker Hub image overview
├── docker-compose.yml                       # Local container orchestration config
├── Dockerfile                               # Multi-stage container build
├── eslint.config.js                         # ESLint flat configuration
├── package.json                             # Dependencies, scripts, and bin entrypoint
├── playwright.config.ts                     # Playwright E2E configuration
├── README.md                                # Human-readable project documentation
├── SECURITY.md                              # Security policy and vulnerability disclosure
├── tsconfig.build.json                      # Production TypeScript compilation config
├── tsconfig.json                            # Strict TypeScript configuration
├── tsconfig.scripts.json                    # TypeScript configuration for scripts/
└── vitest.config.ts                         # Vitest unit/coverage configuration
```
<!-- END: REPO_TREE -->
