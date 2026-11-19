export const ADMIN_HELP = `# Admin Operations
- **Workspace Bounds**: Batch updates, deletions, and rebuilding vector indexes require \`workspace_id\` awareness. Ensure you are targeting the correct workspace to avoid unintended cross-tenant mutations.

### Auto-Prune

Auto-prune is opt-in: it runs on startup only when retention day thresholds (\`> 0\`) are configured, or on demand via \`run_auto_prune({ dry_run })\`.
- **Two-Stage Retention & Composite Importance**: Evaluates composite importance scores (default threshold \`0.15\`; protected tags \`architecture\`, \`important\`, \`keep\`, \`never-prune\`, \`reference\` exempt by default) across archive (\`--archive-older-than-days\`), soft-delete (\`--prune-older-than-days\`), and hard-delete (\`--hard-delete-older-than-days\`) stages. Automatically creates a \`pre-prune-*\` backup before mutating.
- **Exclusion Rules**: Exempt additional tags via \`--prune-exclude-tags <tags>\`.
- **Dry Run**: Preview candidates without mutating via \`--prune-dry-run\` (CLI) or \`run_auto_prune({ dry_run: true })\` (MCP/Code Mode).

### Real-Time Subscriptions

The server supports the standard MCP \`resources/subscribe\` capability. You can subscribe to resources (e.g., \`memory://recent\`, \`memory://team/recent\`, and \`memory://briefing\`) to receive real-time \`notifications/resources/updated\` notifications when other agents or team members mutate shared data. Note that subscriptions are scope-authorized; your session must possess the required scope (e.g., \`team\` or \`admin\`) for the target resource, or the subscription will be rejected with a \`PermissionError\`.

### Runtime Config, Mutations, Batching & Audit

- **Runtime Config**: \`update_configuration({ tool_filter, briefing_entries, briefing_summaries, workspace_id, project_number, ... })\` hot-reloads active tool filters and workspace/project defaults without restarting and emits \`notifications/tools/list_changed\`.
- **Project Registry**: \`register_project\`, \`update_project\`, \`delete_project\`, \`get_project\`, \`list_projects\`.
- **Entry Mutations**: \`update_entry\` (pass \`expected_version\` on direct MCP calls; Code Mode auto-injects via \`auto_version: true\`), \`delete_entry\`, \`restore_entry\`, \`batch_create_entries\`, \`batch_update_entries\`, \`batch_delete_entries\` (max 50 items per batch transaction).
- **Audit Logs**: \`search_audit_log\` queries mutating tool/resource audit records (requires \`--audit-log\` to be enabled on the server).

## Available Tools

- **Configuration**: \`update_configuration\`
- **Project Lifecycle**: \`register_project\`, \`update_project\`, \`delete_project\`, \`get_project\`, \`list_projects\`
- **Entry Mutations**: \`update_entry\`, \`delete_entry\`, \`restore_entry\`
- **Batch Operations**: \`batch_create_entries\`, \`batch_update_entries\`, \`batch_delete_entries\`
- **Vector Index**: \`rebuild_vector_index\`, \`add_to_vector_index\`
- **Maintenance**: \`merge_tags\`, \`run_auto_prune\`
- **Auditing**: \`search_audit_log\`

`;
