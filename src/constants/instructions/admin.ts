export const ADMIN_HELP = `# Admin Operations
- **Workspace Bounds**: Batch updates, deletions, and rebuilding vector indexes require \`workspace_id\` awareness. Ensure you are targeting the correct workspace to avoid unintended cross-tenant mutations.

### Auto-Prune

On server startup, the auto-prune system automatically soft-deletes old entries with low significance scores.
- **Configurable Thresholds**: Controlled via \`--prune-older-than-days\` (soft-delete) and \`--prune-importance-threshold\`.
- **Exclusion Rules**: Specific tags can be exempted from auto-pruning using \`--prune-exclude-tags <tags>\` (e.g. \`architecture\`, \`never-prune\`).
- **Dry Run**: Server administrators can preview what would be processed without mutating the database by using the \`--prune-dry-run\` flag.

### Scheduled Reports

When deployed in HTTP mode with \`--report-interval <minutes>\` and \`--report-webhook-url <url>\`, the server periodically generates digest reports and delivers them to the configured webhook. Reports include activity trends, significance highlights, stale project warnings, and top-importance entries.

- **Formats**: \`slack\` (default, \`{"text":"<markdown>"}\`), \`discord\` (\`{"content":"<markdown>"}\`), or \`json\` (raw DigestSnapshot payload).
- **Report history**: Read \`memory://insights/reports\` to view the last 5 generated reports and their delivery status.
- **Independent from digest**: The \`report\` job is separate from the \`digest\` analytics job. You can run one without the other.

### Real-Time Subscriptions

The server supports the standard MCP \`resources/subscribe\` capability. You can subscribe to team resources (e.g., \`memory://team/recent\`, \`memory://flags\`, and \`memory://briefing\`) to receive real-time \`notifications/resources/updated\` notifications when other agents or team members mutate shared data. Note that subscriptions are scope-authorized; your session must possess the required scope (e.g., \`team\` or \`admin\`) for the target resource, or the subscription will be rejected with a \`PermissionError\`.

## Available Tools

- \`update_configuration\`: Dynamically update the running server configuration without restarting.
- \`register_project\` / \`update_project\` / \`delete_project\` / \`get_project\` / \`list_projects\`: Manage project workspaces in the global registry.
- \`update_entry\`: Update an existing journal entry. Pass \`expected_version\` for optimistic locking. Pass \`null\` to clear a field. Supports 14 metadata fields.
- \`delete_entry\` / \`restore_entry\`: Soft-delete or restore a journal entry.
- \`batch_create_entries\` / \`batch_update_entries\` / \`batch_delete_entries\`: Bulk operations (Max 50 per batch). \`batch_update_entries\` supports \`expected_version\` per entry.
- \`rebuild_vector_index\` / \`add_to_vector_index\`: Manage the semantic search vector index.
- \`merge_tags\`: Merge a source tag into a target tag (source is deleted).
- \`run_auto_prune\`: Manually trigger the auto-prune background job for stale entries.
- \`search_audit_log\`: Search operational telemetry audit logs by tool name, user, date range, status, or category.

`;
