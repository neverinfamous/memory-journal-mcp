
# Re-Test memory-journal-mcp — Team Vector Search

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

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


### 14.9 Team Vector Search

| Test                    | Command/Action                                                                      | Expected Result                                     |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Rebuild team index      | `team_rebuild_vector_index`                                                         | `success: true`, `entriesIndexed` > 0               |
| Team vector stats       | `team_get_vector_index_stats`                                                       | `available`, `itemCount`, `modelName`, `dimensions` |
| Team semantic query     | `team_semantic_search(project_number: 5, query: "team standup")`                    | ≥ 1 result with `similarity` score                  |
| Team related by ID      | `team_semantic_search(project_number: 5, entry_id: <team_entry_id>)`                | Semantically similar team entries bypassing strings |
| Team semantic threshold | `team_semantic_search(project_number: 5, query: "test", similarity_threshold: 0.5)` | Fewer results than default threshold (0.25)         |
| Team add to index       | `team_add_to_vector_index(project_number: 5, entry_id: <team_entry_id>)`            | `success: true`, `entryId` in response              |
| Team add nonexistent    | `team_add_to_vector_index(project_number: 5, entry_id: 999999)`                     | `{ success: false, error: "..." }`                  |

---

