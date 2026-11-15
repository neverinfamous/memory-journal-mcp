import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import {
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
} from '../../../handlers/tools/core/dummy-healing.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { logger } from '../../../utils/logger.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'
import type { ServerOptions } from '../types.js'

export { resolveMcpCreateWorkspaceScope } from './create-scope-interceptor.js'

/**
 * Pure helpers for the call-tool interceptor (payload formatting, key healing, name matching).
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const ALL_KNOWN_GROUP_TOOLS = new Set(Object.values(TOOL_GROUPS).flat())
const UPPERCASE_RE = /[A-Z]/

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

export interface ToolCallParams {
    name?: string
    arguments?: Record<string, unknown>
}

export function normalizeAndAliasToolCall(
    reqParams: ToolCallParams,
    options: ServerOptions
): void {
    reqParams.arguments = deepCamelToSnake(reqParams.arguments) as Record<string, unknown>
    const toolArgs = reqParams.arguments

    // [INVARIANT] A `repo`/`project` string is only a lookup hint: `project_number` is assigned
    // solely after it resolves to a valid positive integer (H3). Unresolved hints never leak
    // into `project_number` as raw strings.
    let repoHint: string | undefined
    if (toolArgs['project_number'] === undefined) {
        const repoStr =
            typeof toolArgs['repo'] === 'string'
                ? toolArgs['repo']
                : typeof toolArgs['project'] === 'string'
                  ? toolArgs['project']
                  : undefined
        if (repoStr !== undefined && repoStr.trim() !== '') repoHint = repoStr
    }
    const rawProject = toolArgs['project_number']
    const strVal = typeof rawProject === 'string' ? rawProject : repoHint

    if (strVal !== undefined) {
        const parsed = Number(strVal)
        if (!Number.isNaN(parsed) && strVal.trim() !== '') {
            if (repoHint === undefined || (Number.isInteger(parsed) && parsed > 0)) {
                toolArgs['project_number'] = parsed
            }
        } else {
            const registry = options.projectRegistry ?? loadProjectRegistryFromConfig()
            if (registry !== undefined) {
                const trimmedPath = strVal.replace(/[\\/]+$/, '')
                const candidate =
                    trimmedPath.includes('/') || trimmedPath.includes('\\')
                        ? (trimmedPath.split(/[\\/]/).pop() ?? strVal)
                        : trimmedPath || strVal
                const canonicalKey = findCanonicalRegistryKey(candidate, registry) ?? candidate
                const entry = registry[canonicalKey] ?? registry[strVal]
                const rawWorkspace = toolArgs['workspace_id']
                const workspaceMissing =
                    rawWorkspace === undefined ||
                    (typeof rawWorkspace === 'string' && rawWorkspace.trim() === '')
                const existingWorkspace =
                    typeof rawWorkspace === 'string' && !workspaceMissing
                        ? (findCanonicalRegistryKey(rawWorkspace, registry) ?? rawWorkspace.trim())
                        : undefined
                const sameWorkspace =
                    existingWorkspace?.toLowerCase() === canonicalKey.toLowerCase()
                // A repo-name project_number may fill a missing workspace, not a different concrete one.
                // Explicit workspace `default` stays on that workspace.
                if (entry?.project_number !== undefined && (workspaceMissing || sameWorkspace)) {
                    toolArgs['project_number'] = entry.project_number
                }
                if (workspaceMissing && entry !== undefined) {
                    toolArgs['workspace_id'] = canonicalKey
                }
            }
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

export function toValidationFailureResponse(
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

    return formatTokenEstimatedError(errorResult, true)
}

export function toThrownValidationResponse(
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

export function deepCamelToSnake(obj: unknown, depth = 0): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) return obj.map((item) => deepCamelToSnake(item, depth + 1))
    if (obj !== null && typeof obj === 'object') {
        const newObj: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (FORBIDDEN_KEYS.has(k)) continue
            const snakeKey = UPPERCASE_RE.test(k)
                ? k
                      .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
                      .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
                : k
            if (FORBIDDEN_KEYS.has(snakeKey)) continue
            newObj[snakeKey] = deepCamelToSnake(v, depth + 1)
        }
        return newObj
    }
    return obj
}

export function formatSuccessPayload(payload: unknown): {
    content: { type: 'text'; text: string }[]
    structuredContent: Record<string, unknown>
} {
    const enriched = JSON.stringify(payload, null, 2)
    return {
        content: [{ type: 'text', text: enriched }],
        structuredContent: payload as Record<string, unknown>,
    }
}

export function formatTokenEstimatedError(
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

export function parseZodErrorsFromMessage(rawText: string, prefixToRemove?: string): string {
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
    } catch (parseError) {
        // Fallback to raw message if parsing fails
        logger.debug('Could not parse Zod error details from message; using raw message', {
            module: 'McpServer',
            error: parseError instanceof Error ? parseError.message : String(parseError),
        })
    }
    return errorMessage
}

export function isSuccessObject(res: unknown): boolean {
    return typeof res === 'object' && res !== null && (res as Record<string, unknown>)['success'] === true
}

export function matchesExactName(name: string, list: string[]): boolean {
    return list.includes(name)
}

export function resolveSingleProjectFromRegistry(
    registry: Record<string, { path: string; project_number?: number }> | undefined,
    toolArgs: Record<string, unknown>,
    requestedTool: string
): Record<string, unknown> {
    const reg = registry ?? {}
    const nameArg =
        typeof toolArgs['name'] === 'string'
            ? toolArgs['name']
            : typeof toolArgs['project'] === 'string'
              ? toolArgs['project']
              : typeof toolArgs['repo'] === 'string'
                ? toolArgs['repo']
                : undefined
    const numArg =
        typeof toolArgs['project_number'] === 'number'
            ? toolArgs['project_number']
            : typeof toolArgs['id'] === 'number'
              ? toolArgs['id']
              : undefined

    if (nameArg !== undefined && Object.hasOwn(reg, nameArg) && reg[nameArg] !== undefined) {
        const info = reg[nameArg]
        return {
            success: true,
            project: {
                name: nameArg,
                id: info.project_number,
                project_number: info.project_number,
                ...info,
            },
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered project '${nameArg}' from projectRegistry successfully.`,
        }
    }

    const numericTarget =
        numArg ??
        (nameArg !== undefined && !Number.isNaN(Number(nameArg)) ? Number(nameArg) : undefined)
    if (numericTarget !== undefined) {
        const matches = Object.entries(reg).filter(
            ([, pData]) => pData.project_number === numericTarget
        )
        if (matches.length > 1) {
            return {
                success: false,
                error: `project_number ${String(numericTarget)} is registered to more than one workspace.`,
            }
        }
        const matched = matches[0]
        if (matched !== undefined) {
            const [pName, pData] = matched
            return {
                success: true,
                project: {
                    name: pName,
                    id: pData.project_number,
                    project_number: pData.project_number,
                    ...pData,
                },
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${requestedTool}' was called as an MCP tool. Returned registered project '${pName}' from projectRegistry successfully.`,
            }
        }
    }

    return {
        success: false,
        error: `🛠️ AUTONOMOUS HEALING: Project not found: '${nameArg ?? String(numericTarget ?? '')}'`,
    }
}
