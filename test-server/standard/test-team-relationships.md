
# Re-Test memory-journal-mcp — Team Relationships

**Scope:** Team administration, analytics, relationships, vector search, backup, and IO operations.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the linter and typechecker (`pnpm run lint` and `npx tsc --noEmit`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---


### 14.11 Team Relationships

| Test                  | Command/Action                                                                                                                    | Expected Result                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Link entries          | `team_link_entries(workspace_id: "test-ws", from_entry_id: <A>, to_entry_id: <B>, relationship_type: "references")`                     | `success: true`, `relationship` object               |
| Link with description | `team_link_entries(workspace_id: "test-ws", from_entry_id: <A>, to_entry_id: <B>, relationship_type: "implements", description: "...")` | Relationship created with `description`              |
| Duplicate link        | Call `team_link_entries(workspace_id: "test-ws")` again with same params                                                                | `duplicate: true`, `message`                         |
| Link nonexistent      | `team_link_entries(workspace_id: "test-ws", from_entry_id: 999999, to_entry_id: <B>, ...)`                                              | Structured error: `{ success: false, error: "..." }` |
| Visualize by entry    | `team_visualize_relationships(workspace_id: "test-ws", id: <A>)`                                                                  | `mermaid` string, `nodeCount`, `edgeCount`           |
| Visualize by tag      | `team_visualize_relationships(workspace_id: "test-ws", tag: "team-test")`                                                               | Mermaid diagram scoped to tag                        |
| Visualize nonexistent | `team_visualize_relationships(workspace_id: "test-ws", id: 999999)`                                                               | Structured error or empty diagram                    |

---

