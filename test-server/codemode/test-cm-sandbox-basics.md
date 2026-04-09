# Test memory-journal-mcp — Code Mode: Sandbox Basics

Test the Code Mode sandbox (`mj_execute_code`) fundamentals: expression evaluation, async support, execution metrics, and timeout handling.

**Scope:** 1 tool (`mj_execute_code`), Phase 16 — ~15 test cases covering sandbox execution basics.

**Prerequisites:**

- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file.
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 16: Sandbox Basics

### 16.1 Simple Expressions

| Test            | Code                             | Expected Result                                             |
| --------------- | -------------------------------- | ----------------------------------------------------------- |
| Integer return  | `return 42;`                     | `{ success: true, result: 42 }`                             |
| String return   | `return "hello from code mode";` | `{ success: true, result: "hello from code mode" }`         |
| Object return   | `return { a: 1, b: [2, 3] };`    | `{ success: true, result: { a: 1, b: [2, 3] } }`            |
| Null return     | `return null;`                   | `{ success: true, result: null }`                           |
| No return value | `const x = 1;`                   | `{ success: true, result: undefined }` (implicit undefined) |
| Boolean return  | `return true;`                   | `{ success: true, result: true }`                           |

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

---

## Success Criteria

- [x] Simple expressions return correct types: integer, string, object, null, boolean
- [x] Async/await resolves correctly inside sandbox
- [x] Built-in constructors available: JSON, Math, Date, Array, Map, Set, RegExp
- [x] `metrics` field present with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb`
- [x] Custom `timeout` parameter accepted and enforced
- [x] Infinite loop terminated with structured error (not hang or crash)
