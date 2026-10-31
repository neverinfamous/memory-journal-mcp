/**
 * Memory Journal MCP Server - Tool Filtering
 *
 * Configurable tool filtering system with groups and meta-groups.
 * Matches mysql-mcp filtering syntax and patterns.
 */

import type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from '../types/index.js'
import { TOOL_GROUPS, META_GROUPS } from './tool-constants.js'

// Re-export ToolFilterConfig from types
export type { ToolFilterConfig } from '../types/index.js'

export { TOOL_GROUPS, META_GROUPS }

/** 
 * Tools that are always enabled regardless of filter configuration.
 * Prevents agents from locking themselves out of the config system or Code Mode. 
 */
export const ALWAYS_ENABLED_TOOLS = ['update_configuration', 'mj_execute_code'] as const

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
 * Determine which tool groups have at least one enabled tool.
 * Used by instruction generation to conditionally include/exclude sections.
 */
export function getEnabledGroups(enabledTools: Set<string>): Set<ToolGroup> {
    const groups = new Set<ToolGroup>()
    for (const [group, tools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
        if (tools.some((t) => enabledTools.has(t))) {
            groups.add(group)
        }
    }
    return groups
}

/**
 * Legacy group name aliases.
 * Users with `--tool-filter=export` in their config are transparently mapped to `io`.
 */
const GROUP_ALIASES: Record<string, ToolGroup> = { export: 'io' }

/**
 * Resolve a group name, applying legacy aliases.
 */
function resolveGroupAlias(name: string): string {
    return GROUP_ALIASES[name] ?? name
}

/**
 * Check if a string is a valid group name (after alias resolution).
 *
 * Returns a boolean rather than a type predicate because legacy aliases like
 * `export` resolve to `io` at call time — they are valid inputs but are not
 * themselves members of the ToolGroup union, making a type predicate unsound.
 */
function isGroup(name: string): boolean {
    return resolveGroupAlias(name) in TOOL_GROUPS
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
                const resolved = resolveGroupAlias(name) as ToolGroup
                enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[resolved]])
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
                const resolved = resolveGroupAlias(name) as ToolGroup
                for (const tool of TOOL_GROUPS[resolved]) {
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
                const resolved = resolveGroupAlias(name) as ToolGroup
                enabledTools = new Set([...enabledTools, ...TOOL_GROUPS[resolved]])
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
                    const resolved = resolveGroupAlias(rule.target) as ToolGroup
                    for (const tool of TOOL_GROUPS[resolved]) {
                        enabledTools.delete(tool)
                    }
                } else {
                    enabledTools.delete(rule.target)
                }
            }
        }
    }

    // Always include escape-hatch tools so agents can't lock themselves out
    for (const tool of ALWAYS_ENABLED_TOOLS) {
        enabledTools.add(tool)
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
