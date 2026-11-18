
## Code Mode

API: `tool_name` → `mj.group.action()` (e.g., `search_entries` → `mj.search.searchEntries()`)
Top-Level Contract: `mj_execute_code({ code, workspace_id, project_number, repo, context, readonly, dry_run, auto_version, max_result_size, timeout })`
Globals: `createEntry()`, `find()`, `recent()`, `searchEntries()`, `deleteEntry()`, `help()` work without the `mj.` prefix.
Positional: `createEntry("note")`, `searchEntries("performance")`
Aliases: Common parameter hallucinations auto-normalize (`q`/`search`→`query`, `path`→`source_dir` on import / `output_dir` on export, `keep`→`keep_count`, `user`/`assignee`→`target_user`, `project`→`project_number`, `repo`/`repo_name`→`workspace_id` on core tools or `repo` on GitHub/git, `team`→`share_with_team`, `author` on team member tools).
Discovery: `mj.help()` → `{ groups, totalMethods, usage }`, `mj.core.help()`, and `await mj.<group>.<method>.schema()` (works even when `readonly: true`).
Anti-Hallucination: Always pass valid JS in `code` (e.g. `code: "return await mj.search.searchEntries({ query: '...' })"`). If `mj_execute_code` is called with an empty payload `{}` or missing `code`, Code Mode auto-heals by returning sandbox status and available namespaces; structured objects in `payload` or `entry` are also synthesized.
Sandbox: Network access (`fetch()`) is blocked with a 403 `VALIDATION_ERROR`, and `child_process`/`require()`/`import` are blocked. A deterministic `path` shim and a read-only virtual `fs` backed by `context.content` are exposed (`fs` writes throw `VALIDATION_ERROR`). Pass file contents or markdown via `context: { content }` rather than reading disk inside the sandbox. `setTimeout` and `sleep(ms)` are available for minor delays.
Readonly & Dry Run: Pass `readonly: true` to restrict execution to read-only operations, or `dry_run: true` to preview mutations; `auto_version` defaults to `true`.
Read `memory://help/codemode` for full namespace table, examples, and patterns.
**Codemode-only**: When `mj_execute_code` is the only registered journal tool (besides `update_configuration`), call journal operations via `mj.*` or bare sandbox globals rather than calling unfiltered tool names directly. CLI commands (`memory-journal-mcp ...`) should still be run natively in the terminal.