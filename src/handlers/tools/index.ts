/**
 * Tool Handler Barrel
 *
 * Composes all tool group modules and exposes the public API:
 * - getTools(): returns filtered tool definitions for the MCP server
 * - callTool(): dispatches a tool call by name
 *
 * Each group module owns its:
 * - Input/output Zod schemas
 * - Tool definitions (name, description, group, annotations)
 * - Handler implementations (with try/catch + formatHandlerError)
 */

import type {
    ToolFilterConfig,
    ToolDefinition,
    ToolRegistration,
    ToolContext,
    ToolHandlerConfig,
} from '../../types/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'
import { isToolVisibleForFilter } from '../../filtering/tool-filter.js'
import {
    isBareRuntimeWrapperConfig,
    type CachedToolContextRefs,
} from './tool-cache-helpers.js'

import {
    getCoreTools,
    getStalenessTools,
    getDummyHealingTools,
} from './core/index.js'
import {
    assertToolFilterAllowsCall,
    isDummyToolAllowedByFilter,
} from './dummy-filter-helpers.js'
import { getSearchTools } from './search/index.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getIoTools } from './io/index.js'
import { getAdminTools } from './admin/index.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team/index.js'
import { getCodeModeTools } from './codemode/index.js'
import { getGitTools } from './git.js'

import { injectTokenEstimate } from '../../observability/index.js'
import { enforceAccessBoundary } from '../../auth/validation.js'
import { ConfigurationError } from '../../types/errors.js'
import {
    applyArgInterceptions,
    injectProjectNames,
    getToolIcon,
    instrumentToolDefinitions,
    throwToolNotFoundError,
} from './arg-interceptions.js'
import {
    applyToolHealingArgs,
    enforcePreHealingToolGuards,
    enforceToolInputElementBound,
    getEntryToResourceRewriteUri,
} from './call-guards.js'
import { getAuthContext } from '../../auth/auth-context.js'
import { getRequestContext, requestContextStorage } from '../../utils/request-context.js'

// Re-export for backward compatibility
export type { ToolHandlerConfig }
export {
    applyArgInterceptions,
    injectProjectNames,
}

// ============================================================================
// Public API
// ============================================================================

function mapToolToRegistration(t: ToolDefinition): ToolRegistration {
    const reg: ToolRegistration = {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
        annotations: t.annotations,
        icons: getToolIcon(t.group),
    }
    return Object.assign(reg, { group: t.group })
}

/**
 * Get all tool definitions, optionally filtered by config
 */
export function getTools(
    db: IDatabaseAdapter,
    filterConfig: ToolFilterConfig | null,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): ToolRegistration[] {
    ensureToolCache(db, vectorManager, github, config, teamDb, teamVectorManager)

    if (filterConfig) {
        const mapToUse = config?.runtime?.toolMapCache ?? toolMapCache ?? EMPTY_TOOL_MAP
        const includeDummy = config?.agentHealing !== false
        const fullAccess = config?.codemodeInternalFullAccess === true
        const raw = filterConfig.raw
        const cached = filteredToolsCache.get(filterConfig)
        if (
            cached?.toolMap === mapToUse &&
            cached.raw === raw &&
            cached.enabledTools === filterConfig.enabledTools &&
            cached.includeDummy === includeDummy &&
            cached.fullAccess === fullAccess
        ) {
            return cached.result
        }
        const result = Array.from(mapToUse.values())
            .filter(
                (t) =>
                    (filterConfig.enabledTools.has(t.name) ||
                        isDummyToolAllowedByFilter(t.name, filterConfig, includeDummy, fullAccess)) &&
                    isToolVisibleForFilter(t.name, t.annotations.readOnlyHint, raw)
            )
            .map(mapToolToRegistration)
        filteredToolsCache.set(filterConfig, {
            toolMap: mapToUse,
            raw,
            enabledTools: filterConfig.enabledTools,
            includeDummy,
            fullAccess,
            result,
        })
        return result
    }

    if (config?.runtime) {
        config.runtime.mappedToolsCache ??= Array.from(
            (config.runtime.toolMapCache ?? EMPTY_TOOL_MAP).values()
        ).map(mapToolToRegistration)
        return config.runtime.mappedToolsCache
    }

    mappedToolsCache ??= Array.from((toolMapCache ?? EMPTY_TOOL_MAP).values()).map(
        mapToolToRegistration
    )
    return mappedToolsCache
}

