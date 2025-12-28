/**
 * Server instructions for Memory Journal MCP.
 *
 * These instructions are automatically sent to MCP clients during initialization,
 * providing guidance for AI agents on tool usage.
 */
export const SERVER_INSTRUCTIONS = `# memory-journal-mcp

Memory Journal MCP Server - Persistent project context management for AI-assisted development.

## GitHub Tools

GitHub tools auto-detect repository from the configured GITHUB_REPO_PATH.
- If owner/repo are detected, they appear in \`detectedOwner\`/\`detectedRepo\` in responses
- If not detected (null), specify \`owner\` and \`repo\` parameters explicitly

## Tool Groups

| Group | Tools |
|-------|-------|
| journal | create_entry, create_entry_minimal, update_entry, delete_entry |
| search | search_entries, semantic_search, search_by_date_range |
| github | get_github_issues, get_github_prs, get_github_issue, get_github_pr, get_github_context |
| admin | backup_journal, list_backups, restore_backup, rebuild_vector_index |
`;
