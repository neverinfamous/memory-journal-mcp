# Memory Journal MCP Test Server — Agent Testing Instructions

> **This README is optimized for AI agent consumption.** It serves as the primary orchestration document for running manual MCP functionality tests against the `memory-journal-mcp` service. Test `.db` files in this directory are `.gitignore`d.

## Files

| File                              | Purpose                                                                                                                             | When to Read          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`standard/`](standard/README.md) | **Standard Modular Tests** — Directory containing 14 core modular test files. See `standard/README.md` for full list.               | **Always start here** |
| [`codemode/`](codemode/README.md) | **Code Mode Sandbox Tests** — Directory containing 14 phase-aligned Code Mode test prompts. See `codemode/README.md` for full list. | After standard tests  |

| `test-preflight.md` | **Pre-flight check** — validates tiered instructions, resources, and tool-filter alignment in 5 steps | Before any test pass |
| [`tool-reference.md`](tool-reference.md) | **Tool Reference** — Categorized list of all 61 tools across 11 groups | Reference |
| [`code-map.md`](code-map.md) | **Source Code Map** — Directory tree, handler→tool mapping, type locations, error hierarchy, key constants, architecture patterns | When debugging source code or making changes |

## Integration Test Scripts

These scripts test features that require separate server processes — they **cannot** be run via MCP tool calls. All scripts are Node.js (`.mjs`), require no dependencies beyond Node.js, and exit with code 0 on success.

> [!IMPORTANT]
> Always `npm run build` before running these scripts — they execute `dist/cli.js` directly.

### Script Reference

| Script                                 | Tests                                                                                                                                 | Transport     | Duration |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| `scripts/test-instruction-levels.mjs`  | `--instruction-level` essential/standard/full token ordering                                                                          | stdio         | ~10s     |
| `scripts/test-filter-instructions.mjs` | Filter-aware sections — validates each `--tool-filter` config includes/excludes correct sections + reports token estimates per filter | stdio         | ~90s     |
| `scripts/test-tool-annotations.mjs`    | `tools/list` openWorldHint annotation counts (45 false + 16 true = 61)                                                                | stdio         | ~5s      |
| `scripts/test-prompts.mjs`             | `prompts/list` + `prompts/get` for all 16 prompts (shape + errors)                                                                    | stdio         | ~10s     |
| `scripts/test-scheduler.mjs`           | Scheduler job execution (backup, vacuum, rebuild-index)                                                                               | HTTP stateful | ~130s    |

### Quick Run

```powershell
cd C:\Users\chris\Desktop\memory-journal-mcp
npm run build

# Phase 1.3A — Instruction levels
node test-server/scripts/test-instruction-levels.mjs

# Phase 1.3B — Filter-aware instruction sections + token estimates
node test-server/scripts/test-filter-instructions.mjs

# Phase 1.3C — Tool annotations
node test-server/scripts/test-tool-annotations.mjs

# Phase 8 — Prompt handlers
node test-server/scripts/test-prompts.mjs

# Phase 9 — Scheduler (requires HTTP server in a separate terminal)
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2
# In another terminal:
node test-server/scripts/test-scheduler.mjs
```

### Scheduler Script Options

| Env Variable   | Default                     | Description                                                          |
| -------------- | --------------------------- | -------------------------------------------------------------------- |
| `MCP_URL`      | `http://localhost:3099/mcp` | HTTP endpoint URL                                                    |
| `WAIT_SECONDS` | `130`                       | Seconds to wait for jobs to fire (set to `0` for initial check only) |

### Dual Transport Notes

The server supports three transport modes:

| Mode           | CLI Flags                      | Scheduler   | Sessions                 |
| -------------- | ------------------------------ | ----------- | ------------------------ |
| stdio          | `--transport stdio` (default)  | ❌ Inactive | N/A                      |
| HTTP stateful  | `--transport http`             | ✅ Active   | `mcp-session-id` header  |
| HTTP stateless | `--transport http --stateless` | ✅ Active   | No sessions (serverless) |

The scheduler activates in **both** HTTP modes. The test script handles SSE response parsing automatically (HTTP transport returns `text/event-stream`). In stateless mode, there are no sessions so each request is independent — the scheduler still runs but session-scoped resources behave differently.

## Success Criteria

### Instruction Levels (Phase 1.3A)

- [ ] essential (~1.2K tokens) < standard (~1.4K) < full (~6.7K)
- [ ] No runtime errors in server logs

### Filter-Aware Instructions (Phase 1.3B)

- [ ] 9/9 filter configs pass section presence/absence checks
- [ ] `full` includes CORE + COPILOT + CODE_MODE + GITHUB_INTEGRATION + SEARCH_ROW (~1790 tokens)
- [ ] `codemode` omits COPILOT + GITHUB_INTEGRATION + SEARCH_ROW (~1190 tokens)
- [ ] `essential` — CORE + CODE_MODE only (~1214 tokens)
- [ ] `starter` — CORE + CODE_MODE + SEARCH_ROW (~1250 tokens)
- [ ] `core` — CORE only (~759 tokens)
- [ ] `full -codemode` — COPILOT + GITHUB_INTEGRATION + SEARCH_ROW, no CODE_MODE (~1147 tokens)
- [ ] `full -github` — CODE_MODE + SEARCH_ROW, no COPILOT/GITHUB_INTEGRATION (~1391 tokens)
- [ ] `readonly` — CORE + SEARCH_ROW, no CODE_MODE/COPILOT/GITHUB_INTEGRATION (~771 tokens)
- [ ] `full --instruction-level essential` — omits GITHUB_INTEGRATION but keeps COPILOT + CODE_MODE (~1582 tokens)

