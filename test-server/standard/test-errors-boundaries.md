# Re-Test memory-journal-mcp — Error Handling & Structured Responses

**Scope:** Prompt handler validation, structured error response verification across all tool groups, and numeric coercion boundary testing.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 11: Error Handling (Part 2)\n\n### 11.3 Numeric Coercion Boundaries

The Dual-Schema pattern allows `.optional()` on the SDK-facing schema. Verify that type mismatches either coerce gracefully or return structured errors — **never raw `-32602`**.

| Test                  | Input                                                         | Expected Result                                                      |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| String limit (core)   | `get_recent_entries(project_number: 5, limit: "abc")`         | `VALIDATION_ERROR`: structured, not raw `-32602`                     |
| String limit (search) | `search_entries(project_number: 5, query: "x", limit: "abc")`         | `VALIDATION_ERROR`: structured, not raw `-32602`                     |
| String weight         | `search_entries(project_number: 5, query: "x", fts_weight: "abc")`    | `VALIDATION_ERROR`: structured, not raw `-32602`                     |
| Float weight          | `search_entries(project_number: 5, query: "x", fts_weight: 1.5)`      | Success — float is valid for weight multipliers                      |
| String entry_id       | `get_entry_by_id(project_number: 5, entry_id: "abc")`         | `VALIDATION_ERROR`: structured, not raw `-32602`                     |
| String threshold      | `semantic_search(query: "x", similarity_threshold: "abc")`    | `VALIDATION_ERROR`: structured, not raw `-32602`                     |
| Negative limit        | `get_recent_entries(project_number: 5, limit: -1)`            | `VALIDATION_ERROR`: min boundary enforced (`>=1`)                    |
| Zero limit            | `get_recent_entries(project_number: 5, limit: 0)`             | `VALIDATION_ERROR`: min boundary enforced (`>=1`)                    |
| Float entry_id        | `get_entry_by_id(project_number: 5, entry_id: 1.5)`           | `VALIDATION_ERROR`: non-integer rejected                             |
| Boolean where string  | `create_entry(project_number: 5, content: true)`              | ⚠️ SDK coerces to string `"true"` — accepted (expected SDK behavior) |
| Array where string    | `create_entry(project_number: 5, content: ["array"])`         | ⚠️ SDK coerces to `'["array"]'` — accepted (expected SDK behavior)   |

> [!NOTE]
> Under MCP SDK 1.29+ with strict Zod integration, the two ⚠️ findings (boolean and array coercion) now properly throw `VALIDATION_ERROR` rather than silently coercing. The new strict behavior, along with team-scoped permission rejections, is verified directly via the `test-server/scripts/test-sdk-boundaries.mjs` script.

### 11.4 Empty Parameter (`{}`) Sweep — Critical Tools

Ensure that submitting empty parameters gracefully returns structured validation errors without crashing the server or returning `-32602`.

| Test | Command/Action | Expected Result |
| --- | --- | --- |
| Empty create | `create_entry` (no arguments) | `VALIDATION_ERROR`: content required |
| Empty search | `search_entries` (no arguments) | `VALIDATION_ERROR`: query required |
| Empty semantic | `semantic_search` (no arguments) | `VALIDATION_ERROR`: query required |
| Empty update | `update_entry` (no arguments) | `VALIDATION_ERROR`: entry_id required |
| Empty delete | `delete_entry` (no arguments) | `VALIDATION_ERROR`: entry_id required |
| Empty team create | `team_create_entry` (no arguments) | `VALIDATION_ERROR`: project_number/content required |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary.
- Numeric coercion boundary violations (e.g. string for limit) return structured `VALIDATION_ERROR` rather than raw `-32602`.
- Float values allowed for weights, but rejected for integer IDs.
- Empty parameter calls gracefully return structured `VALIDATION_ERROR`.

