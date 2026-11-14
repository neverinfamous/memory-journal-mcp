import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { PermissionError, ValidationError } from '../../../../types/errors.js'
import { VERSION } from '../../../../version.js'
import { getAllToolNames, isToolVisibleForFilter } from '../../../../filtering/tool-filter.js'
import { getCoreTools } from '../tools.js'
import { getSearchTools } from '../../search/index.js'
import { getAdminTools } from '../../admin/index.js'
import { readResource, getResources } from '../../../resources/index.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { handlePrompt, handleListPrompts, handleGetPrompt } from './mcp-prompt-fallbacks.js'
import {
    DUMMY_RESOURCE_TOOL_NAMES,
    DUMMY_PROMPT_TOOL_NAMES,
    DUMMY_LIST_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_PROMPT_TOOL_NAMES,
    DUMMY_LIST_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    DUMMY_SERVER_INFO_TOOL_NAMES,
    DUMMY_ADAPTER_TOOL_NAMES,
} from './alias-catalog.js'

export { handlePrompt, handleListPrompts, handleGetPrompt }

const FLEXIBLE_PASSTHROUGH_SCHEMA = z.looseObject({ ...ErrorFieldsMixin.shape })

const URI_CANDIDATE_KEYS = [
    'resourceUri', 'resource_uri', 'resource', 'Resource',
    'url', 'Url', 'path', 'Path', 'name', 'Name',
    'target', 'Target', 'ServerName', 'server_name',
] as const

const MEMORY_ROOT_PREFIXES = [
    'briefing', 'recent', 'agent-', 'statistics', 'insights',
    'help', 'health', 'team', 'git', 'tools',
] as const

export function extractUriFromArgs(args: Record<string, unknown>): string | undefined {
    let uri =
        typeof args['uri'] === 'string'
            ? args['uri']
            : typeof args['Uri'] === 'string'
              ? args['Uri']
              : typeof args['_uri'] === 'string'
                ? args['_uri']
                : undefined
    if (uri === undefined || uri === '') {
        for (const key of URI_CANDIDATE_KEYS) {
            const rawVal = args[key]
            if (typeof rawVal === 'string' && rawVal.trim() !== '') {
                const val = rawVal.trim()
                if (
                    (key === 'ServerName' || key === 'server_name') &&
                    (val === 'memory-journal-mcp' || val === 'memory-journal')
                ) {
                    continue
                }
                uri = val
                break
            }
        }
    }
    if (uri !== undefined && uri !== '' && !uri.includes('://')) {
        const candidateUri = uri
        const isRootResource = MEMORY_ROOT_PREFIXES.some(
            (prefix) =>
                candidateUri === prefix ||
                candidateUri.startsWith(`${prefix}/`) ||
                candidateUri.startsWith(`${prefix}?`)
        )
        uri = isRootResource ? `memory://${candidateUri}` : `memory://briefing/${candidateUri}`
    }
    return uri
}

