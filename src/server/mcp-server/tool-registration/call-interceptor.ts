import {
    DUMMY_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_PROMPT_TOOL_NAMES,
    DUMMY_LIST_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    DUMMY_SERVER_INFO_TOOL_NAMES,
    DUMMY_PROJECT_TOOL_NAMES,
    DUMMY_ADAPTER_TOOL_NAMES,
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
    handleReadResource,
    handlePrompt,
    handleListResources,
    handleListPrompts,
    handleGetPrompt,
    handleServerInfo,
    handleListAdapters,
    handleGrepSearch,
    handleViewFile,
    handleListDir,
    projectAliasTarget,
} from '../../../handlers/tools/core/dummy-healing.js'
import { resolveActiveBriefingConfig } from './register-tools-helpers.js'
import { runFallbackWithInterceptors } from './fallback-interceptors.js'
import {
    ALL_KNOWN_GROUP_TOOLS,
    formatSuccessPayload,
    formatTokenEstimatedError,
    isSuccessObject,
    matchesExactName,
    normalizeAndAliasToolCall,
    resolveMcpCreateWorkspaceScope,
    resolveSingleProjectFromRegistry,
    toThrownValidationResponse,
    toValidationFailureResponse,
} from './call-interceptor-helpers.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import type { PromptDefinition } from '../../registration.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { applyArgInterceptions } from '../../../codemode/param-normalizer.js'
import { setActiveProjectRegistry } from '../../../codemode/normalizers/generic-field-aliases.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { ServerContext, ServerOptions } from '../types.js'
import type { ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { RequestHandlerMap } from './list-interceptor.js'

async function tryPromptAndResourceFallbacks(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    prompts: PromptDefinition[],
    toolContext: ToolContext,
    runtime: ServerContext['runtime']
): Promise<unknown> {
    if (matchingPrompt !== undefined) {
        enforceAccessBoundary(matchingPrompt.name, 'prompt', matchingPrompt.capabilities, runtime.auditLogger)
        const res = await handlePrompt(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    if (
        matchesExactName(requestedTool, DUMMY_RESOURCE_TOOL_NAMES) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    ) {
        enforceAccessBoundary('read_resource', 'tool', undefined, runtime.auditLogger)
        const res = await handleReadResource(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    if (matchesExactName(requestedTool, DUMMY_LIST_RESOURCE_TOOL_NAMES)) {
        enforceAccessBoundary('list_resources', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListResources(requestedTool))
    }

    if (matchesExactName(requestedTool, DUMMY_LIST_PROMPT_TOOL_NAMES)) {
        enforceAccessBoundary('list_prompts', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListPrompts(requestedTool))
    }

    if (matchesExactName(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES)) {
        const rawPromptName =
            typeof toolArgs['name'] === 'string'
                ? toolArgs['name']
                : typeof toolArgs['prompt'] === 'string'
                  ? toolArgs['prompt']
                  : undefined
        const normalizedTarget = rawPromptName?.replace(/^mj_/, '').replace(/_/g, '-')
        const targetPrompt =
            rawPromptName !== undefined
                ? prompts.find((p) => p.name === rawPromptName || p.name === normalizedTarget)
                : undefined
        enforceAccessBoundary(
            targetPrompt?.name ?? rawPromptName ?? 'get_prompt',
            'prompt',
            targetPrompt?.capabilities,
            runtime.auditLogger
        )
        const res = await handleGetPrompt(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    return undefined
}

async function tryAutonomousUnknownToolFallback(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    prompts: PromptDefinition[],
    context: ServerContext,
    options: ServerOptions,
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<unknown> {
    const { configManager, db, teamDb, vectorManager, teamVectorManager, github, runtime, allowedIoRoots } = context
    const currentConfig = configManager.getConfig()
    const toolContext: ToolContext = {
        db,
        ...(teamDb !== undefined ? { teamDb } : {}),
        vectorManager,
        ...(teamVectorManager !== undefined ? { teamVectorManager } : {}),
        github,
        config: {
            ...customToolHandlerConfig,
            filterConfig: currentConfig.toolFilterConfig,
            briefingConfig: resolveActiveBriefingConfig(
                currentConfig.briefingConfig,
                options,
                allowedIoRoots
            ),
            runtime,
        },
    }

    const promptOrResourceRes = await tryPromptAndResourceFallbacks(
        requestedTool,
        toolArgs,
        matchingPrompt,
        prompts,
        toolContext,
        runtime
    )
    if (promptOrResourceRes !== undefined) return promptOrResourceRes

    if (matchesExactName(requestedTool, DUMMY_LIST_TOOL_NAMES)) {
        enforceAccessBoundary('list_tools', 'tool', undefined, runtime.auditLogger)
        const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
        const raw = currentConfig.toolFilterConfig?.raw
        const toolsList = allTools
            .filter(
                (t) =>
                    enabledSet.has(t.name) &&
                    isToolVisibleForFilter(t.name, t.annotations?.readOnlyHint, raw)
            )
            .map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations }))
        return formatSuccessPayload({
            success: true,
            tools: toolsList,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`,
        })
    }

    if (DUMMY_SERVER_INFO_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('server_info', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleServerInfo(toolArgs, requestedTool, toolContext))
    }

    if (
        matchesExactName(requestedTool, DUMMY_PROJECT_TOOL_NAMES) ||
        requestedTool === 'projects'
    ) {
        const target = requestedTool === 'projects' ? 'list_projects' : projectAliasTarget(requestedTool)
        if (target !== undefined) {
            enforceAccessBoundary(target, 'tool', undefined, runtime.auditLogger)
            if (target === 'get_project') {
                return formatSuccessPayload(
                    resolveSingleProjectFromRegistry(customToolHandlerConfig.projectRegistry, toolArgs, requestedTool)
                )
            }
            return formatSuccessPayload({
                success: true,
                projects: customToolHandlerConfig.projectRegistry ?? {},
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered projects from projectRegistry successfully.`,
            })
        }
    }

    if (matchesExactName(requestedTool, DUMMY_ADAPTER_TOOL_NAMES)) {
        enforceAccessBoundary('list_adapters', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListAdapters(requestedTool, toolContext))
    }

    if (matchesExactName(requestedTool, DUMMY_GREP_SEARCH_TOOL_NAMES)) {
        enforceAccessBoundary('grep_search', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleGrepSearch(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_FILE_VIEW_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('view_file', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleViewFile(toolArgs, requestedTool, toolContext))
    }

    if (DUMMY_DIR_LIST_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('list_dir', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleListDir(toolArgs, requestedTool, toolContext))
    }

    return undefined
}

/** Healing fallbacks and a structured TOOL_NOT_FOUND response for tools that are not registered. */
async function handleUnknownTool(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    healingEnabled: boolean,
    prompts: PromptDefinition[],
    context: ServerContext,
    options: ServerOptions,
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<unknown> {
    const normalized = requestedTool.replace(/^mj_/, '').replace(/_/g, '-')
    const matchingPrompt = prompts.find(
        (p) =>
            p.name === normalized ||
            p.name === requestedTool ||
            p.name === requestedTool.replace(/^mj_/, '')
    )

    if (healingEnabled) {
        const fallbackResponse = await runFallbackWithInterceptors(
            requestedTool,
            toolArgs,
            context.runtime,
            () =>
                tryAutonomousUnknownToolFallback(
                    requestedTool,
                    toolArgs,
                    matchingPrompt,
                    prompts,
                    context,
                    options,
                    allTools,
                    allToolNames,
                    customToolHandlerConfig
                )
        )
        if (fallbackResponse !== undefined) return fallbackResponse
    }

    let suggestion = `Tool '${requestedTool}' does not exist. Use tools/list to see available tools.`
    const isFilteredTool = ALL_KNOWN_GROUP_TOOLS.has(requestedTool)

    if (isFilteredTool) {
        suggestion = `'${requestedTool}' is a valid tool but it is not currently exposed because of your active --tool-filter or codemode restrictions. If you are in Code Mode, invoke it via 'mj_execute_code' (e.g. 'await mj.core.${requestedTool}(...)').`
    } else if (matchingPrompt !== undefined) {
        suggestion = `'${requestedTool}' is an MCP Prompt, not an MCP Tool. Please use the 'get_prompt' tool (or your native MCP Prompts integration) to evaluate it, then use 'create_entry' to save the result.`
    } else if (requestedTool.startsWith('mj_')) {
        suggestion = `'${requestedTool}' is not a valid root tool. If you are trying to use Code Mode, you must invoke the 'mj_execute_code' tool and write javascript (e.g. 'await mj.core.searchEntries(...)').`
    }

    const errorResult = {
        success: false,
        error: `MCP error -32602: Tool ${requestedTool} not found`,
        code: 'TOOL_NOT_FOUND',
        category: 'hallucination',
        suggestion,
        recoverable: false,
    }

    if (healingEnabled) {
        logAgentIssue({
            source: 'MCP',
            action: requestedTool,
            input: toolArgs,
            error: errorResult.error,
        })
    }

    return formatTokenEstimatedError(errorResult, true)
}

export function attachCallToolInterceptor(
    requestHandlers: RequestHandlerMap | undefined,
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): void {
    const originalHandler = requestHandlers?.get('tools/call')
    if (originalHandler === undefined || requestHandlers === undefined) return

    requestHandlers.set('tools/call', async (request: unknown, extra: unknown) => {
        try {
            const req = request as { params?: { name?: string; arguments?: Record<string, unknown> } }
            const healingEnabled =
                options.agentHealing !== false && customToolHandlerConfig.agentHealing !== false

            const liveBriefing = resolveActiveBriefingConfig(
                context.configManager.getConfig().briefingConfig,
                options,
                context.allowedIoRoots
            )
            const liveRegistry = liveBriefing.projectRegistry
            const liveDefaultProj = liveBriefing.defaultProjectNumber
            const liveDefaultWs = liveBriefing.defaultWorkspaceId
            customToolHandlerConfig.briefingConfig = liveBriefing
            if (liveDefaultProj !== undefined) {
                customToolHandlerConfig.defaultProjectNumber = liveDefaultProj
            } else {
                delete customToolHandlerConfig.defaultProjectNumber
            }
            if (liveDefaultWs !== undefined) {
                customToolHandlerConfig.defaultWorkspaceId = liveDefaultWs
            } else {
                delete customToolHandlerConfig.defaultWorkspaceId
            }
            if (liveRegistry !== undefined) {
                customToolHandlerConfig.projectRegistry = liveRegistry
            } else {
                delete customToolHandlerConfig.projectRegistry
            }

            if (req.params !== undefined && healingEnabled) {
                req.params.arguments ??= {}
                normalizeAndAliasToolCall(req.params, {
                    ...options,
                    ...(liveRegistry !== undefined
                        ? { projectRegistry: liveRegistry }
                        : {}),
                    ...(liveDefaultProj !== undefined
                        ? { defaultProjectNumber: liveDefaultProj }
                        : {}),
                    ...(liveDefaultWs !== undefined
                        ? { defaultWorkspaceId: liveDefaultWs }
                        : {}),
                })
                const toolArgs = req.params.arguments

                if (req.params.name !== undefined && req.params.name !== '') {
                    setActiveProjectRegistry(liveRegistry)
                    let intercept: ReturnType<typeof applyArgInterceptions>
                    try {
                        intercept = applyArgInterceptions(req.params.name, [toolArgs])
                    } finally {
                        setActiveProjectRegistry(undefined)
                    }
                    if ('error' in intercept) {
                        const errorResult = intercept.error
                        logAgentIssue({
                            source: 'MCP',
                            action: req.params.name,
                            input: toolArgs,
                            error: (errorResult['error'] as string) ?? 'Validation Error',
                        })
                        return formatTokenEstimatedError(errorResult, false)
                    }
                    const normalizedArgs = intercept.args?.[0]
                    if (
                        normalizedArgs !== null &&
                        normalizedArgs !== undefined &&
                        typeof normalizedArgs === 'object' &&
                        !Array.isArray(normalizedArgs)
                    ) {
                        req.params.arguments = normalizedArgs as Record<string, unknown>
                    }
                }
            }

            if (req.params?.arguments !== undefined) {
                resolveMcpCreateWorkspaceScope(req.params.name, req.params.arguments, {
                    ...customToolHandlerConfig,
                    briefingConfig: liveBriefing,
                    runtime: context.runtime,
                    ...(liveRegistry !== undefined ? { projectRegistry: liveRegistry } : {}),
                    ...(liveDefaultProj !== undefined ? { defaultProjectNumber: liveDefaultProj } : {}),
                    ...(liveDefaultWs !== undefined ? { defaultWorkspaceId: liveDefaultWs } : {}),
                })
            }

            if (
                req.params?.name !== undefined &&
                req.params.name !== '' &&
                !allToolNames.has(req.params.name)
            ) {
                return await handleUnknownTool(
                    req.params.name,
                    req.params.arguments ?? {},
                    healingEnabled,
                    prompts,
                    context,
                    options,
                    allTools,
                    allToolNames,
                    customToolHandlerConfig
                )
            }

            const result = await originalHandler(request, extra)

            const validationFailure = toValidationFailureResponse(result, req.params)
            if (validationFailure !== undefined) return validationFailure

            return result
        } catch (error: unknown) {
            const handled = toThrownValidationResponse(error, request)
            if (handled !== undefined) return handled
            throw error
        }
    })
}
