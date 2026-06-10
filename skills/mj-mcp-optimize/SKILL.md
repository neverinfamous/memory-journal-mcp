---
name: mj-mcp-optimize
description: Learn how the `memory-journal-mcp` Code Mode architecture connects the `mj.*` sandbox API to native MCP tools. Essential for debugging tool alias resolution, serialization errors, constructor wiring, proxy interceptions (shimMj), and Sandbox/Worker bounds. Load when contributing to `codemode.ts`, `worker-script.ts`, or tracking down missing tool parameters in `memory-journal-mcp`.
---

# Code Mode Internals (`memory-journal-mcp`)

The `mj_execute_code` (Code Mode) tool provides an isolated V8/Worker sandbox where LLMs can execute multi-step logic. Inside the sandbox, native MCP tools are exposed via the asynchronous `mj.*` API. 

Understanding how an `mj.*` call makes its way from the sandbox out to the host process is critical for debugging serialization, alias, and validation bugs.

## The Execution Pipeline

When an agent calls `await mj.core.createEntry({ content: 'test' })`:

1. **`shimMj` Proxy (Sandbox)**: The call is intercepted by a dynamic Proxy.
2. **Method & Param Aliases (Sandbox)**: The Proxy converts JavaScript-friendly syntax into MCP tool names (e.g., `createEntry` -> `create_entry`).
3. **RPC Serialization (Sandbox -> Host)**: The arguments are serialized and sent over `node:worker_threads` MessagePort.
4. **Dispatcher (Host)**: `secureDispatcher` in `codemode.ts` receives the RPC request and routes it to the native tool logic.
5. **Validation (Host)**: Tool parameters (like `project_number`) are validated and sometimes dynamically resolved.
6. **Result Serialization (Host -> Sandbox)**: The JSON result is sent back, where `wrapResult` reconstructs it. If the tool threw a `VALIDATION_ERROR`, it's converted back into a Proxy that throws on access to missing properties.

---

## 1. `shimMj` Proxy (`worker-script.ts`)

Inside the worker, the entire `mj` object is a nested set of JavaScript Proxies built by `buildApiProxy(methods, schemas)`.

- **Group Proxy**: Handles `mj.core`, `mj.search`, etc. If a group doesn't exist, it throws a helpful error listing available groups.
- **Method Proxy**: Handles `mj.core.createEntry`. It intercepts method calls and forwards them to `rpcCall()`.
- **Snake_case Fallback**: If an agent calls `mj.core.create_entry`, the Proxy seamlessly supports it by routing it identically to the camelCase `createEntry`.

## 2. Constructor Wiring & Sandbox Bindings (`codemode.ts`)

When `mj_execute_code` is invoked:
1. `collectNonCodeModeTools(context)` gathers all 180+ tools.
2. `createJournalApi(tools, secureDispatcher)` groups them by prefix (`core_`, `search_`, etc.).
3. `api.createSandboxBindings()` outputs a map of `group -> method[]` string arrays.
4. These bindings are injected into the worker. The worker *only* knows tool names, not their logic.

## 3. Dispatcher Validations (`codemode.ts`)

The `secureDispatcher` acts as the gatekeeper between the Sandbox and the Host tools. This is where we catch hallucinated parameters before they hit Zod schemas.

For example, LLMs frequently hallucinate string-based project IDs (e.g. `{ project_number: 'db-mcp' }`). `secureDispatcher` safely translates these:
```typescript
if (typeof args['project_number'] === 'string') {
    const registryEntry = sessionContext.config?.projectRegistry?.[args['project_number']]
    if (registryEntry?.project_number !== undefined) {
        args['project_number'] = registryEntry.project_number
    }
}
```

## 4. `auto-return` Transformation (`auto-return.ts`)

Because Code Mode is wrapped in an `async () => { ... }` IIFE, bare expressions (like promises) would normally disappear into the void.

The `transformAutoReturn` engine parses the user's code using a forward-scanning state machine, properly ignoring boundaries inside string literals (`'`, `"`, `` \` ``) and brackets (`{}`, `()`), and automatically prepends `return` to the final statement. 

## 5. Result Wrapping (`worker-script.ts`)

When MCP tools fail validation, they return an error object instead of throwing (for deterministic agent feedback). 
However, if an agent writes `const { entry_id } = await mj.core.createEntry()`, and it fails, destructuring `entry_id` from the error object returns `undefined` silently.

To prevent silent failures, `wrapResult` converts failed results into a Proxy. If the agent attempts to access a missing property on a failed result, it throws immediately, forcing the LLM to see the `VALIDATION_ERROR`.

