export const TEAM_HELP = `# Team Collaboration

### Team RBAC & Access Control

The team database features a Role-Based Access Control (RBAC) system for team members:
- **Roles**: 
  - \\\`viewer\\\`: Read-only access to all team data.
  - \\\`member\\\`: Read all, Create/Edit/Delete *own* entries, resolve own flags.
  - \\\`admin\\\`: Read/Write/Delete *all* entries and flags, manage team members, rebuild vector indexes, backup data.
- **Bootstrap Workflow**: The RBAC system is inactive until the first member is added. The first time \\\`team_add_member\\\` is called, the caller is automatically registered as an \\\`admin\\\`. Alternatively, the server can be bootstrapped via the \\\`TEAM_ADMIN\\\` environment variable or \\\`--team-admin\\\` CLI flag. Unregistered authors fall back to the configured \\\`TEAM_DEFAULT_ROLE\\\`.
- **Managing Members**: Admins can manage members using \\\`team_add_member\\\`, \\\`team_remove_member\\\`, \\\`team_update_member_role\\\`, \\\`team_list_members\\\`, and \\\`team_get_member\\\`. 
- **Author Aliases**: Admins can manage author aliases to consolidate attribution for team analytics when one person uses multiple usernames using \\\`team_add_author_alias\\\`, \\\`team_list_author_aliases\\\`, \\\`team_resolve_author\\\`, \\\`team_remove_author_alias\\\`, and \\\`team_consolidate_authors\\\`.
- **OAuth Scopes**: OAuth scopes (read/write/admin) govern broad HTTP endpoint access. RBAC roles govern fine-grained internal tool capabilities. Both must be satisfied when OAuth is active.`;
