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
import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
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

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function deepCamelToSnake(obj: unknown, depth = 0): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (obj !== null && typeof obj === 'object') {
        const newObj: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            const snakeKey = k
                .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
                .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
            if (FORBIDDEN_KEYS.has(snakeKey)) continue
            newObj[snakeKey] = deepCamelToSnake(v, depth + 1)
        }
        return newObj
    }
    return obj
}

function formatSuccessPayload(payload: unknown): {
    content: { type: 'text'; text: string }[]
    structuredContent: Record<string, unknown>
} {
    const enriched = JSON.stringify(payload, null, 2)
    return {
        content: [{ type: 'text', text: enriched }],
        structuredContent: payload as Record<string, unknown>,
    }
}

function formatTokenEstimatedError(
    errorResult: Record<string, unknown>,
    isError: boolean
): {
    content: { type: 'text'; text: string }[]
    structuredContent: Record<string, unknown>
    isError?: boolean
} {
    const enriched = JSON.stringify({ ...errorResult, _meta: { tokenEstimate: 0 } })
    const tokenEstimate = Math.ceil(Buffer.byteLength(enriched, 'utf8') / 4)
    const finalText = enriched.replace('"tokenEstimate":0', `"tokenEstimate":${tokenEstimate}`)
    return {
        content: [{ type: 'text', text: finalText }],
        structuredContent: errorResult,
        ...(isError ? { isError: true } : {}),
    }
}

function parseZodErrorsFromMessage(rawText: string, prefixToRemove?: string): string {
    let errorMessage =
        prefixToRemove !== undefined ? rawText.replace(prefixToRemove, '') : rawText
    try {
        const parts = rawText.split(': [')
        if (parts.length > 1) {
            const zodErrors = JSON.parse('[' + parts[1]) as { path?: string[]; message?: string }[]
            errorMessage = zodErrors
                .map((e) => `${e.path && e.path.length > 0 ? e.path.join('.') : 'unknown'}: ${e.message ?? 'invalid'}`)
                .join('; ')
        }
    } catch {
        // Fallback to raw message if parsing fails
    }
    return errorMessage
}

function isSuccessObject(res: unknown): boolean {
    return typeof res === 'object' && res !== null && (res as Record<string, unknown>)['success'] === true
}

function matchesSuffixes(name: string, list: string[], suffixes: string[]): boolean {
    return list.includes(name) || suffixes.some((s) => name.endsWith(s))
}

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
        matchesSuffixes(requestedTool, DUMMY_RESOURCE_TOOL_NAMES, ['_read_resource', 'ReadResource']) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    ) {
        enforceAccessBoundary('read_resource', 'tool', undefined, runtime.auditLogger)
        const res = await handleReadResource(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    if (matchesSuffixes(requestedTool, DUMMY_LIST_RESOURCE_TOOL_NAMES, ['_list_resources', 'ListResources'])) {
        enforceAccessBoundary('list_resources', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListResources(requestedTool))
    }

    if (matchesSuffixes(requestedTool, DUMMY_LIST_PROMPT_TOOL_NAMES, ['_list_prompts', 'ListPrompts'])) {
        enforceAccessBoundary('list_prompts', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListPrompts(requestedTool))
    }

    if (matchesSuffixes(requestedTool, DUMMY_LIST_TOOL_NAMES, ['_list_tools', 'ListTools'])) {
        enforceAccessBoundary('list_tools', 'tool', undefined, runtime.auditLogger)
        const enabledSet = currentConfig.toolFilterConfig?.enabledTools ?? allToolNames
        const toolsList = allTools
            .filter((t) => enabledSet.has(t.name))
            .map((t) => ({ name: t.name, title: t.title, description: t.description, annotations: t.annotations }))
        return formatSuccessPayload({
            success: true,
            tools: toolsList,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`,
        })
    }

    if (matchesSuffixes(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES, ['_get_prompt', 'GetPrompt'])) {
        enforceAccessBoundary('get_prompt', 'tool', undefined, runtime.auditLogger)
        const res = await handleGetPrompt(toolArgs, requestedTool, toolContext)
        if (isSuccessObject(res)) return formatSuccessPayload(res)
    }

    if (DUMMY_SERVER_INFO_TOOL_NAMES.includes(requestedTool)) {
        enforceAccessBoundary('server_info', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(await handleServerInfo(toolArgs, requestedTool, toolContext))
    }

    if (
        matchesSuffixes(requestedTool, DUMMY_PROJECT_TOOL_NAMES, ['list_projects', 'listProjects', 'ListProjects']) ||
        requestedTool === 'projects'
    ) {
        enforceAccessBoundary('list_projects', 'tool', undefined, runtime.auditLogger)
        const cfg = currentConfig as { projectRegistry?: Record<string, unknown> }
        return formatSuccessPayload({
            success: true,
            projects: cfg.projectRegistry ?? {},
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered projects from projectRegistry successfully.`,
        })
    }

    if (matchesSuffixes(requestedTool, DUMMY_ADAPTER_TOOL_NAMES, ['list_adapters', 'listAdapters', 'ListAdapters'])) {
        enforceAccessBoundary('list_adapters', 'tool', undefined, runtime.auditLogger)
        return formatSuccessPayload(handleListAdapters(requestedTool, toolContext))
    }

    if (matchesSuffixes(requestedTool, DUMMY_GREP_SEARCH_TOOL_NAMES, ['grep_search', 'grepSearch'])) {
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
                const requestedTool = req.params.name
                const toolArgs = req.params.arguments ?? {}
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
                const isFilteredTool = Object.values(TOOL_GROUPS).flat().includes(requestedTool)

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

            const result = await originalHandler(request, extra)

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
                        const errorMessage = parseZodErrorsFromMessage(
                            text,
                            'MCP error -32602: Input validation error: '
                        )
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
                            action: req.params?.name ?? 'unknown',
                            input: req.params?.arguments ?? {},
                            error: errorMessage,
                        })

                        return formatTokenEstimatedError(errorResult, false)
                    }
                }
            }

            return result
        } catch (error: unknown) {
            const err = error as { code?: number; message?: string }
            if (err.code === -32602) {
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

                const fallbackReq = request as {
                    params?: { name?: string; arguments?: Record<string, unknown> }
                }
                logAgentIssue({
                    source: 'MCP',
                    action: fallbackReq.params?.name ?? 'unknown',
                    input: fallbackReq.params?.arguments ?? {},
                    error: errorMessage,
                })

                return formatTokenEstimatedError(errorResult, true)
            }
            throw error
        }
    })
}
