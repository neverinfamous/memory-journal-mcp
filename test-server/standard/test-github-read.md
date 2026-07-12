# Re-Test memory-journal-mcp — GitHub Integration

**Scope:** 16 GitHub tools — read-only tools, issue lifecycle, Kanban, milestones, repository insights, Copilot reviews, and test cleanup.

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun .\.agents\scripts\commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. DO NOT stop to ask the USER to verify with `pnpm run check` yourself—you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 13: GitHub Integration (16 tools)

### 13.1 Read-Only Tools

| Test                  | Command/Action                                 | Expected Result                                          |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Context               | `get_github_context`                           | Returns repo, branch, issues, PRs                        |
| List issues           | `get_github_issues(limit: 5)`                  | Returns open issues                                      |
| Issue milestone data  | Inspect issue objects                          | Issues include `milestone` field (if assigned)           |
| Get issue             | `get_github_issue(issue_number: <N>)`          | Returns issue details                                    |
| List PRs              | `get_github_prs(limit: 5)`                     | Returns open PRs                                         |
| List closed issues    | `get_github_issues(state: "closed", limit: 3)` | Returns closed issues                                    |
| List all issues       | `get_github_issues(state: "all", limit: 3)`    | Returns both open and closed issues                      |
| List closed PRs       | `get_github_prs(state: "closed", limit: 3)`    | Returns closed/merged PRs                                |
| List all PRs          | `get_github_prs(state: "all", limit: 3)`       | Returns both open and closed PRs                         |
| Get PR                | `get_github_pr(pr_number: <N>)`                | Returns PR details (use known closed PR)                 |
| Get nonexistent issue | `get_github_issue(issue_number: 999999)`       | Structured error: `{ error: "Issue #999999 not found" }` |
| Get nonexistent PR    | `get_github_pr(pr_number: 999999)`             | Structured error: `{ error: "PR #999999 not found" }`    |

### 13.5 Repository Insights Tool\n

| Test              | Command/Action                             | Expected Result                                    |
| ----------------- | ------------------------------------------ | -------------------------------------------------- |
| Default (stars)   | `get_repo_insights`                        | Returns `stars`, `forks`, `watchers`, `openIssues` |
| Traffic section   | `get_repo_insights(sections: "traffic")`   | Returns 14-day `clones` and `views` aggregates     |
| Referrers section | `get_repo_insights(sections: "referrers")` | Returns top 5 referral sources                     |
| Paths section     | `get_repo_insights(sections: "paths")`     | Returns top 5 popular content paths                |
| All sections      | `get_repo_insights(sections: "all")`       | Returns full payload with all sections above       |

### 13.6 Copilot Review Tool

| Test                  | Command/Action                                        | Expected Result                                                                                                |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Reviewed PR           | `get_copilot_reviews(pr_number: <known_reviewed_pr>)` | Returns `state`, `commentCount`, `comments` array with `path`, `line`, `body`                                  |
| Unreviewed PR         | `get_copilot_reviews(pr_number: <unreviewed_pr>)`     | Returns `state: "none"`, `commentCount: 0`, empty `comments`                                                   |
| Auto-detect repo      | `get_copilot_reviews(pr_number: 1)`                   | Returns structured `CONFIGURATION_ERROR` in multi-workspace environments (or auto-detects in single-workspace) |
| No GitHub integration | (server without `GITHUB_TOKEN`)                       | Returns `{ success: false, error: "GitHub integration not available" }`                                        |



---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `get_github_issues` and `get_github_prs` with `state: "closed"` and `state: "all"` work
- `get_repo_insights` returns correct data based on `sections` parameter
- `get_copilot_reviews` — referenced in test docs but not re-executed (verified in schema check only; see prior sessions)
