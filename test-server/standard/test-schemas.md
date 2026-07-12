# Re-Test memory-journal-mcp — Output Schemas

**Scope:** Verify all 103 outputSchema tools return `structuredContent` (not raw text). `mj_execute_code` intentionally excluded — its dynamic return type produces a bare `{}` JSON Schema that crashes clients processing `structuredContent`.

**Prerequisites:**

- **CRITICAL:** You MUST pass `use_test_db: true` as a top-level parameter in ALL MCP tool calls to ensure tests hit the test database instead of production.
- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 9: outputSchema Validation

> **Efficiency Update:** Instead of manually testing 70+ tools sequentially, use the dedicated programmatic verification script.

Run the validation script to ensure all exported tools (except `mj_execute_code`) have strict `outputSchema` definitions:

```bash
node test-server/scripts/verify-schemas.mjs
```

_The script will output `SUCCESS: All X tools have outputSchema defined.` if all schemas are correctly wired, which guarantees that `mcp-server.ts` will append `structuredContent` to all responses._

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- The verification script exits with a 0 status code and reports that all exported outputSchema tools are compliant.
