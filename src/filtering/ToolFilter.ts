/**
 * Memory Journal MCP Server - Tool Filtering
 *
 * Configurable tool filtering system with groups and meta-groups.
 * Matches mysql-mcp filtering syntax and patterns.
 */

import type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from '../types/index.js'

// Re-export ToolFilterConfig from types
export type { ToolFilterConfig } from '../types/index.js'

/**
 * Tool group definitions mapping group names to tool names
 *
 * All 31 tools are categorized here for filtering support.
 */
export const TOOL_GROUPS: Record<ToolGroup, string[]> = {
    core: [
        'create_entry',
        'get_entry_by_id',
        'get_recent_entries',
        'create_entry_minimal',
        'test_simple',
        'list_tags',
    ],
    search: ['search_entries', 'search_by_date_range', 'semantic_search', 'get_vector_index_stats'],
    analytics: ['get_statistics', 'get_cross_project_insights'],
    relationships: ['link_entries', 'visualize_relationships'],
    export: ['export_entries'],
    admin: ['update_entry', 'delete_entry', 'rebuild_vector_index', 'add_to_vector_index'],
    github: [
        'get_github_issues',
        'get_github_prs',
        'get_github_issue',
        'get_github_pr',
        'get_github_context',
        'get_kanban_board',
        'move_kanban_item',
        'create_github_issue_with_entry',
        'close_github_issue_with_entry',
    ],
    backup: ['backup_journal', 'list_backups', 'restore_backup'],
}

/**
 * Meta-group definitions mapping shortcuts to groups
 */
export const META_GROUPS: Record<MetaGroup, ToolGroup[]> = {
    starter: ['core', 'search'],
    essential: ['core'],
    full: ['core', 'search', 'analytics', 'relationships', 'export', 'admin', 'github', 'backup'],
    readonly: ['core', 'search', 'analytics', 'relationships', 'export'],
}

/**
 * Get all tool names across all groups
 */
export function getAllToolNames(): string[] {
    const allTools: string[] = []
    for (const tools of Object.values(TOOL_GROUPS)) {
        allTools.push(...tools)
    }
    return allTools
}

/**
 * Get the group for a specific tool
 */
export function getToolGroup(toolName: string): ToolGroup | undefined {
    for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
        if (tools.includes(toolName)) {
            return group as ToolGroup
        }
    }
    return undefined
}

/**
 * Check if a string is a valid group name
 */
function isGroup(name: string): name is ToolGroup {
    return name in TOOL_GROUPS
}

/**
 * Check if a string is a valid meta-group name
 */
function isMetaGroup(name: string): name is MetaGroup {
    return name in META_GROUPS
}

/**
 * Parse a tool filter string into configuration
 *
 * Syntax:
 * - `starter` - Use starter preset (whitelist mode)
 * - `core,search` - Enable specific groups (whitelist mode)
 * - `full,-admin` - All tools except admin group
 * - `starter,-delete_entry` - Starter without specific tool
 * - `+semantic_search` - Add specific tool to current set
 */
export function parseToolFilter(filterString: string): ToolFilterConfig {
    const rules: ToolFilterRule[] = []
    const parts = filterString
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)

    // Determine if we're in whitelist or blacklist mode
    // If first item has no prefix and is a group/metagroup, we're in whitelist mode
    let enabledTools = new Set<string>()
    let isWhitelistMode = false

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!part) continue

        const isAdd = part.startsWith('+')
        const isRemove = part.startsWith('-')
        const name = isAdd || isRemove ? part.slice(1) : part

        if (i === 0 && !isAdd && !isRemove) {
            // First item without prefix - whitelist mode
            isWhitelistMode = true

            if (isMetaGroup(name)) {
                // Expand meta-group to groups
                for (const group of META_GROUPS[name]) {
                    enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[group]])
                }
            } else if (isGroup(name)) {
                enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[name]])
            } else {
                // Single tool
                enabledTools.add(name)
            }

            rules.push({
                type: 'include',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name),
            })
        } else if (isRemove) {
            // Remove group or tool
            if (isGroup(name)) {
                for (const tool of TOOL_GROUPS[name]) {
                    enabledTools.delete(tool)
                }
            } else {
                enabledTools.delete(name)
            }

            rules.push({
                type: 'exclude',
                target: name,
                isGroup: isGroup(name),
            })
        } else {
            // Add group or tool (with or without + prefix)
            if (isMetaGroup(name)) {
                for (const group of META_GROUPS[name]) {
                    enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[group]])
                }
            } else if (isGroup(name)) {
                enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[name]])
            } else {
                enabledTools.add(name)
            }

            rules.push({
                type: 'include',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name),
            })
        }
    }

    // If no filter specified or starting with removal, start with all tools
    if (!isWhitelistMode && rules.length > 0 && rules[0]?.type === 'exclude') {
        enabledTools = new Set(getAllToolNames())
        // Re-apply rules
        for (const rule of rules) {
            if (rule.type === 'exclude') {
                if (isGroup(rule.target)) {
                    for (const tool of TOOL_GROUPS[rule.target]) {
                        enabledTools.delete(tool)
                    }
                } else {
                    enabledTools.delete(rule.target)
                }
            }
        }
    }

    return {
        raw: filterString,
        rules,
        enabledTools,
    }
}

/**
 * Check if a tool is enabled based on filter string
 */
export function isToolEnabled(toolName: string, filterConfig: ToolFilterConfig): boolean {
    return filterConfig.enabledTools.has(toolName)
}

/**
 * Filter tools array based on filter configuration
 */
export function filterTools<T extends { name: string }>(
    tools: T[],
    filterConfig: ToolFilterConfig
): T[] {
    return tools.filter((tool) => isToolEnabled(tool.name, filterConfig))
}

/**
 * Get tool filter from environment variable
 */
export function getToolFilterFromEnv(): ToolFilterConfig | null {
    const filterString = process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
    if (!filterString) return null
    return parseToolFilter(filterString)
}

/**
 * Calculate token savings from filtering
 */
export function calculateTokenSavings(
    totalTools: number,
    enabledTools: number,
    avgTokensPerTool = 150
): { reduction: number; savedTokens: number } {
    const savedTokens = (totalTools - enabledTools) * avgTokensPerTool
    const reduction = ((totalTools - enabledTools) / totalTools) * 100
    return { reduction, savedTokens }
}

/**
 * Get human-readable filter summary
 */
export function getFilterSummary(filterConfig: ToolFilterConfig): string {
    const total = getAllToolNames().length
    const enabled = filterConfig.enabledTools.size
    const { reduction } = calculateTokenSavings(total, enabled)

    return `${enabled}/${total} tools enabled (${reduction.toFixed(0)}% reduction)`
}
