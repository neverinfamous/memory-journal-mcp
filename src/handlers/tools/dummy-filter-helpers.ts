import type { ToolFilterConfig } from '../../types/index.js'
import {
    isFilterEffectivelyReadOnly,
    isToolVisibleForFilter,
} from '../../filtering/tool-filter.js'
import {
    DUMMY_HEALING_TOOL_NAMES,
    DUMMY_ENTRY_CREATION_TOOL_NAMES,
    DUMMY_SQL_EXECUTION_TOOL_NAMES,
    DUMMY_PROJECT_TOOL_NAMES,
    DUMMY_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_RESOURCE_TOOL_NAMES,
    DUMMY_PROMPT_TOOL_NAMES,
    DUMMY_LIST_PROMPT_TOOL_NAMES,
    DUMMY_LIST_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    DUMMY_SERVER_INFO_TOOL_NAMES,
    DUMMY_ADAPTER_TOOL_NAMES,
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
    projectAliasTarget,
} from './core/dummy-healing/alias-catalog.js'

export interface DummyTargetInfo {
    target: string
    group: string
    readOnly: boolean
    isMcpTool: boolean
}

const STATIC_ALIAS_TARGET_GROUPS: readonly {
    names: readonly string[]
    target: string
    group: string
    readOnly: boolean
    isMcpTool: boolean
}[] = [
    { names: DUMMY_SQL_EXECUTION_TOOL_NAMES, target: 'mj_execute_code', group: 'codemode', readOnly: false, isMcpTool: true },
    {
        names: ['create_entry', ...DUMMY_ENTRY_CREATION_TOOL_NAMES, 'mj_core_create_entry', 'mj.core.createEntry', 'mj.core.create_entry'],
        target: 'create_entry',
        group: 'core',
        readOnly: false,
        isMcpTool: true,
    },
    {
        names: ['update_entry', 'mj_core_update_entry', 'mj.core.updateEntry', 'mj.core.update_entry'],
        target: 'update_entry',
        group: 'admin',
        readOnly: false,
        isMcpTool: true,
    },
    {
        names: ['delete_entry', 'mj_core_delete_entry', 'mj.core.deleteEntry', 'mj.core.delete_entry'],
        target: 'delete_entry',
        group: 'admin',
        readOnly: false,
        isMcpTool: true,
    },
    {
        names: ['search_entries', 'mj_core_search_entries', 'mj.core.searchEntries', 'mj.core.search_entries'],
        target: 'search_entries',
        group: 'search',
        readOnly: true,
        isMcpTool: true,
    },
    {
        names: ['get_recent_entries', 'mj_core_get_recent_entries', 'mj.core.getRecentEntries', 'mj.core.get_recent_entries'],
        target: 'get_recent_entries',
        group: 'core',
        readOnly: true,
        isMcpTool: true,
    },
    {
        names: ['get_entry_by_id', 'mj_core_get_entry_by_id', 'mj.core.getEntryById', 'mj.core.get_entry_by_id'],
        target: 'get_entry_by_id',
        group: 'core',
        readOnly: true,
        isMcpTool: true,
    },
    { names: DUMMY_RESOURCE_TOOL_NAMES, target: 'read_resource', group: 'resources', readOnly: true, isMcpTool: false },
    { names: DUMMY_LIST_RESOURCE_TOOL_NAMES, target: 'list_resources', group: 'resources', readOnly: true, isMcpTool: false },
    { names: DUMMY_PROMPT_TOOL_NAMES, target: 'get_prompt', group: 'prompts', readOnly: true, isMcpTool: false },
    { names: DUMMY_LIST_PROMPT_TOOL_NAMES, target: 'list_prompts', group: 'prompts', readOnly: true, isMcpTool: false },
    { names: DUMMY_GET_PROMPT_TOOL_NAMES, target: 'get_prompt', group: 'prompts', readOnly: true, isMcpTool: false },
    { names: DUMMY_LIST_TOOL_NAMES, target: 'list_tools', group: 'meta', readOnly: true, isMcpTool: false },
    { names: DUMMY_SERVER_INFO_TOOL_NAMES, target: 'server_info', group: 'meta', readOnly: true, isMcpTool: false },
    { names: DUMMY_ADAPTER_TOOL_NAMES, target: 'list_adapters', group: 'meta', readOnly: true, isMcpTool: false },
    { names: DUMMY_GREP_SEARCH_TOOL_NAMES, target: 'grep_search', group: 'fs', readOnly: true, isMcpTool: false },
    { names: DUMMY_FILE_VIEW_TOOL_NAMES, target: 'view_file', group: 'fs', readOnly: true, isMcpTool: false },
    { names: DUMMY_DIR_LIST_TOOL_NAMES, target: 'list_dir', group: 'fs', readOnly: true, isMcpTool: false },
]

