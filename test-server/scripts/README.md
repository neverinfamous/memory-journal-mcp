# Test Scripts

> **This README is optimized for AI agent consumption.**

Runtime MCP server and transport integration checks previously in this directory have been migrated into automated Vitest and Playwright suites:

- **Vitest invariants & filter/instruction checks:** [tool-annotations.test.ts](../../tests/handlers/tool-annotations.test.ts), [tool-output-schemas.test.ts](../../tests/handlers/tool-output-schemas.test.ts), [filter-instructions.test.ts](../../tests/server/filter-instructions.test.ts), and [observability-and-resources.test.ts](../../tests/unit/observability-and-resources.test.ts).
- **Playwright E2E transport & CLI checks:** [boundary.spec.ts](../../tests/e2e/boundary.spec.ts), [stdio-transport.spec.ts](../../tests/e2e/stdio-transport.spec.ts), [tools.spec.ts](../../tests/e2e/tools.spec.ts), [cli-commands.spec.ts](../../tests/e2e/cli-commands.spec.ts), [config-parsing.spec.ts](../../tests/e2e/config-parsing.spec.ts), [subscriptions.spec.ts](../../tests/e2e/subscriptions.spec.ts), [progress-notifications.spec.ts](../../tests/e2e/progress-notifications.spec.ts), [prompts.spec.ts](../../tests/e2e/prompts.spec.ts), [prompts-expanded.spec.ts](../../tests/e2e/prompts-expanded.spec.ts), [payloads-team.spec.ts](../../tests/e2e/payloads-team.spec.ts), and [security.spec.ts](../../tests/e2e/security.spec.ts).

> [!IMPORTANT]
> Run `pnpm test` for Vitest invariants and `pnpm run test:e2e` (after `pnpm run build`) for Playwright E2E specs.
> `test-server-config.json` is data validated automatically by [filter-instructions.test.ts](../../tests/server/filter-instructions.test.ts). Node 26 cannot execute the JSON file.

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
