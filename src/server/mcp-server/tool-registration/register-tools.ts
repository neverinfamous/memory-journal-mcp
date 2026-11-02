import {
    McpServer,
    type CallToolResult,
    type StandardSchemaWithJSON,
    type ToolAnnotations,
    type Icon,
} from '@modelcontextprotocol/server'
import { getEnabledGroups } from '../../../filtering/tool-filter.js'
import { callTool } from '../../../handlers/tools/index.js'
import { readResource, validateResourceSubscription } from '../../../handlers/resources/index.js'
import {
    generateStandardInstructions,
    generateCodeModeInstructions,
} from '../../../constants/server-instructions.js'
import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import type { ToolGroup, ToolRegistration, ToolHandlerConfig } from '../../../types/index.js'
import { type DEFAULT_BRIEFING_CONFIG } from '../../../handlers/resources/shared.js'
import {
    registerResources,
    registerPrompts,
    type ResourceDefinition,
    type PromptDefinition,
} from '../../registration.js'
import { VERSION } from '../../../version.js'
import { globalSubscriptionManager } from '../../subscription-manager.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import type { ServerContext, ServerOptions } from '../types.js'
import { attachListToolsInterceptor, type RequestHandlerMap } from './list-interceptor.js'
import { attachCallToolInterceptor } from './call-interceptor.js'

/**
 * Default maximum number of array elements and object properties allowed across a
 * single tool input payload before Zod validation runs.
 */
export const DEFAULT_MAX_TOOL_INPUT_ELEMENTS = 25_000

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

