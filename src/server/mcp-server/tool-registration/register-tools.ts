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
import { VERSION } from '../../../version.js'
import { globalSubscriptionManager } from '../../subscription-manager.js'
import { logger } from '../../../utils/logger.js'
import type { ServerContext, ServerOptions } from '../types.js'
import { attachListToolsInterceptor, type RequestHandlerMap } from './list-interceptor.js'
import { attachCallToolInterceptor } from './call-interceptor.js'
import {
    MUTATING_TOOLS,
    buildServerInstructions,
    createResourceReadHandler,
    formatToolFailure,
    notifyMutationSubscribers,
    resolveActiveBriefingConfig,
    syncLiveHandlerConfig,
} from './register-tools-helpers.js'

/**
 * Default maximum number of array elements and object properties allowed across a
 * single tool input payload before Zod validation runs.
 */
export const DEFAULT_MAX_TOOL_INPUT_ELEMENTS = 25_000

function readOnlyHintOf(tool: { annotations?: { readOnlyHint?: boolean } }): boolean | undefined {
    if (tool.annotations === undefined) {
        return undefined
    }
    return tool.annotations.readOnlyHint
}

/**
 * Resolves the configured `maxToolInputElements` option into the value passed to `McpServer`.
 * - `undefined` -> `DEFAULT_MAX_TOOL_INPUT_ELEMENTS` (25,000)
 * - `0` or `Infinity` -> `Infinity` (disables the SDK's element limit check)
 * - positive number -> passed through as-is
 */
