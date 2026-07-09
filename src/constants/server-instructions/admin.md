# Admin Operations
- **Workspace Bounds**: Batch updates, deletions, and rebuilding vector indexes require `workspace_id` awareness. Ensure you are targeting the correct workspace to avoid unintended cross-tenant mutations.

### Auto-Prune

On server startup, the auto-prune system implements a graduated data lifecycle (Active → Archived → Soft-Deleted → Hard-Deleted) for old entries with low significance scores.
- **Configurable Thresholds**: Controlled via `--archive-older-than-days`, `--prune-older-than-days` (soft-delete), `--hard-delete-older-than-days`, and `--prune-importance-threshold`.
- **Exclusion Rules**: Specific tags can be exempted from auto-pruning using `--prune-exclude-tags <tags>` (e.g. `architecture`, `never-prune`).
- **Dry Run**: Server administrators can preview what would be processed without mutating the database by using the `--prune-dry-run` flag.

### Scheduled Reports

When deployed in HTTP mode with `--report-interval <minutes>` and `--report-webhook-url <url>`, the server periodically generates digest reports and delivers them to the configured webhook. Reports include activity trends, significance highlights, stale project warnings, and top-importance entries.

- **Formats**: `slack` (default, `{"text":"<markdown>"}`), `discord` (`{"content":"<markdown>"}`), or `json` (raw DigestSnapshot payload).
- **Report history**: Read `memory://insights/reports` to view the last 5 generated reports and their delivery status.
- **Independent from digest**: The `report` job is separate from the `digest` analytics job. You can run one without the other.

### Real-Time Subscriptions

The server supports the standard MCP `resources/subscribe` capability. You can subscribe to team resources (e.g., `memory://team/recent`, `memory://flags`, and `memory://briefing`) to receive real-time `notifications/resources/updated` notifications when other agents or team members mutate shared data. Note that subscriptions are scope-authorized; your session must possess the required scope (e.g., `team` or `admin`) for the target resource, or the subscription will be rejected with a `PermissionError`.

## Available Tools

- **Configuration**: `update_configuration`, `registerProject`
- **Entry Mutations**: `update_entry`, `delete_entry`, `restore_entry`
- **Batch Operations**: `batch_create_entries`, `batch_update_entries`, `batch_delete_entries`
- **Vector Index**: `rebuild_vector_index`, `add_to_vector_index`
- **Maintenance**: `merge_tags`, `run_auto_prune`
- **Auditing**: `search_audit_log`

