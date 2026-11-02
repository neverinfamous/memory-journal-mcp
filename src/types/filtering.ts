/**
 * Memory Journal MCP Server - Tool Filtering Types
 */

/**
 * Tool group identifiers for Memory Journal
 */
export type ToolGroup =
    | 'core' // Entry CRUD & session lifecycle: create_entry, get_entry_by_id, get_recent_entries, get_entry_history, list_tags, mark_anchors_stale
    | 'search' // Search: search_entries, search_by_date_range, semantic_search, get_vector_index_stats, list_deleted_entries, cross_team_search
    | 'analytics' // Analytics: get_statistics, get_cross_project_insights
    | 'relationships' // Relationships: link_entries, visualize_relationships
    | 'io' // IO: export_entries, export_markdown, import_markdown, import_external
    | 'admin' // Admin: update_entry, delete_entry, restore_entry, batch ops, project registry, vector index, audit, auto-prune
    | 'github' // GitHub: issues, PRs, context, Kanban board, milestones, repo insights, Copilot reviews
    | 'git' // Git History operations: commits, releases, patterns, staleness
    | 'backup' // Backup: backup_journal, list_backups, restore_backup, cleanup_backups
    | 'team' // Team: shared team database CRUD, search, analytics, IO, backup, vector, RBAC members, author aliases
    | 'codemode' // Code Mode: mj_execute_code (sandboxed JS execution)

/**
 * Meta-group identifiers for common multi-group selections
 */
export type MetaGroup =
    | 'starter' // core + search + codemode
    | 'essential' // core + codemode
    | 'full' // all 11 groups (115 tools)
    | 'readonly' // core + search + analytics + relationships + io + git + codemode

/**
 * Tool filter rule
 */
export interface ToolFilterRule {
    /** Rule type: include or exclude */
    type: 'include' | 'exclude'

    /** Target: group name or tool name */
    target: string

    /** Whether target is a group (true) or individual tool (false) */
    isGroup: boolean
}

/**
 * Parsed tool filter configuration
 */
export interface ToolFilterConfig {
    /** Original filter string */
    raw: string

    /** Parsed rules in order */
    rules: ToolFilterRule[]

    /** Set of enabled tool names after applying rules */
    enabledTools: Set<string>
}
