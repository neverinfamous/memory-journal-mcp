
## Code Mode

API: `tool_name` → `mj.group.action()` (e.g., `search_entries` → `mj.search.searchEntries()`)
Globals: `createEntry()`, `find()`, `recent()`, `searchEntries()`, `deleteEntry()`, `help()` work without the `mj.` prefix.
Positional: `createEntry("note")`, `searchEntries("performance")`
Aliases: Common parameter names are auto-corrected (`q`/`search`→`query`, `path`/`filepath`→`output_dir`, `keep`→`keep_count`, `user`/`assignee`→`target_user`, `team`/`project`→`workspace_id`).
Discovery: `mj.help()` → `{groups, totalMethods}`. `mj.core.help()` for group-specific.
Anti-Hallucination: DO NOT invoke `mj_execute_code` with an empty `code` payload to "list tools". You must provide valid JavaScript in the `code` parameter.
Sandbox: No network access (`fetch` is undefined). `setTimeout` and `sleep(ms)` are available for minor delays.
Readonly: Pass `readonly: true` to `mj_execute_code` to restrict execution to read-only operations.
Read `memory://help/codemode` for full namespace table, examples, and patterns.
**Codemode-only**: When `mj_execute_code` is the only registered tool, all tool names referenced in these instructions (e.g., `create_entry`, `search_entries`) must be called via `mj_execute_code` using `mj.*` namespaces or bare globals. Do NOT call them as direct MCP tools. Note: This rule applies ONLY to MCP tools; CLI commands (like `memory-journal-mcp entry create`) should always be run natively in the terminal using `run_command`.