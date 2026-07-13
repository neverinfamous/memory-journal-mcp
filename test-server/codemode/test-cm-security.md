# Re-Test memory-journal-mcp — Code Mode: Error Handling & Security

Test the Code Mode security constraints: input validation, blocked patterns, runtime error handling, and nulled globals.

**Scope:** 1 tool (`mj_execute_code`), Phase 19 — ~16 test cases covering sandbox security enforcement.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

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

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Empty code returns structured error (not raw MCP error)
- All 7 blocked patterns (`require`, `process`, `eval`, `import`, `Function`, `__proto__`, `child_process`) return structured security errors
- Syntax errors return `{ success: false, error: "..." }` with descriptive message
- Runtime errors (ReferenceError, TypeError) caught and returned as structured errors
- Nulled globals confirmed: `process`, `require`, `setTimeout`, `globalThis` are all `undefined`
