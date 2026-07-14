# Re-Test memory-journal-mcp — Core Infrastructure

**Scope:** Server health, briefing resource, protocol validation scripts, and GitHub status resource.

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
   - DO NOT perform live server verification. DO NOT wait for a server restart. DO NOT pause or send a message asking the user to refresh the server.
4. **Commit**: Immediately commit passing changes using the `bun ./.agents/scripts/commit.ts --msg "type(scope): message" --impact <0.1-1.0> --confidence <0.1-1.0> --validation passed --journal --add <path>` utility. Do NOT use raw `git commit`. WARNING: Do NOT commit your code and then attempt to use `git commit --amend` to fix a lingering lint or test issue later. Amending a commit rewrites the commit SHA, which will permanently break the changelog tracking workflow. DO NOT stop to ask the USER to verify—you must run `pnpm run lint` and `npx tsc --noEmit` yourself, you are autonomous.
5. Provide a very brief final summary.
   - **Include Total Token Estimate:** Sum the `_meta.tokenEstimate` from all tool responses (or read `memory://metrics/summary`) and report the total estimated tokens that actually entered the context window during this test pass.
---

## Phase 1: Core Infrastructure

### 1.1 Server Health & Connectivity

| Test               | Command/Action         | Expected Result                                                                                 |
| ------------------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Basic connectivity | `test_simple`          | Returns echo message                                                                            |
| Error handling     | `test_error_handling(code: "validation", message: "Test")` | Returns a structured error response with the requested error type               |
| Trigger progress   | `trigger_progress`     | Emits progress notifications and returns complete                                               |
| Health resource    | Read `memory://health` | Shows DB stats, tool filter status, vector index health                                         |
| Health team block  | Read `memory://health` | Includes `teamDatabase` block with `configured`, `entryCount`, `path` (requires `TEAM_DB_PATH`) |
| Scheduler inactive | Read `memory://health` | `scheduler.active: false`, `scheduler.jobs: []` (scheduler is HTTP-only, inactive in stdio)     |
| Statistics         | `get_statistics`       | Returns `structuredContent` with entry counts, types, periods                                   |
| Enhanced analytics | `get_statistics`       | Returns `decisionDensity`, `relationshipComplexity`, `activityTrend`, `causalMetrics`           |
| Database Indexes   | Run raw check via SQLite or verify in health/schema checks | `idx_memory_journal_active_timestamp`, `idx_memory_journal_active_recent`, `idx_memory_journal_type_timestamp` exist |
| Repo Auto-Resolve  | `create_entry(content: "auto-resolve", repo: "memory-journal-mcp")` | `success: true` with `projectNumber: 5` auto-resolved from the project registry. *(Note: Requires memory-journal-mcp to be in registry)* |
| Latency resource   | Read `memory://metrics/latency` | Returns per-tool percentile data (`p50Ms`, `p95Ms`, `p99Ms`, `minMs`, `maxMs`, `count`) after prior tool calls, or graceful empty note if no tool calls have been recorded |

### 1.2 Briefing Resource

