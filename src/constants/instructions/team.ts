export const TEAM_HELP = `# Team Collaboration

### Team RBAC & Access Control

The team database features a Role-Based Access Control (RBAC) system for team members:
- **Roles**: 
  - \`viewer\`: Read-only access to all team data.
  - \`member\`: Read all, Create/Edit/Delete *own* entries, resolve own flags.
  - \`admin\`: Read/Write/Delete *all* entries and flags, manage team members, rebuild vector indexes, backup data.
- **Bootstrap Workflow**: The RBAC system is inactive until the first member is added. The first time \`team_add_member\` is called, the caller is automatically registered as an \`admin\`. Alternatively, the server can be bootstrapped via the \`TEAM_ADMIN\` environment variable or \`--team-admin\` CLI flag. Unregistered authors fall back to the configured \`TEAM_DEFAULT_ROLE\`.
- **Managing Members**: Admins can manage members using \`team_add_member\`, \`team_remove_member\`, \`team_update_member_role\`, \`team_list_members\`, and \`team_get_member\`. 
- **Author Aliases**: Admins can manage author aliases to consolidate attribution for team analytics when one person uses multiple usernames using \`team_add_author_alias\`, \`team_list_author_aliases\`, \`team_resolve_author\`, \`team_remove_author_alias\`, and \`team_consolidate_authors\`.
- **OAuth Scopes**: OAuth scopes (read/write/admin) govern broad HTTP endpoint access. RBAC roles govern fine-grained internal tool capabilities. Both must be satisfied when OAuth is active.

## Available Tools

- \`team_create_entry\`: Create an entry in the team database for sharing with collaborators.
- \`team_get_entry_by_id\`: Get a team entry by ID with full details including relationships.
- \`team_get_recent\`: Get recent entries. Supports \`sort_by\` (timestamp or importance) and cursor pagination.
- \`team_list_tags\`: List all tags used in the team database with usage counts.
- \`team_search\`: Search team entries. Use \`mode\` (\`auto\`, \`fts\`, \`semantic\`, \`hybrid\`). Supports \`sort_by\`, cursor pagination, \`include_facets\`, \`include_highlights\`, hybrid search weights, \`fuzzy_match\`, and \`auto_correct\`.
- \`team_search_by_date_range\`: Search team entries within a date range with optional filters, \`sort_by\`, and pagination.
- \`team_semantic_search\`: Perform semantic/vector search on team entries.
- \`team_get_vector_index_stats\` / \`team_rebuild_vector_index\` / \`team_add_to_vector_index\`: Manage the team vector index.
- \`team_update_entry\`: Update a team entry. Pass \`expected_version\` for optimistic locking. Pass \`null\` to clear a field.
- \`team_delete_entry\` / \`team_restore_entry\` / \`team_list_deleted_entries\`: Manage soft-deleted team entries.
- \`team_merge_tags\`: Merge a source tag into a target tag.
- \`team_batch_create_entries\` / \`team_batch_update_entries\` / \`team_batch_delete_entries\`: Bulk operations (Max 50 per batch). \`team_batch_update_entries\` supports \`expected_version\`.
- \`team_get_statistics\`: Get statistics for the team database.
- \`team_get_cross_project_insights\`: Analyze patterns across GitHub Projects in team entries.
- \`team_get_collaboration_matrix\`: Generate a structural matrix mapping author activity and cross-collaboration impact.
- \`team_link_entries\` / \`team_visualize_relationships\`: Create relationships between team entries and generate Mermaid diagrams.
- \`team_export_entries\` / \`team_export_markdown\` / \`team_import_markdown\` / \`team_import_external\`: I/O operations for team data.
- \`team_backup\` / \`team_list_backups\`: Manage team database backups.
- \`team_add_member\` / \`team_remove_member\` / \`team_update_member_role\` / \`team_list_members\` / \`team_get_member\`: Manage team members and RBAC roles (Admins only for mutations).
- \`team_add_author_alias\` / \`team_remove_author_alias\` / \`team_list_author_aliases\` / \`team_resolve_author\` / \`team_consolidate_authors\`: Manage author aliases and consolidate attribution (Admins only for mutations).

`;
