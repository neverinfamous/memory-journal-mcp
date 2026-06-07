# Re-Test memory-journal-mcp — Code Mode: Sandbox Basics

Test the Code Mode sandbox (`mj_execute_code`) fundamentals: expression evaluation, async support, execution metrics, and timeout handling.

**Scope:** 1 tool (`mj_execute_code`), Phase 16 — ~15 test cases covering sandbox execution basics.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 16: Sandbox Basics

### 16.1 Simple Expressions

| Test            | Code                               | Expected Result                                             |
| --------------- | ---------------------------------- | ----------------------------------------------------------- |
| Integer return  | `return 42;`                       | `{ success: true, result: 42 }`                             |
| String return   | `return "hello from code mode";`   | `{ success: true, result: "hello from code mode" }`         |
| Object return   | `return { a: 1, b: [2, 3] };`      | `{ success: true, result: { a: 1, b: [2, 3] } }`            |
| Circular return | `const a = {}; a.b = a; return a;` | `{ success: true, result: { b: "[Circular]" } }`            |
| Null return     | `return null;`                     | `{ success: true, result: null }`                           |
| No return value | `const x = 1;`                     | `{ success: true, result: undefined }` (implicit undefined) |
| Boolean return  | `return true;`                     | `{ success: true, result: true }`                           |

### 16.2 Async & Built-ins

| Test              | Code                                                 | Expected Result                             |
| ----------------- | ---------------------------------------------------- | ------------------------------------------- |
| Async/await       | `const x = await Promise.resolve(42); return x;`     | `{ success: true, result: 42 }`             |
| JSON built-in     | `return JSON.parse('{"test": true}');`               | `{ success: true, result: { test: true } }` |
| Math built-in     | `return Math.max(1, 2, 3);`                          | `{ success: true, result: 3 }`              |
| Array methods     | `return [3,1,2].sort();`                             | `{ success: true, result: [1, 2, 3] }`      |
| Date available    | `return typeof Date;`                                | `{ success: true, result: "function" }`     |
| Map/Set available | `const m = new Map(); m.set("a", 1); return m.size;` | `{ success: true, result: 1 }`              |
| RegExp available  | `return /test/.test("testing");`                     | `{ success: true, result: true }`           |
| Fetch unavailable | `return typeof fetch;`                               | `{ success: true, result: "undefined" }`    |

### 16.3 Execution Metrics

| Test                 | Code        | Expected Result                                                       |
| -------------------- | ----------- | --------------------------------------------------------------------- |
| Metrics present      | `return 1;` | Response has `metrics` with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb` |
| wallTimeMs > 0       | `return 1;` | `metrics.wallTimeMs >= 0` (typically > 0)                             |
| cpuTimeMs numeric    | `return 1;` | `metrics.cpuTimeMs` is a number                                       |
| memoryUsedMb numeric | `return 1;` | `metrics.memoryUsedMb` is a number                                    |

### 16.4 Timeout Handling

| Test                    | Code                                  | Expected Result                                            |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Custom timeout succeeds | `return "fast";` with `timeout: 5000` | `{ success: true, result: "fast" }`                        |
| Infinite loop timeout   | `while(true) {}` with `timeout: 2000` | `{ success: false, error: "..." }` with timeout indication |

### 16.5 Database Schema & Indexes Verification

Validate that Code Mode can successfully execute raw SQL or introspect the schema to verify that our new composite and partial performance-optimizing indexes exist:

| Test                    | Code                                                                                                                                                                                                                                                                              | Expected Result                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verify index schema     | `const res = mj.admin._executeRawQueryUnsafe("PRAGMA index_list('memory_journal');"); const names = res[0].values.map(v => v[1]); return ["idx_memory_journal_active_timestamp", "idx_memory_journal_active_recent", "idx_memory_journal_type_timestamp"].every(idx => names.includes(idx));` | `{ success: true, result: true }` (meaning all three new indexes exist in the `memory_journal` table index list)                                                                |

### 16.6 Telemetry Resource Verification

After the preceding test phases have executed several tool calls, verify that the telemetry metrics resources contain valid tracking data:

| Test                    | Code                                                                                                                                         | Expected Result                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary resource exists | Read `memory://metrics/summary` | Resource returns YAML-style text containing `total_calls`, `total_duration_ms`, `tools_called`, and `up_since` fields |
| Latency resource exists | `const entries = await mj.core.getRecentEntries({ limit: 1 }); return "latency data seeded";`<br>Then read `memory://metrics/latency` | Resource returns YAML-style text containing `p50_ms`, `p95_ms`, `p99_ms`, `min_ms`, `max_ms`, `count` fields for at least one tool            |
| Graceful empty          | Read `memory://metrics/latency` on a fresh server with no prior tool calls                                                                    | Returns `note: No latency data recorded yet.` (graceful empty state)                                                                         |
| Resources metrics exists| Read `memory://help` then `memory://metrics/resources` | Resource returns YAML-style text containing `uri`, `read_count`, and `error_count` fields for at least one resource |
| Resources empty         | Read `memory://metrics/resources` on a fresh server with no prior reads | Returns `note: No resource reads recorded yet.` (graceful empty state) |


---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Simple expressions return correct types: integer, string, object, null, boolean
- Circular object references are safely serialized as "[Circular]" without crashing
- Async/await resolves correctly inside sandbox
- Built-in constructors available: JSON, Math, Date, Array, Map, Set, RegExp
- `fetch` is explicitly `undefined` (Code Mode cannot scrape `/metrics` directly)
- `metrics` field present with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb`
- Custom `timeout` parameter accepted and enforced
- Infinite loop terminated with structured error (not hang or crash)
- Verified index schema via `_executeRawQueryUnsafe` check returning all three new composite and partial indexes
- `memory://metrics/summary` returns aggregate session telemetry with `total_calls` and `total_duration_ms`
- `memory://metrics/latency` returns per-tool percentile data with `p50_ms`, `p95_ms`, `p99_ms` fields after tool calls have been made
- `memory://metrics/resources` returns URI read telemetry after resource reads have occurred

