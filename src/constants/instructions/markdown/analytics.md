# Analytics Operations
- **Workspace Bounds**: Analytics operations scope to the active/default workspace when `workspace_id` is omitted — except `get_statistics({ project_breakdown: true })`, which automatically spans `workspace_id: "*"` unless an explicit `workspace_id` is passed.
- **Cross-Project & Digest Insights**: Use `get_cross_project_insights({ start_date, end_date, min_entries, workspace_id, project_number })` to surface top-importance entries and stale project warnings, and read `memory://insights/digest` or `memory://insights/team-collaboration` for cached summaries.

## Available Tools

- **Metrics**: `get_statistics`
- **Insights**: `get_cross_project_insights`
