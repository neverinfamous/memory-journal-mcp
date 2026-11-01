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

import { getCoreTools, getStalenessTools, getDummyHealingTools, DUMMY_HEALING_TOOL_NAMES } from './core/index.js'
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
    ARG_ALIASES,
    BOOLEAN_COERCIONS,
    NUMBER_COERCIONS,
    applyArgInterceptions,
    injectProjectNames,
    getToolIcon,
    wrapToolHandlerWithInterceptors,
    instrumentToolDefinitions,
    throwToolNotFoundError,
} from './arg-interceptions.js'

// Re-export for backward compatibility
export type { ToolHandlerConfig }
export {
    ARG_ALIASES,
    BOOLEAN_COERCIONS,
    NUMBER_COERCIONS,
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
        return Array.from(mapToUse.values())
            .filter(
                (t) =>
                    filterConfig.enabledTools.has(t.name) ||
                    (includeDummyTools && DUMMY_HEALING_TOOL_NAMES.has(t.name))
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
let cachedContextRefs: {
    db: IDatabaseAdapter
    github?: GitHubIntegration
    vectorManager?: VectorSearchManager
    config?: ToolHandlerConfig
    teamDb?: IDatabaseAdapter
    teamVectorManager?: VectorSearchManager
} | null = null

function safeIsAvailable(gh: GitHubIntegration | undefined | null): boolean | undefined {
    if (!gh) return undefined
    const ghObj = gh as unknown as Record<string, unknown>
    const isAvail = ghObj['isAvailable']
    return typeof isAvail === 'function' ? Boolean(isAvail.call(gh)) : undefined
}

function safeIsInitialized(vm: VectorSearchManager | undefined | null): boolean | undefined {
    if (!vm) return undefined
    const vmObj = vm as unknown as Record<string, unknown>
    const isInit = vmObj['isInitialized']
    return typeof isInit === 'function' ? Boolean(isInit.call(vm)) : undefined
}

function isCacheHit(
    refs: typeof cachedContextRefs,
    cache: Map<string, ToolDefinition> | null | undefined,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): boolean {
    return Boolean(
        cache &&
            refs?.db === db &&
            (refs.github === github || safeIsAvailable(refs.github) === safeIsAvailable(github)) &&
            (refs.vectorManager === vectorManager ||
                safeIsInitialized(refs.vectorManager) === safeIsInitialized(vectorManager)) &&
            refs.config === config &&
            refs.teamDb === teamDb &&
            (refs.teamVectorManager === teamVectorManager ||
                safeIsInitialized(refs.teamVectorManager) ===
                    safeIsInitialized(teamVectorManager))
    )
}

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

    const context: ToolContext = { db, teamDb, vectorManager, teamVectorManager, github, config }
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
    ensureToolCache(db, vectorManager, github, config, teamDb, teamVectorManager)

    if (config?.agentHealing !== false) {
        const intercept = applyArgInterceptions(name, [args])
        if ('error' in intercept) {
            return intercept.error
        }
        const cleanArgs = (intercept.args[0] as Record<string, unknown>) ?? args
        args = cleanArgs
    }

    const mapToUse = config?.runtime?.toolMapCache ?? toolMapCache ?? EMPTY_TOOL_MAP
    const tool = mapToUse.get(name)

    if (!tool) {
        throwToolNotFoundError(name)
    }

    if (!config?.runtime?.maintenanceManager) {
        throw new ConfigurationError(
            'ServerRuntime is logically required for secure tool execution. Please initialize the server correctly.'
        )
    }

    try {
        const auditLogger = config?.runtime?.auditLogger
        enforceAccessBoundary(name, 'tool', tool.capabilities, auditLogger)
    } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }

    if (progress) {
        const context: ToolContext = {
            db,
            teamDb,
            vectorManager,
            teamVectorManager,
            github,
            config,
            progress,
        }
        const freshTool = getAllToolDefinitions(context).find((t) => t.name === name)
        if (freshTool) {
            const wrappedHandler = wrapToolHandlerWithInterceptors(
                freshTool.name,
                freshTool.handler,
                config
            )
            const freshResult = await config.runtime.maintenanceManager.withActiveJob(
                () => wrappedHandler(args),
                name === 'restore_backup'
            )
            injectProjectNames(freshResult, config?.projectRegistry)
            return injectTokenEstimate(freshResult)
        }
    }

    const result = await config.runtime.maintenanceManager.withActiveJob(
        () => Promise.resolve(tool.handler(args)),
        name === 'restore_backup'
    )
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
