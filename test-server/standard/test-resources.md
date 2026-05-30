# Re-Test memory-journal-mcp — Resources

**Scope:** All 37 resources — 29 static resources, 8 template resources (happy path + error paths).

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools whenever possible.** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `constants/server-instructions.ts` or this file. **If you encounter parameter or tool hallucinations during testing, intercept them gracefully in the server code (e.g., `codemode.ts`) so future agents succeed automatically.**
2. Use `code-map.md` as a source of truth and ensure fixes comply with the `mcp-builder` skill.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 10: All Resources

### 1.1 Static Resources

| Resource          | URI                          | Test                                                                                                                                                                                   |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefing          | `memory://briefing`          | Returns JSON with `userMessage`, `templateResources`, `journal`, `github`, optional `rulesFile`, `skillsDir`, `workflowSummary`, `copilotReviews`, `localTime`, optional `activeFlags` |
| Instructions      | `memory://instructions`      | Full server instructions — verify it references all 61 tools and key resources                                                                                                         |
| Recent entries    | `memory://recent`            | Read, verify 10 entries with typed fields                                                                                                                                              |
| Significant       | `memory://significant`       | Verify entries have `importance`, sorted by importance (primary), timestamp (secondary)                                                                                                |
| Significant order | `memory://significant`       | Compare adjacent entries: `entries[0].importance >= entries[1].importance` etc.                                                                                                        |
| Tags              | `memory://tags`              | Read, verify tag counts match `list_tags` output                                                                                                                                       |
| Statistics        | `memory://statistics`        | Read, verify structured stats match `get_statistics` output                                                                                                                            |
| Health            | `memory://health`            | Shows DB stats, tool filter status, vector index health                                                                                                                                |
| GitHub status     | `memory://github/status`     | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary (includes milestones)                                                                                                  |
| Repo insights     | `memory://github/insights`   | Compact summary of stars, forks, and 14-day traffic                                                                                                                                    |
| GitHub milestones | `memory://github/milestones` | Open milestones with completion percentages                                                                                                                                            |
| Graph recent      | `memory://graph/recent`      | Mermaid diagram with harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)                                                                                                           |
| Graph actions     | `memory://graph/actions`     | CI/CD narrative graph (verify graceful output when no workflow entries exist)                                                                                                          |
| Actions recent    | `memory://actions/recent`    | Recent workflow runs (verify graceful output when no workflow entries exist)                                                                                                           |
| Team recent       | `memory://team/recent`       | Author-enriched entries, `source: "team"`, `count`                                                                                                                                     |
| Team statistics   | `memory://team/statistics`   | `configured: true`, `authors` array with `{ author, count }`, `source: "team"`                                                                                                         |
| Help index        | `memory://help`              | Lists all tool groups with counts, descriptions, and `totalTools`                                                                                                                      |
| Help group detail | `memory://help/{group}`      | Per-group tool listing with parameters, descriptions, and annotations (test with `memory://help/core`)                                                                                 |
| Help gotchas      | `memory://help/gotchas`      | Field notes and practical tips (moved from server instructions); verify non-empty content with actionable guidance                                                                     |
| Rules             | `memory://rules`             | Rules file content (requires `RULES_FILE_PATH`); graceful empty if not set                                                                                                             |
| Workflows         | `memory://workflows`         | Workflow summary (requires `MEMORY_JOURNAL_WORKFLOW_SUMMARY` or `--workflow-summary`); returns `{ configured: false }` when not set                                                    |
| Skills            | `memory://skills`            | Indexed skills listing (requires `SKILLS_DIR_PATH`); graceful empty if not set                                                                                                         |
| Active flags      | `memory://flags`             | JSON with `activeFlags` array (unresolved flags); empty array when no active flags                                                                                                     |
| Flag vocabulary   | `memory://flags/vocabulary`  | JSON listing configured vocabulary: `blocker`, `needs_review`, `help_requested`, `fyi` (defaults)                                                                                      |
| Metrics summary   | `memory://metrics/summary`   | Session metrics: tool calls, token estimates, cache hits, uptime                                                                                                                       |
| Metrics tokens    | `memory://metrics/tokens`    | Token breakdown: per-tool token usage and totals                                                                                                                                       |
| Metrics system    | `memory://metrics/system`    | System metrics: memory usage, database stats, vector index health                                                                                                                      |
| Metrics users     | `memory://metrics/users`     | Per-user metrics (when multi-user sessions active)                                                                                                                                     |
| Audit log         | `memory://audit`             | Last 50 audit entries with tool name, timestamp, and result                                                                                                                            |
| Insights digest   | `memory://insights/digest`   | Cross-project digest snapshot (graceful empty if no digest available)                                                                                                                  |
| Insights team     | `memory://insights/team-collaboration` | Team collaboration matrix with `authorActivity` and `impactFactor` (graceful if team DB not configured)                                                                       |

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
| Kanban diagram   | `memory://kanban/5/diagram`    | Raw Mermaid text (`text/plain` MIME), not JSON-wrapped                                                                              |
| Milestone detail | `memory://milestones/<N>`      | Milestone with completion %, `openIssues` + `closedIssues` counts, and hint to use `get_github_issues` for individual issue details |
| Briefing by repo | `memory://briefing/<repo>`     | Repo-scoped briefing (test with `memory://briefing/memory-journal-mcp`) — same structure as `memory://briefing` but repo-filtered  |

### 1.3 Template Resources — Error Paths

| Template                   | Test URI                           | Expected Result                                                 |
| -------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| Nonexistent project        | `memory://projects/99999/timeline` | Empty or graceful response (no entries for nonexistent project) |
| Nonexistent issue          | `memory://issues/999999/entries`   | Empty entries array (no crash)                                  |
| Nonexistent PR             | `memory://prs/999999/entries`      | Empty entries array (no crash)                                  |
| Nonexistent PR timeline    | `memory://prs/999999/timeline`     | Graceful response with empty/null `prMetadata`                  |
| Nonexistent Kanban         | `memory://kanban/99999`            | Error or empty board (no crash)                                 |
| Nonexistent Kanban diagram | `memory://kanban/99999/diagram`    | Error or empty diagram (no crash)                               |
| Nonexistent milestone      | `memory://milestones/999999`       | Error or empty milestone data (no crash)                        |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- All 29 static resources return valid data
- All 8 template resources work with valid parameters
- All 8 template resources handle invalid/nonexistent IDs gracefully (no crashes)
- `memory://significant` includes `importance` field and is sorted by importance (primary) then timestamp (secondary)
- `memory://tags` tag counts match `list_tags` output
- `memory://statistics` structured stats match `get_statistics` output
- `memory://github/insights` returns compact stats including traffic aggregates
- `memory://graph/recent` uses harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)
- `memory://instructions` references all tools and key resources
- `memory://flags` returns active flag dashboard (empty when no unresolved flags)
- `memory://flags/vocabulary` returns configured vocabulary list
- `memory://briefing` includes `localTime` field for chronological grounding
- `memory://briefing/<repo>` returns repo-scoped briefing
- `memory://metrics/summary` returns session-level metrics
- `memory://audit` returns last 50 audit entries
- `memory://insights/digest` handles empty digest gracefully
- `memory://insights/team-collaboration` returns collaboration matrix or graceful empty
