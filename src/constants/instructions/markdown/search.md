# Search Operations
- **Workspace Filtering**: All search and listing operations filter by `workspace_id` if configured. You can query across workspaces by explicitly omitting the workspace or passing an asterisk/wildcard if supported.
- **CLI Commands**: You can search natively via the CLI by using `memory-journal-mcp search <query>`, or explicitly with the `--query`, `--term`, or `--keyword` flags.

## Available Tools

- **Core Search**: `search_entries`, `search_by_date_range`, `cross_team_search`
- **Vector/Semantic**: `semantic_search`, `get_vector_index_stats`
- **Recycle Bin**: `list_deleted_entries`

