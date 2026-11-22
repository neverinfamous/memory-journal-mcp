import type { ToolDefinition, ToolContext, ProjectRegistryEntry } from '../../../types/index.js'
import type { ToolFilterConfig } from '../../../types/filtering.js'
import { createSandboxPool, type ISandboxPool } from '../../../codemode/sandbox-factory.js'
import { CodeModeSecurityManager } from '../../../codemode/security.js'
import { createJournalApi, getCachedSandboxSchemas, type JournalApi } from '../../../codemode/api/journal-api.js'
import type { RegistryOpsConfig } from '../../../codemode/api/types.js'
import { isFilterEffectivelyReadOnly, isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import { ConfigManager } from '../../../utils/config-manager.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { createContextualSecureDispatcher } from './secure-dispatcher.js'
import { getCodemodeInvocationState } from './invocation-store.js'

import { getCoreTools, getStalenessTools } from '../core/index.js'
import { getSearchTools } from '../search/index.js'
import { getAnalyticsTools } from '../analytics.js'
import { getRelationshipTools } from '../relationships.js'
import { getIoTools } from '../io/index.js'
import { getAdminTools } from '../admin/index.js'
import { getGitHubTools } from '../github.js'
import { getGitTools } from '../git.js'
import { getBackupTools } from '../backup.js'
import { getTeamTools } from '../team/index.js'

// ============================================================================
// Singleton State & Caching
// ============================================================================

let globalSandboxPool: ISandboxPool | null = null

export function getSandboxPool(): ISandboxPool {
    globalSandboxPool ??= createSandboxPool()
    return globalSandboxPool
}

let globalSecurityManager: CodeModeSecurityManager | null = null

export function getSecurityManager(): CodeModeSecurityManager {
    globalSecurityManager ??= new CodeModeSecurityManager()
    return globalSecurityManager
}

export interface CachedCodemodeBundle {
    tools: ToolDefinition[]
    allEnabledTools: ToolDefinition[]
    isSandboxReadonly: boolean
    journalApi: JournalApi
    apiBindings: Record<string, unknown>
    schemas: Record<string, Record<string, string>>
    contextConfig: ToolContext['config']
    filterConfig: ToolFilterConfig | null | undefined
    enabledTools: Set<string> | undefined
    rawFilter: string | undefined
    fullAccess: boolean
}

const MAX_CODEMODE_BUNDLE_ENTRIES = 16
let cachedNonCodeModeTools = new WeakMap<ToolContext, ToolDefinition[]>()
let cachedCodemodeBundles = new WeakMap<ToolContext, Map<string, CachedCodemodeBundle>>()

/**
 * Dispose the Code Mode sandbox pool and security manager (cleanup interval).
 * Safe to call when neither singleton was created; intended for server shutdown.
 */
export function disposeCodemodeResources(): void {
    const pool = globalSandboxPool
    const security = globalSecurityManager
    globalSandboxPool = null
    globalSecurityManager = null
    cachedNonCodeModeTools = new WeakMap<ToolContext, ToolDefinition[]>()
    cachedCodemodeBundles = new WeakMap<ToolContext, Map<string, CachedCodemodeBundle>>()
    pool?.dispose()
    security?.dispose()
}

/**
 * Lazily instantiate and cache non-codemode tools per ToolContext instance.
 */
export function collectNonCodeModeTools(context: ToolContext): ToolDefinition[] {
    const cached = cachedNonCodeModeTools.get(context)
    if (cached !== undefined) {
        return cached
    }

    const tools = [
        ...getCoreTools(context),
        ...getStalenessTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getIoTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
        ...getGitTools(context),
    ]

    const filtered = tools.filter((t) => t.name !== 'mj_execute_code')
    cachedNonCodeModeTools.set(context, filtered)
    return filtered
}

function buildFilteredTools(
    sessionContext: ToolContext,
    context: ToolContext,
    readonlyRequested: boolean | undefined
): { tools: ToolDefinition[]; allEnabledTools: ToolDefinition[]; isSandboxReadonly: boolean } {
    let tools = collectNonCodeModeTools(sessionContext)
    const fullAccess = context.config?.codemodeInternalFullAccess === true
    if (!fullAccess && context.config?.filterConfig?.enabledTools !== undefined) {
        const enabledSet = context.config.filterConfig.enabledTools
        const rawFilter = context.config.filterConfig.raw
        tools = tools.filter(
            (t) =>
                t.name !== 'update_configuration' &&
                enabledSet.has(t.name) &&
                isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, rawFilter)
        )
    } else if (!fullAccess) {
        tools = tools.filter((t) => t.name !== 'update_configuration')
    }
    const allEnabledTools = tools
    const filterConfig = context.config?.filterConfig
    const isGlobalReadonly =
        filterConfig !== null && filterConfig !== undefined
            ? isFilterEffectivelyReadOnly(filterConfig)
            : false
    const isSandboxReadonly = Boolean(readonlyRequested) || isGlobalReadonly
    if (isSandboxReadonly) {
        tools = tools.filter((t) => t.annotations?.readOnlyHint === true)
    }
    return { tools, allEnabledTools, isSandboxReadonly }
}

