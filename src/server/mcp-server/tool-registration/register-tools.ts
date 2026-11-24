import {
    McpServer,
    type CallToolResult,
    type StandardSchemaWithJSON,
    type ToolAnnotations,
    type Icon,
} from '@modelcontextprotocol/server'
import { callTool } from '../../../handlers/tools/index.js'
import { validateResourceSubscription } from '../../../handlers/resources/index.js'
import type { BriefingConfig } from '../../../handlers/resources/shared.js'
import type { ToolRegistration, ToolHandlerConfig } from '../../../types/index.js'
import {
    registerResources,
    registerPrompts,
    type ResourceDefinition,
    type PromptDefinition,
} from '../../registration.js'
import { getSerializedPayloadJson } from '../../../observability/token-estimator.js'
import { VERSION } from '../../../version.js'
import { globalSubscriptionManager } from '../../subscription-manager.js'
import { logger } from '../../../utils/logger.js'
import { isRecord } from '../../../utils/type-guards.js'
import type { ServerContext, ServerOptions } from '../types.js'
import { attachListToolsInterceptor, type RequestHandlerMap } from './list-interceptor.js'
import { attachCallToolInterceptor } from './call-interceptor.js'
import {
    MUTATING_TOOLS,
    attachStdioCloseCleanup,
    buildServerInstructions,
    createResourceReadHandler,
    formatToolFailure,
    getCachedReadOnlyHints,
    isStandardSchemaWithJson,
    notifyMutationSubscribers,
    relaxInputSchemaForMcp,
    relaxOutputSchemaForMcp,
    resolveActiveBriefingConfig,
    syncLiveHandlerConfig,
} from './register-tools-helpers.js'

import {
    DEFAULT_MAX_TOOL_INPUT_ELEMENTS,
    resolveEffectiveMaxToolInputElements,
} from '../../../utils/tool-input-bounds.js'

export { DEFAULT_MAX_TOOL_INPUT_ELEMENTS, resolveEffectiveMaxToolInputElements }

function readOnlyHintOf(tool: { annotations?: { readOnlyHint?: boolean } }): boolean | undefined {
    if (tool.annotations === undefined) {
        return undefined
    }
    return tool.annotations.readOnlyHint
}

interface ModernToolConfig {
    title?: string
    description?: string
    inputSchema?: StandardSchemaWithJSON
    outputSchema?: StandardSchemaWithJSON
    annotations?: ToolAnnotations
    icons?: Icon[]
}

const toolRegistrationOptionsCache = new WeakMap<ToolRegistration, ModernToolConfig>()

function buildToolRegistrationOptions(tool: ToolRegistration): ModernToolConfig {
    const cached = toolRegistrationOptionsCache.get(tool)
    if (cached !== undefined) return cached

    const toolOptions: ModernToolConfig = { description: tool.description }
    if (tool.title !== undefined && tool.title !== '') toolOptions.title = tool.title

    if (tool.inputSchema !== undefined) {
        const schema = tool.inputSchema
        const fallbackInputSchema = isStandardSchemaWithJson(schema) ? schema : undefined
        try {
            const candidate = relaxInputSchemaForMcp(schema)
            if (isStandardSchemaWithJson(candidate)) {
                toolOptions.inputSchema = candidate
            } else if (fallbackInputSchema !== undefined) {
                toolOptions.inputSchema = fallbackInputSchema
            }
        } catch (error) {
            logger.warning('Failed to relax input schema; using fallback schema', {
                module: 'McpServer',
                tool: tool.name,
                error: error instanceof Error ? error.message : String(error),
            })
            if (fallbackInputSchema !== undefined) toolOptions.inputSchema = fallbackInputSchema
        }
    }

    if (tool.outputSchema !== undefined) {
        const relaxedOutput = relaxOutputSchemaForMcp(tool.outputSchema, tool.name)
        if (relaxedOutput !== undefined) {
            toolOptions.outputSchema = relaxedOutput
        }
    }

    if (tool.annotations !== undefined) toolOptions.annotations = tool.annotations
    if (tool.icons !== undefined) toolOptions.icons = [{ src: tool.icons.iconUrl }]
    toolRegistrationOptionsCache.set(tool, toolOptions)
    return toolOptions
}