const DUMMY_TARGET_LOOKUP = new Map<string, DummyTargetInfo>()
for (const entry of STATIC_ALIAS_TARGET_GROUPS) {
    const info: DummyTargetInfo = {
        target: entry.target,
        group: entry.group,
        readOnly: entry.readOnly,
        isMcpTool: entry.isMcpTool,
    }
    for (const name of entry.names) {
        DUMMY_TARGET_LOOKUP.set(name, info)
    }
}
for (const name of DUMMY_PROJECT_TOOL_NAMES) {
    DUMMY_TARGET_LOOKUP.set(name, {
        target: projectAliasTarget(name) ?? 'list_projects',
        group: 'admin',
        readOnly: true,
        isMcpTool: true,
    })
}

export function resolveDummyTargetInfo(name: string): DummyTargetInfo | undefined {
    const direct = DUMMY_TARGET_LOOKUP.get(name)
    if (direct !== undefined) return direct
    const projTarget = projectAliasTarget(name)
    if (projTarget !== undefined) {
        return { target: projTarget, group: 'admin', readOnly: true, isMcpTool: true }
    }
    return undefined
}

const RAW_FILTER_TOKENS_CACHE = new WeakMap<
    ToolFilterConfig,
    { raw: string; tokens: ReadonlySet<string> }
>()

function getRawFilterTokens(filterConfig: ToolFilterConfig): ReadonlySet<string> {
    const cached = RAW_FILTER_TOKENS_CACHE.get(filterConfig)
    if (cached?.raw === filterConfig.raw) {
        return cached.tokens
    }
    const tokens = new Set<string>()
    for (const part of filterConfig.raw.toLowerCase().split(/[\s,]+/)) {
        if (part.length > 0) tokens.add(part)
    }
    RAW_FILTER_TOKENS_CACHE.set(filterConfig, { raw: filterConfig.raw, tokens })
    return tokens
}

export function isTargetExcludedByRules(
    tokensToMatch: readonly string[],
    filterConfig: ToolFilterConfig
): boolean {
    const rawTokens = getRawFilterTokens(filterConfig)
    const lowered = new Set<string>()
    for (const token of tokensToMatch) {
        const lower = token.toLowerCase()
        lowered.add(lower)
        if (rawTokens.has(`-${lower}`) && !rawTokens.has(`+${lower}`)) {
            return true
        }
    }

    let excluded = false
    for (const rule of filterConfig.rules) {
        if (lowered.has(rule.target.toLowerCase())) {
            excluded = rule.type === 'exclude'
        }
    }
    return excluded
}

const TEAM_SCOPED_PROMPT_SHIMS = new Set([
    'team-session-summary',
    'team_session_summary',
    'mj_team_session_summary',
    'create-team-entry',
    'mj_create_team_entry',
    'update-team-entry',
    'mj_update_team_entry',
])

function appendTeamShimGroup(targets: string[], ...candidates: (string | undefined)[]): string[] {
    return candidates.some((c) => c !== undefined && TEAM_SCOPED_PROMPT_SHIMS.has(c))
        ? [...targets, 'team']
        : targets
}

