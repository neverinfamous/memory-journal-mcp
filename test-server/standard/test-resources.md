# Re-Test memory-journal-mcp — Resources

**Scope:** All 33 resources — 26 static resources, 7 template resources (happy path + error paths).

**Prerequisites:**

- **Validation:** Ensure the test agent validates strict mode and boundary limits on newly hardened schemas.
> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.
- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools exclusively.** Do NOT use Code Mode (`mj_execute_code`) for these tests. Code Mode tests are handled separately in the `codemode` track. If you must use a script to supplement a test, use a standard Node/shell script.
- Seed data from `test-seed.md` must be present.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `src/constants/server-instructions.ts`. **Do NOT edit this test prompt file directly.** **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `src/filtering/tool-filter.ts`) so future agents succeed automatically.**
2. Use `test-server/tool-reference.md` and `test-server/scripts/tool-map.json` as sources of truth and ensure fixes comply with the `mcp-builder` skill.
3. **Local Verification**: If you or a subagent modifies the codebase, you MUST run the full validation pipeline (`pnpm run check`) locally and fix any issues BEFORE committing. Pay strict attention to ESLint and TypeScript compiler outputs. You MUST fix all validation issues prior to committing. Do NOT ignore warnings or errors. Follow strict TypeScript guidelines: NEVER use `any` (use `unknown` with type guards), avoid unsafe typecasts, and ensure explicit return types.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run check` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 10: All Resources

### 1.1 Static Resources

| Resource          | URI                                    | Test                                                                                                                                |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Briefing          | `memory://briefing`                    | Returns pre-formatted Markdown string containing a dense 2-column context table                                |
| Instructions      | `memory://instructions`                | Full server instructions — verify it references all 61 tools and key resources                                                      |
| Recent entries    | `memory://recent`                      | Read, verify 10 entries with typed fields                                                                                           |
| Significant       | `memory://significant`                 | Verify entries have `importance`, sorted by importance (primary), timestamp (secondary)                                             |
| Significant order | `memory://significant`                 | Compare adjacent entries: `entries[0].importance >= entries[1].importance` etc.                                                     |
| Health            | `memory://health`                      | Shows DB stats, tool filter status, vector index health                                                                             |
| GitHub status     | `memory://github/status`               | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary (includes milestones)                                               |
| GitHub milestones | `memory://github/milestones`           | Open milestones with completion percentages                                                                                         |
| Actions recent    | `memory://actions/recent`              | Recent workflow runs (verify graceful output when no workflow entries exist)                                                        |
| Team recent       | `memory://team/recent`                 | Author-enriched entries, `source: "team"`, `count`                                                                                  |
| Team statistics   | `memory://team/statistics`             | `configured: true`, `authors` array with `{ author, count }`, `source: "team"`                                                      |
| Help index        | `memory://help`                        | Lists all tool groups with counts, descriptions, and `totalTools`                                                                   |
| Help group detail | `memory://help/{group}`                | Per-group tool listing with parameters, descriptions, and annotations (test with `memory://help/core`)                              |
| Rules             | `memory://rules`                       | Rules file content (requires `RULES_FILE_PATH`); graceful empty if not set                                                          |
| Workflows         | `memory://workflows`                   | Workflow summary (requires `MEMORY_JOURNAL_WORKFLOW_SUMMARY` or `--workflow-summary`); returns `{ configured: false }` when not set |
| Skills            | `memory://skills`                      | Indexed skills listing (requires `SKILLS_DIR_PATH`); graceful empty if not set                                                      |

| Metrics summary   | `memory://metrics/summary`             | Session metrics: tool calls, token estimates, cache hits, uptime                                                                    |
| Metrics tokens    | `memory://metrics/tokens`              | Token breakdown: per-tool token usage and totals                                                                                    |
| Metrics system    | `memory://metrics/system`              | System metrics: memory usage, database stats, vector index health                                                                   |
| Metrics users     | `memory://metrics/users`               | Per-user metrics (when multi-user sessions active)                                                                                  |
| Metrics latency   | `memory://metrics/latency`             | Per-tool latency percentiles (p50/p95/p99) with min/max bounds                                                                      |
| Metrics resources | `memory://metrics/resources`           | Resource read telemetry (counts, error rates, timestamps) per accessed URI                                                          |
| Audit log         | `memory://audit`                       | Last 50 audit entries with tool name, timestamp, and result                                                                         |
| Insights digest   | `memory://insights/digest`             | Cross-project digest snapshot (graceful empty if no digest available)                                                               |
| Insights team     | `memory://insights/team-collaboration` | Team collaboration matrix with `authorActivity` and `impactFactor` (graceful if team DB not configured)                             |
| Insights reports  | `memory://insights/reports`            | Last 5 scheduled digest report snapshots and previews                                                                               |
| Project staleness | `memory://staleness`                   | Overview of staleness across all projects                                                                                           |

