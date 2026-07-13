# Re-Test memory-journal-mcp — Code Mode: Sandbox Basics

Test the Code Mode sandbox (`mj_execute_code`) fundamentals: expression evaluation, async support, execution metrics, and timeout handling.

**Scope:** 1 tool (`mj_execute_code`), Phase 16 (Part 2) — ~15 test cases covering sandbox execution basics.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use codemode directly for all tests, NOT the terminal or scripts!**
- Code Mode is included in all tool filtering presets by default.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\\.agents\\scripts\\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 16: Sandbox Basics

### 16.4 Timeout Handling

| Test                    | Code                                  | Expected Result                                            |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------- |
| Custom timeout succeeds | `return "fast";` with `timeout: 5000` | `{ success: true, result: "fast" }`                        |
| Infinite loop timeout   | `while(true) {}` with `timeout: 2000` | `{ success: false, error: "..." }` with timeout indication |

### 16.5 Admin Tool Verification

Validate that Code Mode can successfully call admin tools:

| Test                    | Code                                                                                                                                                                                                                                                                              | Expected Result                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search audit log        | `const res = await mj.admin.searchAuditLog({ limit: 5 }); return res.count >= 0;` | `{ success: true, result: true }` (meaning the audit log search returns a valid response)                                                                |

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
- `mj_execute_code` gracefully handles omitting the `code` parameter without a raw error
- `metrics` field present with `wallTimeMs`, `cpuTimeMs`, `memoryUsedMb`
- Custom `timeout` parameter accepted and enforced
- Infinite loop terminated with structured error (not hang or crash)
- Verified index schema via `_executeRawQueryUnsafe` check returning all three new composite and partial indexes
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- `memory://metrics/summary` returns aggregate session telemetry with `total_calls` and `total_duration_ms`
- `memory://metrics/latency` returns per-tool percentile data with `p50_ms`, `p95_ms`, `p99_ms` fields after tool calls have been made
- `memory://metrics/resources` returns URI read telemetry after resource reads have occurred

