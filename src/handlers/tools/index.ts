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
import type { VectorSearchManager } from '../../vector/vector-search-manager.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { getCoreTools } from './core.js'
import { getSearchTools } from './search/index.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getIoTools } from './io.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team/index.js'
import { getCodeModeTools } from './codemode.js'

import { globalMetrics, wrapWithMetrics, injectTokenEstimate } from '../../observability/index.js'
import { AuditLogger, createAuditInterceptor } from '../../audit/index.js'
import type { AuditConfig, AuditInterceptor } from '../../audit/index.js'

import { getAuthContext } from '../../auth/auth-context.js'
import { getRequiredScope } from '../../auth/scope-map.js'
import { hasScope } from '../../auth/scopes.js'
import { logger } from '../../utils/logger.js'
import { PermissionError, ResourceNotFoundError, ConfigurationError } from '../../types/errors.js'

// Re-export for backward compatibility (McpServer imports these)
export type { ToolHandlerConfig }

// ============================================================================
// Global Audit Logger Singleton
// ============================================================================

let globalAuditLogger: AuditLogger | null = null
let globalAuditInterceptor: AuditInterceptor | null = null

/**
 * Initialize the global audit logger from CLI/env config.
 * Called once during server startup. Must be called before any tool calls.
 */
export function initializeAuditLogger(config: AuditConfig): AuditLogger {
    globalAuditLogger = new AuditLogger(config)
    globalAuditInterceptor = createAuditInterceptor(globalAuditLogger)
    return globalAuditLogger
}

/**
 * Get the global audit logger instance (for shutdown/resource access).
 */
export function getGlobalAuditLogger(): AuditLogger | null {
    return globalAuditLogger
}

// ============================================================================
// Icon Mapping
// ============================================================================

function getToolIcon(
    group: string
): { iconUrl: string; title: string; description: string } | undefined {
    const iconMap: Record<string, { iconUrl: string; title: string; description: string }> = {
        core: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/notebook.svg',
            title: 'Journal Core',
            description: 'Core journal operations',
        },
        search: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/magnify.svg',
            title: 'Search',
            description: 'Entry search operations',
        },
        analytics: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/chart-bar.svg',
            title: 'Analytics',
            description: 'Journal analytics',
        },
        relationships: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/graph-outline.svg',
            title: 'Relationships',
            description: 'Entry relationship management',
        },
        io: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/swap-horizontal.svg',
            title: 'IO',
            description: 'Import/export operations',
        },
        admin: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/cog.svg',
            title: 'Admin',
            description: 'Administrative operations',
        },
        github: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/github.svg',
            title: 'GitHub',
            description: 'GitHub integration',
        },
        backup: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/backup-restore.svg',
            title: 'Backup',
            description: 'Backup and restore',
        },
        team: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/account-group.svg',
            title: 'Team',
            description: 'Team collaboration',
        },
        codemode: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/code-braces.svg',
            title: 'Code Mode',
            description: 'Sandboxed code execution',
        },
    }
    return iconMap[group]
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
    // Ensure tool map is built / up-to-date (shared cache with callTool)
    ensureToolCache(db, vectorManager, github, config, teamDb, teamVectorManager)

    const mapTool = (t: ToolDefinition): ToolRegistration => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        // Only include outputSchema when defined — undefined values in the
        // tools/list response break clients that process the JSON Schema field
        ...(t.outputSchema !== undefined ? { outputSchema: t.outputSchema } : {}),
        annotations: t.annotations,
        icons: getToolIcon(t.group),
    })

    if (filterConfig) {
        // Filtered lists are not cached — filter sets vary per call
        const mapToUse = config?.runtime?.toolMapCache ?? (toolMapCache ?? EMPTY_TOOL_MAP)
        return Array.from(mapToUse.values())
            .filter((t) => filterConfig.enabledTools.has(t.name))
            .map(mapTool)
    }

    if (config?.runtime) {
        config.runtime.mappedToolsCache ??= Array.from((config.runtime.toolMapCache ?? EMPTY_TOOL_MAP).values()).map(mapTool)
        return config.runtime.mappedToolsCache
    }

    // Return cached mapped output for unfiltered calls
    mappedToolsCache ??= Array.from((toolMapCache ?? EMPTY_TOOL_MAP).values()).map(mapTool)
    return mappedToolsCache
}

