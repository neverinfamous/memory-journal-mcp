import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'
import { getEnabledGroups } from '../../filtering/tool-filter.js'
import { callTool } from '../../handlers/tools/index.js'
import { readResource, validateResourceSubscription } from '../../handlers/resources/index.js'
import { generateInstructions } from '../../constants/server-instructions.js'
import { type DEFAULT_BRIEFING_CONFIG } from '../../handlers/resources/shared.js'
import { registerResources, registerPrompts } from '../registration.js'
import type { ResourceDefinition, PromptDefinition } from '../registration.js'
import { VERSION } from '../../version.js'
import { globalSubscriptionManager } from '../subscription-manager.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { ServerContext, ServerOptions } from './types.js'
import type { ToolRegistration, ToolHandlerConfig } from '../../types/index.js'

export function createServerInstance(
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    resources: ResourceDefinition[],
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): McpServer {
    const { configManager, db, teamDb, vectorManager, teamVectorManager, github, scheduler, allowedIoRoots, runtime } = context;
    const { defaultProjectNumber } = options;

        // Generate dynamic instructions based on current config
        const getInstructions = (): string => {
            const currentConfig = configManager.getConfig()
            const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
            const groups = currentConfig.toolFilterConfig ? getEnabledGroups(currentConfig.toolFilterConfig.enabledTools) : undefined
            return generateInstructions(
                enabledSet,
                prompts.map((p) => {
                    const prompt = p as { name: string; description?: string }
                    return { name: prompt.name, description: prompt.description }
                }),
                undefined,
                currentConfig.instructionLevel,
                groups
            )
        }

        // Create MCP server
        const server = new McpServer(
            {
                name: 'memory-journal-mcp',
                version: VERSION,
            },
            {
                capabilities: {
                    logging: {},
                    resources: {
                        subscribe: true,
                        listChanged: true,
                    },
                },
                instructions: getInstructions(),
            }
        )

        for (const tool of allTools) {
            // Build tool options matching MCP SDK expectations
            const toolOptions: {
                description?: string
                title?: string
                inputSchema?: z.ZodType
                outputSchema?: z.ZodType
                annotations?: {
                    title?: string
                    readOnlyHint?: boolean
                    destructiveHint?: boolean
                    idempotentHint?: boolean
                    openWorldHint?: boolean
                }
                icons?: unknown
            } = {
                description: tool.description,
            }

            // MCP 2025-11-25: Pass title for human-readable display
            if (tool.title) {
                toolOptions.title = tool.title
            }

            if (tool.inputSchema !== undefined) {
                const schema = tool.inputSchema
                if (
                    typeof schema === 'object' &&
                    schema !== null &&
                    'partial' in schema &&
                    typeof schema.partial === 'function'
                ) {
                    // DOCUMENTATION (P3 #8): Two-Schema Pattern
                    // We use a strict `inputSchema` for tool definitions so LLMs see exactly what is required.
                    // However, the MCP SDK strictly validates incoming JSON against this schema before reaching our handlers.
                    // By using `.partial().passthrough()` here, we relax the schema for the SDK, allowing our
                    // own handler logic to perform the strict validation, sanitize data, and return structured error
                    // messages instead of the SDK crashing or returning opaque generic errors.
                    //
                    // .partial() makes all fields optional so the SDK accepts `{}`.
                    // .passthrough() preserves unrecognized keys so handler can normalize.
                    // Wrapped in try/catch: if partial() returns something without passthrough()
                    // (non-ZodObject wrapper), fall back to the original schema to avoid
                    // a startup throw.
                    try {
                        const relaxed = (
                            schema as { partial: () => { passthrough?: () => z.ZodType } }
                        ).partial()
                        toolOptions.inputSchema = (typeof relaxed.passthrough === 'function'
                            ? relaxed.passthrough()
                            : schema) as unknown as z.ZodType
                    } catch {
                        toolOptions.inputSchema = schema as unknown as z.ZodType
                    }
                } else {
                    toolOptions.inputSchema = schema as unknown as z.ZodType
                }
            }

            // MCP 2025-11-25: Pass outputSchema for structured responses
            if (tool.outputSchema !== undefined) {
                const outSchema = tool.outputSchema
                if (
                    typeof outSchema === 'object' &&
                    outSchema !== null &&
                    'passthrough' in outSchema &&
                    typeof outSchema.passthrough === 'function'
                ) {
                    try {
                        toolOptions.outputSchema = (outSchema as { passthrough: () => z.ZodType }).passthrough()
                    } catch {
                        toolOptions.outputSchema = outSchema as unknown as z.ZodType
                    }
                } else {
                    toolOptions.outputSchema = outSchema as unknown as z.ZodType
                }
            }

            if (tool.annotations !== undefined) {
                toolOptions.annotations = tool.annotations
            }

            // MCP 2025-11-25: Pass icons for visual representation
            if (tool.icons) {
                toolOptions.icons = tool.icons
            }

            // Capture whether this tool has outputSchema for response handling
            const hasOutputSchema = Boolean(tool.outputSchema)

            server.registerTool(tool.name, toolOptions, async (args, extra): Promise<CallToolResult> => {
                try {
                    // Build progress context for progress notifications
                    // Extract progressToken from extra._meta (SDK passes RequestHandlerExtra)
                    const extraMeta = extra as { _meta?: { progressToken?: string | number } }
                    const progressToken = extraMeta?._meta?.progressToken
                    const progressContext =
                        progressToken !== undefined
                            ? { server: server.server, progressToken }
                            : undefined

                    // Ensure the dispatch gets the latest filter config!
                    const currentConfig = configManager.getConfig()
                    customToolHandlerConfig.filterConfig = currentConfig.toolFilterConfig
                    customToolHandlerConfig.briefingConfig = currentConfig.briefingConfig

                    const toolArgs = args as Record<string, unknown>
                    
                    // Intercept hallucinated 'repo' or 'project' strings and map to project_number
                    if (typeof toolArgs?.['project_number'] === 'undefined') {
                        let repoStr: string | undefined
                        if (typeof toolArgs?.['repo'] === 'string') repoStr = toolArgs['repo']
                        else if (typeof toolArgs?.['project'] === 'string') repoStr = toolArgs['project']
                        
                        if (repoStr && options.projectRegistry) {
                            let entry = options.projectRegistry[repoStr]
                            if (!entry && repoStr.includes('/')) {
                                const repoName = repoStr.split('/').pop()
                                if (repoName) {
                                    entry = options.projectRegistry[repoName]
                                }
                            }
                            if (entry?.project_number !== undefined) {
                                toolArgs['project_number'] = entry.project_number
                            }
                        }
                    }

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

                    const isSuccess = typeof result === 'object' && result !== null && (result as Record<string, unknown>)['success'] === true
                    if (isSuccess) {
                        const mutatingTools = [
                            'create_entry', 'update_entry', 'delete_entry', 'restore_entry',
                            'batch_create_entries', 'batch_update_entries', 'batch_delete_entries',
                            'raise_flag', 'resolve_flag',
                            'add_team_member', 'update_team_member', 'remove_team_member'
                        ]
                        const isMutation = mutatingTools.includes(tool.name) || (tool.name.startsWith('team_') && tool.name !== 'team_search' && tool.name !== 'get_team_entry_by_id')
                        
                        if (isMutation) {
                            void globalSubscriptionManager.notifyResourceUpdated('memory://briefing')
                            void globalSubscriptionManager.notifyResourceUpdated('memory://recent')
                            void globalSubscriptionManager.notifyResourceUpdated('memory://statistics')
                            
                            if (tool.name.startsWith('team_') || tool.name.includes('flag') || tool.name.includes('team_member')) {
                                void globalSubscriptionManager.notifyResourceUpdated('memory://team/recent')
                                void globalSubscriptionManager.notifyResourceUpdated('memory://team/statistics')
                            }
                            
                            if (tool.name.includes('flag')) {
                                void globalSubscriptionManager.notifyResourceUpdated('memory://flags')
                                void globalSubscriptionManager.notifyResourceUpdated('memory://flags/history')
                            }
                        }
                    }

                    // MCP 2025-11-25: If tool has outputSchema, return both:
                    // - structuredContent: validated JSON for clients that support it
                    // - content: compact text fallback (~15-20% payload reduction per §3.1)
                    const textContent =
                        typeof result === 'string' ? result : JSON.stringify(result, null, 2)

                    if (hasOutputSchema) {
                        // Include both structured data for the UI and raw text for the LLM context
                        return {
                            content: [
                                {
                                    type: 'text' as const,
                                    text: textContent,
                                },
                            ],
                            structuredContent: result as Record<string, unknown>,
                        }
                    }

                    // Otherwise, return just text content
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: textContent,
                            },
                        ],
                    }
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
            })
        }

        // Resource read handler shared by template and static branches (D2 fix)
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
            const activeBriefingConfig: typeof DEFAULT_BRIEFING_CONFIG = {
                ...(currentConfig.briefingConfig),
                // Ensure defaultProjectNumber is available to resource handlers
                // (may come via briefingConfig from CLI, or directly from server options)
                defaultProjectNumber:
                    currentConfig.briefingConfig.defaultProjectNumber ?? defaultProjectNumber,
                projectRegistry: options.projectRegistry,
                flagVocabulary: options.flagVocabulary,
                allowedIoRoots: allowedIoRoots,
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
                    typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType,
                            text: dataStr,
                            ...(result.annotations ? { annotations: result.annotations } : {}),
                        },
                    ],
                }
            } catch (error) {
                runtime.metrics.recordResourceRead(uri.href, true)
                throw error
            }
        }

        // Register resources (reusing resources from instruction generation)
        registerResources(server, resources, handleResourceRead, runtime)

        // Register subscribe/unsubscribe handlers on the underlying server
        server.server.setRequestHandler(SubscribeRequestSchema, (request, extra) => {
            const transportSessionId = (extra as { sessionId?: string })?.sessionId || 'stdio'
            
            // Validate that the current session has authorization to subscribe to this resource
            validateResourceSubscription(request.params.uri, runtime)
            
            globalSubscriptionManager.registerServer(transportSessionId, server)
            globalSubscriptionManager.subscribe(request.params.uri, transportSessionId)
            return {}
        })

        server.server.setRequestHandler(UnsubscribeRequestSchema, (request, extra) => {
            const transportSessionId = (extra as { sessionId?: string })?.sessionId || 'stdio'
            globalSubscriptionManager.unsubscribe(request.params.uri, transportSessionId)
            return {}
        })

        // Register prompts (reusing prompts from instruction generation)
        registerPrompts(server, prompts, db, teamDb ?? undefined, runtime)

        // Intercept SDK-level Zod validation errors to return structured error responses
        const serverObj = server.server as unknown as {
            _requestHandlers: Map<string, (req: unknown, ext: unknown) => Promise<unknown>>
        }
        const requestHandlers = serverObj._requestHandlers
        
        // Intercept tools/list for dynamic filtering
        const listToolsHandler = requestHandlers?.get('tools/list')
        if (listToolsHandler) {
            requestHandlers.set('tools/list', async (request: unknown, extra: unknown) => {
                const currentConfig = configManager.getConfig()
                const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
                
                const result = await listToolsHandler(request, extra)
                const res = result as { tools?: { name: string }[] } | undefined
                if (Array.isArray(res?.tools)) {
                    res.tools = res.tools.filter((t) => enabledSet.has(t.name))
                }
                return result
            })
        }

        const originalHandler = requestHandlers?.get('tools/call')
        if (originalHandler) {
            requestHandlers.set('tools/call', async (request: unknown, extra: unknown) => {
                try {
                    const result = await originalHandler(request, extra)

                    // Intercept JSON-RPC success responses that carry SDK Zod validation errors
                    if (
                        result !== null &&
                        result !== undefined &&
                        typeof result === 'object' &&
                        'isError' in result &&
                        result.isError === true
                    ) {
                        const resObj = result as { content?: { type?: string; text?: string }[] }
                        if (Array.isArray(resObj.content) && resObj.content.length > 0) {
                            const text = resObj.content[0]?.text
                            if (typeof text === 'string' && text.includes('MCP error -32602')) {
                                let errorMessage = text.replace(
                                    'MCP error -32602: Input validation error: ',
                                    ''
                                )

                                try {
                                    const parts = text.split(': [')
                                    if (parts.length > 1) {
                                        const zodErrors = JSON.parse('[' + parts[1]) as {
                                            path?: string[]
                                            message?: string
                                        }[]
                                        const formattedErrors = zodErrors
                                            .map((e) => {
                                                const path =
                                                    e.path && e.path.length > 0
                                                        ? e.path.join('.')
                                                        : 'unknown'
                                                return `${path}: ${e.message || 'invalid'}`
                                            })
                                            .join('; ')
                                        errorMessage = formattedErrors
                                    }
                                } catch {
                                    // Fallback to raw message if parsing fails
                                }

                                const errorResult = {
                                    success: false,
                                    error: errorMessage,
                                    code: 'VALIDATION_ERROR',
                                    category: 'validation',
                                    suggestion: 'Check input parameters against the tool schema',
                                    recoverable: false,
                                }

                                const enriched = JSON.stringify({
                                    ...errorResult,
                                    _meta: { tokenEstimate: 0 },
                                })
                                const tokenEstimate = Math.ceil(
                                    Buffer.byteLength(enriched, 'utf8') / 4
                                )
                                const finalText = enriched.replace(
                                    '"tokenEstimate":0',
                                    `"tokenEstimate":${tokenEstimate}`
                                )

                                return {
                                    content: [
                                        {
                                            type: 'text',
                                            text: finalText,
                                        },
                                    ],
                                    structuredContent: errorResult,
                                }
                            }
                        }
                    }

                    return result
                } catch (error: unknown) {
                    const err = error as { code?: number; message?: string }
                    if (err?.code === -32602) {
                        let errorMessage = err.message || 'Validation Error'

                        if (
                            typeof errorMessage === 'string' &&
                            errorMessage.includes('Invalid arguments for tool')
                        ) {
                            try {
                                const parts = errorMessage.split(': [')
                                if (parts.length > 1) {
                                    const zodErrors = JSON.parse('[' + parts[1]) as {
                                        path?: string[]
                                        message?: string
                                    }[]
                                    const formattedErrors = zodErrors
                                        .map((e) => {
                                            const path =
                                                e.path && e.path.length > 0
                                                    ? e.path.join('.')
                                                    : 'unknown'
                                            return `${path}: ${e.message || 'invalid'}`
                                        })
                                        .join('; ')
                                    errorMessage = formattedErrors
                                }
                            } catch {
                                // Fallback to raw message if parsing fails
                            }
                        }

                        const errorResult = {
                            success: false,
                            error: errorMessage,
                            code: 'VALIDATION_ERROR',
                            category: 'validation',
                            suggestion: 'Check input parameters against the tool schema',
                            recoverable: false,
                        }

                        const enriched = JSON.stringify({
                            ...errorResult,
                            _meta: { tokenEstimate: 0 },
                        })
                        const tokenEstimate = Math.ceil(Buffer.byteLength(enriched, 'utf8') / 4)
                        const finalText = enriched.replace(
                            '"tokenEstimate":0',
                            `"tokenEstimate":${tokenEstimate}`
                        )

                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: finalText,
                                },
                            ],
                            structuredContent: errorResult,
                        }
                    }
                    throw error
                }
            })
        }

        return server
}