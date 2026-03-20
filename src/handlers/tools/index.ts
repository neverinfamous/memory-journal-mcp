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
import { getSearchTools } from './search.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getExportTools } from './export.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'
import { getTeamTools } from './team/index.js'
import { getCodeModeTools } from './codemode.js'

// Re-export for backward compatibility (McpServer imports these)
export type { ToolHandlerConfig }

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
        export: {
            iconUrl: 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/export.svg',
            title: 'Export',
            description: 'Data export operations',
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
    teamDb?: IDatabaseAdapter
): ToolRegistration[] {
    // Ensure tool map is built / up-to-date (shared cache with callTool)
    ensureToolCache(db, vectorManager, github, config, teamDb)

    const mapTool = (t: ToolDefinition): ToolRegistration => ({
        name: t.name,
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
        return Array.from((toolMapCache ?? EMPTY_TOOL_MAP).values())
            .filter((t) => filterConfig.enabledTools.has(t.name))
            .map(mapTool)
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
    teamDb?: IDatabaseAdapter
): void {
    if (
        toolMapCache &&
        cachedContextRefs?.db === db &&
        cachedContextRefs.github === github &&
        cachedContextRefs.vectorManager === vectorManager &&
        cachedContextRefs.config === config &&
        cachedContextRefs.teamDb === teamDb
    ) {
        return // Cache is valid
    }

    const context: ToolContext = { db, teamDb, vectorManager, github, config }
    toolMapCache = new Map(getAllToolDefinitions(context).map((t) => [t.name, t]))
    mappedToolsCache = null // Invalidate mapped cache when definitions change
    cachedContextRefs = { db, github, vectorManager, config, teamDb }
}

/**
 * Call a tool by name
 */
export function callTool(
    name: string,
    args: Record<string, unknown>,
    db: IDatabaseAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    progress?: ProgressContext,
    teamDb?: IDatabaseAdapter
): Promise<unknown> {
    ensureToolCache(db, vectorManager, github, config, teamDb)

    const tool = (toolMapCache ?? EMPTY_TOOL_MAP).get(name)

    if (!tool) {
        return Promise.reject(new Error(`Unknown tool: ${name}`))
    }

    // When progress context is provided, rebuild the handler with it.
    // This is rare (only MCP server calls with progress tokens, not benchmarked).
    if (progress) {
        const context: ToolContext = { db, teamDb, vectorManager, github, config, progress }
        const freshTools = getAllToolDefinitions(context)
        const freshTool = freshTools.find((t) => t.name === name)
        if (freshTool) {
            return Promise.resolve(freshTool.handler(args))
        }
    }

    return Promise.resolve(tool.handler(args))
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
        ...getExportTools(context),
        ...getAdminTools(context),
        ...getGitHubTools(context),
        ...getBackupTools(context),
        ...getTeamTools(context),
        ...getCodeModeTools(context),
    ]
}
