# Code Mode Reference — MCP Builder Skill

> Comprehensive implementation guide for adding Code Mode (sandboxed JS execution) to MCP servers. This is the standard pattern for all servers with 15+ tools.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Thread                              │
│                                                              │
│  MCP Client ──► {prefix}_execute_code tool handler           │
│       │                                                      │
│       ▼                                                      │
│  1. Security validation (blocked patterns, rate limit)       │
│  2. Build API bridge from ToolDefinition[]                   │
│  3. Serialize method names ──► Worker Thread                 │
│                                    │                         │
│  ┌──── RPC Host ◄──── MessagePort ─┘                        │
│  │                                                           │
│  │  Dispatches tool.handler() calls                         │
│  │  Returns results via RpcResponse                          │
│  └──────────────────────────────────────────────────────────┘
│
│  ┌──── Worker Thread (V8 Isolate) ──────────────────────────┐
│  │                                                           │
│  │  workerData: { code, methodList, timeoutMs, rpcPort }    │
│  │                                                           │
│  │  1. Build mj.* Proxy from methodList                     │
│  │  2. vm.createContext (secondary isolation)                │
│  │  3. Execute: (async () => { transformAutoReturn(code) })()               │
│  │  4. RPC calls ──► MessagePort ──► Main thread            │
│  │  5. Return result/error + ExecutionMetrics                │
│  │                                                           │
│  │  resourceLimits: maxOldGenerationSizeMb                  │
│  │  Hard timeout: worker.terminate() from main thread       │
│  └──────────────────────────────────────────────────────────┘
```

## File-by-File Breakdown

### `types.ts`

Core type definitions. Key interfaces:

- **`SandboxOptions`** — `memoryLimitMb` (128), `timeoutMs` (30000), `cpuLimitMs` (10000)
- **`PoolOptions`** — `minInstances` (2), `maxInstances` (10), `idleTimeoutMs` (60000)
- **`SandboxResult`** — `{ success, result?, error?, stack?, metrics }`
- **`SecurityConfig`** — `maxCodeLength`, `maxExecutionsPerMinute`, `maxResultSize`, `blockedPatterns`
- **`RpcRequest`** — `{ id, group, method, args }` (worker → main thread)
- **`RpcResponse`** — `{ id, result?, error? }` (main → worker thread)
- **`ExecuteCodeOptions`** — `{ code, timeout?, readonly? }` (tool input)

### `security.ts`

Pre-execution security validation:

- **Code validation** — length check, empty check, blocked pattern scan
- **Rate limiting** — sliding 1-minute window per client ID, configurable limit
- **Result validation** — post-execution JSON serialization size check
- **Cleanup** — periodic `cleanupRateLimits()` to prevent memory leaks
- **Additional blocked patterns** — `Reflect.*`, `Symbol.*`, `new Proxy` (escape aids), `(SELECT` (WHERE clause subquery injection)

> [!IMPORTANT]
> The `(SELECT` pattern prevents blind data exfiltration via `CASE WHEN (SELECT ...) THEN ... ELSE ...` in WHERE clauses passed to Code Mode tools. This is distinct from the semicolon-chained patterns in `validateWhereClause()` — both layers are required.

### `sandbox.ts` (VM-based — dev/test only)

Lightweight sandbox using `node:vm`. Use only for testing environments as it does not securely isolate memory or CPU execution boundaries:

- **LRU script cache** (50 entries) — avoid recompilation
- **Nulled globals** — `process`, `require`, `global`, `globalThis`, `setTimeout`, `setInterval`
- **Frozen built-in prototypes** — All built-in prototypes (`Object`, `Function`, `Error`, `Array`, `Promise`, `String`, `Number`, `Boolean`, `RegExp`, `Map`, `Set`, typed arrays) must be frozen inside the `vm` context to prevent constructor chain escapes via string concatenation (e.g., `'con'+'structor'` bypasses static blocked pattern scanning)
- **`microtaskMode: "afterEvaluate"`** — prevents async escapes (safe here because VM sandbox doesn't use async IIFE execution)
- **`SandboxPool`** — concurrent execution with max instances guard
- **Auto-return transform** — applies `transformAutoReturn()` before IIFE wrapping so bare expressions surface their return value

> ⚠️ **Do NOT use `microtaskMode: 'afterEvaluate'` in the worker-thread sandbox** — it prevents async function Promises from resolving, causing the worker to hang forever.

### `worker-sandbox.ts` (Production Standard)

True V8 isolate via `node:worker_threads` (Mandatory for production release):

- **`WorkerSandbox.execute(code, apiBindings)`** — spawns fresh worker per execution
- **RPC bridge** — `MessageChannel` with `hostPort` (main) and `workerPort` (worker)
- **MessagePort transfer** — pass `workerPort` via `workerData.rpcPort` + `transferList: [workerPort]` in the constructor. **Never** double-transfer with a separate `postMessage` — the port becomes detached after the first transfer.
- **Binding serialization** — separate group objects → method name arrays and top-level function aliases → `_topLevel` key. The RPC handler must dispatch `_topLevel` methods from `apiBindings` root.
- **Resource limits** — `maxOldGenerationSizeMb` and `maxYoungGenerationSizeMb`
- **Hard timeout** — `worker.terminate()` after `timeoutMs + 1000ms` grace
- **Two message channels**: `hostPort.on('message')` for RPC only; `worker.on('message')` for completion results
- **Timeout forwarding** — The tool handler **must** destructure `timeout` from the parsed Zod input and pass it as `timeoutMs` to `pool.execute()`. If omitted, all executions silently use the default 30s regardless of user input. This was a production bug in memory-journal-mcp (March 2026). The pattern is: `const { code, timeout, readonly } = Schema.parse(params); await pool.execute(code, bindings, { timeoutMs: timeout ?? DEFAULT_TIMEOUT });`
- **Negative `memoryUsedMb` clamping** — Worker memory metrics can report negative values due to GC timing. Always clamp: `memoryUsedMb: Math.max(0, (rss - baseline) / 1048576)`. This prevents confusing negative memory usage in execution metrics returned to the client.

### `worker-script.ts` (Worker entry point)

Runs inside the worker thread:

- Receives `{ code, methodList, timeoutMs, rpcPort }` via `workerData`
- Builds **async Proxy API** — each method sends `RpcRequest` over `rpcPort`, awaits `RpcResponse`. Readonly mode wraps undefined mutation methods in a Proxy `'get'` trap that rejects the promise, natively catching and returning a structured `{ success: false, error }` response.
- `_topLevel` methods are mounted directly on the API root (e.g., `mj.createEntry`)
- Wraps code in `(async () => { transformAutoReturn(user_code) })()` for async support — `transformAutoReturn()` prepends `return` to the last expression statement so bare expressions surface their value (Node REPL semantics)
- Secondary `vm.createContext` isolation within the worker — **do NOT use `microtaskMode: 'afterEvaluate'`** and **do NOT explicitly inject built-ins** (`Promise`, `JSON`, etc.) — they inherit from the worker's global scope
- **Frozen built-in prototypes** — Same freezing as `sandbox.ts`. Apply `Object.freeze(builtin.prototype)` to all built-ins inside the `vm` context before executing user code
- **Result path**: close `rpcPort` with `unref()` + `close()`, then send result via `parentPort.postMessage()`
- Measures CPU time via `process.cpuUsage()`

### `sandbox-factory.ts`

Runtime mode selection:

- `createSandbox(mode)` → `CodeModeSandbox` or `WorkerSandbox`
- `createSandboxPool(mode)` → `SandboxPool` or `WorkerSandboxPool`
- `getSandboxModeInfo()` → description, security level, isolation type
- Default mode: `'worker'`

### `api.ts`

The API bridge — transforms `ToolDefinition[]` into the namespaced API object:

**Key functions:**

- `toolNameToMethodName(name, group)` — strips prefix, converts snake_case → camelCase
- `normalizeParams(method, args)` — maps positional args to named params using `POSITIONAL_PARAM_MAP`. Handles multiple input types: string, number, boolean single args (not just strings). For non-string primitives passed as a single positional arg, wraps into the first parameter name.
- `createGroupApi(group, tools)` — builds one group namespace with handlers, aliases, and `help()`
- `{Api}.createSandboxBindings()` — assembles the complete `{prefix}.*` object
- `{prefix}.reportProgress(current, total, message)` — utility for sandboxed code to emit MCP progress notifications. Bridges to the main thread's `sendProgress()` via the RPC channel. Silently no-ops when the client doesn't request progress

**`help()` behavior:** The `help()` method at both top level and per group lists **ALL methods regardless of the `readonly` flag**. Write methods are wrapped with readonly guards that return structured errors when called in readonly mode, but they still appear in the `help()` listing for discoverability.

**Positional parameter completeness:** When adding new tools or groups, verify that the `POSITIONAL_PARAM_MAP` covers all methods that accept a single "primary" argument. Missing mappings force agents to use verbose object syntax even for simple calls.

**Recursion prevention:** Filters out `codemode` group tools during construction.

### `api-constants.ts`

Static configuration maps:

- **`METHOD_ALIASES`** — shorthand names per group (e.g., `core.create` → `createEntry`). Ensure semantic correctness: `log` and `record` aliases must point to the right methods.
- **`GROUP_EXAMPLES`** — usage examples for `help()` output
- **`POSITIONAL_PARAM_MAP`** — enables `mj.core.createEntry("note")` → `{ content: "note" }`
- **`GROUP_PREFIX_MAP`** — prefix stripping rules per group
- **`KEEP_PREFIX_GROUPS`** — groups that retain meaningful prefixes (e.g., `github`, `team`)

### `api/` Subdirectory Variant (Adapter Servers)

For adapter-based servers with large tool sets (50+ tools, extensive aliases), the single `api.ts` + `api-constants.ts` pattern becomes unwieldy. Split into a dedicated subdirectory:

```
src/codemode/api/
  index.ts       — Main API bridge — exposes tools to sandbox
  maps.ts        — Tool name → handler function mapping (can grow to 20KB+)
  group-api.ts   — Per-group API surface generation
  aliases.ts     — Tool alias resolution (can grow to 15KB+)
  normalize.ts   — Parameter normalization utilities
```

**When to split:** When `api.ts` exceeds ~500 lines or `api-constants.ts` exceeds ~300 lines. Adapter servers with 200+ tools (postgres-mcp, mysql-mcp) should always use the subdirectory pattern.

**Key difference from single-file:** The `maps.ts` file replaces the `POSITIONAL_PARAM_MAP` and `METHOD_ALIASES` constants, while `group-api.ts` replaces the `createGroupApi()` function. The `normalize.ts` file extracts parameter normalization from `api.ts`.

## Tool Handler Pattern

The `{prefix}_execute_code` tool handler sits in `src/handlers/tools/codemode.ts`:

```typescript
// Key flow:
// 1. Parse input (code, timeout, readonly)
// 2. Security validation → early return if blocked
// 3. Rate limit check → early return if exceeded
// 4. Collect non-codemode tools from all group modules
// 5. Optional readonly filter (only readOnlyHint: true tools)
// 6. Build API bridge from tool definitions
// 7. Execute in sandbox pool
// 8. Validate result size → return structured result
```

> [!CAUTION]
> **`outputSchema` pitfall**: Do NOT define `outputSchema` with `z.unknown()` on the Code Mode tool. It produces a bare `{}` JSON Schema that crashes AntiGravity's `structuredContent` processing. Omit `outputSchema` entirely — dynamically-typed results should use the plain text JSON response path.

**Import strategy:** Import from leaf tool group modules (e.g., `./core.js`, `./search.js`) directly — NOT from the tool barrel `./index.js` to avoid circular dependencies.

## Integration Checklist

When adding Code Mode to a new MCP server:

- [ ] Create `src/codemode/` directory with all 10 files (or 5 + `api/` subdir for adapter servers)
- [ ] Add `'codemode'` to the `ToolGroup` union type
- [ ] Create `src/handlers/tools/codemode.ts` handler
- [ ] Wire `getCodeModeTools()` into `getAllToolDefinitions()`
- [ ] Add `codemode` to `TOOL_GROUPS` record in `ToolFilter`
- [ ] Add `'codemode'` to the `'full'` meta-group
- [ ] Add codemode icon to the icon map
- [ ] Add `--sandbox-mode` CLI flag (optional)
- [ ] Update `server-instructions.ts` with Code Mode preference guidance
- [ ] Update README, code-map, and tool-reference docs
- [ ] Write tests: API bridge, security, sandbox, worker sandbox, handler integration

## Testing Patterns

### API Bridge Tests (`tests/codemode/api.test.ts`)

- `toolNameToMethodName()` — verify snake_case → camelCase for all groups
- `normalizeParams()` — test positional args, object passthrough, multi-arg mapping
- `JournalApi` construction — verify group count, method count, alias resolution
- `createSandboxBindings()` — verify all namespaces present, `help()` returns valid info

### Security Tests (`tests/codemode/security.test.ts`)

- Blocked patterns — each pattern individually and in combinations
- Code length limits — boundary values (exactly at, one over)
- Rate limiting — within limit, at limit, over limit, window reset
- Result size — within limit, over limit, non-serializable results

### Sandbox Tests (`tests/codemode/sandbox.test.ts`)

- Basic execution — `return 1 + 1`
- Async execution — `return await Promise.resolve(42)`
- Nulled globals — `process`, `require`, `eval` should be undefined
- Timeout enforcement — infinite loop should terminate
- Script cache — verify cache hit on repeated execution

### Worker Sandbox Tests (`tests/codemode/worker-sandbox.test.ts`)

- RPC bridge — verify tool calls route to main thread and return results
- Resource limits — OOM should terminate worker gracefully
- Hard timeout — long-running code should be terminated
- Fresh state — each execution gets a clean worker

### Handler Integration Tests (`tests/handlers/codemode-tool-handlers.test.ts`)

- Happy path — simple code execution returns result
- Error path — invalid code returns `{ success: false, error }`
- Readonly mode — write tools should be filtered out
- Cross-group workflow — code that uses multiple API groups
- Security rejection — blocked patterns return structured error

## AntiGravity Agent Considerations

When deploying an MCP server with Code Mode inside AntiGravity:

- AntiGravity defaults to raw parameter schemas and doesn't implicitly know about internal API mappings or aliases
- **Always provide a reference** to the injected API bindings via `server-instructions.ts` — include group namespaces, method signatures, and positional argument examples
- Add a system prompt rule instructing the agent to prefer Code Mode for multi-step operations:
  > _"When using this server, prefer `{prefix}_execute_code` (Code Mode) for multi-step operations to minimize token usage."_
- The `help()` method at top level and per group provides runtime discoverability as a fallback
- **`outputSchema` pitfall**: Do NOT define `outputSchema` with `z.unknown()` on the Code Mode tool. It produces a bare `{}` JSON Schema that crashes AntiGravity's `structuredContent` processing. Omit `outputSchema` entirely — dynamically-typed results should use the plain text JSON response path. (Also documented above in Tool Handler Pattern.)