### Tool Annotations (Phase 1.3C)

- [ ] 61 tools returned, all with `annotations` object
- [ ] 45 tools with `openWorldHint: false`, 16 with `openWorldHint: true`, 0 missing

### Scheduler (Phase 9)

- [ ] `memory://health` shows `scheduler.active: false` and empty `jobs` array in stdio mode
- [ ] Server logs confirm scheduler started with correct intervals
- [ ] `memory://health` shows all 3 jobs active with `nextRun` timestamps
- [ ] Backup job creates timestamped `.db` files and prunes to `--keep-backups` limit
- [ ] Vacuum job logs `PRAGMA optimize` completion
- [ ] Rebuild-index job logs vector index rebuild with entry count
- [ ] All `lastResult` values are `"success"` after jobs fire
- [ ] `lastError` remains `null` for all jobs
- [ ] Error in one job does not prevent others from running

## Conventions & Protocols

| Convention                    | Rule                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Reporting**                 | ❌ Fail, ⚠️ Issue, 📦 Payload. ✅ inline only, omit from final summary.                                              |
| **Error testing**             | Must return `{success: false, error: "...", code, category, suggestion, recoverable}`, NOT raw MCP error exceptions. |
| **Error items in checklists** | Marked with 🔴 prefix                                                                                                |
| **Post-test**                 | Clean up test databases/data → plan fixes → implement → lint+typecheck → changelog → commit (no push)                |

## Connection Details & Portability

The SQLite database path for `memory-journal-mcp` is entirely portable and **does not require code changes**.

The server initializes its database locations using **Smart Path Resolution**:

1. If `--db` or `DB_PATH` is passed explicitly, it is used immediately.
2. If `memory_journal.db` exists in the root directory, it is used.
3. If `test-server/test-memory-journal.db` exists, it falls back to this test database automatically.
4. If neither exist, it creates a new `memory_journal.db` in the root.

_(The identical fallback pattern applies to `--team-db` / `TEAM_DB_PATH` / `test-team-journal.db`)_.

### Automated Test Artifacts

When you run automated testing (e.g., `npm run test:e2e` or `vitest`), the test suites generate isolated database artifacts into the `.test-output/` directory (gitignored):

- `.test-output/e2e/test-e2e.db`
- `.test-output/e2e/test-e2e-auth.db`
- `.test-output/e2e/test-e2e-stateless.db`
- `.test-output/e2e/test-isolation-dir/`

**You do NOT need to maintain a copy of your real journal database here.** The test prompts and automated suites are designed for "from-scratch" database workflows.

## Agent Workflow

1. Read the server instructions you received during initialization, then `memory://briefing`.
2. Navigate to the `standard/` directory and **always run `standard/test-seed.md` first** — all other test files depend on it.
3. Run any combination of the independent test files in `standard/` (`test-core-*.md`, `test-schemas.md`, `test-resources.md`, `test-github.md`, `test-tool-group-*.md`, `test-team.md`).
4. Each file is self-contained — pick the one relevant to your current task or run them in any order.
5. **Run integration test scripts** for instruction levels, annotations, prompts, and scheduler (see Script Reference above).
6. Provide manual cleanup (e.g., deleting test nodes) if testing stateful behavior.
7. Report findings returning proper handler formatting.
8. (Optional) Run Code Mode tests from `codemode/` — see `codemode/README.md` for the 14-file module list and dependency DAG.

## Troubleshooting

### SQLite database locked

The `memory-journal-mcp` uses `better-sqlite3` (native SQLite) in WAL mode. Lock errors are uncommon but can occur if multiple processes access the same `.db` file:

1. Stop all MCP server instances accessing the database
2. Delete any `*.db-journal` or `*.db-wal` files alongside the database
3. Restart a single server instance

### GitHub tools return "Could not auto-detect repository"

1. Verify `GITHUB_REPO_PATH` is set in `mcp_config.json` env
2. Verify the path points to a directory with a `.git` folder and a valid `origin` remote
3. Alternatively, pass `owner` and `repo` parameters explicitly in tool calls

### GitHub tools return 401/403

1. Verify `GITHUB_TOKEN` is set and not expired
2. Required scopes: `repo`, `project`, `read:org` (for org-level project discovery)
3. For traffic/insights data, the token needs push access to the repository

### Vector search returns no results

1. Run `rebuild_vector_index` to re-index all entries
2. Check `get_vector_index_stats` — if `itemCount: 0`, the index is empty
3. The first index build triggers ML model download (~30MB) — verify network access

### Team tools return "Team database not configured"

Set `TEAM_DB_PATH` in `mcp_config.json` env or via `--team-db` CLI flag. The path can be any writable location.
