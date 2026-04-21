# Test Scripts

> **This README is optimized for AI agent consumption.**

This directory contains standalone Node.js integration tests for `memory-journal-mcp` that verify behavior outside of standard MCP tool invocation boundaries (like transport layers, command-line arguments, tool annotations, or background jobs).

> [!IMPORTANT]
> The scripts execute `dist/cli.js` directly. Always ensure your code is built (`npm run build`) before executing these scripts.

## Scripts Index

| Script                         | Tests                                                                                                                                 | Transport     | Duration |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| `check-schemas.mjs`            | `tools/list` validates that all tools (except `mj_execute_code`) contain a properly serialized `outputSchema` definition              | stdio         | ~5s      |
| `cleanup-seed-data.mjs`        | Whitelist-driven database maintenance utility replacing tests/seed artifacts while protecting real projects (#5, #13) and base seeds. | direct SQLite | ~1s      |
| `test-admin-zod.mjs`           | Validates that the Admin tool group correctly processes empty schemas and mismatched types via strict Zod handling.                   | stdio         | ~5s      |
| `test-instruction-levels.mjs`  | `--instruction-level` essential/standard/full token ordering                                                                          | stdio         | ~10s     |
| `test-filter-instructions.mjs` | Filter-aware sections — validates each `--tool-filter` config includes/excludes correct sections + reports token estimates per filter | stdio         | ~90s     |
| `test-tool-annotations.mjs`    | `tools/list` openWorldHint annotation counts (45 false + 22 true = 67)                                                                | stdio         | ~5s      |
| `test-prompts.mjs`             | `prompts/list` + `prompts/get` for all 16 prompts (shape + errors)                                                                    | stdio         | ~10s     |
| `test-scheduler.mjs`           | Scheduler job execution (backup, vacuum, rebuild-index)                                                                               | HTTP stateful | ~130s    |
| `test-team-db-fallback.mjs`    | Verifies the MCP server gracefully handles a missing `TEAM_DB_PATH` environment variable by safely rejecting team-scoped requests.    | stdio         | ~1s      |

## Scheduler Notes

The `test-scheduler.mjs` script requires an active HTTP server with aggressive timing configuration to be running in another terminal.

```powershell
# Terminal 1: Background server
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2

# Terminal 2: Test script
node test-server/scripts/test-scheduler.mjs
```


