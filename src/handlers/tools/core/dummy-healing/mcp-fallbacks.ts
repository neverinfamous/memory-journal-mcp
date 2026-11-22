import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { AuthorizationError, PermissionError, ValidationError } from '../../../../types/errors.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { VERSION } from '../../../../version.js'
import { getAllToolNames, isToolVisibleForFilter } from '../../../../filtering/tool-filter.js'
import { getCoreTools } from '../tools.js'
import { getStalenessTools } from '../staleness-tools.js'
import { getSearchTools } from '../../search/index.js'
import { getAnalyticsTools } from '../../analytics.js'
import { getRelationshipTools } from '../../relationships.js'
import { getIoTools } from '../../io/index.js'
import { getAdminTools } from '../../admin/index.js'
import { getGitHubTools } from '../../github.js'
import { getBackupTools } from '../../backup.js'
import { getTeamTools } from '../../team/index.js'
import { getCodeModeTools } from '../../codemode/index.js'
import { getGitTools } from '../../git.js'
import { readResource, getResources } from '../../../resources/index.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import { isDummyToolAllowedByFilter } from '../../dummy-filter-helpers.js'
import { registerDynamicMemoryUriRoots } from '../../../../audit/audit-file-helpers.js'
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
    DUMMY_URI_CANDIDATE_KEYS,
} from './alias-catalog.js'

export { handlePrompt, handleListPrompts, handleGetPrompt }

const FLEXIBLE_PASSTHROUGH_SCHEMA = z.looseObject({ ...ErrorFieldsMixin.shape })

let cachedMemoryRootPrefixes: ReadonlySet<string> | null = null

