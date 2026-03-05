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
    ToolContext,
    ToolHandlerConfig,
} from '../../types/index.js'
import type { SqliteAdapter } from '../../database/SqliteAdapter.js'
import type { VectorSearchManager } from '../../vector/VectorSearchManager.js'
import type { GitHubIntegration } from '../../github/GitHubIntegration.js'
import type { ProgressContext } from '../../utils/progress-utils.js'

import { getCoreTools } from './core.js'
import { getSearchTools } from './search.js'
import { getAnalyticsTools } from './analytics.js'
import { getRelationshipTools } from './relationships.js'
import { getExportTools } from './export.js'
import { getAdminTools } from './admin.js'
import { getGitHubTools } from './github.js'
import { getBackupTools } from './backup.js'

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
    db: SqliteAdapter,
    filterConfig: ToolFilterConfig | null,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig
): object[] {
    const context: ToolContext = { db, vectorManager, github, config }
    const allTools = getAllToolDefinitions(context)

    const mapTool = (t: ToolDefinition): object => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations: t.annotations,
        icons: getToolIcon(t.group),
    })

    if (filterConfig) {
        return allTools.filter((t) => filterConfig.enabledTools.has(t.name)).map(mapTool)
    }

    return allTools.map(mapTool)
}

/**
 * Call a tool by name
 */
export function callTool(
    name: string,
    args: Record<string, unknown>,
    db: SqliteAdapter,
    vectorManager?: VectorSearchManager,
    github?: GitHubIntegration,
    config?: ToolHandlerConfig,
    progress?: ProgressContext
): Promise<unknown> {
    const context: ToolContext = { db, vectorManager, github, config, progress }
    const tools = getAllToolDefinitions(context)
    const tool = tools.find((t) => t.name === name)

    if (!tool) {
        return Promise.reject(new Error(`Unknown tool: ${name}`))
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
    ]
}
