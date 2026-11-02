import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { VERSION } from '../../../../version.js'
import { getCoreTools } from '../tools.js'
import { getSearchTools } from '../../search/index.js'
import { getAdminTools } from '../../admin/index.js'
import { getPrompt, getPrompts } from '../../../prompts/index.js'
import { readResource, getResources } from '../../../resources/index.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
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
        const isRootResource = MEMORY_ROOT_PREFIXES.some((prefix) => uri?.startsWith(prefix))
        uri = isRootResource ? `memory://${uri}` : `memory://briefing/${uri}`
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

export async function handlePrompt(
    params: unknown,
    promptName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const stringArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawArgs)) {
        if (typeof v === 'string') stringArgs[k] = v
        else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
    }

    const canonicalPromptName = promptName
        .replace(/^mj_/, '')
        .replace(/_/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()

    if (canonicalPromptName === 'load-briefing' || canonicalPromptName === 'briefing') {
        if (stringArgs['projects'] === undefined || stringArgs['projects'] === '') {
            stringArgs['projects'] =
                stringArgs['project'] ??
                stringArgs['name'] ??
                stringArgs['target'] ??
                stringArgs['repo'] ??
                stringArgs['workspace'] ??
                ''
        }
    }

    if (context !== undefined) {
        try {
            const result = await getPrompt(
                canonicalPromptName === 'briefing' ? 'load-briefing' : canonicalPromptName,
                stringArgs,
                context.db,
                context.teamDb,
                context.github,
                context.config?.briefingConfig
            )
            return {
                success: true,
                data: result,
                messages: result.messages,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, but was invoked directly as an MCP tool. The prompt was evaluated and returned successfully.`,
            }
        } catch (err) {
            return {
                success: false,
                error: `Failed to execute prompt '${promptName}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'PROMPT_ERROR',
                category: 'prompt',
                recoverable: true,
            }
        }
    }

    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the 'prompts/list' endpoint.`,
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

export function handleListPrompts(toolName: string): unknown {
    return {
        success: true,
        prompts: getPrompts(),
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/list). The available prompts were returned successfully.`,
    }
}

export function handleListTools(toolName: string, context?: ToolContext): unknown {
    let toolsList: { name: string; title?: string; description?: string; group?: string }[] = []
    if (context !== undefined) {
        toolsList = [
            ...getCoreTools(context),
            ...getSearchTools(context),
            ...getAdminTools(context),
        ].map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            group: t.group,
        }))
    }
    return {
        success: true,
        tools: toolsList,
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`,
    }
}

export async function handleGetPrompt(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const targetPromptName =
        typeof rawArgs['name'] === 'string'
            ? rawArgs['name']
            : typeof rawArgs['prompt'] === 'string'
              ? rawArgs['prompt']
              : typeof rawArgs['prompt_name'] === 'string'
                ? rawArgs['prompt_name']
                : 'load-briefing'
    const nestedArgs = (
        typeof rawArgs['arguments'] === 'object' && rawArgs['arguments'] !== null
            ? rawArgs['arguments']
            : rawArgs
    ) as Record<string, unknown>
    const stringArgs: Record<string, string> = {}
    for (const [k, v] of Object.entries(nestedArgs)) {
        if (k !== 'name' && k !== 'prompt' && k !== 'prompt_name' && k !== 'arguments') {
            if (typeof v === 'string') stringArgs[k] = v
            else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
        }
    }
    if (context !== undefined) {
        try {
            const result = await getPrompt(
                targetPromptName,
                stringArgs,
                context.db,
                context.teamDb,
                context.github,
                context.config?.briefingConfig
            )
            return {
                success: true,
                data: result,
                messages: result.messages,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/get). The prompt '${targetPromptName}' was evaluated successfully.`,
            }
        } catch (err) {
            return {
                success: false,
                error: `Failed to execute prompt '${targetPromptName}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'PROMPT_ERROR',
                category: 'prompt',
                recoverable: true,
            }
        }
    }
    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an MCP Prompt protocol method. Context is not initialized.`,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        recoverable: true,
    }
}

export async function handleServerInfo(
    _params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    let healthData: Record<string, unknown> | undefined
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
            // Fallback to manual db status if readResource fails
        }
    }

    const dbHealth = healthData ?? context?.db.getHealthStatus()

    return {
        success: true,
        status: 'healthy',
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
        ...(healthData !== undefined ? { health: healthData } : {}),
        ...(dbHealth !== undefined ? { database: dbHealth } : {}),
        capabilities: { codemode: true, resources: true, prompts: true, tools: true },
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Returned server diagnostic information and health status successfully.`,
    }
}

export function handleListAdapters(toolName: string, context?: ToolContext): unknown {
    const adapters = [
        {
            name: 'sqlite',
            type: 'database',
            driver: 'better-sqlite3',
            status: 'connected',
            primary: true,
            description: 'Primary SQLite storage engine for journal entries, tags, and relationships',
        },
        {
            name: 'sqlite-vec',
            type: 'vector',
            driver: 'sqlite-vec',
            status:
                context?.vectorManager !== undefined && context.vectorManager !== null
                    ? 'connected'
                    : 'ready',
            description: 'Native vector embeddings and semantic search engine',
        },
        {
            name: 'team',
            type: 'database',
            driver: 'better-sqlite3',
            status:
                context?.teamDb !== undefined && context.teamDb !== null ? 'connected' : 'disabled',
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
            annotations: { readOnlyHint: true, openWorldHint: false },
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