/**
 * Retrieve or build a memoized JournalApi, sandbox bindings, and schema map per
 * session context and active filter/readonly configuration so WorkerSandbox RPC
 * method metadata and schema caches remain warm across invocations.
 */
function buildRegistryOpsConfig(context: ToolContext): RegistryOpsConfig {
    const cfgMgr = context.config?.runtime?.configManager
    return {
        getConfigFilePath: (): string | undefined =>
            cfgMgr instanceof ConfigManager ? cfgMgr.getConfigFilePath() : undefined,
        onRegistryUpdate: (nextRegistry: Record<string, unknown>): void => {
            if (context.config === undefined) return
            const typed = nextRegistry as Record<string, ProjectRegistryEntry>
            context.config.projectRegistry = typed
            if (context.config.briefingConfig !== undefined) {
                context.config.briefingConfig.projectRegistry = typed
            }
            if (cfgMgr instanceof ConfigManager) {
                const briefingConfig = {
                    ...cfgMgr.getConfig().briefingConfig,
                    projectRegistry: typed,
                }
                cfgMgr.updateConfig({ briefingConfig }, false)
            }
        },
    }
}

export function getOrCreateCodemodeBundle(
    sessionContext: ToolContext,
    context: ToolContext,
    readonlyRequested: boolean | undefined
): CachedCodemodeBundle {
    const filterConfig = context.config?.filterConfig
    const fullAccess = context.config?.codemodeInternalFullAccess === true
    const isGlobalReadonly =
        filterConfig !== null && filterConfig !== undefined
            ? isFilterEffectivelyReadOnly(filterConfig)
            : false
    const isSandboxReadonly = Boolean(readonlyRequested) || isGlobalReadonly
    const rawFilter = filterConfig?.raw
    const key = `${fullAccess ? '1' : '0'}:${isSandboxReadonly ? '1' : '0'}:${rawFilter ?? ''}`

    let byConfig = cachedCodemodeBundles.get(sessionContext)
    if (byConfig === undefined) {
        byConfig = new Map<string, CachedCodemodeBundle>()
        cachedCodemodeBundles.set(sessionContext, byConfig)
    } else {
        const existing = byConfig.get(key)
        if (
            existing !== undefined &&
            existing.contextConfig === context.config &&
            existing.filterConfig === filterConfig &&
            existing.enabledTools === filterConfig?.enabledTools &&
            existing.rawFilter === rawFilter &&
            existing.fullAccess === fullAccess
        ) {
            return existing
        }
    }

    const filtered = buildFilteredTools(sessionContext, context, readonlyRequested)
    const contextualDispatcher = createContextualSecureDispatcher(filtered.tools)
    const journalApi = createJournalApi(
        filtered.tools,
        contextualDispatcher,
        () =>
            activeProjectRegistry(
                getCodemodeInvocationState()?.projectRegistry ?? context.config?.projectRegistry
            ),
        buildRegistryOpsConfig(context)
    )
    const apiBindings = journalApi.createSandboxBindings(
        () => getCodemodeInvocationState()?.sessionContext.progress
    )
    const schemas = filtered.isSandboxReadonly
        ? getCachedSandboxSchemas(filtered.allEnabledTools)
        : journalApi.createSandboxSchemas()

    const bundle: CachedCodemodeBundle = {
        tools: filtered.tools,
        allEnabledTools: filtered.allEnabledTools,
        isSandboxReadonly: filtered.isSandboxReadonly,
        journalApi,
        apiBindings,
        schemas,
        contextConfig: context.config,
        filterConfig,
        enabledTools: filterConfig?.enabledTools,
        rawFilter,
        fullAccess,
    }
    if (byConfig.size >= MAX_CODEMODE_BUNDLE_ENTRIES) {
        const oldestKey = byConfig.keys().next().value
        if (oldestKey !== undefined) byConfig.delete(oldestKey)
    }
    byConfig.set(key, bundle)
    return bundle
}
