# Re-Test memory-journal-mcp — Core Infrastructure

**Scope:** Server health, briefing resource, protocol validation scripts, and GitHub status resource.

**Prerequisites:**

- Confirm MCP server instructions were auto-received before starting.
- **Use direct MCP tools whenever possible.** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.
- Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Create a plan to fix any issues found or potential improvement opportunities, including changes to `server-instructions.md`/`server-instructions.ts` or this file.
2. Use `code-map.md` as a source of truth and ensure fixes comply with `C:\Users\chris\Desktop\adamic\skills\mcp-builder`.
3. If you made code changes/fixes, update `UNRELEASED.md` and commit without pushing. If tests pass cleanly, do NOT update `UNRELEASED.md`. Then, stop so the **USER** can verify with `npm run lint && npm run typecheck`, `npm run test`, and `npm run test:e2e`.
4. After user completes verification, re-test fixes with direct MCP calls.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.

---

## Phase 1: Core Infrastructure

### 1.1 Server Health & Connectivity

| Test               | Command/Action         | Expected Result                                                                                 |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Basic connectivity | `test_simple`          | Returns echo message                                                                            |
| Health resource    | Read `memory://health` | Shows DB stats, tool filter status, vector index health                                         |
| Health team block  | Read `memory://health` | Includes `teamDatabase` block with `configured`, `entryCount`, `path` (requires `TEAM_DB_PATH`) |
| Scheduler inactive | Read `memory://health` | `scheduler.active: false`, `scheduler.jobs: []` (scheduler is HTTP-only, inactive in stdio)     |
| Statistics         | `get_statistics`       | Returns `structuredContent` with entry counts, types, periods                                   |
| Enhanced analytics | `get_statistics`       | Returns `decisionDensity`, `relationshipComplexity`, `activityTrend`, `causalMetrics`           |

### 1.2 Briefing Resource

| Test                             | Command/Action                   | Expected Result                                                                                        |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read briefing                    | Read `memory://briefing`         | Returns JSON with `userMessage`, `templateResources`, `journal`, `github`                              |
| Verify `lastModified` annotation | Check resource metadata          | ISO 8601 timestamp (client-dependent — AntiGravity doesn't expose MCP annotations)                     |
| Confirm `userMessage`            | Inspect briefing.userMessage     | Formatted table with project/branch/CI/journal stats                                                   |
| Milestone progress row           | Inspect briefing.userMessage     | Table includes milestone progress row (e.g., "🚩 Milestones: X open")                                  |
| Team DB row                      | Inspect briefing.userMessage     | Table includes "Team DB" row with team entry count (requires `TEAM_DB_PATH`)                           |
| Template URIs                    | Check `templateResources` array  | 11 template URIs listed (includes `memory://milestones/{number}`)                                      |
| Workflow summary                 | Inspect `github.workflowSummary` | Present when `BRIEFING_WORKFLOW_STATUS=true` — has `passing`, `failing`, `pending`, `cancelled` counts |
| Workflow named runs              | Inspect `workflowSummary.runs`   | Array of `{name, conclusion}` when `BRIEFING_WORKFLOW_COUNT > 0`; CI row shows icons (✅/❌)           |
| Rules metadata                   | Inspect `rulesFile` field        | Present when `RULES_FILE_PATH` set — has `name`, `sizeKB`, `lastModified`                              |
| Skills metadata                  | Inspect `skillsDir` field        | Present when `SKILLS_DIR_PATH` set — has `count`, `names` array                                        |
| Enhanced CI row                  | Inspect briefing.userMessage     | CI row shows breakdown or named runs (not just single-word status) when workflow env vars are set      |

### 1.3 Protocol Validation — Run via Scripts - DO NOT SKIP!

> [!IMPORTANT]
> These tests require **separate server starts** — they cannot be run via MCP tool calls. Run the scripts below in a terminal. Ensure the project is built first. See `test-server/README.md` for full details.

```powershell
# Ensure latest build
npm run build

# Test A — Instruction levels (essential < standard < full)
node test-server/scripts/test-instruction-levels.mjs

# Test B — Tool annotations (67 tools, 45 openWorldHint=false, 22 openWorldHint=true, 0 missing)
node test-server/scripts/test-tool-annotations.mjs
```

| Check              | Expected                                                             |
| ------------------ | -------------------------------------------------------------------- |
| Instruction levels | essential (~1.9K) < standard (~2.2K) < full (~3.3K tokens)           |
| Tool annotations   | 70 tools, all with `annotations`, 48 `false` + 22 `true` = 0 missing |

### 1.4 GitHub Status Resource

| Test              | Command/Action                                                                               | Expected Result                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Read status       | Read `memory://github/status` (use `memory://github/status/{repo}` for multi-project setups) | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary  |
| CI status mapping | Verify CI status value                                                                       | Shows `passing`, `failing`, `pending`, `cancelled`, or `unknown` |
| Milestone data    | Inspect status data                                                                          | Includes milestones summary (open count, completion percentages) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- `test_simple` returns echo message
- `memory://health` shows DB stats, vector index health, team DB block, and `scheduler.active: false`
- `memory://briefing` returns complete JSON with all expected fields
- Server instructions length respects `--instruction-level`: essential (~1.9K tokens) < standard (~2.2K) < full (~3.3K)
- 48 core/local tools have `openWorldHint: false`; 22 GitHub tools have `openWorldHint: true` (70 total, 0 missing)
- `get_statistics` returns all 4 enhanced analytics metrics
- `memory://github/status` returns compact JSON with CI, issues, PRs, milestones
