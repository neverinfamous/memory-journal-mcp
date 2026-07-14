<!-- mcp-name: io.github.neverinfamous/memory-journal-mcp -->

# 🤖 Agent-Optimized Reference: memory-journal-mcp

> **Notice to AI Agents:** You are reading the Agent-Optimized README. Do not read the human-facing `README.md` unless explicitly instructed to. This document condenses the architectural rules, validation patterns, and token-optimization strategies required to navigate and modify this repository effectively.

---

## 🗺️ Context & Navigation

The Memory Journal MCP is a sophisticated, multi-tenant SQLite-backed MCP server. It provides a comprehensive suite of tools for journal management, GitHub integration, analytics, vector search, and team collaboration.

**Critical Reference Files:**
- **Code Map**: `test-server/code-map.md` - Start here for any architectural questions. It documents the directory tree, handler-to-tool mappings, error hierarchy, and key constants.
- **Tool Reference**: `test-server/tool-reference.md` - Complete reference of all tools organized into logical tool groups.
- **Security Policy**: `SECURITY.md` - Defines strict security and validation boundaries.

---

## ⚡ Maximum Token Efficiency: Code Mode (`mj_execute_code`)

When orchestrating workflows or performing multi-step operations on behalf of a user, **always prioritize Code Mode**. 

- **Token Savings**: It reduces token usage by 70-90% by letting you compose logic across all tool groups in a single sandboxed JavaScript execution.
- **Sandbox Security**: Executes in a secure worker thread with frozen prototypes, static validation rules blocking `require()` and `eval()`, and strict execution bounds.
- **API Surface**: Exposed via the `mj.*` API (e.g., `mj.core.createEntry()`, `mj.search.searchEntries()`, `mj.github.getGithubIssues()`).
- **Readonly Contract**: Mutations are safely blocked if the server is running with the `--tool-filter readonly` flag.

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

All errors must extend `MemoryJournalMcpError` (e.g., `ValidationError`, `ResourceNotFoundError`, `QueryError`, `ConnectionError`, `PermissionError`).

### 3. Multi-Tenancy & `workspace_id`

The server supports strict data isolation using `workspace_id`.
- All CRUD, Search, and Analytics tools accept a `workspace_id`. 
- If omitted, entries default to the `default` workspace.
- The `workspace_id` is permanently assigned upon creation and is immutable.

---

## 📡 Session Initialization & Context

Agents no longer need to proactively pull the briefing. You must wait for the user to optionally inject context using the `load-briefing` prompt.
When provided, the briefing contains:
- `memory://briefing` (or `memory://briefing/{repo_name}` for multi-repo environments)
- This provides ~350 tokens of high-value ambient context: server health, GitHub CI status, active milestones, and unreleased changes.
Review it thoroughly before proceeding.

---

## 💻 Execution & OS Boundaries

Development is optimized for **Windows Native Orchestration** using PowerShell. However, you MUST cross the boundary into **WSL (`wsl bash -c`)** for:
- **Native compilation**: Building SQLite C-bindings if `node-gyp` fails on Windows.
- **CRLF Isolation**: Resolving string matching or `simple-git` errors caused by Windows line endings (`\r\n`).
- **Forensic parsing**: Chaining complex tools (`grep`, `awk`) against massive Playwright E2E trace logs.

## 🛡️ Testing & Validation Gates

- Code validation is handled via `pnpm run check` (handles linting, typechecking, vitest, and playwright E2E).
- Hard fail on security checks; never use `continue-on-error: true` in CI pipelines.
