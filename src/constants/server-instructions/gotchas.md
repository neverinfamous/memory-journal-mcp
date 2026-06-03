# Field Notes & Gotchas

## Tool Usage Pitfalls

1. **Missing `project_number`**: The single most common failure reason. Always pass `project_number: <N>` or ensure `DEFAULT_PROJECT_NUMBER` is configured on the server. Omitting both triggers a `VALIDATION_ERROR`.
2. **Result Limits**: The `MAX_QUERY_LIMIT` is strictly 500 for most search tools. Use the optional `cursor` parameter and `next_cursor` output for O(1) keyset pagination on large datasets. Batch operations are strictly limited to `MAX_BATCH_SIZE` (50) per transaction.
3. **Code Mode Restrictions**: The `mj_execute_code` sandbox cannot make network requests (`fetch` is undefined) or use timers (`setTimeout`/`setInterval`). Use it strictly for orchestrating `mj.*` API calls.
4. **Tool Hallucinations**: Do NOT attempt to use tools that are not listed in the `memory://help` resource. If a tool doesn't exist, use `mj_execute_code` to combine existing tools.
5. **Phrase Matching**: The `query` parameter in search tools supports true phrase matching. Wrap exact strings in double quotes (e.g., `"error handling"`) when word order and adjacency are critical.
6. **Typo Tolerance**: FTS5 search operations automatically fall back to Levenshtein distance matching on tags and entry types if no results are found. To disable this when strict exact matching is needed, explicitly set `fuzzy_match: false`.
7. **Team RBAC**: If the team database has at least one member registered, RBAC is active. Unregistered authors fall back to the `TEAM_DEFAULT_ROLE` (which denies access by default). Non-admin members can only modify or resolve entries/flags they originally authored.
8. **Concurrent Edits**: When updating an entry (`update_entry`, `team_update_entry`), always pass `expected_version` if you know the current version to prevent silently overwriting concurrent changes. If you get a `VERSION_CONFLICT` error, re-read the latest entry state returned in the error payload, merge your changes, and retry.

## GitHub & Kanban Sync

- **Eventual Consistency**: GitHub Projects V2 read indexes are eventually consistent. If you `add_kanban_item` or `move_kanban_item`, a subsequent `get_kanban_board` might take up to 10 seconds to reflect the change.
- **Multi-Project Routing**: Always pass the `repo` parameter to GitHub tools if your `memory://briefing` indicates you are in a multi-project environment.

## Structural Integrity

- **Session Summaries**: Always use `entry_type: "retrospective"` and tag with `session-summary`.
- **References**: Never guess `entry_id`, `issue_number`, or `pr_number`. Always query them first to avoid broken links.
- **Significance**: Only mark entries with `significance_type` if they are genuinely major milestones, decisions, or breakthroughs. Overusing this degrades the signal-to-noise ratio of the journal.
