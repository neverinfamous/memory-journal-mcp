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
} from '../../../handlers/tools/core/dummy-healing.js'
import {
    ALL_KNOWN_GROUP_TOOLS,
    deepCamelToSnake,
    formatSuccessPayload,
    formatTokenEstimatedError,
    isSuccessObject,
    matchesExactName,
    parseZodErrorsFromMessage,
} from './call-interceptor-helpers.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import type { PromptDefinition } from '../../registration.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { applyArgInterceptions } from '../../../codemode/param-normalizer.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import type { ServerContext, ServerOptions } from '../types.js'
import type { ToolRegistration, ToolHandlerConfig, ToolContext } from '../../../types/index.js'
import type { RequestHandlerMap } from './list-interceptor.js'

const ALIASED_EXECUTE_CODE_NAMES = new Set([
    'mysql_execute_code', 'mysqlExecuteCode', 'execute_code', 'executeCode',
    'mjExecuteCode', 'mj_eval', 'eval_code', 'run_code', 'exec_code', 'code_execute',
])

const ALIASED_LIST_PROJECTS_NAMES = new Set([
    'listProjects', 'list-projects', 'get_projects', 'getProjects', 'get-projects',
    'mj_list_projects', 'mjListProjects', 'mj_get_projects', 'mjGetProjects',
    'mj_admin_list_projects', 'mj_admin_get_projects',
])

const ALIASED_GET_PROJECT_NAMES = new Set([
    'getProject', 'get-project', 'mj_get_project', 'mjGetProject', 'mj_admin_get_project',
])

const ALIASED_GREP_SEARCH_NAMES = new Set(DUMMY_GREP_SEARCH_TOOL_NAMES)
const ALIASED_VIEW_FILE_NAMES = new Set(
    DUMMY_FILE_VIEW_TOOL_NAMES.filter((name) => name !== 'cat')
)
const ALIASED_LIST_DIR_NAMES = new Set(
    DUMMY_DIR_LIST_TOOL_NAMES.filter((name) => name !== 'ls' && name !== 'dir')
)