/**
 * Cached tool map for O(1) lookup in callTool and getTools.
 */
let toolMapCache: Map<string, ToolDefinition> | null = null
/** Cached mapped tool output for unfiltered getTools calls */
let mappedToolsCache: ToolRegistration[] | null = null
/** Cached mapped tool output per active ToolFilterConfig instance */
const filteredToolsCache = new WeakMap<
    ToolFilterConfig,
    {
        toolMap: Map<string, ToolDefinition>
        raw: string
        enabledTools: Set<string>
        includeDummy: boolean
        fullAccess: boolean
        result: ToolRegistration[]
    }
>()
/** Typed empty map for safe fallback */
const EMPTY_TOOL_MAP = new Map<string, ToolDefinition>()
let cachedContextRefs: CachedToolContextRefs | null = null

function safeIsAvailable(gh: GitHubIntegration | undefined | null): boolean | undefined {
    return gh ? gh.isApiAvailable() : undefined
}

function safeIsInitialized(vm: VectorSearchManager | undefined | null): boolean | undefined {
    if (!vm) return undefined
    return typeof vm.isInitialized === 'function' ? vm.isInitialized() : undefined
}

export function isCacheHit(
    refs: CachedToolContextRefs | null | undefined,
    cache: Map<string, ToolDefinition> | null | undefined,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): boolean {
    if (!cache || !refs) return false
    if (refs.db !== db || refs.teamDb !== teamDb) return false
    if (
        refs.github !== github ||
        refs.vectorManager !== vectorManager ||
        refs.teamVectorManager !== teamVectorManager
    ) {
        return false
    }
    const ghAvail = github !== undefined ? github.isApiAvailable() : undefined
    const vmInit =
        vectorManager !== undefined && typeof vectorManager.isInitialized === 'function'
            ? vectorManager.isInitialized()
            : undefined
    const tvmInit =
        teamVectorManager !== undefined && typeof teamVectorManager.isInitialized === 'function'
            ? teamVectorManager.isInitialized()
            : undefined
    const prevGhAvail =
        'githubAvailable' in refs ? refs.githubAvailable : safeIsAvailable(refs.github)
    const prevVmInit =
        'vectorInitialized' in refs ? refs.vectorInitialized : safeIsInitialized(refs.vectorManager)
    const prevTvmInit =
        'teamVectorInitialized' in refs
            ? refs.teamVectorInitialized
            : safeIsInitialized(refs.teamVectorManager)
    if (prevGhAvail !== ghAvail || prevVmInit !== vmInit || prevTvmInit !== tvmInit) {
        return false
    }
    if (refs.config !== config) return false
    if (
        'agentHealing' in refs &&
        (refs.agentHealing !== config?.agentHealing ||
            refs.codemodeEnabled !== config?.codemodeEnabled ||
            refs.codemodeInternalFullAccess !== config?.codemodeInternalFullAccess)
    ) {
        return false
    }
    return true
}

function hasValidToolCache(
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): boolean {
    if (config?.runtime) {
        const rt = config.runtime
        const refs = rt.cachedContextRefs as typeof cachedContextRefs
        if (isCacheHit(refs, rt.toolMapCache, db, vectorManager, github, config, teamDb, teamVectorManager)) {
            return true
        }
        return (
            isBareRuntimeWrapperConfig(config) &&
            rt.toolMapCache !== null &&
            refs !== undefined &&
            refs !== null &&
            isCacheHit(refs, rt.toolMapCache, db, vectorManager, github, refs.config, teamDb, refs.teamVectorManager)
        )
    }
    return isCacheHit(cachedContextRefs, toolMapCache, db, vectorManager, github, config, teamDb, teamVectorManager)
}

function createCachedToolContext(
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): ToolContext {
    return {
        db, teamDb, vectorManager, teamVectorManager, github, config,
        get progress(): ProgressContext | undefined {
            return getRequestContext()?.progress
        },
        get auth(): ToolContext['auth'] {
            const authCtx = getAuthContext()
            if (authCtx?.claims === undefined) return undefined
            return { ...(authCtx.claims.sub !== undefined ? { sub: authCtx.claims.sub } : {}), scopes: authCtx.claims.scopes }
        },
    }
}