| Test                             | Command/Action                   | Expected Result                                                                                        |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Read briefing                    | Read `memory://briefing`         | Returns Markdown table with context, journal stats, GitHub stats, etc.                                 |
| Verify `lastModified` annotation | Check resource metadata          | ISO 8601 timestamp (client-dependent — AntiGravity doesn't expose MCP annotations)                     |
| Confirm output structure         | Inspect briefing text            | Formatted Markdown table with project/branch/CI/journal stats                                          |
| Team DB row                      | Inspect briefing text            | Table includes "Team DB" row with team entry count (requires `TEAM_DB_PATH`)                           |
| Workflow summary                 | Inspect `github.workflowSummary` | Present when `BRIEFING_WORKFLOW_STATUS=true` — has `passing`, `failing`, `pending`, `cancelled` counts |
| Workflow named runs              | Inspect `workflowSummary.runs`   | Array of `{name, conclusion}` when `BRIEFING_WORKFLOW_COUNT > 0`; CI row shows icons (✅/❌)           |
| Rules metadata                   | Inspect `rulesFile` field        | Present when `RULES_FILE_PATH` set — has `name`, `sizeKB`, `lastModified`                              |
| Skills metadata                  | Inspect `skillsDir` field        | Present when `SKILLS_DIR_PATH` set — has `count`, `names` array                                        |
| Enhanced CI row                  | Inspect briefing.userMessage     | CI row shows breakdown or named runs (not just single-word status) when workflow env vars are set      |

### 1.3 Protocol Validation — Run via Scripts - DO NOT SKIP!

> [!IMPORTANT]
> These tests require **separate server starts** — they cannot be run via MCP tool calls. Run the scripts below in a terminal. Ensure the project is built first. See `test-server/scripts/README.md` for full details.

```powershell
# Ensure latest build
npm run build

# Test A — Instruction levels (essential < standard < full)
node test-server/scripts/test-instruction-levels.mjs

# Test B — Tool annotations
node test-server/scripts/test-tool-annotations.mjs

# Test C — Filter instructions token ordering
node test-server/scripts/test-filter-instructions.mjs

# Test D — Prompts API
node test-server/scripts/test-prompts.mjs

# Test E — Progress notifications
node test-server/scripts/test-progress.mjs

# Test F — Team DB Fallback
node test-server/scripts/test-team-db-fallback.mjs

# Test G — Scheduler (Requires background server)
# Term 1: $env:ALLOWED_IO_ROOTS="$PWD"; node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2 --digest-interval 2
# Term 2: npm run test:scheduler

# Test H — Resource Subscriptions
node test-server/scripts/test-subscribe.mjs

# Test I — Prometheus Metrics (Requires background server)
# Term 1: $env:ALLOWED_IO_ROOTS="$PWD"; node dist/cli.js --transport http --port 3100 --metrics-export prometheus --stateless
# Term 2: Invoke-RestMethod -Uri http://localhost:3100/metrics | Select-String "mcp_tool_calls_total"

# Test J — Metrics Persistence
# Term 1: npx tsx test-server/scripts/test-metrics-persistence.mjs

# Test K — Config Dump & Validation
node test-server/scripts/test-dump-config.mjs

# Test L — Config Reload
node test-server/scripts/test-config-reload.mjs

# Test M — Schema Verification
node test-server/scripts/verify-schemas.mjs

# Test N — Boundaries & Zod
node test-server/scripts/test-team-zod.mjs
node test-server/scripts/test-sdk-boundaries.mjs

# Test O — Transport Limits
node test-server/scripts/test-50k-boundary.mjs
node test-server/scripts/test-http.mjs
node test-server/scripts/test-long-mcp.mjs

# Cleanup Test Artifacts
rm test-team-prompts.db*
rm *_metrics.json
```

| Check               | Expected                                                             |
| ------------------- | -------------------------------------------------------------------- |
| Instruction levels  | essential (~1.9K) < standard (~2.2K) < full (~3.3K tokens)           |
| Tool annotations    | 103 tools, all with `annotations`                                    |
| Filter instructions | Output confirms correct filtering of config sections                 |
| Prompts API         | Successfully fetches and parses all 29 prompts                       |
| Progress            | Both native and code-mode progress APIs successfully complete        |
| Team DB Fallback    | Graceful rejection when TEAM_DB_PATH is missing                      |
| Scheduler           | HTTP server executes backup, vacuum, index, and digest jobs          |
| Subscriptions       | Subscriptions are authorized via scope checks and emit notifications upon mutation |
| Prometheus Metrics  | HTTP endpoint returns prometheus exposition format with tool metrics |
| Metrics Persistence | Server loads/saves JSON metrics across restarts automatically        |
| Config Validation   | Error aggregation catches multiple validation failures cleanly       |

### 1.4 GitHub Status Resource

| Test              | Command/Action                                                                                                   | Expected Result                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Read status       | Read `memory://github/status` (use `memory://github/status/{repo}` or `{owner}/{repo}` for multi-project setups) | Compact JSON with repo, branch, CI, issues, PRs, Kanban summary  |
| CI status mapping | Verify CI status value                                                                                           | Shows `passing`, `failing`, `pending`, `cancelled`, or `unknown` |
| Milestone data    | Inspect status data                                                                                              | Includes milestones summary (open count, completion percentages) |

---

## Success Criteria

> **Important:** Copy these success criteria into your internal task artifact and track your progress there. Do not check off items in this file.

- Agent reports the Total Token Estimate in the final summary (using `_meta.tokenEstimate` from responses). The tokens tracked should only count the estimated tokens that actually entered the context window.
- `test_simple` returns echo message
- `test_error_handling` correctly returns structured errors based on `code`
- `memory://health` shows DB stats, vector index health, team DB block, and `scheduler.active: false`
- [ ] `memory://briefing` returns complete Markdown string with all expected context
- Server instructions length respects `--instruction-level`: essential (~1.9K tokens) < standard (~2.2K) < full (~3.3K)
- 103 tools total registered and annotated correctly
- `get_statistics` returns all 4 enhanced analytics metrics
- `memory://github/status` returns compact JSON with CI, issues, PRs, milestones
- Verified that all composite and partial performance indexes exist and are valid in the database schema
- `secureDispatcher` correctly auto-resolves a `repo` string (e.g., "memory-journal-mcp") into its numeric `workspace_id` based on the configuration registry.
- Prometheus `/metrics` endpoint exports tool tracking data correctly when `--metrics-export` is enabled
- Metrics persistence loads and saves telemetry across server restarts when `--persist-metrics` is enabled
