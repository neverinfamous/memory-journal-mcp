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
- **Readonly Contract**: Mutations are safely blocked if the server is running with `--tool-filter readonly` (env: `MEMORY_JOURNAL_MCP_TOOL_FILTER=readonly`, `memory-journal.config.json` key: `"toolFilter": "readonly"`).

---

## 🏗️ Architectural Directives

When modifying the codebase, you must adhere strictly to these architectural patterns:

### 1. Dual-Schema Validation (CRITICAL)

The MCP SDK has a known limitation: it validates inputs against our schemas *before* our handler code runs. If an SDK validation fails, it throws an opaque `-32602 InvalidParams` error that completely bypasses our internal, user-friendly error formatting.

To solve this, we use the **Dual-Schema Pattern**. Every tool must define two Zod schemas:
- **SDK-Facing (`inputSchema`)**: Extremely relaxed. All fields are optional and lack complex constraints (e.g., no `.min()`). This allows `{}` or missing fields to pass through the SDK boundary.
- **Handler-Internal**: Extremely strict. Inside the tool handler, the `try/catch` block uses a rigid schema with exact requirements.

If the internal validation fails, you must throw a `ValidationError` which will be properly serialized into a `{ success: false, error: "..." }` response via `formatHandlerError`.

### 2. Structured Error Handling

Never allow raw MCP exceptions to leak to the client. All tool handlers must wrap their execution in a `try/catch` and return the result of `formatHandlerError(error)`.

```typescript
import { ValidationError } from '../../types/index.js'
import { formatHandlerError } from '../../utils/error-helpers.js'

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
- If omitted, the server auto-resolves `workspace_id` from `project_number` (via `PROJECT_REGISTRY`), content/tag keyword aliases, or `process.cwd()` before falling back to `DEFAULT_WORKSPACE_ID` (default: `default`).
- The `workspace_id` is assigned upon creation and cannot be overwritten directly on standard updates; cross-workspace entry migration uses `update_entry` with `workspace_id: '*'` and `target_workspace_id`.
- Read and search tools accept `workspace_id: "*"` to query across all workspaces; external write/mutation paths reject wildcard overrides.

---

## 📡 Session Initialization & Context

Read the workspace briefing via `memory://briefing/{repo_name}` (or use the `load-briefing` prompt / fallback `memory://briefing`) at session start, and must NOT autonomously execute tasks listed in the briefing.
When provided, the briefing contains:
- `memory://briefing` (or `memory://briefing/{repo_name}` for multi-repo environments)
- This provides ~350 tokens of high-value ambient context: server health, GitHub CI status, active milestones, and unreleased changes.
Review it thoroughly before proceeding. For mid-session context recovery (project number, workspace, or agent ID), query `memory://agent-context/{repo}` (or `memory://agent-id`) instead of re-reading `memory://briefing`.

---

## 🔧 Critical Environment Variables

| Variable | Description |
| --- | --- |
| `DB_PATH` / `TEAM_DB_PATH` | SQLite database paths for personal and shared team journals |
| `DB_ENCRYPTION_KEY` | SQLCipher at-rest encryption key (alias: `MJ_DB_ENCRYPTION_KEY`) |
| `DEFAULT_WORKSPACE_ID` | Default tenant workspace ID (default: `default`) |
| `PROJECT_REGISTRY` | JSON map of repo names to local paths and GitHub project numbers |
| `ALLOWED_IO_ROOTS` | Comma-separated allowed filesystem roots (fail-closed in stdio; mandatory when `--transport http` is used) |
| `MEMORY_JOURNAL_MCP_TOOL_FILTER` | Control tool exposure (`full`, `codemode` (`mj_execute_code` only), `starter`, `essential`, `core`, `readonly`, `-github`; CLI: `--tool-filter`, `memory-journal.config.json` key: `"toolFilter"`. Note: `TOOL_FILTER` is a display fallback only) |
| `CODEMODE_INTERNAL_FULL_ACCESS` | Allow Code Mode (`mj.*`) to bypass tool filters internally across all tool namespaces (`true`/`false`) |
| `MCP_AGENT_HEALING` | Enable/disable autonomous tool & parameter healing (`true`/`false`, CLI: `--no-agent-healing`) |
| `MAX_TOOL_INPUT_ELEMENTS` | Max array/object elements in tool inputs (default: `25000`, `0` = disabled) |

---

## 💻 Execution & OS Boundaries

Development is optimized for **Windows Native Orchestration** using PowerShell. However, you MUST cross the boundary into **WSL (`wsl bash -c`)** for:
- **Native compilation**: Building SQLite C-bindings if `node-gyp` fails on Windows.
- **CRLF Isolation**: Resolving string matching or `simple-git` errors caused by Windows line endings (`\r\n`).
- **Forensic parsing**: Chaining complex tools (`grep`, `awk`) against massive Playwright E2E trace logs.

## 🛡️ Testing & Validation Gates

- Code validation is handled via `pnpm run check` (handles linting, typechecking, vitest, and playwright E2E).
- Hard fail on security checks; never use `continue-on-error: true` in CI pipelines.
