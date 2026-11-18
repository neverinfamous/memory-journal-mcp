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
- The `workspace_id` is assigned upon creation and cannot be overwritten directly on standard updates; cross-workspace entry migration uses `update_entry` with `workspace_id: '*'` and `target_workspace_id`.
- Read, search, and visualization tools accept `workspace_id: "*"` to query across all workspaces (`resolveWorkspaceId('*')` preserves wildcard sentinel `'*'`); `create_entry` uses `resolveProjectContext`, which treats `workspace_id: '*'` as omitted so `'*'` is never stored (and supports cross-workspace `relationships` at creation time). `update_entry`, `delete_entry`, `restore_entry`, `batch_update_entries`, `batch_delete_entries`, and `team_link_entries` keep `'*'` as a cross-workspace caller scope, whereas `link_entries` requires a concrete `workspace_id` or `project_number` and links entries within that workspace. A stored workspace changes only when `target_workspace_id` is set and is not `'*'`.

### 4. Knowledge Graph Relationships & Parameter Healing

- Tools creating entries (`create_entry`, `team_create_entry`, `batch_create_entries`, and `team_batch_create_entries`) accept a canonical `relationships: [{ targetId, relationType }]` array.
- Autonomous agents frequently supply top-level relationship fields (`evolves_from`, `references`, `implements`, `related_to`, `clarifies`, `response_to`, `blocked_by`, `resolved`, `resolves`, `caused`, `depends_on`, or their camelCase equivalents).
- `healAgentHallucinations` autonomously intercepts and translates top-level relationship parameters into the canonical `relationships` structure and purges the top-level keys before strict Zod validation, ensuring zero friction across single and batch creation flows.

---

## 📡 Session Initialization & Context

Read the workspace briefing via `memory://briefing/{+repo}` (or use the `load-briefing` prompt / fallback `memory://briefing`) at session start, and must NOT autonomously execute tasks listed in the briefing.
When provided, the briefing contains:
- `memory://briefing` (or `memory://briefing/{+repo}` for multi-repo environments)
- This provides ~350 tokens of high-value ambient context: server health, GitHub CI status, active milestones, and unreleased changes.
Review it thoroughly before proceeding. For mid-session context recovery (project number, workspace, or agent ID), query `memory://agent-context` / `memory://agent-context/{+repo}` (or `memory://agent-id` / `memory://agent-id/{+repo}`) instead of re-reading `memory://briefing`.

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
