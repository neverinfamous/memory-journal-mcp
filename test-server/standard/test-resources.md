# Test memory-journal-mcp — Resources

**Scope:** All 28 resources — static resources, template resources (happy path + error paths).

**Prerequisites:** Seed data from `test-seed.md` must be present. Core tests should have passed. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. User verifies: `npm run lint && npm run typecheck`, `npm run test`, `npm run test:e2e`.
4. Re-test fixes with direct MCP calls.
5. Brief final summary.
   * **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total tokens used by this test pass.

---

## Phase 1: All Resources

### 1.1 Static Resources

| Resource          | URI                          | Test                                                                                                                                              |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefing          | `memory://briefing`          | Returns JSON with `userMessage`, `templateResources`, `journal`, `github`, optional `rulesFile`, `skillsDir`, `workflowSummary`, `copilotReviews` |
| Instructions      | `memory://instructions`      | Full server instructions — verify it references all 61 tools and key resources                                                                    |
| Recent entries    | `memory://recent`            | Read, verify 10 entries with typed fields                                                                                                         |
| Significant       | `memory://significant`       | Verify entries have `importance`, sorted by importance (primary), timestamp (secondary)                                                           |
| Significant order | `memory://significant`       | Compare adjacent entries: `entries[0].importance >= entries[1].importance` etc.                                                                   |
| Tags              | `memory://tags`              | Read, verify tag counts match `list_tags` output                                                                                                  |
| Statistics        | `memory://statistics`        | Read, verify structured stats match `get_statistics` output                                                                                       |
| Health            | `memory://health`            | Shows DB stats, tool filter status, vector index health                                                                                           |
| GitHub status     | `memory://github/status`     | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary (includes milestones)                                                             |
| Repo insights     | `memory://github/insights`   | Compact summary of stars, forks, and 14-day traffic                                                                                               |
| GitHub milestones | `memory://github/milestones` | Open milestones with completion percentages                                                                                                       |
| Graph recent      | `memory://graph/recent`      | Mermaid diagram with harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)                                                                      |
| Graph actions     | `memory://graph/actions`     | CI/CD narrative graph (verify graceful output when no workflow entries exist)                                                                     |
| Actions recent    | `memory://actions/recent`    | Recent workflow runs (verify graceful output when no workflow entries exist)                                                                      |
| Team recent       | `memory://team/recent`       | Author-enriched entries, `source: "team"`, `count`                                                                                                |
| Team statistics   | `memory://team/statistics`   | `configured: true`, `authors` array with `{ author, count }`, `source: "team"`                                                                    |
| Help index        | `memory://help`              | Lists all tool groups with counts, descriptions, and `totalTools`                                                                                 |
| Help group detail | `memory://help/{group}`      | Per-group tool listing with parameters, descriptions, and annotations (test with `memory://help/core`)                                            |
| Help gotchas      | `memory://help/gotchas`      | Field notes and practical tips (moved from server instructions); verify non-empty content with actionable guidance                                |
| Rules             | `memory://rules`             | Rules file content (requires `RULES_FILE_PATH`); graceful empty if not set                                                                        |
| Workflows         | `memory://workflows`         | Workflow summary (requires `MEMORY_JOURNAL_WORKFLOW_SUMMARY` or `--workflow-summary`); returns `{ configured: false }` when not set               |
| Skills            | `memory://skills`            | Indexed skills listing (requires `SKILLS_DIR_PATH`); graceful empty if not set                                                                    |

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

- [ ] All 22 static resources return valid data
- [ ] All 7 template resources work with valid parameters
- [ ] All 7 template resources handle invalid/nonexistent IDs gracefully (no crashes)
- [ ] `memory://significant` includes `importance` field and is sorted by importance (primary) then timestamp (secondary)
- [ ] `memory://tags` tag counts match `list_tags` output
- [ ] `memory://statistics` structured stats match `get_statistics` output
- [ ] `memory://github/insights` returns compact stats including traffic aggregates
- [ ] `memory://graph/recent` uses harmonized arrows (`-->`, `==>`, `-.->`, `--x`, `<-->`)
- [ ] `memory://instructions` references all 61 tools and key resources