/**
 * Cached tool map for O(1) lookup in callTool and getTools.
 * Built lazily on first invocation. Invalidates when any
 * context parameter changes (happens in tests with different mocks;
 * in production, all instances are stable).
 */
let toolMapCache: Map<string, ToolDefinition> | null = null
/** Cached mapped tool output for unfiltered getTools calls */
let mappedToolsCache: ToolRegistration[] | null = null
/** Typed empty map for safe fallback (narrowing guard, never actually used) */
const EMPTY_TOOL_MAP = new Map<string, ToolDefinition>()
let cachedContextRefs: {
    db: IDatabaseAdapter
    github?: GitHubIntegration
    vectorManager?: VectorSearchManager
    config?: ToolHandlerConfig
    teamDb?: IDatabaseAdapter
    teamVectorManager?: VectorSearchManager
} | null = null

/**
 * Ensure the tool definition cache is populated and valid for the given context.
 * Shared by getTools() and callTool() to avoid redundant getAllToolDefinitions() calls.
 */
function ensureToolCache(
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    teamDb?: IDatabaseAdapter,
    teamVectorManager?: VectorSearchManager
): void {
    if (config?.runtime) {
        const rt = config.runtime;
        const refs = rt.cachedContextRefs as {
            db: IDatabaseAdapter
            github?: GitHubIntegration
            vectorManager?: VectorSearchManager
            config?: ToolHandlerConfig
            teamDb?: IDatabaseAdapter
            teamVectorManager?: VectorSearchManager
        } | null;
        if (
            rt.toolMapCache &&
            refs?.db === db &&
            refs?.github === github &&
            refs?.vectorManager === vectorManager &&
            refs?.config === config &&
            refs?.teamDb === teamDb &&
            refs?.teamVectorManager === teamVectorManager
        ) {
            return;
        }
    } else {
        if (
            toolMapCache &&
            cachedContextRefs?.db === db &&
            cachedContextRefs.github === github &&
            cachedContextRefs.vectorManager === vectorManager &&
            cachedContextRefs.config === config &&
            cachedContextRefs.teamDb === teamDb &&
            cachedContextRefs.teamVectorManager === teamVectorManager
        ) {
            return // Cache is valid
        }
    }

    const context: ToolContext = { db, teamDb, vectorManager, teamVectorManager, github, config }
    const rawDefs = getAllToolDefinitions(context)

    // Wrap every handler with the metrics interceptor at cache-build time.
    // When audit logging is enabled, also wraps with the audit interceptor.
    // This is O(n) once per cache miss — production cost is negligible.
    const instrumentedDefs: ToolDefinition[] = rawDefs.map((t) => {
        // Layer 1: Metrics collection (always active)
        const metricsWrapped = wrapWithMetrics(
            t.name,
            (args: Record<string, unknown>) => Promise.resolve(t.handler(args)),
            globalMetrics
        )

        // Layer 2: Audit logging (only when initialized)
        const runtimeAudit = config?.runtime ? config.runtime.auditInterceptor : null
        const interceptor = runtimeAudit ?? globalAuditInterceptor
        const finalHandler = interceptor !== null && interceptor !== undefined
            ? (args: Record<string, unknown>): Promise<unknown> =>
                  interceptor.around(t.name, args, () => metricsWrapped(args))
            : metricsWrapped

        return {
            ...t,
            handler: finalHandler as (params: unknown) => unknown,
        }
    })

    if (config?.runtime) {
        config.runtime.toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        config.runtime.mappedToolsCache = null
        config.runtime.cachedContextRefs = { db, github, vectorManager, config, teamDb, teamVectorManager }
    } else {
        toolMapCache = new Map(instrumentedDefs.map((t) => [t.name, t]))
        mappedToolsCache = null // Invalidate mapped cache when definitions change
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

    const mapToUse = config?.runtime?.toolMapCache ?? (toolMapCache ?? EMPTY_TOOL_MAP)
    const tool = mapToUse.get(name)

    if (!tool) {
        throw new ResourceNotFoundError('Tool', name)
    }

    if (!config?.runtime?.maintenanceManager) {
        throw new ConfigurationError('ServerRuntime is logically required for secure tool execution. Please initialize the server correctly.')
    }

    // Authorization Hook: Enforce scope if auth context exists
    const auth = getAuthContext()
    if (auth) {
        const requiredScope = getRequiredScope(name)
        if (!hasScope(auth.claims?.scopes ?? [], requiredScope)) {
            logger.warning(`Insufficient scope for tool: ${name}`, {
                module: 'AUTH',
                operation: 'scope-check',
                entityId: name,
            })
            const auditLogger = config?.runtime?.auditLogger ?? getGlobalAuditLogger()
            if (auditLogger) {
                const category = tool.group === 'core' || tool.group === 'search' || tool.group === 'io' || tool.group === 'relationships' || tool.group === 'analytics' || tool.group === 'github' ? 'read' : tool.group === 'admin' || tool.group === 'backup' ? 'admin' : tool.group === 'team' ? 'team' : 'read'
                auditLogger.logDenial(name, 'Insufficient scope', {
                    user: auth.claims?.sub,
                    scopes: auth.claims?.scopes ?? [],
                    category,
                    scope: requiredScope,
                })
            }
            return Promise.reject(new PermissionError(`Access to tool '${name}' denied: insufficient scope.`))
        }
    }

    // When progress context is provided, rebuild the handler with it.
    // This is rare (only MCP server calls with progress tokens, not benchmarked).
    // IMPORTANT: Fresh handlers must still be wrapped with metrics + audit
    // interceptors — otherwise the progress path bypasses all instrumentation.
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
        const freshTools = getAllToolDefinitions(context)
        const freshTool = freshTools.find((t) => t.name === name)
        if (freshTool) {
            // Layer 1: Metrics
            const metricsWrapped = wrapWithMetrics(
                freshTool.name,
                (a: Record<string, unknown>) => Promise.resolve(freshTool.handler(a)),
                globalMetrics
            )
            // Layer 2: Audit (if initialized)
            const runtimeAudit = config?.runtime !== undefined && config.runtime !== null ? config.runtime.auditInterceptor : null
            const interceptor = runtimeAudit ?? globalAuditInterceptor
            
            const wrappedHandler = async (a: Record<string, unknown>): Promise<unknown> => {
                if (interceptor !== null && interceptor !== undefined) {
                    return await interceptor.around(freshTool.name, a, () => metricsWrapped(a))
                }
                return await metricsWrapped(a)
            }

            if (config?.runtime?.maintenanceManager !== undefined && config.runtime.maintenanceManager !== null) {
                const freshResult = await config.runtime.maintenanceManager.withActiveJob(
                    () => wrappedHandler(args),
                    name === 'restore_backup'
                );
                return injectTokenEstimate(freshResult)
            }

            const freshResult = await wrappedHandler(args)
            return injectTokenEstimate(freshResult)
        }
    }

    if (config?.runtime?.maintenanceManager !== undefined && config.runtime.maintenanceManager !== null) {
        const result = await config.runtime.maintenanceManager.withActiveJob(
            () => Promise.resolve(tool.handler(args)),
            name === 'restore_backup' // restore bypasses lock since it acquires exclusive
        );
        return injectTokenEstimate(result)
    }

    const result = await Promise.resolve(tool.handler(args))
    return injectTokenEstimate(result)
}

/**
 * Compose all tool definitions from group modules
 */
function getAllToolDefinitions(context: ToolContext): ToolDefinition[] {
    return [
        ...getCoreTools(context),
        ...getSearchTools(context),
        ...getAnalyticsTools(context),
        ...getRelationshipTools(context),
        ...getIoTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
        ...getCodeModeTools(context),
    ]
}
