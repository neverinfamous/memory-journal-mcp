/**
 * Centralized SQL entry column list for raw queries outside the database adapter.
 *
 * Handlers and resources that run their own SELECT queries against `memory_journal`
 * should import this constant instead of maintaining local copies.
 */
export const RAW_ENTRY_COLUMNS =
    'id, entry_type, content, timestamp, is_personal, significance_type, auto_context, deleted_at, ' +
    'project_number, project_owner, issue_number, issue_url, pr_number, pr_url, pr_status, ' +
    'workflow_run_id, workflow_name, workflow_status'
