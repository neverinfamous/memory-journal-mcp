
# Re-Test memory-journal-mcp — Team Analytics & Cross-Project

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


### 14.8 Team Analytics

| Test             | Command/Action                           | Expected Result                                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Default stats    | `team_get_statistics`                    | `totalEntries`, `entriesByType`, `entriesByPeriod`, `authors` array |
| Group by month   | `team_get_statistics(group_by: "month")` | `entriesByPeriod` periods grouped by month                          |
| Group by day     | `team_get_statistics(group_by: "day")`   | `entriesByPeriod` periods grouped by day                            |
| Author breakdown | Inspect `authors` field                  | Array of `{ author, count }` for each contributor                   |

### 14.10 Team Cross-Project Insights

| Test                 | Command/Action                                                                      | Expected Result                                                                           |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Default insights     | `team_get_cross_project_insights`                                                   | `project_count ≥ 1`, project 5 with `entry_count ≥ 3`, `top_tags` and `time_distribution` |
| Insights with dates  | `team_get_cross_project_insights(start_date: "2026-01-01", end_date: "2026-03-01")` | Date-filtered — project 5 visible if S15–S17 fall within range                            |
| Insights min_entries | `team_get_cross_project_insights(min_entries: 1)`                                   | Same or more projects than default (`min_entries: 3`)                                     |
| Empty result         | `team_get_cross_project_insights(min_entries: 9999)`                                | `project_count: 0`, `projects: []`, `message` present                                     |

### 14.14 Team Resources

| Test             | URI                        | Expected Result                                                       |
| ---------------- | -------------------------- | --------------------------------------------------------------------- |
| Recent entries   | `memory://team/recent`     | JSON with `entries` (author-enriched), `count`, `source: "team"`      |
| Statistics       | `memory://team/statistics` | `configured: true`, `totalEntries`, `authors` array, `source: "team"` |
| Author breakdown | `memory://team/statistics` | `authors` contains `{ author: "<name>", count: N }` for each author   |

### 14.15 Insights & Team Collaboration Metrics

| Test                 | Command/Action                                 | Expected Result                                                                |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| Matrix structure     | `team_get_collaboration_matrix`                | `authorActivity` and `impactFactor` object arrays present                      |
| Matrix author        | Inspect `team_get_collaboration_matrix` result | Authors like "alice" and "bob" (from S15-S17) exist in metrics                 |
| Digest resource      | Read `memory://insights/digest`                | Either full snapshot JSON or graceful "no digest available" message            |
| Team collab resource | Read `memory://insights/team-collaboration`    | Same payload structure as `team_get_collaboration_matrix` with `success: true` |

---

