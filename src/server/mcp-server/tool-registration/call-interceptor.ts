import {
    DUMMY_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_RESOURCE_TOOL_NAMES,
    DUMMY_LIST_PROMPT_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    extractUriFromArgs,
    handleReadResource,
    handlePrompt,
    handleListResources,
    handleListPrompts,
    handleGetPrompt,
} from '../../../handlers/tools/core/dummy-healing.js'
import { getBaseUri } from '../../../handlers/resources/shared.js'
import { resolveActiveBriefingConfig, syncLiveHandlerConfig } from './register-tools-helpers.js'
import {
    dispatchKnownGroupFallbackTools,
    resolveKnownFallbackAuditName,
    runFallbackWithInterceptors,
    type FallbackAccessTarget,
} from './fallback-interceptors.js'
import {
    ALL_KNOWN_GROUP_TOOLS,
    formatSuccessPayload,
    formatTokenEstimatedError,
    isSuccessObject,
    matchesExactName,
    toThrownValidationResponse,
    toValidationFailureResponse,
    type ToolCallParams,
} from './call-interceptor-helpers.js'
import {
    applyCreateWorkspaceScope,
    healIncomingToolCallParams,
} from './call-arg-normalizer.js'
import { isAutonomousShimBlockedByFilter } from '../../../handlers/tools/dummy-filter-helpers.js'
import type { PromptDefinition } from '../../registration.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { setFallbackProjectRegistryLoader } from '../../../codemode/normalizers/generic-field-aliases.js'
import { loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import type { ServerContext, ServerOptions } from '../types.js'
import type { ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { RequestHandlerMap } from './list-interceptor.js'

setFallbackProjectRegistryLoader(loadProjectRegistryFromConfig)

function isFailureObject(res: unknown): res is Record<string, unknown> {
    return (
        typeof res === 'object' &&
        res !== null &&
        !Array.isArray(res) &&
        'success' in res &&
        res.success === false
    )
}

function resolveGetPromptTarget(
    toolArgs: Record<string, unknown>,
    prompts: PromptDefinition[]
): { targetName: string; capabilities: PromptDefinition['capabilities'] } {
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
    return {
        targetName: targetPrompt?.name ?? rawPromptName ?? 'get_prompt',
        capabilities: targetPrompt?.capabilities,
    }
}

function resolvePromptOrResourceAccessTargets(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    prompts: PromptDefinition[]
): FallbackAccessTarget[] | undefined {
    if (matchingPrompt !== undefined) {
        return [
            {
                targetName: matchingPrompt.name,
                targetType: 'prompt',
                ...(matchingPrompt.capabilities !== undefined
                    ? { capabilities: matchingPrompt.capabilities }
                    : {}),
            },
        ]
    }
    if (
        matchesExactName(requestedTool, DUMMY_RESOURCE_TOOL_NAMES) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    ) {
        const rawUri =
            extractUriFromArgs(toolArgs) ??
            (requestedTool.startsWith('memory://') ? requestedTool : 'memory://briefing')
        return [
            { targetName: 'read_resource', targetType: 'tool' },
            { targetName: getBaseUri(rawUri), targetType: 'resource' },
        ]
    }
    if (matchesExactName(requestedTool, DUMMY_LIST_RESOURCE_TOOL_NAMES)) {
        return [{ targetName: 'list_resources', targetType: 'tool' }]
    }
    if (matchesExactName(requestedTool, DUMMY_LIST_PROMPT_TOOL_NAMES)) {
        return [{ targetName: 'list_prompts', targetType: 'tool' }]
    }
    if (matchesExactName(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES)) {
        const promptTarget = resolveGetPromptTarget(toolArgs, prompts)
        return [
            {
                targetName: promptTarget.targetName,
                targetType: 'prompt',
                ...(promptTarget.capabilities !== undefined
                    ? { capabilities: promptTarget.capabilities }
                    : {}),
            },
        ]
    }
    return undefined
}

async function tryPromptAndResourceFallbacks(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    toolContext: ToolContext
): Promise<unknown> {
    if (matchingPrompt !== undefined) {
        const res = await handlePrompt(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
        if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
    }

    if (
        matchesExactName(requestedTool, DUMMY_RESOURCE_TOOL_NAMES) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    ) {
        const res = await handleReadResource(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
        if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
    }

    if (matchesExactName(requestedTool, DUMMY_LIST_RESOURCE_TOOL_NAMES)) {
        return formatSuccessPayload(handleListResources(requestedTool))
    }

    if (matchesExactName(requestedTool, DUMMY_LIST_PROMPT_TOOL_NAMES)) {
        return formatSuccessPayload(handleListPrompts(requestedTool))
    }

    if (matchesExactName(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES)) {
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
    context: ServerContext,
    options: ServerOptions,
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<unknown> {
    const { configManager, db, teamDb, vectorManager, teamVectorManager, github, runtime, allowedIoRoots } = context
    const currentConfig = configManager.getConfig()
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
        toolContext
    )
    if (promptOrResourceRes !== undefined) return promptOrResourceRes

    return dispatchKnownGroupFallbackTools(
        requestedTool,
        toolArgs,
        toolContext,
        currentConfig.toolFilterConfig,
        fallbackConfig,
        allTools,
        allToolNames
    )
}

function buildToolNotFoundErrorPayload(
    requestedTool: string,
    matchingPrompt: PromptDefinition | undefined
): Record<string, unknown> {
    let suggestion = `Tool '${requestedTool}' does not exist. Use tools/list to see available tools.`
    const isFilteredTool = ALL_KNOWN_GROUP_TOOLS.has(requestedTool)

    if (isFilteredTool) {
        suggestion = `'${requestedTool}' is a valid tool but it is not currently exposed because of your active --tool-filter or codemode restrictions. If you are in Code Mode, invoke it via 'mj_execute_code' (e.g. 'await mj.core.${requestedTool}(...)').`
    } else if (matchingPrompt !== undefined) {
        suggestion = `'${requestedTool}' is an MCP Prompt, not an MCP Tool. Please use the 'get_prompt' tool (or your native MCP Prompts integration) to evaluate it, then use 'create_entry' to save the result.`
    } else if (requestedTool.startsWith('mj_')) {
        suggestion = `'${requestedTool}' is not a valid root tool. If you are trying to use Code Mode, you must invoke the 'mj_execute_code' tool and write javascript (e.g. 'await mj.core.searchEntries(...)').`
    }

    return {
        success: false,
        error: `MCP error -32602: Tool ${requestedTool} not found`,
        code: 'TOOL_NOT_FOUND',
        category: 'hallucination',
        suggestion,
        recoverable: false,
    }
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
            const activeFilter = context.configManager.getConfig().toolFilterConfig
            if (
                activeFilter !== null &&
                activeFilter !== undefined &&
                isAutonomousShimBlockedByFilter(requestedTool, matchingPrompt?.name, activeFilter)
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
            const accessTargets = resolvePromptOrResourceAccessTargets(
                requestedTool,
                toolArgs,
                matchingPrompt,
                prompts
            )
            const fallbackResponse = await runFallbackWithInterceptors(
                auditTargetName,
                toolArgs,
                context.runtime,
                () =>
                    tryAutonomousUnknownToolFallback(
                        requestedTool,
                        toolArgs,
                        matchingPrompt,
                        context,
                        options,
                        allTools,
                        allToolNames,
                        customToolHandlerConfig
                    ),
                accessTargets
            )
            if (fallbackResponse !== undefined) return fallbackResponse
        }
    }

    const errorResult = buildToolNotFoundErrorPayload(requestedTool, matchingPrompt)
    if (healingEnabled) {
        logAgentIssue({
            source: 'MCP',
            action: requestedTool,
            input: toolArgs,
            error: String(errorResult['error']),
        })
    }

    return formatTokenEstimatedError(errorResult, true)
}

function hasToolCallRequestShape(request: unknown): request is { params?: ToolCallParams } {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
        return false
    }
    if (!('params' in request) || request.params === undefined) {
        return true
    }
    const params = request.params
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
        return false
    }
    const nameOk = !('name' in params) || params.name === undefined || typeof params.name === 'string'
    const argsOk =
        !('arguments' in params) ||
        params.arguments === undefined ||
        (typeof params.arguments === 'object' &&
            params.arguments !== null &&
            !Array.isArray(params.arguments))
    return nameOk && argsOk
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
        const params = hasToolCallRequestShape(request) ? request.params : undefined
        const healingEnabled =
            options.agentHealing !== false && customToolHandlerConfig.agentHealing !== false

        const liveConfig = context.configManager.getConfig()
        const liveBriefing = resolveActiveBriefingConfig(
            liveConfig.briefingConfig,
            context.allowedIoRoots
        )
        syncLiveHandlerConfig(customToolHandlerConfig, liveConfig, options, liveBriefing)

        if (params !== undefined && healingEnabled) {
            const healError = healIncomingToolCallParams(params, options, liveBriefing)
            if (healError !== undefined) return healError
        }

        applyCreateWorkspaceScope(params, customToolHandlerConfig, liveBriefing, context.runtime)

        if (
            params?.name !== undefined &&
            params.name !== '' &&
            !allToolNames.has(params.name)
        ) {
            return await handleUnknownTool(
                params.name,
                params.arguments ?? {},
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
        const validationFailure = toValidationFailureResponse(result, params)
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