function getMemoryRootPrefixes(): ReadonlySet<string> {
    if (cachedMemoryRootPrefixes !== null) return cachedMemoryRootPrefixes
    const prefixes = new Set<string>()
    for (const r of getResources()) {
        const uri = 'uri' in r && typeof r.uri === 'string' ? r.uri : undefined
        if (uri?.startsWith('memory://')) {
            const root = uri.slice('memory://'.length).split(/[/?#{]/, 1)[0]?.toLowerCase()
            if (root !== undefined && root !== '') prefixes.add(root)
        }
    }
    cachedMemoryRootPrefixes = prefixes
    return prefixes
}

registerDynamicMemoryUriRoots(getMemoryRootPrefixes, DUMMY_RESOURCE_TOOL_NAMES)

export function extractUriFromArgs(args: Record<string, unknown>): string | undefined {
    let uri: string | undefined
    for (const key of DUMMY_URI_CANDIDATE_KEYS) {
        const rawVal = args[key]
        if (typeof rawVal !== 'string') continue
        const val = rawVal.trim()
        if (val === '') continue
        if ((key === 'ServerName' || key === 'server_name') && (val === 'memory-journal-mcp' || val === 'memory-journal')) continue
        uri = val
        break
    }
    if (uri !== undefined && !uri.includes('://')) {
        const candidateUri = uri
        const firstSeg = candidateUri.split(/[/?#]/, 1)[0]?.toLowerCase() ?? ''
        const isRootResource = firstSeg !== '' && getMemoryRootPrefixes().has(firstSeg)
        uri = isRootResource
            ? `memory://${firstSeg}${candidateUri.slice(firstSeg.length)}`
            : `memory://briefing/${candidateUri}`
    }
    return uri
}

export async function tryHandleResourceUriFallback(
    targetPath: string,
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<{ handled: true; result: unknown } | { handled: false }> {
    const trimmed = targetPath.trim()
    if (!trimmed.includes('://')) return { handled: false }
    if (!trimmed.startsWith('memory://')) {
        return {
            handled: true,
            result: {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Unsupported URI scheme in '${trimmed}'. Only 'memory://' resource URIs are supported.`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            },
        }
    }
    if (
        context?.config?.filterConfig !== undefined &&
        context.config.filterConfig !== null &&
        !isDummyToolAllowedByFilter(
            'read_resource',
            context.config.filterConfig,
            true,
            context.config.codemodeInternalFullAccess === true
        )
    ) {
        return {
            handled: true,
            result: {
                success: false,
                error: "Tool 'read_resource' is disabled by the active --tool-filter configuration.",
                code: 'TOOL_DISABLED',
                category: 'authorization',
                suggestion: 'Update the active tool filter or use an enabled tool.',
                recoverable: false,
            },
        }
    }
    return { handled: true, result: await handleReadResource(params, toolName, context) }
}

export async function handleReadResource(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const args =
        typeof params === 'object' && params !== null && !Array.isArray(params)
            ? (params as Record<string, unknown>)
            : {}
    let uri = extractUriFromArgs(args)
    if ((uri === undefined || uri === '') && toolName.startsWith('memory://')) {
        uri = toolName
    }
    if ((uri === undefined || uri === '') && context !== undefined && Object.keys(args).length === 0) {
        uri = 'memory://briefing'
    }

    if (uri !== undefined && uri !== '' && uri.includes('://') && !uri.startsWith('memory://')) {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: Unsupported URI scheme in '${uri}'. Only 'memory://' resource URIs are supported.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }

    if (context !== undefined && uri !== undefined && uri !== '') {
        try {
            const res = await readResource(
                uri,
                context.db,
                context.vectorManager,
                context.config?.filterConfig,
                context.github,
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
            if (err instanceof PermissionError || err instanceof AuthorizationError) throw err
            if (err instanceof ValidationError) return formatHandlerError(err)
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
        resources: getResources().map((r) => {
            const rest = { ...(r as Record<string, unknown>) }
            delete rest['capabilities']
            return rest
        }),
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (resources/list). The available resources were returned successfully.`,
    }
}

const CANONICAL_TOOL_NAMES: ReadonlySet<string> = new Set(getAllToolNames())

function buildToolFilterSummary(context?: ToolContext): {
    active: boolean
    enabledCount: number
    totalCount: number
    filterString: string | null
} {
    const filterConfig = context?.config?.filterConfig
    const totalCount = CANONICAL_TOOL_NAMES.size
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
    const cachedTools = context.config?.runtime?.toolMapCache
    const rawTools: ToolDefinition[] =
        cachedTools !== null &&
        cachedTools !== undefined &&
        cachedTools.size >= CANONICAL_TOOL_NAMES.size
            ? [...cachedTools.values()].filter((t) => CANONICAL_TOOL_NAMES.has(t.name))
            : [
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
    const toolsList = rawTools
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

    let dbHealth: unknown = healthData
    if (dbHealth === undefined && context !== undefined) {
        try {
            dbHealth = context.db.getHealthStatus()
        } catch (err: unknown) {
            healthReadFailed = true
            dbHealth = {
                status: 'degraded',
                error: err instanceof Error ? err.message : String(err),
            }
        }
    }
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
        ...buildFallbackTools(DUMMY_RESOURCE_TOOL_NAMES, 'Read Resource', 'when invoked as an MCP tool instead of a protocol resource read.', (n) => (p) => handleReadResource(p, n, context)),
        ...buildFallbackTools(DUMMY_PROMPT_TOOL_NAMES, 'Prompt Fallback', 'when invoked as an MCP tool instead of an MCP prompt.', (n) => (p) => handlePrompt(p, n, context)),
        ...buildFallbackTools(DUMMY_LIST_RESOURCE_TOOL_NAMES, 'List Resources Fallback', 'when called directly as an MCP tool.', (n) => () => handleListResources(n)),
        ...buildFallbackTools(DUMMY_LIST_PROMPT_TOOL_NAMES, 'List Prompts Fallback', 'when called directly as an MCP tool.', (n) => () => handleListPrompts(n)),
        ...buildFallbackTools(DUMMY_LIST_TOOL_NAMES, 'List Tools Fallback', 'when called directly as an MCP tool.', (n) => () => handleListTools(n, context)),
        ...buildFallbackTools(DUMMY_GET_PROMPT_TOOL_NAMES, 'Get Prompt Fallback', 'when called directly as an MCP tool.', (n) => async (p) => handleGetPrompt(p, n, context)),
        ...buildFallbackTools(DUMMY_SERVER_INFO_TOOL_NAMES, 'Server Info & Health Diagnostics Fallback', 'when called directly as an MCP tool. Returns server metadata, runtime status, and diagnostics.', (n) => async (p) => handleServerInfo(p, n, context)),
        ...buildFallbackTools(DUMMY_ADAPTER_TOOL_NAMES, 'List Adapters Fallback', 'when called directly as an MCP tool. Returns available database and service adapters.', (n) => () => handleListAdapters(n, context)),
    ]
}