async function tryAutonomousUnknownToolFallback(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    context: ServerContext,
    allTools: ToolRegistration[],
    allToolNames: Set<string>,
    customToolHandlerConfig: ToolHandlerConfig
): Promise<unknown> {
    const { configManager, db, teamDb, vectorManager, teamVectorManager, github, runtime } = context
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
            briefingConfig: currentConfig.briefingConfig,
            runtime,
        },
    }

    if (matchingPrompt !== undefined) {
        enforceAccessBoundary(matchingPrompt.name, 'prompt', undefined, runtime.auditLogger)
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

    if (matchesExactName(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES)) {
        enforceAccessBoundary('get_prompt', 'tool', undefined, runtime.auditLogger)
        const res = await handleGetPrompt(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    if (DUMMY_SERVER_INFO_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('server_info', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleServerInfo(toolArgs, requestedTool, toolContext))
    }

    if (
        matchesExactName(requestedTool, DUMMY_PROJECT_TOOL_NAMES) ||
        requestedTool === 'projects'
    ) {
        enforceAccessBoundary('list_projects', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload({
            success: true,
            projects: customToolHandlerConfig.projectRegistry ?? {},
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered projects from projectRegistry successfully.`,
        })
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

function normalizeAndAliasToolCall(
    reqParams: { name?: string; arguments?: Record<string, unknown> },
    options: ServerOptions
): void {
    reqParams.arguments = deepCamelToSnake(reqParams.arguments) as Record<string, unknown>
    const toolArgs = reqParams.arguments

    if (toolArgs['project_number'] === undefined) {
        const repoStr =
            typeof toolArgs['repo'] === 'string'
                ? toolArgs['repo']
                : typeof toolArgs['project'] === 'string'
                  ? toolArgs['project']
                  : undefined
        if (repoStr !== undefined && repoStr !== '') toolArgs['project_number'] = repoStr
    }

    if (typeof toolArgs['project_number'] === 'string') {
        const strVal = toolArgs['project_number']
        const parsed = Number(strVal)
        if (!Number.isNaN(parsed)) {
            toolArgs['project_number'] = parsed
        } else if (options.projectRegistry !== undefined) {
            let entry = options.projectRegistry[strVal]
            if (entry === undefined && strVal.includes('/')) {
                const repoName = strVal.split('/').pop()
                if (repoName !== undefined && repoName !== '') entry = options.projectRegistry[repoName]
            }
            if (entry?.project_number !== undefined) toolArgs['project_number'] = entry.project_number
        }
    }

    const currentName = reqParams.name
    if (currentName !== undefined && currentName !== '') {
        if (ALIASED_EXECUTE_CODE_NAMES.has(currentName)) {
            reqParams.name = 'mj_execute_code'
        } else if (currentName === 'create_entry_minimal') {
            reqParams.name = 'create_entry'
            if (toolArgs['entry_type'] === undefined) toolArgs['entry_type'] = 'personal_reflection'
        } else if (ALIASED_LIST_PROJECTS_NAMES.has(currentName)) {
            reqParams.name = 'list_projects'
        } else if (ALIASED_GET_PROJECT_NAMES.has(currentName)) {
            reqParams.name = 'get_project'
        } else if (ALIASED_GREP_SEARCH_NAMES.has(currentName)) {
            reqParams.name = 'grep_search'
        } else if (ALIASED_VIEW_FILE_NAMES.has(currentName)) {
            reqParams.name = 'view_file'
        } else if (ALIASED_LIST_DIR_NAMES.has(currentName)) {
            reqParams.name = 'list_dir'
        }
    }
}

interface ToolCallParams {
    name?: string
    arguments?: Record<string, unknown>
}

/** Healing fallbacks and a structured TOOL_NOT_FOUND response for tools that are not registered. */
async function handleUnknownTool(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    healingEnabled: boolean,
    prompts: PromptDefinition[],
    context: ServerContext,
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
        const fallbackResponse = await tryAutonomousUnknownToolFallback(
            requestedTool,
            toolArgs,
            matchingPrompt,
            context,
            allTools,
            allToolNames,
            customToolHandlerConfig
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

/** Rewrite an SDK validation-error result into a structured VALIDATION_ERROR payload (or undefined). */
function toValidationFailureResponse(
    result: unknown,
    params: ToolCallParams | undefined
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    if (
        result === null ||
        result === undefined ||
        typeof result !== 'object' ||
        !('isError' in result) ||
        result.isError !== true
    ) {
        return undefined
    }
    const resObj = result as { content?: { type?: string; text?: string }[] }
    if (!Array.isArray(resObj.content) || resObj.content.length === 0) return undefined

    const text = resObj.content[0]?.text
    const prefix = 'MCP error -32602: Input validation error: '
    if (
        typeof text !== 'string' ||
        !(text.includes('MCP error -32602') || text.includes('Invalid arguments for tool'))
    ) {
        return undefined
    }

    const errorMessage = parseZodErrorsFromMessage(text, text.includes(prefix) ? prefix : undefined)
    const errorResult = {
        success: false,
        error: errorMessage,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Check input parameters against the tool schema',
        recoverable: false,
    }

    logAgentIssue({
        source: 'MCP',
        action: params?.name ?? 'unknown',
        input: params?.arguments ?? {},
        error: errorMessage,
    })

    return formatTokenEstimatedError(errorResult, false)
}

/** Convert a thrown -32602 error into a structured VALIDATION_ERROR payload (or undefined). */
function toThrownValidationResponse(
    error: unknown,
    request: unknown
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const err = error as { code?: number; message?: string }
    if (err.code !== -32602) return undefined

    let errorMessage = err.message ?? 'Validation Error'
    if (typeof errorMessage === 'string' && errorMessage.includes('Invalid arguments for tool')) {
        errorMessage = parseZodErrorsFromMessage(errorMessage)
    }

    const errorResult = {
        success: false,
        error: errorMessage,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Check input parameters against the tool schema',
        recoverable: false,
    }

    const fallbackReq = request as { params?: ToolCallParams }
    logAgentIssue({
        source: 'MCP',
        action: fallbackReq.params?.name ?? 'unknown',
        input: fallbackReq.params?.arguments ?? {},
        error: errorMessage,
    })

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

            if (req.params?.arguments !== undefined && healingEnabled) {
                normalizeAndAliasToolCall(req.params, options)
                const toolArgs = req.params.arguments

                if (req.params.name !== undefined && req.params.name !== '') {
                    const intercept = applyArgInterceptions(req.params.name, [toolArgs])
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