const MUTATING_TOOLS = new Set([
    'create_entry',
    'update_entry',
    'delete_entry',
    'restore_entry',
    'batch_create_entries',
    'batch_update_entries',
    'batch_delete_entries',
    'team_add_member',
    'team_update_member_role',
    'team_remove_member',
])

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
        const fallbackInputSchema = schema as unknown as StandardSchemaWithJSON
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
                toolOptions.inputSchema =
                    typeof relaxed.passthrough === 'function'
                        ? relaxed.passthrough()
                        : fallbackInputSchema
            } catch {
                toolOptions.inputSchema = fallbackInputSchema
            }
        } else {
            toolOptions.inputSchema = fallbackInputSchema
        }
    }

    if (tool.outputSchema !== undefined) {
        const outSchema = tool.outputSchema
        const fallbackOutputSchema = outSchema as unknown as StandardSchemaWithJSON
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
            } catch {
                toolOptions.outputSchema = fallbackOutputSchema
            }
        } else {
            toolOptions.outputSchema = fallbackOutputSchema
        }
    }

    if (tool.annotations !== undefined) toolOptions.annotations = tool.annotations
    if (tool.icons !== undefined) toolOptions.icons = [{ src: tool.icons.iconUrl }]
    toolRegistrationOptionsCache.set(tool, toolOptions)
    return toolOptions
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
    const {
        configManager,
        db,
        teamDb,
        vectorManager,
        teamVectorManager,
        github,
        scheduler,
        allowedIoRoots,
        runtime,
    } = context
    const { defaultProjectNumber } = options

    const getInstructions = (): string => {
        const currentConfig = configManager.getConfig()
        const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
        const groups = currentConfig.toolFilterConfig
            ? getEnabledGroups(currentConfig.toolFilterConfig.enabledTools)
            : undefined

        const isCodeModeOnly = enabledSet.size === 1 && enabledSet.has('mj_execute_code')
        const mappedPrompts = prompts.map((p) => {
            const prompt = p as { name: string; description?: string }
            return {
                name: prompt.name,
                ...(prompt.description !== undefined ? { description: prompt.description } : {}),
            }
        })

        if (isCodeModeOnly || currentConfig.toolFilterConfig?.raw === 'codemode') {
            const finalGroups =
                currentConfig.codemodeInternalFullAccess === true
                    ? new Set(Object.keys(TOOL_GROUPS) as ToolGroup[])
                    : groups
            const finalEnabledTools =
                currentConfig.codemodeInternalFullAccess === true ? allToolNames : enabledSet

            return generateCodeModeInstructions(
                finalEnabledTools,
                mappedPrompts,
                undefined,
                finalGroups,
                currentConfig.briefingConfig
            )
        }

        return generateStandardInstructions(
            enabledSet,
            mappedPrompts,
            undefined,
            groups,
            currentConfig.briefingConfig
        )
    }

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
            instructions: getInstructions(),
            maxToolInputElements: resolveEffectiveMaxToolInputElements(options.maxToolInputElements),
        }
    )

    if (context.skillCatalog !== undefined && typeof server.isConnected === 'function') {
        context.skillCatalog.attach(server)
    }

    for (const tool of allTools) {
        const toolOptions = buildToolRegistrationOptions(tool)
        const hasOutputSchema = Boolean(tool.outputSchema)

        server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(
            tool.name,
            toolOptions,
            async (args: unknown, extra: unknown): Promise<CallToolResult> => {
                try {
                    const extraMeta = extra as
                        | { mcpReq?: { _meta?: { progressToken?: string | number } } }
                        | undefined
                    const progressToken = extraMeta?.mcpReq?._meta?.progressToken
                    const progressContext =
                        progressToken !== undefined
                            ? { server: server.server, progressToken }
                            : undefined

                    const currentConfig = configManager.getConfig()
                    customToolHandlerConfig.filterConfig = currentConfig.toolFilterConfig
                    customToolHandlerConfig.briefingConfig = currentConfig.briefingConfig

                    const toolArgs =
                        typeof args === 'object' && args !== null
                            ? (args as Record<string, unknown>)
                            : {}

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

                    const isSuccess =
                        typeof result === 'object' &&
                        result !== null &&
                        (result as Record<string, unknown>)['success'] === true

                    if (isSuccess) {
                        const isMutation =
                            MUTATING_TOOLS.has(tool.name) ||
                            (tool.name.startsWith('team_') &&
                                tool.annotations.readOnlyHint !== true)

                        if (isMutation) {
                            void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
                            void globalSubscriptionManager.notifyResourceUpdated('memory://recent')
                            void globalSubscriptionManager.notifyResourceUpdated(
                                'memory://statistics'
                            )

                            if (tool.name.startsWith('team_')) {
                                void globalSubscriptionManager.notifyResourceUpdated(
                                    'memory://team/recent'
                                )
                                void globalSubscriptionManager.notifyResourceUpdated(
                                    'memory://team/statistics'
                                )
                            }
                        }
                    }

                    const textContent =
                        typeof result === 'string' ? result : JSON.stringify(result, null, 2)

                    if (hasOutputSchema) {
                        return {
                            content: [{ type: 'text' as const, text: textContent }],
                            structuredContent: result as Record<string, unknown>,
                        }
                    }

                    return { content: [{ type: 'text' as const, text: textContent }] }
                } catch (error) {
                    let errorResult: Record<string, unknown>
                    if (
                        error instanceof Error &&
                        'toResponse' in error &&
                        typeof (error as { toResponse?: unknown }).toResponse === 'function'
                    ) {
                        errorResult = (
                            error as { toResponse: () => Record<string, unknown> }
                        ).toResponse()
                    } else {
                        const errorMessage = error instanceof Error ? error.message : String(error)
                        errorResult = {
                            success: false,
                            error: errorMessage,
                            code: 'INTERNAL_ERROR',
                            category: 'internal',
                            recoverable: false,
                        }
                    }

                    logAgentIssue({
                        source: 'MCP',
                        action: tool.name,
                        input: args,
                        error: (errorResult['error'] as string) ?? 'Unknown error',
                    })

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
        )
    }

    const handleResourceRead = async (
        uri: URL,
        mimeType: string
    ): Promise<{
        contents: {
            uri: string
            mimeType: string
            text: string
            annotations?: Record<string, unknown>
        }[]
    }> => {
        const currentConfig = configManager.getConfig()
        const resolvedDefaultProj =
            currentConfig.briefingConfig.defaultProjectNumber ?? defaultProjectNumber
        const activeBriefingConfig: typeof DEFAULT_BRIEFING_CONFIG = {
            ...currentConfig.briefingConfig,
            ...(resolvedDefaultProj !== undefined
                ? { defaultProjectNumber: resolvedDefaultProj }
                : {}),
            ...(options.projectRegistry !== undefined
                ? { projectRegistry: options.projectRegistry }
                : {}),
            allowedIoRoots,
        }

        try {
            const result = await readResource(
                uri.href,
                db,
                vectorManager,
                currentConfig.toolFilterConfig,
                github,
                scheduler,
                teamDb ?? undefined,
                activeBriefingConfig,
                runtime
            )

            runtime.metrics.recordResourceRead(uri.href, false)

            const dataStr =
                typeof result.data === 'string'
                    ? result.data
                    : JSON.stringify(result.data, null, 2)
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType,
                        text: dataStr,
                        ...(result.annotations !== undefined
                            ? { annotations: result.annotations }
                            : {}),
                    },
                ],
            }
        } catch (error) {
            runtime.metrics.recordResourceRead(uri.href, true)
            throw error
        }
    }

    registerResources(server, resources, handleResourceRead, runtime)

    server.server.setRequestHandler('resources/subscribe', (request, extra) => {
        const sessionId = (extra as { sessionId?: string } | undefined)?.sessionId
        const transportSessionId =
            sessionId !== undefined && sessionId !== '' ? sessionId : 'stdio'

        validateResourceSubscription(request.params.uri, runtime)

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

    const briefingConfig = configManager.getConfig().briefingConfig
    registerPrompts(
        server,
        prompts,
        db,
        teamDb ?? undefined,
        runtime,
        context.github,
        briefingConfig
    )

    const serverObj = server.server as unknown as {
        _requestHandlers?: RequestHandlerMap
    }
    const requestHandlers = serverObj._requestHandlers

    attachListToolsInterceptor(requestHandlers, configManager, allToolNames)
    attachCallToolInterceptor(
        requestHandlers,
        context,
        options,
        prompts,
        allTools,
        allToolNames,
        customToolHandlerConfig
    )

    return server
}