### 1.2 Template Resources — Happy Path

> [!CAUTION]
> Issue and PR template URIs require the `/entries` or `/timeline` suffix — they are **NOT** bare `memory://issues/{number}` or `memory://prs/{number}`. Using bare URIs will return "Resource not found". Always use the full paths shown in the table below (e.g. `memory://issues/55/entries`, `memory://prs/67/timeline`).

| Template         | Test URI                       | Expected Result                                                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Project timeline | `memory://projects/5/timeline` | Timeline data                                                                                                                       |
| Issue entries    | `memory://issues/55/entries`   | Entries linked to issue #55                                                                                                         |
| PR entries       | `memory://prs/67/entries`      | Entries linked to PR #67 (permanent test fixture)                                                                                   |
| PR timeline      | `memory://prs/67/timeline`     | PR lifecycle with `prMetadata` (live state) and `timelineNote`                                                                      |
| Kanban JSON      | `memory://kanban/5`            | Board JSON                                                                                                                          |
| Milestone detail | `memory://milestones/<N>`      | Milestone with completion %, `openIssues` + `closedIssues` counts, and hint to use `get_github_issues` for individual issue details |
| Briefing by repo | `memory://briefing/<repo>`     | Repo-scoped briefing (test with `memory://briefing/memory-journal-mcp`) — same structure as `memory://briefing` but repo-filtered   |
| Agent Context    | `memory://agent-context/<repo>`| Context injected into agent instructions                                                                                            |
| Actions by repo  | `memory://actions/recent/<repo>` | Recent actions scoped to specific repository                                                                                      |
| Milestones by repo | `memory://github/milestones/<repo>` | Milestones scoped to specific repository                                                                                     |
| Status by repo   | `memory://github/status/<repo>`| GitHub status scoped to specific repository                                                                                         |
| Commits          | `memory://commits/5`           | Raw commit history for project                                                                                                      |
| Commits by Issue | `memory://commits/5/by-issue`  | Commits grouped by issue                                                                                                            |
| Commits by PR    | `memory://commits/5/by-pr`     | Commits grouped by PR                                                                                                               |
| Kanban by repo   | `memory://kanban/<repo>/5`     | Kanban board scoped to specific repository                                                                                          |
| Milestone by repo| `memory://milestones/<repo>/<N>` | Milestone detail scoped to specific repository                                                                                      |
| Staleness project| `memory://staleness/5`         | Staleness details scoped to specific project                                                                                        |

### 1.3 Template Resources — Error Paths

| Template                   | Test URI                           | Expected Result                                                 |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Nonexistent project        | `memory://projects/99999/timeline` | Empty or graceful response (no entries for nonexistent project) |
| Nonexistent issue          | `memory://issues/999999/entries`   | Empty entries array (no crash)                                  |
| Nonexistent PR             | `memory://prs/999999/entries`      | Empty entries array (no crash)                                  |
| Nonexistent PR timeline    | `memory://prs/999999/timeline`     | Graceful response with empty/null `prMetadata`                  |
| Nonexistent Kanban         | `memory://kanban/99999`            | Error or empty board (no crash)                                 |
| Nonexistent milestone      | `memory://milestones/999999`       | Error or empty milestone data (no crash)                        |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- All 26 static resources return valid data
- All 7 template resources work with valid parameters
- All 7 template resources handle invalid/nonexistent IDs gracefully (no crashes)
- `memory://significant` includes `importance` field and is sorted by importance (primary) then timestamp (secondary)
- `memory://instructions` references all tools and key resources

- `memory://briefing` includes local time for chronological grounding
- `memory://briefing/<repo>` returns repo-scoped briefing
- `memory://help/[group]` resources exist for all 10 API groups (`core`, `search`, `analytics`, `relationships`, `io`, `export`, `admin`, `github`, `backup`, `team`).
- `memory://metrics/summary` returns session-level metrics
- `memory://metrics/latency` returns per-tool latency percentile data with `p50_ms`, `p95_ms`, `p99_ms` fields (or a graceful empty message if no tool calls have been made)
- `memory://metrics/resources` returns read access counts and error counts for all accessed URIs, or a graceful empty message if no reads have occurred
- `memory://audit` returns last 50 audit entries
- `memory://insights/digest` handles empty digest gracefully
- `memory://insights/team-collaboration` returns collaboration matrix or graceful empty
- `memory://insights/reports` returns list of report snapshots or graceful empty
