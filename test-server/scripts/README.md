# Test Scripts

> **This README is optimized for AI agent consumption.**

This directory contains standalone Node.js integration tests for `memory-journal-mcp` that verify behavior outside of standard MCP tool invocation boundaries (like transport layers, command-line arguments, tool annotations, or background jobs).

> [!IMPORTANT]
> The scripts execute `dist/cli.js` directly. Always ensure your code is built (`npm run build`) before executing these scripts.

## Scripts Index

| Script                         | Tests                                                                                                                                     | Transport     | Duration |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- |
| `verify-schemas.mjs`           | `tools/list` validates that all tools (except `mj_execute_code`) contain a properly serialized `outputSchema` definition                  | stdio         | ~5s      |
| `test-instruction-levels.mjs`  | `--instruction-level` essential/standard/full token ordering                                                                              | stdio         | ~10s     |
| `test-filter-instructions.mjs` | Filter-aware sections — validates each `--tool-filter` config includes/excludes correct sections + reports token estimates per filter     | stdio         | ~90s     |
| `test-tool-annotations.mjs`    | `tools/list` openWorldHint annotation counts (45 false + 22 true = 67)                                                                    | stdio         | ~5s      |
| `test-prompts.mjs`             | `prompts/list` + `prompts/get` for all 16 prompts (shape + errors)                                                                        | stdio         | ~10s     |
| `test-scheduler.mjs`           | Scheduler job execution (backup, vacuum, rebuild-index)                                                                                   | HTTP stateful | ~130s    |
| `test-progress.mjs`            | Two-phase progress notification test: (1) native tool progress via `export_entries`, (2) Code Mode `mj.reportProgress()` sandbox binding. | stdio         | ~8s      |
| `test-team-db-fallback.mjs`    | Verifies the MCP server gracefully handles a missing `TEAM_DB_PATH` environment variable by safely rejecting team-scoped requests.        | stdio         | ~1s      |
| `test-50k-boundary.mjs`        | Validates that `create_entry` gracefully handles large string payloads (50,000 characters) via standard Node pipeline.                    | stdio         | ~1s      |
| `test-team-zod.mjs`            | Validates that the Team Tool group properly intercepts SDK-level Zod validation errors and returns structured JSON-RPC responses.         | stdio         | ~2s      |
| `test-http.mjs`                | Tests large payloads (50k/100k chars) via HTTP/fetch to ensure they don't break the HTTP transport boundary.                              | HTTP          | ~1s      |
| `test-long-mcp.mjs`            | Tests large payloads (50k/100k chars) via standard stdio client transport.                                                                | stdio         | ~1s      |
| `test-subscribe.mjs`           | Validates MCP real-time resource subscriptions, ensuring that mutating tools emit `notifications/resources/updated` via transport.        | stdio         | ~2s      |
| `test-config-reload.mjs`       | Tests hot-reloading and persistence of server configuration files (`json`/`yaml`) via the `update_configuration` tool.                    | stdio         | ~5s      |
| `test-dump-config.mjs`         | Tests the `--dump-config` CLI option to ensure sensitive environment variables are properly redacted and config resolution succeeds.      | pipe          | ~1s      |
| `test-metrics-persistence.mjs` | Integration test for the `MetricsAccumulator`, verifying `--persist-metrics` file persistence and reload logic.                           | internal      | ~1s      |

## Scheduler Notes

The `test-scheduler.mjs` script requires an active HTTP server with aggressive timing configuration to be running in another terminal.

```powershell
# Terminal 1: Background server
node dist/cli.js --transport http --port 3099 --backup-interval 1 --keep-backups 3 --vacuum-interval 2 --rebuild-index-interval 2

# Terminal 2: Test script
node test-server/scripts/test-scheduler.mjs
```
