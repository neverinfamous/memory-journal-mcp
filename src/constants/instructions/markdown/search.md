# Search Operations
- **Workspace Filtering**: Omitting `workspace_id` scopes queries to the active/default workspace — pass `workspace_id: "*"` explicitly for cross-workspace search.
- **Hybrid Search & Ranking**: Use `search_entries({ query, mode: 'hybrid', exclude_tags: ['commit-narrative'], workspace_id })` (with optional `sort_by: 'blended'`) for pre-planning recall, and check tag `"copilot-finding"` before opening PRs. Note: search results merge personal and team entries (`include_team: true` by default); when `hit.source === 'team'`, expand via `mj.team.teamGetEntryById` / `mj.team.teamVisualizeRelationships`.
- **FTS5 Phrase & Compound Matching**: Tokens with `.`, `/`, `:`, or `@` (`AGENTS.md`, `@scope/pkg`, `memory://agent-context`) auto-quote as exact FTS5 phrases; hyphenated tokens without those delimiters (`"CMS-04"`, `"memory-journal-mcp"`) split on `-` unless wrapped in double quotes.
- **Date Range, Semantic & Cross-Team Search**: Use `search_by_date_range({ start_date, end_date, sort_by: 'timestamp' | 'importance', exclude_tags })` for time windows (note: `mode` and `blended` apply to `search_entries` only; `exclude_tags` works across `search_entries`, `search_by_date_range`, `team_search_by_date_range`, and `semantic_search`), `semantic_search({ query | entry_id, similarity_threshold, exclude_tags })` for vector similarity, and `cross_team_search` when `ADDITIONAL_TEAM_DBS` is configured.
- **CLI Commands**: Search natively via `memory-journal-mcp search <query>`, or `--query`, `--term`, `--keyword` flags.

## Available Tools

- **Core Search**: `search_entries`, `search_by_date_range`, `cross_team_search`
- **Vector/Semantic**: `semantic_search`, `get_vector_index_stats`
- **Recycle Bin**: `list_deleted_entries`

