# Memory Journal MCP Test Server — Agent Testing Instructions

> **This README is optimized for AI agent consumption.** It serves as the primary orchestration document for running manual MCP functionality tests against the `memory-journal-mcp` service. Test `.db` files in this directory are `.gitignore`d.

## Files

| File | Size | Purpose | When to Read |
|------|------|---------|--------------|
| `test-tools.md` | ~58KB | **Pass 1: Core Functionality** — Phases 1-10 covering happy paths, error paths, and feature verification for all 44 tools, 22 resources, and scheduler | Always read first |
| `test-tools2.md` | ~37KB | **Pass 2: Validation & Edge Cases** — Phases 11-15 covering outputSchema validation, structured error verification, data integrity, boundary values, and implementation bug detection | After Pass 1 completes |
| `test-tools-codemode.md` | ~12KB | **Pass 3: Code Mode** — Phases 16-21 covering sandbox execution, API discoverability, multi-step workflows, readonly mode, error handling, and cross-group orchestration | After Pass 1 completes |
| `tool-reference.md` | ~8KB | **Tool Reference** — Categorized list of all 44 tools across 10 groups | Reference |
| [`code-map.md`](code-map.md) | ~10KB | **Source Code Map** — Directory tree, handler→tool mapping, type locations, error handling, constants, architecture patterns. | When debugging source code or making changes |

## Conventions & Protocols

| Convention | Rule |
|------------|------|
| **Reporting** | ❌ Fail, ⚠️ Issue, 📦 Payload. ✅ inline only, omit from final summary. |
| **Error testing** | Must return `{success: false, error: "..."}`, NOT raw MCP error exceptions. |
| **Error items in checklists** | Marked with 🔴 prefix |
| **Post-test** | Clean up test databases/data → plan fixes → implement → lint+typecheck → changelog → commit (no push) |

## Connection Details & Portability

The SQLite database path for `memory-journal-mcp` is entirely portable and **does not require code changes**. 

The server initializes its database locations using **Smart Path Resolution**:
1. If `--db` or `DB_PATH` is passed explicitly, it is used immediately.
2. If `memory_journal.db` exists in the root directory, it is used.
3. If `test-server/test-memory-journal.db` exists, it falls back to this test database automatically.
4. If neither exist, it creates a new `memory_journal.db` in the root.

*(The identical fallback pattern applies to `--team-db` / `TEAM_DB_PATH` / `test-team-journal.db`)*.

### Automated Test Artifacts

When you run automated testing (e.g., `npm run test:e2e` or `vitest`), the test suites will natively generate and drop isolated database artifacts directly into this `test-server/` directory instead of the project root. 
- `test-e2e.db`
- `test-e2e-auth.db`
- `test-e2e-stateless.db`
- `test-isolation-dir/`

**You do NOT need to maintain a copy of your real journal database here.** The test prompts and automated suites are designed for "from-scratch" database workflows.

## Agent Workflow

1. Read `src/constants/server-instructions.md` (via `view_file` tool).
2. Read `test-tools.md` for Pass 1 protocol, phases, and success criteria.
3. Execute via direct MCP tool calls. Run both happy-path and 🔴 error-path tests.
4. Provide manual cleanup (e.g., deleting test nodes) if testing stateful behavior. 
5. Report findings returning proper handler formatting.
6. (Optional) Run Pass 2 from `test-tools2.md` after Pass 1 completes successfully.
7. (Optional) Run Pass 3 from `test-tools-codemode.md` for Code Mode sandbox testing.

## Troubleshooting

### SQLite database locked

The `memory-journal-mcp` uses `sql.js` (pure JS SQLite). Lock errors are rare but can occur if multiple processes access the same `.db` file:

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

