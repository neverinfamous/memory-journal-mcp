/**
 * Memory Journal MCP Server - Tool Filtering
 *
 * Configurable tool filtering system with groups and meta-groups.
 * Matches mysql-mcp filtering syntax and patterns.
 */

import type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from '../types/index.js'
import { TOOL_GROUPS, META_GROUPS } from './tool-constants.js'
import { getCachedReadonlyFilterState } from './readonly-filter-cache.js'
import { logger } from '../utils/logger.js'

// Re-export ToolFilterConfig from types
export type { ToolFilterConfig } from '../types/index.js'

export { TOOL_GROUPS, META_GROUPS }

/**
 * Tools that are always enabled regardless of filter configuration.
 * Prevents agents from locking themselves out of the config system or Code Mode.
 */
export const ALWAYS_ENABLED_TOOLS = ['update_configuration', 'mj_execute_code'] as const

const ALL_TOOL_NAMES: readonly string[] = Object.values(TOOL_GROUPS).flat()
const TOOL_TO_GROUP = new Map<string, ToolGroup>()
for (const [group, tools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
    for (const t of tools) {
        TOOL_TO_GROUP.set(t, group)
    }
}

/**
 * Get all tool names across all groups
 */
export function getAllToolNames(): string[] {
    return ALL_TOOL_NAMES.slice()
}

/**
 * Get the group for a specific tool
 */
export function getToolGroup(toolName: string): ToolGroup | undefined {
    return TOOL_TO_GROUP.get(toolName)
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
    return Object.hasOwn(GROUP_ALIASES, name) ? (GROUP_ALIASES[name] ?? name) : name
}

/**
 * Check if a string is a valid group name (after alias resolution).
 *
 * Returns a boolean rather than a type predicate because legacy aliases like
 * `export` resolve to `io` at call time — they are valid inputs but are not
 * themselves members of the ToolGroup union, making a type predicate unsound.
 */
function isGroup(name: string): boolean {
    return Object.hasOwn(TOOL_GROUPS, resolveGroupAlias(name))
}

/**
 * Check if a string is a valid meta-group name
 */
function isMetaGroup(name: string): name is MetaGroup {
    return Object.hasOwn(META_GROUPS, name)
}

/**
 * Return a new set with a meta-group, group, write meta-set, or single tool added.
 * An unknown single-tool name is still added (so filters stay forward compatible)
 * but is reported, because a typo would otherwise enable nothing without any signal.
 */
function applyInclude(enabledTools: Set<string>, name: string): Set<string> {
    if (name === 'write') {
        const allToolSet = new Set(getAllToolNames())
        const expanded = new Set(enabledTools)
        for (const tool of MUTATING_NON_EXEMPT_TOOLS) {
            if (allToolSet.has(tool)) {
                expanded.add(tool)
            }
        }
        return expanded
    }
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

/** Remove a meta-group, group, write meta-set, or single tool from the set in place. */
function applyExclude(enabledTools: Set<string>, name: string): void {
    if (name === 'write') {
        for (const tool of MUTATING_NON_EXEMPT_TOOLS) {
            enabledTools.delete(tool)
        }
        return
    }
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
                isGroup: isGroup(name) || isMetaGroup(name) || name === 'write',
            })
        } else if (isRemove) {
            // Remove meta-group, group, write meta-set, or tool
            applyExclude(enabledTools, name)

            rules.push({
                type: 'exclude',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name) || name === 'write',
            })
        } else {
            // Add group, write meta-set, or tool (with or without + prefix)
            enabledTools = applyInclude(enabledTools, name)

            rules.push({
                type: 'include',
                target: name,
                isGroup: isGroup(name) || isMetaGroup(name) || name === 'write',
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
    if (filterString === undefined || filterString === '') {
        return null
    }
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
const READONLY_FILTER_OPS = { applyInclude, applyExclude }

/**
 * True when the active filter enforces read-only mode (via `readonly` or `-write`
 * without a subsequent `-readonly`, `+write`, or `write` override).
 */
export function isReadonlyMetaActive(raw: string | undefined): boolean {
    return getCachedReadonlyFilterState(raw, READONLY_FILTER_OPS).active
}

/**
 * Collect tool names explicitly re-included after the final `readonly`/`+readonly`/`-write`
 * token, taking subsequent `-<target>` exclusions into account.
 */
export function getPostReadonlyIncludedTools(raw: string | undefined): Set<string> {
    return new Set(getCachedReadonlyFilterState(raw, READONLY_FILTER_OPS).postIncluded)
}

/**
 * Registration, tools/list, and tools/call share this gate.
 * update_configuration and mj_execute_code stay available. Code Mode still
 * limits mj.* dispatch to readOnlyHint on its own, while explicit inclusions after
 * `readonly` or `-write` (such as `+create_entry` or `+core`) remain visible.
 */
export function isToolVisibleForFilter(
    name: string,
    readOnlyHint: boolean | undefined,
    raw: string | undefined
): boolean {
    const state = getCachedReadonlyFilterState(raw, READONLY_FILTER_OPS)
    if (!state.active) return true
    if (READONLY_REGISTRATION_EXEMPT.has(name)) return true
    if (readOnlyHint === true) return true
    return state.postIncluded.has(name)
}

const READONLY_ADMIN_TOOLS = new Set<string>([
    'update_configuration',
    'get_project',
    'list_projects',
    'search_audit_log',
])

const MUTATING_NON_EXEMPT_TOOLS = new Set<string>([
    ...TOOL_GROUPS.admin.filter((t) => !READONLY_ADMIN_TOOLS.has(t)),
    'create_entry',
    'mark_anchors_stale',
    'link_entries',
    'import_markdown',
    'import_external',
    'export_markdown',
    'backup_journal',
    'restore_backup',
    'cleanup_backups',
    'create_github_issue_with_entry',
    'close_github_issue_with_entry',
    'move_kanban_item',
    'add_kanban_item',
    'delete_kanban_item',
    'create_github_milestone',
    'update_github_milestone',
    'delete_github_milestone',
    'check_entry_staleness',
    'team_create_entry',
    'team_update_entry',
    'team_delete_entry',
    'team_restore_entry',
    'team_merge_tags',
    'team_batch_create_entries',
    'team_batch_update_entries',
    'team_batch_delete_entries',
    'team_link_entries',
    'team_import_markdown',
    'team_import_external',
    'team_export_markdown',
    'team_backup',
    'team_rebuild_vector_index',
    'team_add_to_vector_index',
    'team_add_member',
    'team_remove_member',
    'team_update_member_role',
    'team_add_author_alias',
    'team_remove_author_alias',
    'team_consolidate_authors',
])

/**
 * Returns true when a parsed `--tool-filter` configuration permits zero mutating operations,
 * accounting for `readonly`, `-write`, and read-only groups even though `ALWAYS_ENABLED_TOOLS`
 * automatically keeps `mj_execute_code` and `update_configuration` in `enabledTools`.
 */
export function isFilterEffectivelyReadOnly(filterConfig: ToolFilterConfig): boolean {
    if (isReadonlyMetaActive(filterConfig.raw)) {
        const postIncluded = getPostReadonlyIncludedTools(filterConfig.raw)
        return ![...filterConfig.enabledTools].some(
            (t) => MUTATING_NON_EXEMPT_TOOLS.has(t) && postIncluded.has(t)
        )
    }

    let explicitCodemode = false
    for (const r of filterConfig.rules) {
        if (
            r.type === 'include' &&
            (r.target === 'codemode' ||
                r.target === 'mj_execute_code' ||
                r.target === 'starter' ||
                r.target === 'essential' ||
                r.target === 'full')
        ) {
            explicitCodemode = true
        } else if (
            r.type === 'exclude' &&
            (r.target === 'codemode' ||
                r.target === 'mj_execute_code' ||
                r.target === 'starter' ||
                r.target === 'essential' ||
                r.target === 'full')
        ) {
            explicitCodemode = false
        }
    }
    if (explicitCodemode) return false

    return ![...filterConfig.enabledTools].some((t) => MUTATING_NON_EXEMPT_TOOLS.has(t))
}
