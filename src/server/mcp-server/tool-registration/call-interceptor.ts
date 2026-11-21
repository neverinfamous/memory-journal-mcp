import { resolveActiveBriefingConfig, syncLiveHandlerConfig } from './register-tools-helpers.js'
import {
    dispatchKnownGroupFallbackTools,
    resolveKnownFallbackAuditName,
    runFallbackWithInterceptors,
} from './fallback-interceptors.js'
import {
    ALL_KNOWN_GROUP_TOOLS,
    exceedsMaxToolInputElements,
    formatTokenEstimatedError,
    hasToolCallRequestShape,
    resolveCodeModeCallHint,
    resolvePromptOrResourceAccessTargets,
    toThrownValidationResponse,
    toValidationFailureResponse,
    tryPromptAndResourceFallbacks,
} from './call-interceptor-helpers.js'
import { resolveEffectiveMaxToolInputElements } from './register-tools.js'
import {
    applyCreateWorkspaceScope,
    healIncomingToolCallParams,
} from './call-arg-normalizer.js'
import {
    isAutonomousShimBlockedByFilter,
    isDummyToolAllowedByFilter,
} from '../../../handlers/tools/dummy-filter-helpers.js'
import { DUMMY_HEALING_TOOL_NAMES } from '../../../handlers/tools/core/dummy-healing/alias-catalog.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { hasScope } from '../../../auth/scopes.js'
import { getRequiredScope } from '../../../auth/scope-map.js'
import { getGrantedAuthScopes } from '../../../auth/validation.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import type { PromptDefinition } from '../../registration.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { setFallbackProjectRegistryLoader } from '../../../codemode/normalizers/generic-field-aliases.js'
import { loadProjectRegistryFromConfig } from '../../../utils/workspace-resolver.js'
import type { ServerContext, ServerOptions } from '../types.js'
import type { ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { RequestHandlerMap } from './list-interceptor.js'

setFallbackProjectRegistryLoader(loadProjectRegistryFromConfig)

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
        const hint = resolveCodeModeCallHint(requestedTool)
        suggestion = `'${requestedTool}' is a valid tool but it is not currently exposed because of your active --tool-filter or codemode restrictions. If you are in Code Mode, invoke it via 'mj_execute_code' (e.g. 'await ${hint}(...)').`
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

function resolveBlockedShimResponse(
    requestedTool: string,
    matchingPrompt: PromptDefinition | undefined,
    context: ServerContext
): unknown {
    const liveConfig = context.configManager.getConfig()
    const activeFilter = liveConfig.toolFilterConfig
    if (
        activeFilter === null ||
        activeFilter === undefined ||
        !isAutonomousShimBlockedByFilter(
            requestedTool,
            matchingPrompt?.name,
            activeFilter,
            liveConfig.codemodeInternalFullAccess === true
        )
    ) {
        return undefined
    }
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
            const blockedResponse = resolveBlockedShimResponse(requestedTool, matchingPrompt, context)
            if (blockedResponse !== undefined) return blockedResponse
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

interface SyncedCallConfigState {
    rawConfig: ReturnType<ServerContext['configManager']['getConfig']>
    liveBriefing: ReturnType<typeof resolveActiveBriefingConfig>
}

function resolveAndSyncLiveBriefing(
    context: ServerContext,
    options: ServerOptions,
    customToolHandlerConfig: ToolHandlerConfig,
    syncedState?: SyncedCallConfigState
): ReturnType<typeof resolveActiveBriefingConfig> {
    const liveConfig = context.configManager.getConfig()
    const canReuseSynced =
        syncedState?.rawConfig === liveConfig &&
        customToolHandlerConfig.briefingConfig === syncedState.liveBriefing
    const liveBriefing = canReuseSynced
        ? syncedState.liveBriefing
        : resolveActiveBriefingConfig(liveConfig.briefingConfig, context.allowedIoRoots)
    if (!canReuseSynced) {
        syncLiveHandlerConfig(customToolHandlerConfig, liveConfig, options, liveBriefing)
        if (syncedState !== undefined) {
            syncedState.rawConfig = liveConfig
            syncedState.liveBriefing = liveBriefing
        }
    }
    return liveBriefing
}

function checkCallElementLimit(
    argsVal: unknown,
    maxToolInputElements: number | undefined
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const maxElements = resolveEffectiveMaxToolInputElements(maxToolInputElements)
    if (argsVal === undefined || !exceedsMaxToolInputElements(argsVal, maxElements)) {
        return undefined
    }
    return formatTokenEstimatedError(
        {
            success: false,
            error: `Tool input exceeds maximum allowed element count (${String(maxElements)}).`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion: 'Reduce input payload size or batch items into smaller requests.',
            recoverable: false,
        },
        true
    )
}

function isRegisteredToolBlocked(
    toolName: string | undefined,
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    config: ToolHandlerConfig,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): boolean {
    if (toolName === undefined || !allToolNames.has(toolName)) return false
    const auth = getAuthContext()
    if (auth !== undefined && !hasScope(getGrantedAuthScopes(auth), getRequiredScope(toolName))) {
        return true
    }
    const filterCfg = config.filterConfig
    if (
        filterCfg !== undefined &&
        filterCfg !== null &&
        config.codemodeInternalFullAccess !== true
    ) {
        const readOnlyHint =
            readOnlyHints !== undefined
                ? readOnlyHints.get(toolName)
                : allTools.find((t) => t.name === toolName)?.annotations?.readOnlyHint
        if (
            filterCfg.enabledTools.has(toolName) &&
            isToolVisibleForFilter(toolName, readOnlyHint, filterCfg.raw)
        ) {
            return false
        }
        if (
            DUMMY_HEALING_TOOL_NAMES.has(toolName) &&
            isDummyToolAllowedByFilter(toolName, filterCfg, config.agentHealing !== false, false)
        ) {
            return false
        }
        return true
    }
    return false
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
    customToolHandlerConfig: ToolHandlerConfig,
    syncedState?: SyncedCallConfigState,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): Promise<unknown> {
    try {
        const params = hasToolCallRequestShape(request) ? request.params : undefined
        const healingEnabled =
            options.agentHealing !== false && customToolHandlerConfig.agentHealing !== false
        const liveBriefing = resolveAndSyncLiveBriefing(context, options, customToolHandlerConfig, syncedState)

        const limitErr = checkCallElementLimit(params?.arguments, options.maxToolInputElements)
        if (limitErr !== undefined) return limitErr

        const preHealName = params?.name
        if (isRegisteredToolBlocked(preHealName, allTools, allToolNames, customToolHandlerConfig, readOnlyHints)) {
            return await originalHandler(request, extra)
        }

        if (params !== undefined && healingEnabled) {
            const healError = healIncomingToolCallParams(params, options, liveBriefing)
            if (healError !== undefined) return healError
        }

        if (
            params?.name !== preHealName &&
            isRegisteredToolBlocked(params?.name, allTools, allToolNames, customToolHandlerConfig, readOnlyHints)
        ) {
            return await originalHandler(request, extra)
        }

        applyCreateWorkspaceScope(params, customToolHandlerConfig, liveBriefing, context.runtime)

        if (
            params?.name !== undefined &&
            params.name !== '' &&
            !allToolNames.has(params.name)
        ) {
            const normalizedToolArgs =
                typeof params.arguments === 'object' &&
                params.arguments !== null &&
                !Array.isArray(params.arguments)
                    ? params.arguments
                    : {}
            return await handleUnknownTool(
                params.name,
                normalizedToolArgs,
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
    customToolHandlerConfig: ToolHandlerConfig,
    readOnlyHints?: ReadonlyMap<string, boolean | undefined>
): void {
    const originalHandler = requestHandlers?.get('tools/call')
    if (originalHandler === undefined || requestHandlers === undefined) return
    const initialConfig = context.configManager.getConfig()
    const syncedState: SyncedCallConfigState = {
        rawConfig: initialConfig,
        liveBriefing: resolveActiveBriefingConfig(
            initialConfig.briefingConfig,
            context.allowedIoRoots
        ),
    }

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
            customToolHandlerConfig,
            syncedState,
            readOnlyHints
        )
    )
}
