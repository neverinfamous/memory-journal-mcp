# Memory Journal MCP Test Server — Agent Testing Instructions

> **This README is optimized for AI agent consumption.** It serves as the primary orchestration document for running manual MCP functionality tests against the `memory-journal-mcp` service. Test `.db` files in this directory are `.gitignore`d.

## Files

| File                              | Purpose                                                                                                                                               | When to Read          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| [`standard/`](standard/README.md) | **Standard Modular Tests** — Directory containing modular test files across feature and stress-test tiers. See `standard/coordinator-workflow.md` for full list. | **Always start here** |
| [`codemode/`](codemode/README.md) | **Code Mode Sandbox Tests** — Directory containing phase-aligned Code Mode test prompts. See `codemode/coordinator-workflow.md` for full list.                   | After standard tests  |
| [`usability/`](usability/README.md) | **Usability & Hallucination Tests** — Directory containing organic testing prompts to explicitly trigger agent hallucinations. See `usability/coordinator-workflow.md` for full list. | After standard tests  |

| `test-preflight.md` | **Pre-flight check** — validates tiered instructions, resources, and tool-filter alignment in 5 steps | Before any test pass |
| [`tool-reference.md`](tool-reference.md) | **Tool Reference** — Categorized list of all tools across 11 groups + codemode | Reference |
| [`code-map.md`](code-map.md) | **Source Code Map** — Directory tree, handler→tool mapping, type locations, error hierarchy, key constants, architecture patterns | When debugging source code or making changes |

## Automated Protocol & Transport Suites

These suites verify features that run at server startup or across transport/wiring boundaries using automated Vitest and Playwright runners.

> [!IMPORTANT]
> Always `pnpm run build` before running Playwright specs (`tests/e2e/` executes `dist/cli.js`).

### Suite Reference

| Suite / Command | Tests | Runner |
| --- | --- | --- |
| `tests/server/filter-instructions.test.ts` | Filter-aware instructions, `--codemode-internal-full-access`, and `memory://help` index across all 9 presets | Vitest |
| `tests/handlers/tool-annotations.test.ts` | Full `108`-tool behavioral annotation hints, contradictions, and canonical allowlists | Vitest |
| `pnpm run test:prompts` (`prompts.spec.ts` + `prompts-expanded.spec.ts`) | `prompts/list` + `prompts/get` for all 31 prompts (shape + error handling) | Playwright |
| `pnpm test` & `pnpm run test:e2e` | Full Vitest + Playwright suite (schemas, CLI config dump/reload, subscriptions, progress, HTTP/stdio boundaries) | Vitest + Playwright |

### Quick Run

```powershell
cd /path/to/memory-journal-mcp
pnpm run build

# Instruction filtering & tool annotations (Vitest)
pnpm exec vitest run tests/server/filter-instructions.test.ts tests/handlers/tool-annotations.test.ts

# Prompt handlers (Playwright)
pnpm run test:prompts

# Full automated Playwright E2E suite
pnpm run pretest:e2e; pnpm run test:e2e
```

### Dual Transport Notes

The server supports three transport modes:

| Mode           | CLI Flags                      | Sessions                 |
| -------------- | ------------------------------ | ------------------------ |
| stdio          | `--transport stdio` (default)  | N/A                      |
| HTTP stateful  | `--transport http`             | `mcp-session-id` header  |
| HTTP stateless | `--transport http --stateless` | No sessions (serverless) |

## Success Criteria

### Instruction Levels (Phase 1.3A)

- [ ] essential < standard < full (strict token ordering)
- [ ] No runtime errors in server logs

### Filter-Aware Instructions (Phase 1.3B)

- [ ] 8/8 filter configs pass section presence/absence checks
- [ ] Dynamic help resources (`memory://help/*`) accurately reflect enabled groups
- [ ] `full (all groups)` — all tools and sections
- [ ] `codemode only` — all tools/groups exposed due to sandbox access
- [ ] `essential` — all tools/groups exposed due to sandbox access
- [ ] `starter` — all tools/groups exposed due to sandbox access
- [ ] `core only` — CORE + Help, NO code mode or other tools
- [ ] `full -codemode` — CORE + Help, NO code mode
- [ ] `full -github` — all tools/groups exposed due to sandbox access
- [ ] `readonly` — all tools/groups exposed due to sandbox access

### Tool Annotations (Phase 1.3C)

- [ ] all tools returned, all with `annotations` object
- [ ] Tools correctly categorized by `openWorldHint` with 0 missing

## Conventions & Protocols

| Convention                    | Rule                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Reporting**                 | ❌ Fail, ⚠️ Issue, 📦 Payload. ✅ inline only, omit from final summary.                                              |
| **Error testing**             | Must return `{success: false, error: "...", code, category, suggestion, recoverable}`, NOT raw MCP error exceptions. |
| **Error items in checklists** | Marked with 🔴 prefix                                                                                                |
| **Post-test**                 | Clean up test databases/data → plan fixes → implement → lint+typecheck → changelog → commit (no push)                |

> **Note**: When updating schemas or validation logic, please refer to the `/zod` skill for best practices on Standard Schema and Safe Parsing.

## Connection Details & Portability

The SQLite database path for `memory-journal-mcp` is entirely portable and **does not require code changes**.

The server initializes its database locations based on the following precedence:

1. If `--db` or `DB_PATH` is passed explicitly, it is used immediately.
2. If neither exist, it creates a new `memory_journal.db` in the root directory.

_(The identical fallback pattern applies to `--team-db` / `TEAM_DB_PATH` which defaults to being disabled)_.

### Automated Test Artifacts

When you run automated testing (e.g., `pnpm run test:e2e` or `vitest`), the test suites generate isolated database artifacts into the `.test-output/` directory (gitignored):

- `.test-output/e2e/test-e2e.db`
- `.test-output/e2e/test-e2e-auth.db`
- `.test-output/e2e/test-e2e-stateless.db`
- `.test-output/e2e/test-isolation-dir/`

**You do NOT need to maintain a copy of your real journal database here.** The test prompts and automated suites are designed for "from-scratch" database workflows.

## Agent Workflow

1. Read the server instructions you received during initialization, then `memory://briefing`.
2. Navigate to the `standard/` directory and **always run `standard/test-seed.md` first** — all other test files depend on it.
3. See `standard/coordinator-workflow.md` for the complete sequence queue and dependency DAG. You may run them in the specified order or individually if their dependencies are met.
4. **Run automated protocol suites** for instruction filtering, tool annotations, and prompts (see Automated Protocol & Transport Suites above).
5. Provide manual cleanup (e.g., deleting test nodes) if testing stateful behavior.
6. Report findings returning proper handler formatting.
7. (Optional) Run Code Mode tests from `codemode/` — see `codemode/coordinator-workflow.md` for the module list and dependency DAG.

## Troubleshooting

### SQLite database locked

The `memory-journal-mcp` uses `better-sqlite3` (native SQLite) in WAL mode. Lock errors are uncommon but can occur if multiple processes access the same `.db` file:

1. Stop all MCP server instances accessing the database
2. Delete any `*.db-journal` or `*.db-wal` files alongside the database
3. Restart a single server instance

### GitHub tools return "Could not auto-detect repository"

1. Verify `PROJECT_REGISTRY` is configured in `mcp_config.json` env as a JSON object, not a single repo path string
2. Ensure the selected registry entry for the target repository includes a `path` field (and optionally `project_number`)
3. Verify that entry's `path` points to a valid git checkout with a `.git` folder and a valid `origin` remote
4. Alternatively, pass `owner` and `repo` parameters explicitly in tool calls

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
