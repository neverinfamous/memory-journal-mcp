# Re-Test memory-journal-mcp — Error Handling & Structured Responses

**Scope:** Prompt handler validation, structured error response verification across all tool groups, and numeric coercion boundary testing.

**Prerequisites:**

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

## Phase 11: Error Handling Verification

### 11.1 Prompt Handler Validation

> [!NOTE]
> Prompts are tested via the existing script `test-server/scripts/test-prompts.mjs`. Run it directly — do **not** use a browser or try to invoke `get_prompt` through the MCP client.

**Command:**

```
node test-server/scripts/test-prompts.mjs
```

| Test                         | Expected Result                                                     |
| ---------------------------- | ------------------------------------------------------------------- |
| List all prompts             | 19 prompts listed (11 workflow + 6 GitHub + 1 adversarial + 1 team) |
| All 19 named prompt calls    | 19/19 PASS with non-empty `messages[0].content.text`                |
| `nonexistent-prompt`         | MCP error returned (code `-32602`)                                  |
| `find-related({})` (no args) | Error returned gracefully                                           |
| **Overall**                  | `21 pass, 0 fail (21 total)`                                        |

### 11.2 Structured Error Response Verification

Every tool must return `{success: false, error, code, category, suggestion, recoverable}` for errors — **never raw MCP exceptions**. Verify the pattern across representative tools from each group.

| Group      | Tool                                   | Error Trigger                                      | Expected Result                                                                    |
| ---------- | -------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **core**   | `create_entry`                         | `entry_type: "invalid"`                            | `success:false`, `code:"VALIDATION_ERROR"`, `category:"validation"`, enum in error |
| **core**   | `get_entry_by_id`                      | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `category:"resource"`                |
| **search** | `search_by_date_range`                 | `start_date: "2026-12-31", end_date: "2026-01-01"` | `success:false`, `code:"VALIDATION_ERROR"`, `suggestion` with date hint            |
| **admin**  | `update_entry`                         | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `recoverable:true`                   |
| **admin**  | `batch_update_entries`                 | `updates: [{ entry_id: 999999, content: "x" }]`    | `success:false`, `code:"AGGREGATE_ERROR"`, `aggregated_errors` array returned      |
| **admin**  | `merge_tags`                           | `source_tag: "x", target_tag: "x"`                 | `success:false`, same-tag error with `category:"validation"`                       |
| **backup** | `restore_backup`                       | `filename: "nonexistent.db"`                       | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `details.resourceType`               |
| **github** | `get_github_issue`                     | `issue_number: 999999`                             | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `category:"resource"`                |
| **team**   | `team_create_entry(workspace_id: "test-ws")` | `entry_type: "invalid"`                            | `success:false`, `code:"VALIDATION_ERROR"`, enum listed in error                   |
| **team**   | `team_update_entry(workspace_id: "test-ws")` | `entry_id: 999999`                                 | `success:false`, `code:"RESOURCE_NOT_FOUND"`, `recoverable:true`                   |

*Note: Team tools requiring `TEAM_AUTHOR` and protocol-level boundary validations are verified by executing `node test-server/scripts/test-sdk-boundaries.mjs`.*

\n\n## Success Criteria\n- Agent reports the Total Token Estimate...