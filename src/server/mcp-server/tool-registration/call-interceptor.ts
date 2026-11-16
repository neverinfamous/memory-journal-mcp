import {
    DUMMY_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_PROMPT_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    handleReadResource,
    handlePrompt,
    handleListResources,
    handleListPrompts,
    handleGetPrompt,
} from '../../../handlers/tools/core/dummy-healing.js'
import { resolveActiveBriefingConfig, syncLiveHandlerConfig } from './register-tools-helpers.js'
import {
    dispatchKnownGroupFallbackTools,
    resolveKnownFallbackAuditName,
    runFallbackWithInterceptors,
} from './fallback-interceptors.js'
import {
    ALL_KNOWN_GROUP_TOOLS,
    applyCreateWorkspaceScope,
    formatSuccessPayload,
    formatTokenEstimatedError,
    isSuccessObject,
    matchesExactName,
    normalizeAndAliasToolCall,
    toThrownValidationResponse,
    toValidationFailureResponse,
} from './call-interceptor-helpers.js'
import { isAutonomousShimBlockedByFilter } from '../../../handlers/tools/dummy-filter-helpers.js'
import type { PromptDefinition } from '../../registration.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { applyArgInterceptions } from '../../../codemode/param-normalizer.js'
import { setActiveProjectRegistry } from '../../../codemode/normalizers/generic-field-aliases.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { ServerContext, ServerOptions } from '../types.js'
import type { ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { RequestHandlerMap } from './list-interceptor.js'

function isFailureObject(res: unknown): res is Record<string, unknown> {
    return (
        typeof res === 'object' &&
        res !== null &&
        !Array.isArray(res) &&
        (res as Record<string, unknown>)['success'] === false
    )
}

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
        if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
    }

    if (
        matchesExactName(requestedTool, DUMMY_RESOURCE_TOOL_NAMES) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    ) {
        enforceAccessBoundary('read_resource', 'tool', undefined, runtime.auditLogger)
        const res = await handleReadResource(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
        if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
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
                : typeof toolArgs['prompt_name'] === 'string'
                  ? toolArgs['prompt_name']
                  : typeof toolArgs['promptName'] === 'string'
                    ? toolArgs['promptName']
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
        if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
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
    if (
        currentConfig.toolFilterConfig !== null &&
        currentConfig.toolFilterConfig !== undefined &&
        isAutonomousShimBlockedByFilter(
            requestedTool,
            matchingPrompt?.name,
            currentConfig.toolFilterConfig
        )
    ) {
        return formatTokenEstimatedError(
            {
                success: false,
                error: `Tool '${requestedTool}' is disabled by the active --tool-filter configuration.`,
                code: 'TOOL_DISABLED',
                category: 'authorization',
                suggestion: 'Update the active tool filter or use an enabled tool.',
                recoverable: false,
            },
            true
        )
    }
    const fallbackConfig: ToolHandlerConfig = {
        ...customToolHandlerConfig,
        filterConfig: currentConfig.toolFilterConfig,
        runtime,
    }
    syncLiveHandlerConfig(
        fallbackConfig,
        currentConfig,
        options,
        resolveActiveBriefingConfig(currentConfig.briefingConfig, allowedIoRoots)
    )
    const toolContext: ToolContext = {
        db,
        ...(teamDb !== undefined ? { teamDb } : {}),
        vectorManager,
        ...(teamVectorManager !== undefined ? { teamVectorManager } : {}),
        github,
        config: fallbackConfig,
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

    return dispatchKnownGroupFallbackTools(
        requestedTool,
        toolArgs,
        toolContext,
        currentConfig.toolFilterConfig,
        fallbackConfig,
        allTools,
        allToolNames,
        runtime
    )
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
        const auditTargetName = resolveKnownFallbackAuditName(requestedTool, matchingPrompt)
        if (auditTargetName !== undefined) {
            const fallbackResponse = await runFallbackWithInterceptors(
                auditTargetName,
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

function runArgInterceptionForCall(
    params: { name?: string; arguments?: Record<string, unknown> },
    inputArg: unknown,
    projectRegistry?: ServerOptions['projectRegistry']
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const toolName = params.name
    if (toolName === undefined || toolName === '') return undefined

    setActiveProjectRegistry(projectRegistry)
    let intercept: ReturnType<typeof applyArgInterceptions>
    try {
        intercept = applyArgInterceptions(toolName, [inputArg])
    } finally {
        setActiveProjectRegistry(undefined)
    }

    if ('error' in intercept) {
        const errorResult = intercept.error
        logAgentIssue({
            source: 'MCP',
            action: toolName,
            input: inputArg,
            error: (errorResult['error'] as string) ?? 'Validation Error',
        })
        return formatTokenEstimatedError(errorResult, true)
    }

    const normalizedArgs = intercept.args?.[0]
    if (
        normalizedArgs !== null &&
        normalizedArgs !== undefined &&
        typeof normalizedArgs === 'object' &&
        !Array.isArray(normalizedArgs)
    ) {
        params.arguments = normalizedArgs as Record<string, unknown>
    }
    return undefined
}

function healIncomingToolCallParams(
    params: { name?: string; arguments?: Record<string, unknown> },
    options: ServerOptions,
    liveBriefing: ReturnType<typeof resolveActiveBriefingConfig>
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const rawArgs: unknown = params.arguments
    if (
        rawArgs === undefined ||
        rawArgs === null ||
        (typeof rawArgs !== 'object' && !Array.isArray(rawArgs))
    ) {
        params.arguments = {}
    }
    const healerOptions: ServerOptions = { ...options }
    if (liveBriefing.projectRegistry !== undefined) {
        healerOptions.projectRegistry = liveBriefing.projectRegistry
    } else {
        delete healerOptions.projectRegistry
    }
    if (liveBriefing.defaultProjectNumber !== undefined) {
        healerOptions.defaultProjectNumber = liveBriefing.defaultProjectNumber
    } else {
        delete healerOptions.defaultProjectNumber
    }
    if (liveBriefing.defaultWorkspaceId !== undefined) {
        healerOptions.defaultWorkspaceId = liveBriefing.defaultWorkspaceId
    } else {
        delete healerOptions.defaultWorkspaceId
    }

    if (Array.isArray(params.arguments)) {
        const errResp = runArgInterceptionForCall(params, params.arguments)
        if (errResp !== undefined) return errResp
    }
    normalizeAndAliasToolCall(params, healerOptions)
    return runArgInterceptionForCall(params, params.arguments, liveBriefing.projectRegistry)
}

async function executeInterceptedToolCall(
    request: unknown,
    extra: unknown,
    originalHandler: (request: unknown, extra: unknown) => Promise<unknown>,
    context: ServerContext,
    options: ServerOptions,
    prompts: PromptDefinition[],
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<unknown> {
    try {
        const req = request as { params?: { name?: string; arguments?: Record<string, unknown> } }
        const healingEnabled =
            options.agentHealing !== false && customToolHandlerConfig.agentHealing !== false

        const liveConfig = context.configManager.getConfig()
        const liveBriefing = resolveActiveBriefingConfig(
            liveConfig.briefingConfig,
            context.allowedIoRoots
        )
        syncLiveHandlerConfig(customToolHandlerConfig, liveConfig, options, liveBriefing)

        if (req.params !== undefined && healingEnabled) {
            const healError = healIncomingToolCallParams(req.params, options, liveBriefing)
            if (healError !== undefined) return healError
        }

        applyCreateWorkspaceScope(req.params, customToolHandlerConfig, liveBriefing, context.runtime)

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

    requestHandlers.set('tools/call', (request: unknown, extra: unknown) =>
        executeInterceptedToolCall(
            request,
            extra,
            originalHandler,
            context,
            options,
            prompts,
            allTools,
            allToolNames,
            customToolHandlerConfig
        )
    )
}
