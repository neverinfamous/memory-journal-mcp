/**
 * Memory Journal MCP Server - Tool Filtering
 *
 * Configurable tool filtering system with groups and meta-groups.
 * Matches mysql-mcp filtering syntax and patterns.
 */

import type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from '../types/index.js'
import { TOOL_GROUPS, META_GROUPS } from './tool-constants.js'
import { logger } from '../utils/logger.js'

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
 * Return a new set with a meta-group, group, or single tool added.
 * An unknown single-tool name is still added (so filters stay forward compatible)
 * but is reported, because a typo would otherwise enable nothing without any signal.
 */
function applyInclude(enabledTools: Set<string>, name: string): Set<string> {
    if (isMetaGroup(name)) {
        const expanded = new Set(enabledTools)
        for (const group of META_GROUPS[name]) {
            for (const tool of TOOL_GROUPS[group]) expanded.add(tool)
        }
        return expanded
    }
    if (isGroup(name)) {
        const resolved = resolveGroupAlias(name) as ToolGroup
        return new Set([...enabledTools, ...TOOL_GROUPS[resolved]])
    }
    if (!getAllToolNames().includes(name)) {
        logger.warning(`Tool filter references unknown tool or group '${name}'`, {
            module: 'ToolFilter',
        })
    }
    return new Set([...enabledTools, name])
}

/** Remove a meta-group, group, or single tool from the set in place. */
function applyExclude(enabledTools: Set<string>, name: string): void {
    if (isMetaGroup(name)) {
        for (const group of META_GROUPS[name]) {
            for (const tool of TOOL_GROUPS[group]) {
                enabledTools.delete(tool)
            }
        }
    } else if (isGroup(name)) {
        const resolved = resolveGroupAlias(name) as ToolGroup
        for (const tool of TOOL_GROUPS[resolved]) {
            enabledTools.delete(tool)
        }
    } else {
        enabledTools.delete(name)
    }
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
    if (parts[0]?.startsWith('+') === true || parts[0]?.startsWith('-') === true) {
        enabledTools = new Set(getAllToolNames())
    }

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        if (!part) continue

        const isAdd = part.startsWith('+')
        const isRemove = part.startsWith('-')
        const name = isAdd || isRemove ? part.slice(1) : part

        if (i === 0 && !isAdd && !isRemove) {
            // First item without prefix - whitelist mode
            enabledTools = applyInclude(enabledTools, name)

            rules.push({
                type: 'include',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name),
            })
        } else if (isRemove) {
            // Remove meta-group, group, or tool
            applyExclude(enabledTools, name)

            rules.push({
                type: 'exclude',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name),
            })
        } else {
            // Add group or tool (with or without + prefix)
            enabledTools = applyInclude(enabledTools, name)

            rules.push({
                type: 'include',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name),
            })
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

const READONLY_REGISTRATION_EXEMPT = new Set<string>(ALWAYS_ENABLED_TOOLS)

/**
 * True when the active filter contains the readonly meta-group and does not exclude it.
 */
export function isReadonlyMetaActive(raw: string | undefined): boolean {
    if (raw === undefined || raw === '') return false
    const tokens = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
    const hasReadonly = tokens.some((token) => token === 'readonly' || token === '+readonly')
    const excludesReadonly = tokens.some((token) => token === '-readonly')
    return hasReadonly && !excludesReadonly
}

/**
 * Registration, tools/list, and tools/call share this gate.
 * update_configuration and mj_execute_code stay available. Code Mode still
 * limits mj.* dispatch to readOnlyHint on its own.
 */
export function isToolVisibleForFilter(
    name: string,
    readOnlyHint: boolean | undefined,
    raw: string | undefined
): boolean {
    if (!isReadonlyMetaActive(raw)) return true
    if (READONLY_REGISTRATION_EXEMPT.has(name)) return true
    return readOnlyHint === true
}
