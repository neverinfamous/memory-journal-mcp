# Test Scripts

> **This README is optimized for AI agent consumption.**

This directory contains standalone Node.js integration tests for `memory-journal-mcp` that verify behavior outside of standard MCP tool invocation boundaries (like transport layers, command-line arguments, tool annotations, or background jobs).

> [!IMPORTANT]
> Most scripts execute `dist/cli.js` directly. Build first with `pnpm run build`.
> Writes in these scripts use workspace `memory-journal-mcp` and `project_number` 5, the pair registered for this repo.
> `test-server-config.json` is data. Run `node test-server/scripts/test-server-config.mjs`. Node 26 cannot execute the JSON file.

## Scripts Index

| Script                         | Tests                                                                                                                                     | Transport     | Duration |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| `verify-schemas.mjs`           | Every tool except `mj_execute_code` advertises `outputSchema` (107 of 108; Code Mode has no fixed schema)                                 | stdio         | ~25s     |
| `test-tool-annotations.mjs`    | Full `tools/list` annotation audit for all 108 tools (hints, titles, destructive and read-only allowlists)                                | stdio         | ~25s     |
| `test-prompts.mjs`             | `prompts/list` + `prompts/get` for all 32 prompts (shape + errors)                                                                        | stdio         | ~10s     |
| `test-scheduler.mjs`           | Scheduler job execution (backup, vacuum, rebuild-index). Requires a separate HTTP server; see below.                                      | HTTP stateful | ~130s    |
| `test-progress.mjs`            | Two-phase progress notification test: (1) native tool progress via `export_entries`, (2) Code Mode `mj.reportProgress()` sandbox binding. | stdio         | ~8s      |
| `test-team-db-fallback.mjs`    | A missing `TEAM_DB_PATH` rejects team-scoped requests instead of crashing the server.                                                     | stdio         | ~1s      |
| `test-50k-boundary.mjs`        | `create_entry` accepts a 50,000-character string over stdio.                                                                              | stdio         | ~40s     |
| `test-team-zod.mjs`            | Team tools return structured JSON-RPC results for invalid Zod input instead of a raw protocol crash.                                      | stdio         | ~25s     |
| `test-sdk-boundaries.mjs`      | Invalid argument types return a tool result. The invalid team entry type is accepted; boolean and array `content` are rejected.           | stdio         | ~60s     |
| `test-http.mjs`                | HTTP transport accepts 50,000 characters and rejects 100,001 characters.                                                                  | HTTP          | ~60s     |
| `test-long-mcp.mjs`            | Stdio client transport accepts 50,000 characters and rejects 100,001 characters.                                                          | stdio         | ~45s     |
| `test-subscribe.mjs`           | `resources/subscribe` on `memory://briefing` emits `notifications/resources/updated` after a mutation, and stays quiet after unsubscribe.  | stdio         | ~50s     |
| `test-config-reload.mjs`       | Hot-reload and persistence of server configuration files (`json`/`yaml`) via `update_configuration`.                                      | stdio         | ~5s      |
| `test-dump-config.mjs`         | `--dump-config` redacts sensitive environment variables and resolves config successfully.                                                 | pipe          | ~1s      |
| `test-metrics-persistence.mjs` | `MetricsAccumulator` persists and reloads metrics when `--persist-metrics` is set.                                                        | internal      | ~1s      |
| `test-server-config.mjs`       | `test-server-config.json` is valid and defines `testDbPath` and `testTeamDbPath`. Does not start the server.                              | none          | ~1s      |
| `test-filter-instructions.mjs` | Each `--tool-filter` includes the expected instruction sections and reports token estimates. Uses `test-server-config.json` via `--config`. | stdio         | ~90s     |

## Scheduler Notes

The `test-scheduler.mjs` script requires an active HTTP server with aggressive timing configuration to be running in another terminal.

```powershell
# Terminal 1: Background server
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2

# Terminal 2: Test script
node test-server/scripts/test-scheduler.mjs
```

## Maintenance helpers

These files do not start the MCP server. They check the test-suite map or rewrite prompt files.

| File | Purpose |
| ---- | ------- |
| `test-server-config.json` | Shared config consumed by `MEMORY_JOURNAL_CONFIG` or `--config`. Not a Node program. |
| `tool-map.json` | Maps each tool name to the test files that cover it. |
| `prompt-template.md` | Template used when standardizing generated test prompts. |
| `validate-tools.mjs` | Compares `test-server/tool-reference.md` with `tool-map.json`. Exits 1 when either side has a tool the other lacks. |
| `check-counts.mjs` | Prints usability files that reference more than five tools. |
| `check-coverage.mjs` | Compares an SSoT mapping file (`argv[2]` or `SSOT_MAPPING_PATH`) with `tool-map.json`, including usability coverage. Skips `mj_execute_code`. |
| `standardize-prompts.mjs` | Rewrites test prompt files from `tool-map.json` and `prompt-template.md`. |