export async function handleReadResource(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const args =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    let uri = extractUriFromArgs(args)
    if ((uri === undefined || uri === '') && toolName.startsWith('memory://')) {
        uri = toolName
    }
    if ((uri === undefined || uri === '') && context !== undefined) {
        uri = 'memory://briefing'
    }

    if (context !== undefined && uri !== undefined && uri !== '') {
        try {
            const res = await readResource(
                uri,
                context.db,
                context.vectorManager,
                context.config?.filterConfig,
                context.github,
                undefined,
                context.teamDb,
                context.config?.briefingConfig,
                context.config?.runtime
            )
            return {
                success: true,
                data: res.data,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP resource read. The resource '${uri}' was resolved successfully.`,
            }
        } catch (err) {
            if (err instanceof PermissionError || err instanceof ValidationError) throw err
            return {
                success: false,
                error: `Failed to read resource '${uri}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'RESOURCE_ERROR',
                category: 'resource',
                recoverable: true,
            }
        }
    }

    const hint = uri !== undefined && uri !== '' ? ` Requested URI: ${uri}.` : ''
    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an MCP protocol resource method, not an MCP tool.${hint} Use native agent tool 'read_resource' / 'read_file', or query via 'mj_execute_code'.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

export function handleListResources(toolName: string): unknown {
    return {
        success: true,
        resources: getResources(),
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (resources/list). The available resources were returned successfully.`,
    }
}

function buildToolFilterSummary(context?: ToolContext): {
    active: boolean
    enabledCount: number
    totalCount: number
    filterString: string | null
} {
    const filterConfig = context?.config?.filterConfig
    const totalCount = getAllToolNames().length
    return {
        active: filterConfig !== null && filterConfig !== undefined,
        enabledCount: filterConfig?.enabledTools.size ?? totalCount,
        totalCount,
        filterString: filterConfig?.raw ?? null,
    }
}

export function handleListTools(toolName: string, context?: ToolContext): unknown {
    if (context === undefined) {
        return {
            success: false,
            error: 'No server context was available, so the tool list was not built.',
            tools: [],
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (tools/list). The tool list was not built because no server context was available.`,
        }
    }
    const filterConfig = context.config?.filterConfig
    const toolsList = [
        ...getCoreTools(context),
        ...getSearchTools(context),
        ...getAdminTools(context),
    ]
        .filter(
            (t) =>
                (filterConfig === undefined ||
                    filterConfig === null ||
                    filterConfig.enabledTools.has(t.name)) &&
                isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, filterConfig?.raw)
        )
        .map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            group: t.group,
        }))
    return {
        success: true,
        tools: toolsList,
        toolFilter: buildToolFilterSummary(context),
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`,
    }
}

export async function handleServerInfo(
    _params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    let healthData: Record<string, unknown> | undefined
    let healthReadFailed = context === undefined
    if (context !== undefined) {
        try {
            const res = await readResource(
                'memory://health',
                context.db,
                context.vectorManager,
                context.config?.filterConfig,
                context.github,
                undefined,
                context.teamDb,
                context.config?.briefingConfig,
                context.config?.runtime
            )
            if (typeof res.data === 'object' && res.data !== null) {
                healthData = res.data as Record<string, unknown>
            }
        } catch {
            healthReadFailed = true
        }
    }

    const dbHealth = healthData ?? context?.db.getHealthStatus()
    const reportedStatus =
        !healthReadFailed && healthData !== undefined && typeof healthData['status'] === 'string'
            ? healthData['status']
            : healthReadFailed
              ? 'degraded'
              : 'healthy'

    return {
        success: !healthReadFailed,
        status: reportedStatus,
        server: {
            name: 'memory-journal-mcp',
            version: VERSION,
            description: 'Memory Journal MCP Server with Code Mode & Semantic Search',
        },
        runtime: {
            nodeVersion: process.version,
            platform: process.platform,
            uptimeSeconds: Math.floor(process.uptime()),
        },
        toolFilter: buildToolFilterSummary(context),
        ...(healthData !== undefined ? { health: healthData } : {}),
        ...(dbHealth !== undefined ? { database: dbHealth } : {}),
        capabilities: { codemode: true, resources: true, prompts: true, tools: true },
        _healing_note: healthReadFailed
            ? `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Health status was not read.`
            : `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Returned server diagnostic information and health status successfully.`,
    }
}

function sqliteAdapterStatus(db?: ToolContext['db']): string {
    if (db === undefined || db === null) return 'disabled'
    try {
        db.getHealthStatus()
        return 'connected'
    } catch {
        return 'error'
    }
}

function vectorAdapterStatus(vectorManager?: ToolContext['vectorManager']): string {
    if (vectorManager === undefined || vectorManager === null) return 'disabled'
    try {
        const stats = vectorManager.getStats()
        return stats.isReady ? 'connected' : 'initialized'
    } catch {
        return 'error'
    }
}

export function handleListAdapters(toolName: string, context?: ToolContext): unknown {
    const adapters = [
        {
            name: 'sqlite',
            type: 'database',
            driver: 'better-sqlite3',
            status: sqliteAdapterStatus(context?.db),
            primary: true,
            description: 'Primary SQLite storage engine for journal entries, tags, and relationships',
        },
        {
            name: 'sqlite-vec',
            type: 'vector',
            driver: 'sqlite-vec',
            status: vectorAdapterStatus(context?.vectorManager),
            description: 'Native vector embeddings and semantic search engine',
        },
        {
            name: 'team',
            type: 'database',
            driver: 'better-sqlite3',
            status: sqliteAdapterStatus(context?.teamDb),
            description: 'Collaborative team journal database adapter',
        },
        {
            name: 'github',
            type: 'integration',
            driver: 'octokit / gh',
            status:
                context?.github !== undefined && context.github !== null ? 'connected' : 'disabled',
            description: 'GitHub synchronization and issue tracking adapter',
        },
    ]

    return {
        success: true,
        adapters,
        default_adapter: 'sqlite',
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Returned registered database and service adapters successfully.`,
    }
}