## 6. Resource URIs vs Tools (`getBriefing` Failures)

Code Mode inherently operates over `memory-journal-mcp`'s **tool layer**. Operations that deal with raw resources (like `memory://briefing/{repo_name}` or `memory://metrics/summary`) are NOT tools and CANNOT be called from within Code Mode. 

Attempting to call `await mj.core.getBriefing()` inside `mj_execute_code` will result in an `Operation 'getBriefing' is not found in group` error.

**Solution:** ALWAYS use your native `read_resource` tool (outside of Code Mode) to fetch resources. Do NOT attempt to read resources or briefings using the `mj.*` API. 

## 7. Array Method Interception

One of the most common mistakes agents make in Code Mode is assuming tools like `getRecentEntries`, `searchEntries`, or `listProjects` return Arrays directly.

**All MCP tools return Objects.** For example, `getRecentEntries` returns `{ success: true, entries: [...] }`.

To smooth out this hallucination, the `wrapResult` proxy intercepts Array methods (like `.map`, `.filter`, `.find`) called directly on the returned Object. It automatically scans the Object for common array properties (e.g. `entries`, `projects`, `results`) and binds the method to that inner array. 

This means `(await mj.core.getRecentEntries()).map(...)` will seamlessly work, behaving exactly as if you had correctly accessed the inner `.entries` array!

## 8. Markdown & String Payload Escaping

A common hallucination occurs when an agent attempts to pass large Markdown text (e.g. documentation or notes) directly into the `code` string using a template literal (backticks):

```javascript
await mj.core.createEntry({
    content: `... prioritizing DB-aware reads over raw \`.jsonl\` files.`
})
```

Because the MCP tool call payload is JSON, the inner `\`` gets interpreted literally and prematurely closes the Javascript template string. The remaining text (e.g., `.jsonl`) is then evaluated as a **Tagged Template Literal** or property access, resulting in:
`TypeError: "...".jsonl is not a function`.

**Solution**: ALWAYS use the `context` parameter of `mj_execute_code` for Markdown or long string payloads. The `context` object is injected securely into the sandbox and avoids all string boundary parsing issues:

```json
{
  "code": "return await mj.core.createEntry({ content: context.myMarkdown });",
  "context": {
    "myMarkdown": "... prioritizing DB-aware reads over raw `.jsonl` files."
  }
}
```

## 9. Catching Method Hallucinations (Aliases)

Agents commonly extrapolate method names based on patterns (e.g., trying to call `mj.listEntries()` instead of `mj.searchEntries()` because they are used to `mj.listProjects()`). 

There are **three layers** that can intercept hallucinated method names. All three must be kept in sync:

1. **`METHOD_ALIASES`** (in `src/codemode/api-constants.ts`): Maps alias → canonical method within a group. The worker-side `shimMj` proxy resolves these **first**, before checking constructor bindings. Example: `listEntries: 'searchEntries'` in the `search` group intercepts `mj.search.listEntries()`.

2. **Constructor Cross-Group Wiring** (in `src/codemode/api/journal-api.ts`): Assigns handler functions from one group onto another group's API object. Example: `this.core['listProjects'] = listProjectsFn` lets `mj.core.listProjects()` work even though `listProjects` is not a core tool.

3. **Top-Level Bindings** (in `createSandboxBindings()` within `src/codemode/api/journal-api.ts`): Exposes methods at the `mj.*` root level. Example: `listProjects: this.core['listProjects']` enables `mj.listProjects()`.

> **⚠️ CRITICAL: Alias Shadowing Bug Pattern**
> 
> `METHOD_ALIASES` resolve in the worker-side proxy **before** the constructor-wired bindings are checked. If a `METHOD_ALIASES` entry maps to a method name that doesn't exist as an actual *tool* in that group, it will **shadow** a correctly wired constructor binding and silently fail.
>
> Example of the bug: `core: { getProjects: 'listProjects' }` — the alias resolves `getProjects` → `listProjects`, but `listProjects` is not a registered tool in the `core` group. Even though the constructor correctly wired `this.core['listProjects'] = listProjectsFn`, the alias resolution short-circuits before reaching it.
>
> **Rule**: `METHOD_ALIASES` entries must point to either (a) a real tool method in the same group, or (b) another alias that eventually resolves to a real tool in the same group. Never alias to a constructor-wired-only method.

Also update `GROUP_EXAMPLES` in `api-constants.ts` so that `help()` output directs agents to the correct group for each method.