/** [M7] Enforce read-only filters, mutating target activation, and explicit `-tool`/`-group` exclusions on dummy aliases. */
export function isDummyToolAllowedByFilter(
    name: string,
    filterConfig: ToolFilterConfig,
    agentHealingEnabled: boolean,
    codemodeInternalFullAccess = false
): boolean {
    if (!agentHealingEnabled || !DUMMY_HEALING_TOOL_NAMES.has(name)) {
        return false
    }
    const info = resolveDummyTargetInfo(name)
    const isReadOnly = info?.readOnly === true
    if (!isReadOnly && isFilterEffectivelyReadOnly(filterConfig)) {
        return false
    }
    if (info !== undefined && !isToolVisibleForFilter(info.target, info.readOnly, filterConfig.raw)) {
        return false
    }
    const matchTargets = appendTeamShimGroup(
        info !== undefined ? [name, info.target, info.group] : [name],
        name,
        info?.target
    )
    if (isTargetExcludedByRules(matchTargets, filterConfig)) {
        return false
    }
    if (!isReadOnly && info === undefined) {
        return false
    }
    if (info !== undefined && info.isMcpTool && !filterConfig.enabledTools.has(info.target)) {
        const allowFullCodemode =
            codemodeInternalFullAccess &&
            filterConfig.enabledTools.has('mj_execute_code') &&
            (isReadOnly || !isFilterEffectivelyReadOnly(filterConfig))
        if (!allowFullCodemode) return false
    }
    return true
}

/** [M7] Check whether an autonomous unknown-tool shim call is blocked by active filter rules or read-only mode. */
export function isAutonomousShimBlockedByFilter(
    requestedTool: string,
    matchingPromptName: string | undefined,
    filterConfig: ToolFilterConfig,
    codemodeInternalFullAccess = false
): boolean {
    const shimInfo = resolveDummyTargetInfo(requestedTool)
    const rawTargets =
        shimInfo !== undefined
            ? [requestedTool, shimInfo.target, shimInfo.group]
            : requestedTool.startsWith('memory://')
              ? [requestedTool, 'read_resource', 'resources']
              : matchingPromptName !== undefined
                ? [requestedTool, matchingPromptName, 'get_prompt', 'prompts']
                : [requestedTool]
    const shimTargets = appendTeamShimGroup(rawTargets, requestedTool, shimInfo?.target, matchingPromptName)

    if (isTargetExcludedByRules(shimTargets, filterConfig)) {
        return true
    }

    if (shimInfo !== undefined) {
        if (!shimInfo.readOnly && isFilterEffectivelyReadOnly(filterConfig)) {
            return true
        }
        if (!isToolVisibleForFilter(shimInfo.target, shimInfo.readOnly, filterConfig.raw)) {
            return true
        }
        if (shimInfo.isMcpTool && !filterConfig.enabledTools.has(shimInfo.target)) {
            const allowFullCodemode =
                codemodeInternalFullAccess &&
                filterConfig.enabledTools.has('mj_execute_code') &&
                (shimInfo.readOnly || !isFilterEffectivelyReadOnly(filterConfig))
            if (!allowFullCodemode) return true
        }
    }

    return false
}

function buildToolDisabledResponse(name: string): Record<string, unknown> {
    return {
        success: false,
        error: `Tool '${name}' is disabled by the active --tool-filter configuration.`,
        code: 'TOOL_DISABLED',
        category: 'authorization',
        suggestion: 'Update the active tool filter or use an enabled tool.',
        recoverable: false,
    }
}

/** Enforce active `--tool-filter` rules against primary tools and dummy aliases before dispatch. */
export function assertToolFilterAllowsCall(
    name: string,
    toolReadOnlyHint: boolean | undefined,
    filterConfig: ToolFilterConfig,
    agentHealing: boolean | undefined,
    codemodeInternalFullAccess: boolean
): Record<string, unknown> | undefined {
    const isPrimaryEnabled = filterConfig.enabledTools.has(name)
    const isDummyAllowed = isDummyToolAllowedByFilter(
        name,
        filterConfig,
        agentHealing !== false,
        codemodeInternalFullAccess
    )
    const isCodeModeShortcut =
        agentHealing !== false &&
        filterConfig.enabledTools.has('mj_execute_code') &&
        DUMMY_HEALING_TOOL_NAMES.has(name) &&
        isDummyAllowed
    if (!isPrimaryEnabled && !isDummyAllowed && !isCodeModeShortcut) {
        return buildToolDisabledResponse(name)
    }
    const dummyInfo = !isPrimaryEnabled ? resolveDummyTargetInfo(name) : undefined
    const visibilityTarget = dummyInfo?.target ?? name
    const visibilityReadOnly = dummyInfo?.readOnly ?? toolReadOnlyHint
    if (!isToolVisibleForFilter(visibilityTarget, visibilityReadOnly, filterConfig.raw)) {
        return buildToolDisabledResponse(name)
    }
    return undefined
}
