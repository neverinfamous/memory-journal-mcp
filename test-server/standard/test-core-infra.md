# Test memory-journal-mcp — Core Infrastructure

**Scope:** Server health, briefing resource, protocol validation scripts, and GitHub status resource.

**Execution Strategy:** **Use direct MCP tools, NOT Code Mode or scripts!** Code Mode is preferred to scripts if absolutely necessary to supplement direct tool calls.

**Prerequisites:** Seed data from `test-seed.md` must be present. MCP server instructions auto-injected.

**Workflow after testing:**

1. Plan fixes (reference `code-map.md` + `mcp-builder` skill).
2. Implement, update `UNRELEASED.md`, commit without push.
3. Re-test fixes with direct MCP calls.
4. Brief final summary.
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
| Tool annotations   | 67 tools, all with `annotations`, 45 `false` + 22 `true` = 0 missing |

### 1.4 GitHub Status Resource

| Test              | Command/Action                                                                               | Expected Result                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Read status       | Read `memory://github/status` (use `memory://github/status/{repo}` for multi-project setups) | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary  |
| CI status mapping | Verify CI status value                                                                       | Shows `passing`, `failing`, `pending`, `cancelled`, or `unknown` |
| Milestone data    | Inspect status data                                                                          | Includes milestones summary (open count, completion percentages) |

---

## Success Criteria

- [ ] `test_simple` returns echo message
- [ ] `memory://health` shows DB stats, vector index health, team DB block, and `scheduler.active: false`
- [ ] `memory://briefing` returns complete JSON with all expected fields
- [ ] Server instructions length respects `--instruction-level`: essential (~1.9K tokens) < standard (~2.2K) < full (~3.3K)
- [ ] 45 core/local tools have `openWorldHint: false`; 22 GitHub tools have `openWorldHint: true` (67 total, 0 missing)
- [ ] `get_statistics` returns all 4 enhanced analytics metrics
- [ ] `memory://github/status` returns compact JSON with CI, issues, PRs, milestones
