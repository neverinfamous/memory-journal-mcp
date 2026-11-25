export const TEAM_HELP = `# Team Collaboration

### Team RBAC & Access Control

Team tools require \`TEAM_DB_PATH\` (\`--team-db\`) plus caller identity via \`TEAM_AUTHOR\` or OAuth. The team database enforces Role-Based Access Control (RBAC):
- **Roles**: 
  - \`viewer\`: Read-only access to all team data.
  - \`member\`: Read all; Create/Edit/Delete *own* entries.
  - \`admin\`: Read/Write/Delete *all* entries, manage team members/aliases, rebuild vector indexes, and back up team data.
- **Bootstrap Workflow**: RBAC stays inactive until the first member is registered. On an empty member table, the first \`team_add_member\` call MUST assign \`role: 'admin'\` to the caller's own \`author\` identity to bootstrap admin access (or configure \`TEAM_ADMIN\` / \`--team-admin\` at startup). Once any member exists, unregistered callers fall back to \`TEAM_DEFAULT_ROLE\` (which defaults to \`'denied'\`).
- **Managing Members**: Admins manage members using \`team_add_member\`, \`team_remove_member\`, \`team_update_member_role\`, \`team_list_members\`, and \`team_get_member\`. 
- **Author Aliases**: Admins consolidate multi-username attribution via \`team_add_author_alias\`, \`team_list_author_aliases\`, \`team_resolve_author\`, \`team_remove_author_alias\`, and \`team_consolidate_authors\`.
- **OAuth Scopes**: When HTTP OAuth is active, OAuth scopes (\`read\`, \`write\`, \`team\`, \`audit\`, \`admin\`, \`full\`) and RBAC roles must both permit the operation.
- **Per-Project Tenant Isolation**: Team read, search, and relationship tools (\`team_get_recent\`, \`team_get_entry_by_id\`, \`team_search\`, \`team_link_entries\`) require a concrete registered \`workspace_id\` and \`project_number\` and reject \`workspace_id: '*'\`. For cross-project team audits, iterate \`list_projects\` and call \`team_get_recent({ workspace_id, project_number, limit: 200 })\` per project instead of passing \`workspace_id: '*'\` or probing sequential entry IDs.

## Available Tools

- **Core**: \`team_create_entry\`, \`team_get_entry_by_id\`, \`team_get_recent\`, \`team_list_tags\`
- **Search**: \`team_search\`, \`team_search_by_date_range\`, \`team_list_deleted_entries\`
- **Admin**: \`team_update_entry\`, \`team_delete_entry\`, \`team_restore_entry\`, \`team_merge_tags\`, \`team_batch_create_entries\`, \`team_batch_update_entries\`, \`team_batch_delete_entries\`
- **Analytics**: \`team_get_statistics\`, \`team_get_cross_project_insights\`, \`team_get_collaboration_matrix\`
- **Relationships**: \`team_link_entries\`, \`team_visualize_relationships\`
- **IO**: \`team_export_entries\`, \`team_export_markdown\`, \`team_import_markdown\`, \`team_import_external\`
- **Backup**: \`team_backup\`, \`team_list_backups\`
- **Vector**: \`team_semantic_search\`, \`team_get_vector_index_stats\`, \`team_rebuild_vector_index\`, \`team_add_to_vector_index\`
- **Members**: \`team_add_member\`, \`team_remove_member\`, \`team_update_member_role\`, \`team_list_members\`, \`team_get_member\`
- **Aliases**: \`team_add_author_alias\`, \`team_remove_author_alias\`, \`team_list_author_aliases\`, \`team_resolve_author\`, \`team_consolidate_authors\`

`;
