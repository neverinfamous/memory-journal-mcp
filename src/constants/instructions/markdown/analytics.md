# Analytics Operations
- **Workspace Bounds**: Analytics operations scope to the active/default workspace when `workspace_id` is omitted — except `get_statistics({ project_breakdown: true })`, which automatically spans `workspace_id: "*"` unless an explicit `workspace_id` is passed. Pass `causal_metrics: true` on `get_statistics` for causal relationship density metrics.
- **Cross-Project & Digest Insights**: Use `get_cross_project_insights({ min_entries, inactive_days, workspace_id })` to surface top-importance entries and stale project warnings, and read `memory://insights/digest` or `memory://insights/team-collaboration` for cached summaries.

## Available Tools

- **Metrics**: `get_statistics`
- **Insights**: `get_cross_project_insights`