function buildFallbackTools(
    names: string[],
    titlePrefix: string,
    descriptionSuffix: string,
    makeHandler: (name: string) => (params: unknown) => unknown
): ToolDefinition[] {
    return names.map(
        (name): ToolDefinition => ({
            name,
            title: `${titlePrefix} (${name})`,
            description: `Fallback handler for \`${name}\` ${descriptionSuffix}`,
            group: 'core',
            inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
            outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            handler: makeHandler(name),
        })
    )
}

export function getMcpFallbackToolDefinitions(context?: ToolContext): ToolDefinition[] {
    return [
        ...buildFallbackTools(
            DUMMY_RESOURCE_TOOL_NAMES, 'Read Resource',
            'when invoked as an MCP tool instead of a protocol resource read.',
            (name) => (params: unknown) => handleReadResource(params, name, context)
        ),
        ...buildFallbackTools(
            DUMMY_PROMPT_TOOL_NAMES, 'Prompt Fallback',
            'when invoked as an MCP tool instead of an MCP prompt.',
            (name) => (params: unknown) => handlePrompt(params, name, context)
        ),
        ...buildFallbackTools(
            DUMMY_LIST_RESOURCE_TOOL_NAMES, 'List Resources Fallback',
            'when called directly as an MCP tool.',
            (name) => () => handleListResources(name)
        ),
        ...buildFallbackTools(
            DUMMY_LIST_PROMPT_TOOL_NAMES, 'List Prompts Fallback',
            'when called directly as an MCP tool.',
            (name) => () => handleListPrompts(name)
        ),
        ...buildFallbackTools(
            DUMMY_LIST_TOOL_NAMES, 'List Tools Fallback',
            'when called directly as an MCP tool.',
            (name) => () => handleListTools(name, context)
        ),
        ...buildFallbackTools(
            DUMMY_GET_PROMPT_TOOL_NAMES, 'Get Prompt Fallback',
            'when called directly as an MCP tool.',
            (name) => async (params: unknown) => handleGetPrompt(params, name, context)
        ),
        ...buildFallbackTools(
            DUMMY_SERVER_INFO_TOOL_NAMES, 'Server Info & Health Diagnostics Fallback',
            'when called directly as an MCP tool. Returns server metadata, runtime status, and diagnostics.',
            (name) => async (params: unknown) => handleServerInfo(params, name, context)
        ),
        ...buildFallbackTools(
            DUMMY_ADAPTER_TOOL_NAMES, 'List Adapters Fallback',
            'when called directly as an MCP tool. Returns available database and service adapters.',
            (name) => () => handleListAdapters(name, context)
        ),
    ]
}
