# Field Notes & Gotchas

## Tool Usage Pitfalls

1. **Missing `project_number`**: The single most common failure reason. Always pass `project_number: <N>` to core and team tools. Omitting it triggers a `VALIDATION_ERROR`.
2. **Result Limits**: The `MAX_QUERY_LIMIT` is strictly 500 for most search tools. Use `search_by_date_range` to iterate through large histories safely.
3. **Code Mode Restrictions**: The `mj_execute_code` sandbox cannot make network requests (`fetch` is undefined) or use timers (`setTimeout`/`setInterval`). Use it strictly for orchestrating `mj.*` API calls.
4. **Tool Hallucinations**: Do NOT attempt to use tools that are not listed in the `memory://help` resource. If a tool doesn't exist, use `mj_execute_code` to combine existing tools.

## GitHub & Kanban Sync

- **Eventual Consistency**: GitHub Projects V2 read indexes are eventually consistent. If you `add_kanban_item` or `move_kanban_item`, a subsequent `get_kanban_board` might take up to 10 seconds to reflect the change.
- **Multi-Project Routing**: Always pass the `repo` parameter to GitHub tools if your `memory://briefing` indicates you are in a multi-project environment.

## Structural Integrity

- **Session Summaries**: Always use `entry_type: "retrospective"` and tag with `session-summary`.
- **References**: Never guess `entry_id`, `issue_number`, or `pr_number`. Always query them first to avoid broken links.
- **Significance**: Only mark entries with `significance_type` if they are genuinely major milestones, decisions, or breakthroughs. Overusing this degrades the signal-to-noise ratio of the journal.