export function resolveEffectiveMaxToolInputElements(configured: number | undefined): number {
    if (configured === undefined) return DEFAULT_MAX_TOOL_INPUT_ELEMENTS
    return configured === 0 || configured === Infinity ? Infinity : configured
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

function isStandardSchemaWithJson(value: unknown): value is StandardSchemaWithJSON {
    return (
        typeof value === 'object' &&
        value !== null &&
        ('~standard' in value || 'partial' in value || 'passthrough' in value)
    )
}

function buildToolRegistrationOptions(tool: ToolRegistration): ModernToolConfig {
    const cached = toolRegistrationOptionsCache.get(tool)
    if (cached !== undefined) return cached

    const toolOptions: ModernToolConfig = { description: tool.description }
    if (tool.title !== undefined && tool.title !== '') toolOptions.title = tool.title

    if (tool.inputSchema !== undefined) {
        const schema = tool.inputSchema
        const fallbackInputSchema = isStandardSchemaWithJson(schema) ? schema : undefined
        if (
            typeof schema === 'object' &&
            schema !== null &&
            'partial' in schema &&
            typeof schema.partial === 'function'
        ) {
            try {
                const relaxed = (
                    schema as { partial: () => { passthrough?: () => StandardSchemaWithJSON } }
                ).partial()
                const candidate =
                    typeof relaxed.passthrough === 'function'
                        ? relaxed.passthrough()
                        : fallbackInputSchema
                if (candidate !== undefined) toolOptions.inputSchema = candidate
            } catch (error) {
                logger.warning('Failed to relax input schema; using fallback schema', {
                    module: 'McpServer',
                    tool: tool.name,
                    error: error instanceof Error ? error.message : String(error),
                })
                if (fallbackInputSchema !== undefined) toolOptions.inputSchema = fallbackInputSchema
            }
        } else if (fallbackInputSchema !== undefined) {
            toolOptions.inputSchema = fallbackInputSchema
        }
    }

    if (tool.outputSchema !== undefined) {
        const outSchema = tool.outputSchema
        const fallbackOutputSchema = isStandardSchemaWithJson(outSchema) ? outSchema : undefined
        if (
            typeof outSchema === 'object' &&
            outSchema !== null &&
            'passthrough' in outSchema &&
            typeof outSchema.passthrough === 'function'
        ) {
            try {
                toolOptions.outputSchema = (
                    outSchema as { passthrough: () => StandardSchemaWithJSON }
                ).passthrough()
            } catch (error) {
                logger.warning('Failed to relax output schema; using fallback schema', {
                    module: 'McpServer',
                    tool: tool.name,
                    error: error instanceof Error ? error.message : String(error),
                })
                if (fallbackOutputSchema !== undefined) {
                    toolOptions.outputSchema = fallbackOutputSchema
                }
            }
        } else if (fallbackOutputSchema !== undefined) {
            toolOptions.outputSchema = fallbackOutputSchema
        }
    }

    if (tool.annotations !== undefined) toolOptions.annotations = tool.annotations
    if (tool.icons !== undefined) toolOptions.icons = [{ src: tool.icons.iconUrl }]
    toolRegistrationOptionsCache.set(tool, toolOptions)
    return toolOptions
}

function getRequestHandlers(rawServer: object): RequestHandlerMap | undefined {
    if ('_requestHandlers' in rawServer && rawServer._requestHandlers instanceof Map) {
        return rawServer._requestHandlers as RequestHandlerMap
    }
    return undefined
}

function formatRegisteredToolResponse(
    tool: ToolRegistration,
    result: unknown,
    hasOutputSchema: boolean
): CallToolResult {
    const isSuccess =
        typeof result === 'object' &&
        result !== null &&
        (result as Record<string, unknown>)['success'] === true

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

    const textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    const failed =
        typeof result === 'object' &&
        result !== null &&
        (result as Record<string, unknown>)['success'] === false

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
        const extraMeta = extra as
            | { mcpReq?: { _meta?: { progressToken?: string | number } } }
            | undefined
        const progressToken = extraMeta?.mcpReq?._meta?.progressToken
        const progressContext =
            progressToken !== undefined ? { server: server.server, progressToken } : undefined

        const currentConfig = configManager.getConfig()
        const nextBriefing = resolveActiveBriefingConfig(
            currentConfig.briefingConfig,
            options,
            allowedIoRoots
        )
        customToolHandlerConfig.filterConfig = currentConfig.toolFilterConfig
        syncLiveHandlerConfig(customToolHandlerConfig, currentConfig, options, nextBriefing)

        const toolArgs =
            typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}

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
                    text: JSON.stringify(errorResult, null, 2),
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

        validateResourceSubscription(request.params.uri, context.runtime)

        if (options.statelessHttp === true && (sessionId === undefined || sessionId === '')) {
            return {}
        }

        globalSubscriptionManager.registerServer(transportSessionId, server)
        globalSubscriptionManager.subscribe(request.params.uri, transportSessionId)
        return {}
    })

    server.server.setRequestHandler('resources/unsubscribe', (request, extra) => {
        const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId
        const transportSessionId =
            sessionId !== undefined && sessionId !== '' ? sessionId : 'stdio'
        globalSubscriptionManager.unsubscribe(request.params.uri, transportSessionId)
        return {}
    })
}

function collectReadOnlyHints(allTools: ToolRegistration[]): Map<string, boolean | undefined> {
    const hints = new Map<string, boolean | undefined>()
    for (const tool of allTools) {
        hints.set(tool.name, readOnlyHintOf(tool))
    }
    return hints
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

    const readOnlyHints = collectReadOnlyHints(allTools)
    const server = new McpServer(
        { name: 'memory-journal-mcp', version: VERSION },
        {
            capabilities: {
                logging: {},
                prompts: { listChanged: true },
                tools: { listChanged: true },
                resources: { subscribe: true, listChanged: true },
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
            options,
            allowedIoRoots,
            runtime
        )
    registerPrompts(server, prompts, db, teamDb ?? undefined, runtime, context.github, resolveLiveBriefingConfig)

    const requestHandlers = getRequestHandlers(server.server)
    attachListToolsInterceptor(requestHandlers, configManager, allToolNames, readOnlyHints)
    attachCallToolInterceptor(requestHandlers, context, options, prompts, allTools, allToolNames, customToolHandlerConfig)
    return server
}