function ensureToolCache(
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): void {
    if (hasValidToolCache(db, vectorManager, github, config, teamDb, teamVectorManager)) return
    const context = createCachedToolContext(db, vectorManager, github, config, teamDb, teamVectorManager)
    const instrumentedDefs = instrumentToolDefinitions(getAllToolDefinitions(context), config)
    const nextRefs: CachedToolContextRefs = {
        db, github, githubAvailable: github !== undefined ? github.isApiAvailable() : undefined,
        vectorManager,
        vectorInitialized: vectorManager !== undefined && typeof vectorManager.isInitialized === 'function' ? vectorManager.isInitialized() : undefined,
        config, agentHealing: config?.agentHealing, codemodeEnabled: config?.codemodeEnabled,
        codemodeInternalFullAccess: config?.codemodeInternalFullAccess, teamDb, teamVectorManager,
        teamVectorInitialized: teamVectorManager !== undefined && typeof teamVectorManager.isInitialized === 'function' ? teamVectorManager.isInitialized() : undefined,
    }
    if (config?.runtime) {
        config.runtime.toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        config.runtime.mappedToolsCache = null
        config.runtime.cachedContextRefs = nextRefs
    } else {
        toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        mappedToolsCache = null
        cachedContextRefs = nextRefs
    }
}

/**
 * Call a tool by name
 */
export async function callTool(
    name: string,
    args: Record<string, unknown>,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    progress?: ProgressContext,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): Promise<unknown> {
    const elementLimitError = enforceToolInputElementBound(args, config)
    if (elementLimitError !== undefined) return elementLimitError

    ensureToolCache(db, vectorManager, github, config, teamDb, teamVectorManager)
    const mapToUse = config?.runtime?.toolMapCache ?? toolMapCache ?? EMPTY_TOOL_MAP
    const preTool = mapToUse.get(name)
    const rewriteUri = getEntryToResourceRewriteUri(name, args, mapToUse, config)
    const preGuard = enforcePreHealingToolGuards(name, preTool, config)
    if (preGuard.blocked) return preGuard.result

    const healed = applyToolHealingArgs(name, args, config)
    if ('error' in healed) return healed.error
    args = healed.args

    const postRewriteUri =
        rewriteUri ?? getEntryToResourceRewriteUri(name, args, mapToUse, config)
    if (postRewriteUri !== undefined) {
        args = { ...args, uri: postRewriteUri }
        name = 'read_resource'
    }
    const tool = postRewriteUri !== undefined || preTool === undefined ? mapToUse.get(name) : preTool
    if (!tool) throwToolNotFoundError(name)

    const needsPostChecks = preTool === undefined || postRewriteUri !== undefined
    if (needsPostChecks && config?.filterConfig) {
        const disabled = assertToolFilterAllowsCall(
            name,
            tool.annotations.readOnlyHint,
            config.filterConfig,
            config.agentHealing,
            config.codemodeInternalFullAccess === true
        )
        if (disabled !== undefined) return disabled
    }
    if (!config?.runtime?.maintenanceManager) {
        throw new ConfigurationError(
            'ServerRuntime is logically required for secure tool execution. Please initialize the server correctly.'
        )
    }
    if (needsPostChecks) {
        try {
            enforceAccessBoundary(name, 'tool', tool.capabilities, config.runtime.auditLogger)
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)))
        }
    }

    const maintenanceManager = config.runtime.maintenanceManager
    const runTool = (): Promise<unknown> =>
        maintenanceManager.withActiveJob(
            () => Promise.resolve(tool.handler(args)),
            name === 'restore_backup'
        )
    const result = progress
        ? await requestContextStorage.run({ ...(getRequestContext() ?? {}), progress }, runTool)
        : await runTool()

    injectProjectNames(result, config?.projectRegistry)
    return injectTokenEstimate(result)
}

/**
 * Compose all tool definitions from group modules
 */
function getAllToolDefinitions(context: ToolContext): ToolDefinition[] {
    const primaryTools = [
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
        ...getCodeModeTools(context),
        ...getGitTools(context),
    ]
    if (context.config?.agentHealing === false) {
        return primaryTools
    }
    const primaryNames = new Set(primaryTools.map((t) => t.name))
    const dummyTools = getDummyHealingTools(context).filter((t) => !primaryNames.has(t.name))
    return [...primaryTools, ...dummyTools]
}
