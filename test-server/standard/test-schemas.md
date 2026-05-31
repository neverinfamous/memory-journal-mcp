# Re-Test memory-journal-mcp — Output Schemas

**Scope:** Verify all 60 outputSchema tools return `structuredContent` (not raw text). `mj_execute_code` intentionally excluded — its dynamic return type produces a bare `{}` JSON Schema that crashes clients processing `structuredContent`.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 9: outputSchema Validation

> **Efficiency Update:** Instead of manually testing 70+ tools sequentially, use the dedicated programmatic verification script.

Run the validation script to ensure all exported tools (except `mj_execute_code`) have strict `outputSchema` definitions:

```bash
node test-server/scripts/verify-schemas.mjs
```

*The script will output `SUCCESS: All X tools have outputSchema defined.` if all schemas are correctly wired, which guarantees that `mcp-server.ts` will append `structuredContent` to all responses.*

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- The verification script exits with a 0 status code and reports that all exported outputSchema tools are compliant.