function isRequestHandlerMap(value: unknown): value is RequestHandlerMap {
    if (!(value instanceof Map)) return false
    const entries: Iterable<[unknown, unknown]> = value.entries()
    for (const [k, v] of entries) {
        if (typeof k !== 'string' || typeof v !== 'function') return false
    }
    return true
}

function getRequestHandlers(rawServer: object): RequestHandlerMap | undefined {
    if ('_requestHandlers' in rawServer && isRequestHandlerMap(rawServer._requestHandlers)) {
        return rawServer._requestHandlers
    }
    return undefined
}

function extractProgressToken(extra: unknown): string | number | undefined {
    if (!isRecord(extra)) return undefined
    const mcpReq = extra['mcpReq']
    if (!isRecord(mcpReq)) return undefined
    const meta = mcpReq['_meta']
    if (!isRecord(meta)) return undefined
    const token = meta['progressToken']
    return typeof token === 'string' || typeof token === 'number' ? token : undefined
}

function formatRegisteredToolResponse(
    tool: ToolRegistration,
    result: unknown,
    hasOutputSchema: boolean
): CallToolResult {
    const isSuccess = isRecord(result) && result['success'] === true

    if (isSuccess) {
        // [INTENT] Any tool that declares `readOnlyHint: false` (merge, link,
        // import, Code Mode, ...) notifies subscribers, not just a fixed list (L5).
        const isMutation =
            MUTATING_TOOLS.has(tool.name) ||
            readOnlyHintOf(tool) === false ||
            (tool.name.startsWith('team_') && readOnlyHintOf(tool) !== true)

        if (isMutation) {
            notifyMutationSubscribers(tool.name)
        }
    }

    const textContent = typeof result === 'string' ? result : getSerializedPayloadJson(result)
    const failed = isRecord(result) && result['success'] === false

    if (hasOutputSchema) {
        return {
            content: [{ type: 'text' as const, text: textContent }],
            structuredContent: result,
            ...(failed ? { isError: true as const } : {}),
        }
    }

    return {
        content: [{ type: 'text' as const, text: textContent }],
        ...(failed ? { isError: true as const } : {}),
    }
}

