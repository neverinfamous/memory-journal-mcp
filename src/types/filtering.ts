/**
 * Memory Journal MCP Server - Tool Filtering Types
 */

/**
 * Tool group identifiers for Memory Journal
 */
export type ToolGroup =
    | 'core' // Entry CRUD: create, get_by_id, get_recent, create_minimal, test_simple
    | 'search' // Search: search_entries, search_by_date_range, semantic_search
    | 'analytics' // Analytics: get_statistics, get_cross_project_insights
    | 'relationships' // Relationships: link_entries, visualize_relationships
    | 'io'     // IO: export_entries, export_markdown, import_markdown
    | 'admin' // Admin: update_entry, delete_entry
    | 'github' // Reserved for future GitHub-specific tools
    | 'backup' // Backup: backup_journal, list_backups, restore_backup
    | 'team' // Team: team_create_entry, team_get_recent, team_search
    | 'codemode' // Code Mode: mj_execute_code (sandboxed JS execution)

/**
 * Meta-group identifiers for common multi-group selections
 */
export type MetaGroup =
    | 'starter' // core + search (~8 tools)
    | 'essential' // core only (~5 tools)
    | 'full' // all groups (~16 tools)
    | 'readonly' // everything except admin

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
