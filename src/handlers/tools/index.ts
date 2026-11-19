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
import { isCacheHit, type CachedToolContextRefs } from './tool-cache-helpers.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../codemode/normalizers/project-alias-helpers.js'
import {
    exceedsMaxToolInputElements,
    resolveEffectiveMaxToolInputElements,
} from '../../utils/tool-input-bounds.js'

import {
    getCoreTools,
    getStalenessTools,
    getDummyHealingTools,
} from './core/index.js'
import { DUMMY_HEALING_TOOL_NAMES } from './core/dummy-healing/alias-catalog.js'
import { isDummyToolAllowedByFilter } from './dummy-filter-helpers.js'
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
import { ALREADY_HEALED_ARGS } from '../../server/mcp-server/tool-registration/healed-args-marker.js'
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

    const mapTool = (t: ToolDefinition): ToolRegistration => {
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

    if (filterConfig) {
        const mapToUse = config?.runtime?.toolMapCache ?? toolMapCache ?? EMPTY_TOOL_MAP
        const includeDummyTools = config?.agentHealing !== false
        const codemodeInternalFullAccess = config?.codemodeInternalFullAccess === true
        const raw = filterConfig.raw
        return Array.from(mapToUse.values())
            .filter(
                (t) =>
                    (filterConfig.enabledTools.has(t.name) ||
                        isDummyToolAllowedByFilter(
                            t.name,
                            filterConfig,
                            includeDummyTools,
                            codemodeInternalFullAccess
                        )) &&
                    isToolVisibleForFilter(t.name, t.annotations.readOnlyHint, raw)
            )
            .map(mapTool)
    }

    if (config?.runtime) {
        config.runtime.mappedToolsCache ??= Array.from(
            (config.runtime.toolMapCache ?? EMPTY_TOOL_MAP).values()
        ).map(mapTool)
        return config.runtime.mappedToolsCache
    }

    mappedToolsCache ??= Array.from((toolMapCache ?? EMPTY_TOOL_MAP).values()).map(mapTool)
    return mappedToolsCache
}

/**
 * Cached tool map for O(1) lookup in callTool and getTools.
 */
let toolMapCache: Map<string, ToolDefinition> | null = null
/** Cached mapped tool output for unfiltered getTools calls */
let mappedToolsCache: ToolRegistration[] | null = null
/** Typed empty map for safe fallback */
const EMPTY_TOOL_MAP = new Map<string, ToolDefinition>()
let cachedContextRefs: CachedToolContextRefs | null = null

function ensureToolCache(
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): void {
    if (config?.runtime) {
        const rt = config.runtime
        const refs = rt.cachedContextRefs as typeof cachedContextRefs
        if (
            isCacheHit(
                refs,
                rt.toolMapCache,
                db,
                vectorManager,
                github,
                config,
                teamDb,
                teamVectorManager
            )
        ) {
            return
        }
    } else if (
        isCacheHit(
            cachedContextRefs,
            toolMapCache,
            db,
            vectorManager,
            github,
            config,
            teamDb,
            teamVectorManager
        )
    ) {
        return
    }

    const context: ToolContext = {
        db,
        teamDb,
        vectorManager,
        teamVectorManager,
        github,
        config,
        get progress(): ProgressContext | undefined {
            return getRequestContext()?.progress
        },
        get auth(): ToolContext['auth'] {
            const authCtx = getAuthContext()
            if (authCtx?.claims === undefined) return undefined
            return {
                ...(authCtx.claims.sub !== undefined ? { sub: authCtx.claims.sub } : {}),
                scopes: authCtx.claims.scopes,
            }
        },
    }
    const instrumentedDefs = instrumentToolDefinitions(getAllToolDefinitions(context), config)

    if (config?.runtime) {
        config.runtime.toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        config.runtime.mappedToolsCache = null
        config.runtime.cachedContextRefs = {
            db,
            github,
            vectorManager,
            config,
            teamDb,
            teamVectorManager,
        }
    } else {
        toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        mappedToolsCache = null
        cachedContextRefs = { db, github, vectorManager, config, teamDb, teamVectorManager }
    }
}

function applyToolHealingArgs(
    name: string,
    args: Record<string, unknown>,
    config?: ToolHandlerConfig
): { args: Record<string, unknown> } | { error: Record<string, unknown> } {
    if (config?.agentHealing === false || ALREADY_HEALED_ARGS.has(args)) return { args }
    const prevRegistryState = captureActiveProjectRegistryState()
    setActiveProjectRegistry(config?.projectRegistry)
    try {
        const intercept = applyArgInterceptions(name, [args])
        if ('error' in intercept) return intercept
        return { args: (intercept.args[0] as Record<string, unknown>) ?? args }
    } finally {
        restoreActiveProjectRegistryState(prevRegistryState)
    }
}

function enforceToolInputElementBound(
    args: Record<string, unknown>,
    config?: ToolHandlerConfig
): Record<string, unknown> | undefined {
    const maxElements = resolveEffectiveMaxToolInputElements(config?.maxToolInputElements)
    if (!exceedsMaxToolInputElements(args, maxElements)) return undefined
    return {
        success: false,
        error: `Tool input exceeds maximum element count (${String(maxElements)}).`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Reduce the number of keys, array items, or nesting depth in tool arguments.',
        recoverable: false,
    }
}

function assertToolFilterAllowsCall(
    name: string,
    tool: ToolDefinition,
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
        return {
            success: false,
            error: `Tool '${name}' is disabled by the active --tool-filter configuration.`,
            code: 'TOOL_DISABLED',
            category: 'authorization',
            suggestion: 'Update the active tool filter or use an enabled tool.',
            recoverable: false,
        }
    }
    if (
        isPrimaryEnabled &&
        !isToolVisibleForFilter(name, tool.annotations.readOnlyHint, filterConfig.raw)
    ) {
        return {
            success: false,
            error: `Tool '${name}' is disabled by the active --tool-filter configuration.`,
            code: 'TOOL_DISABLED',
            category: 'authorization',
            suggestion: 'Update the active tool filter or use an enabled tool.',
            recoverable: false,
        }
    }
    return undefined
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
    const healed = applyToolHealingArgs(name, args, config)
    if ('error' in healed) return healed.error
    args = healed.args

    const mapToUse = config?.runtime?.toolMapCache ?? toolMapCache ?? EMPTY_TOOL_MAP
    const trimmedEntryUri =
        typeof args['uri'] === 'string' ? args['uri'].trim() : undefined
    if (
        config?.agentHealing !== false &&
        name === 'get_entry_by_id' &&
        args['entry_id'] === undefined &&
        trimmedEntryUri !== undefined &&
        trimmedEntryUri.startsWith('memory://') &&
        !/^memory:\/\/(?:entries|entry)\/\d+$/i.test(trimmedEntryUri) &&
        mapToUse.has('read_resource')
    ) {
        args = { ...args, uri: trimmedEntryUri }
        name = 'read_resource'
    }
    const tool = mapToUse.get(name)
    if (!tool) throwToolNotFoundError(name)

    if (config?.filterConfig) {
        const disabled = assertToolFilterAllowsCall(
            name,
            tool,
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
    try {
        enforceAccessBoundary(name, 'tool', tool.capabilities, config.runtime.auditLogger)
    } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
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
