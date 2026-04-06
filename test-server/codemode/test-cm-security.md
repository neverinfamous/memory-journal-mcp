# Test memory-journal-mcp — Code Mode: Error Handling & Security

Test the Code Mode security constraints: input validation, blocked patterns, runtime error handling, and nulled globals.

**Scope:** 1 tool (`mj_execute_code`), Phase 19 — ~16 test cases covering sandbox security enforcement.

**Prerequisites:**

- Phase 16 (Sandbox Basics) must pass first.
- Code Mode is included in all tool filtering presets by default.
- Confirm MCP server instructions were auto-received before starting.
- Use the MCP server directly for all tests — not the terminal or scripts.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file.
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. After implementation, update `UNRELEASED.md` and commit without pushing. Then, stop so the user can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.

> [!IMPORTANT]
> **Test Session Prerequisites**

1. The server instructions are auto-injected by the MCP protocol. Confirm receipt (no need to read `memory://instructions` separately).
2. Read `memory://briefing` to confirm context loaded (the briefing table confirms receipt).

---

## Phase 19: Error Handling & Security

### 19.1 Input Validation

| Test            | Input                               | Expected Result                                               |
| --------------- | ----------------------------------- | ------------------------------------------------------------- |
| Empty code      | `code: ""`                          | `{ success: false, error: "..." }` — pre-execution validation |
| Whitespace only | `code: "   "` (if treated as empty) | Structured error or executes with `undefined` result          |

### 19.2 Blocked Patterns

| Test                 | Code                         | Expected Result                                      |
| -------------------- | ---------------------------- | ---------------------------------------------------- |
| require()            | `require('fs')`              | `{ success: false, error: "..." }` — blocked pattern |
| process.exit         | `process.exit(1)`            | `{ success: false, error: "..." }` — blocked pattern |
| eval()               | `eval('1+1')`                | `{ success: false, error: "..." }` — blocked pattern |
| import()             | `import('fs')`               | `{ success: false, error: "..." }` — blocked pattern |
| Function constructor | `new Function('return 1')()` | `{ success: false, error: "..." }` — blocked pattern |
| **proto**            | `({}).__proto__`             | `{ success: false, error: "..." }` — blocked pattern |
| child_process        | `require('child_process')`   | `{ success: false, error: "..." }` — blocked pattern |

### 19.3 Runtime Errors

| Test                 | Code                                        | Expected Result                                              |
| -------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| Syntax error         | `{{{`                                       | `{ success: false, error: "..." }` with syntax error message |
| ReferenceError       | `return nonexistentVariable;`               | `{ success: false, error: "..." }` with ReferenceError       |
| TypeError in code    | `null.foo()`                                | `{ success: false, error: "..." }` with TypeError            |
| RPC method not found | `return await mj.core.nonexistentMethod();` | `{ success: false }` — method not found in group             |

### 19.4 Nulled Globals

| Test                    | Code                        | Expected Result       |
| ----------------------- | --------------------------- | --------------------- |
| process is undefined    | `return typeof process;`    | `result: "undefined"` |
| require is undefined    | `return typeof require;`    | `result: "undefined"` |
| setTimeout is undefined | `return typeof setTimeout;` | `result: "undefined"` |
| globalThis is undefined | `return typeof globalThis;` | `result: "undefined"` |

---

## Success Criteria

- [ ] Empty code returns structured error (not raw MCP error)
- [ ] All 7 blocked patterns (`require`, `process`, `eval`, `import`, `Function`, `__proto__`, `child_process`) return structured security errors
- [ ] Syntax errors return `{ success: false, error: "..." }` with descriptive message
- [ ] Runtime errors (ReferenceError, TypeError) caught and returned as structured errors
- [ ] Nulled globals confirmed: `process`, `require`, `setTimeout`, `globalThis` are all `undefined`
