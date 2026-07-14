# Re-Test memory-journal-mcp — Code Mode: Sandbox Basics

Test the Code Mode sandbox (`mj_execute_code`) fundamentals: expression evaluation, async support, execution metrics, and timeout handling.

**Scope:** 1 tool (`mj_execute_code`), Phase 16 — ~15 test cases covering sandbox execution basics.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
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
| Optional `code` | Call `mj_execute_code({})` without a `code` parameter | Valid response object, not a raw crash |

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

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- See part 2 for remaining success criteria.
