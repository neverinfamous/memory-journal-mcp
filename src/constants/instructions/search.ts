export const SEARCH_HELP = `# Search Operations
- **Workspace Filtering**: All search and listing operations filter by \`workspace_id\` if configured. You can query across workspaces by explicitly omitting the workspace or passing an asterisk/wildcard if supported.
- **CLI Commands**: You can search natively via the CLI by using \`memory-journal-mcp search <query>\`, or explicitly with the \`--query\`, \`--term\`, or \`--keyword\` flags.

## Available Tools

- \`search_entries\`: Search journal entries. Use \`mode\` (\`auto\`, \`fts\`, \`semantic\`, \`hybrid\`). Supports \`workspace_id\`, filters, \`sort_by\`, cursor pagination, facets, and highlights.
- \`search_by_date_range\`: Search journal entries within a date range with optional filters, \`workspace_id\`, \`sort_by\`, and cursor pagination.
- \`cross_team_search\`: Search across multiple configured team databases simultaneously.
- \`semantic_search\`: Perform semantic/vector search on journal entries using AI embeddings.
- \`get_vector_index_stats\`: Get statistics about the semantic search vector index.
- \`list_deleted_entries\`: List recently soft-deleted entries that can be restored.

`;
