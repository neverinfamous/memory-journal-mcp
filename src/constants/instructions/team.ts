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

- **Core**: \`team_create_entry\`, \`team_get_entry_by_id\`, \`team_get_recent\`, \`team_list_tags\`
- **Search & Semantic**: \`team_search\`, \`team_search_by_date_range\`, \`team_semantic_search\`, \`team_get_vector_index_stats\`, \`team_rebuild_vector_index\`, \`team_add_to_vector_index\`, \`team_list_deleted_entries\`
- **Mutations**: \`team_update_entry\`, \`team_delete_entry\`, \`team_restore_entry\`, \`team_merge_tags\`
- **Batch Operations**: \`team_batch_create_entries\`, \`team_batch_update_entries\`, \`team_batch_delete_entries\`
- **Analytics & Graphs**: \`team_get_statistics\`, \`team_get_cross_project_insights\`, \`team_get_collaboration_matrix\`, \`team_link_entries\`, \`team_visualize_relationships\`
- **I/O & Backup**: \`team_export_entries\`, \`team_export_markdown\`, \`team_import_markdown\`, \`team_import_external\`, \`team_backup\`, \`team_list_backups\`
- **Members**: \`team_add_member\`, \`team_remove_member\`, \`team_update_member_role\`, \`team_list_members\`, \`team_get_member\`
- **Aliases**: \`team_add_author_alias\`, \`team_remove_author_alias\`, \`team_list_author_aliases\`, \`team_resolve_author\`, \`team_consolidate_authors\`

`;