async function executeRegisteredTool(
    server: McpServer,
    tool: ToolRegistration,
    hasOutputSchema: boolean,
    args: unknown,
    extra: unknown,
    context: ServerContext,
    options: ServerOptions,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<CallToolResult> {
    const {
        configManager,
        db,
        teamDb,
        vectorManager,
        teamVectorManager,
        github,
        allowedIoRoots,
    } = context
    try {
        const progressToken = extractProgressToken(extra)
        const progressContext =
            progressToken !== undefined ? { server: server.server, progressToken } : undefined

        const currentConfig = configManager.getConfig()
        const nextBriefing = resolveActiveBriefingConfig(
            currentConfig.briefingConfig,
            allowedIoRoots
        )
        syncLiveHandlerConfig(customToolHandlerConfig, currentConfig, options, nextBriefing)

        const toolArgs = isRecord(args) ? args : {}

        const result = await callTool(
            tool.name,
            toolArgs,
            db,
            vectorManager,
            github,
            customToolHandlerConfig,
            progressContext,
            teamDb ?? undefined,
            teamVectorManager ?? undefined
        )
        return formatRegisteredToolResponse(tool, result, hasOutputSchema)
    } catch (error) {
        const errorResult = formatToolFailure(error, tool.name, args)
        return {
            content: [
                {
                    type: 'text' as const,
                    text: getSerializedPayloadJson(errorResult),
                },
            ],
            ...(hasOutputSchema ? { structuredContent: errorResult } : {}),
            isError: true,
        }
    }
}

function registerAllToolsOnServer(
    server: McpServer,
    context: ServerContext,
    options: ServerOptions,
    allTools: ToolRegistration[],
    customToolHandlerConfig: ToolHandlerConfig
): void {
    for (const tool of allTools) {
        const toolOptions = buildToolRegistrationOptions(tool)
        const hasOutputSchema = Boolean(tool.outputSchema)

        server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(
            tool.name,
            toolOptions,
            (args: unknown, extra: unknown) =>
                executeRegisteredTool(
                    server,
                    tool,
                    hasOutputSchema,
                    args,
                    extra,
                    context,
                    options,
                    customToolHandlerConfig
                )
        )
    }
}

function attachResourceAndSubscriptionHandlers(
    server: McpServer,
    context: ServerContext,
    options: ServerOptions,
    resources: ResourceDefinition[]
): void {
    const handleResourceRead = createResourceReadHandler(context, options)
    registerResources(server, resources, handleResourceRead, context.runtime)

    server.server.setRequestHandler('resources/subscribe', (request, extra) => {
        const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId
        const transportSessionId =
            sessionId !== undefined && sessionId !== '' ? sessionId : 'stdio'

        const liveBriefing = resolveActiveBriefingConfig(
            context.configManager.getConfig().briefingConfig,
            context.allowedIoRoots,
            context.runtime
        )
        validateResourceSubscription(
            request.params.uri,
            context.runtime,
            context.teamDb ?? undefined,
            liveBriefing
        )

        if (
            (options.transport === 'http' || options.statelessHttp === true) &&
            (sessionId === undefined || sessionId === '')
        ) {
            return {}
        }

        globalSubscriptionManager.registerServer(transportSessionId, server)
        globalSubscriptionManager.subscribe(request.params.uri, transportSessionId)
        return {}
    })

    server.server.setRequestHandler('resources/unsubscribe', (request, extra) => {
        const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId
        if (
            (options.transport === 'http' || options.statelessHttp === true) &&
            (sessionId === undefined || sessionId === '')
        ) {
            return {}
        }
        const transportSessionId =
            sessionId !== undefined && sessionId !== '' ? sessionId : 'stdio'
        globalSubscriptionManager.unsubscribe(request.params.uri, transportSessionId)
        return {}
    })
}

export function createServerInstance(
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    resources: ResourceDefinition[],
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): McpServer {
    const { configManager, db, teamDb, allowedIoRoots, runtime } = context
    configManager.seedMissingScopeDefaults({
        ...(options.defaultProjectNumber !== undefined
            ? { defaultProjectNumber: options.defaultProjectNumber }
            : {}),
        ...(options.defaultWorkspaceId !== undefined
            ? { defaultWorkspaceId: options.defaultWorkspaceId }
            : {}),
        ...(options.projectRegistry !== undefined
            ? { projectRegistry: options.projectRegistry }
            : {}),
    })

    const readOnlyHints = getCachedReadOnlyHints(allTools)
    const server = new McpServer(
        { name: 'memory-journal-mcp', version: VERSION },
        {
            capabilities: {
                logging: {},
                prompts: { listChanged: true },
                tools: { listChanged: true },
                resources: {
                    subscribe: options.statelessHttp !== true,
                    listChanged: options.statelessHttp !== true,
                },
                experimental: { progress: {} },
            },
            instructions: buildServerInstructions(context, options, prompts, allToolNames, readOnlyHints),
            maxToolInputElements: resolveEffectiveMaxToolInputElements(options.maxToolInputElements),
        }
    )

    if (context.skillCatalog !== undefined && typeof server.isConnected === 'function') {
        context.skillCatalog.attach(server)
    }

    registerAllToolsOnServer(server, context, options, allTools, customToolHandlerConfig)
    attachResourceAndSubscriptionHandlers(server, context, options, resources)

    const resolveLiveBriefingConfig = (): BriefingConfig =>
        resolveActiveBriefingConfig(
            configManager.getConfig().briefingConfig,
            allowedIoRoots,
            runtime
        )
    registerPrompts(server, prompts, db, teamDb ?? undefined, runtime, context.github, resolveLiveBriefingConfig)

    const requestHandlers = getRequestHandlers(server.server)
    attachListToolsInterceptor(requestHandlers, configManager, allToolNames, readOnlyHints)
    attachCallToolInterceptor(requestHandlers, context, options, prompts, allTools, allToolNames, customToolHandlerConfig, readOnlyHints)
    attachStdioCloseCleanup(server)
    return server
}
