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
import {
    getSerializedPayloadJson,
    injectTokenEstimate,
} from '../../../observability/token-estimator.js'
import type { ToolContext } from '../../../types/index.js'
import type { PromptDefinition } from '../../registration.js'
import type { FallbackAccessTarget } from './fallback-interceptors.js'
import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { logger } from '../../../utils/logger.js'
import { HOST_FILESYSTEM_PATH_RE } from '../../../utils/error-helpers.js'
import { sanitizeErrorForLogging } from '../../../utils/security-utils.js'
import { resolveMcpCreateWorkspaceScope } from './create-scope-interceptor.js'
import { isForbiddenProjectKey } from '../../../utils/project-registry-guards.js'
import {
    parseCanonicalPositiveInt,
    parsePositiveProjectNumber,
} from '../../../utils/safe-positive-int.js'

export { resolveMcpCreateWorkspaceScope }

/**
 * Pure helpers for the call-tool interceptor (payload formatting, validation responses, name matching).
 */

export const ALL_KNOWN_GROUP_TOOLS = new Set(Object.values(TOOL_GROUPS).flat())

export interface ToolCallParams {
    name?: string
    arguments?: Record<string, unknown> | unknown[] | null | undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toValidationFailureResponse(
    result: unknown,
    params: ToolCallParams | undefined
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    if (!isPlainRecord(result) || !('isError' in result) || result['isError'] !== true) {
        return undefined
    }
    const content = result['content']
    if (!Array.isArray(content) || content.length === 0) return undefined

    const firstContent: unknown = content[0]
    const text = isPlainRecord(firstContent) ? firstContent['text'] : undefined
    const prefix = 'MCP error -32602: Input validation error: '
    if (
        typeof text !== 'string' ||
        !(text.includes('MCP error -32602') || text.includes('Invalid arguments for tool'))
    ) {
        return undefined
    }

    const rawMessage = parseZodErrorsFromMessage(text, text.includes(prefix) ? prefix : undefined)
    const errorMessage = sanitizeErrorForLogging(rawMessage).replace(
        HOST_FILESYSTEM_PATH_RE,
        '<sanitized_path>'
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
    if (!isPlainRecord(error) || error['code'] !== -32602) return undefined

    let errorMessage = typeof error['message'] === 'string' ? error['message'] : 'Validation Error'
    if (errorMessage.includes('Invalid arguments for tool')) {
        errorMessage = parseZodErrorsFromMessage(errorMessage)
    }
    errorMessage = sanitizeErrorForLogging(errorMessage).replace(
        HOST_FILESYSTEM_PATH_RE,
        '<sanitized_path>'
    )

    const errorResult = {
        success: false,
        error: errorMessage,
        code: 'VALIDATION_ERROR',
        category: 'validation',
        suggestion: 'Check input parameters against the tool schema',
        recoverable: false,
    }

    const reqObj = isPlainRecord(request) ? request : undefined
    const reqParams = reqObj !== undefined && isPlainRecord(reqObj['params']) ? reqObj['params'] : undefined
    const action = typeof reqParams?.['name'] === 'string' ? reqParams['name'] : 'unknown'
    const input = isPlainRecord(reqParams?.['arguments']) ? reqParams['arguments'] : {}
    logAgentIssue({
        source: 'MCP',
        action,
        input,
        error: errorMessage,
    })

    return formatTokenEstimatedError(errorResult, true)
}

export function formatSuccessPayload(payload: unknown): {
    content: { type: 'text'; text: string }[]
    structuredContent: Record<string, unknown>
} {
    const enriched = getSerializedPayloadJson(payload)
    return {
        content: [{ type: 'text', text: enriched }],
        structuredContent: isPlainRecord(payload) ? payload : {},
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
    const enriched = injectTokenEstimate({ ...errorResult })
    const finalText = getSerializedPayloadJson(enriched)
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
        const jsonIdx = rawText.lastIndexOf(': [')
        if (jsonIdx !== -1) {
            const parsed: unknown = JSON.parse(rawText.slice(jsonIdx + 2))
            if (Array.isArray(parsed)) {
                errorMessage = parsed
                    .map((item) => {
                        if (!isPlainRecord(item)) return 'unknown: invalid'
                        const rawPath = item['path']
                        const pathStr =
                            Array.isArray(rawPath) && rawPath.length > 0
                                ? rawPath.map(String).join('.')
                                : 'unknown'
                        const msg = typeof item['message'] === 'string' ? item['message'] : 'invalid'
                        return `${pathStr}: ${msg}`
                    })
                    .join('; ')
            }
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
    return isPlainRecord(res) && res['success'] === true
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
        parsePositiveProjectNumber(toolArgs['project_number']) ??
        parsePositiveProjectNumber(toolArgs['id'])

    if (
        nameArg !== undefined &&
        !isForbiddenProjectKey(nameArg) &&
        Object.hasOwn(reg, nameArg) &&
        reg[nameArg] !== undefined
    ) {
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
        (nameArg !== undefined ? parseCanonicalPositiveInt(nameArg) : undefined)
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

export { exceedsMaxToolInputElements } from '../../../utils/tool-input-bounds.js'

const TOOL_TO_GROUP = new Map<string, string>(
    Object.entries(TOOL_GROUPS).flatMap(([group, names]) =>
        names.map((name): [string, string] => [name, group])
    )
)

/** Converts an MCP snake_case tool name to its `mj.<group>.<camelCase>` Code Mode call hint. */
export function resolveCodeModeCallHint(toolName: string): string {
    const group = TOOL_TO_GROUP.get(toolName) ?? 'core'
    const camel = toolName.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase())
    return `mj.${group}.${camel}`
}

/** Validates basic JSON-RPC `tools/call` params shape before accessing `name` and `arguments`. */
export function hasToolCallRequestShape(request: unknown): request is { params?: ToolCallParams } {
    if (!isPlainRecord(request)) return false
    if (!('params' in request) || request['params'] === undefined) return true
    const params = request['params']
    if (!isPlainRecord(params)) return false
    const nameOk =
        !('name' in params) || params['name'] === undefined || typeof params['name'] === 'string'
    const argsOk =
        !('arguments' in params) ||
        params['arguments'] === undefined ||
        params['arguments'] === null ||
        Array.isArray(params['arguments']) ||
        isPlainRecord(params['arguments'])
    return nameOk && argsOk
}

export function isFailureObject(res: unknown): res is Record<string, unknown> {
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
        typeof toolArgs['name'] === 'string' && toolArgs['name'].trim() !== ''
            ? toolArgs['name'].trim()
            : typeof toolArgs['prompt'] === 'string' && toolArgs['prompt'].trim() !== ''
              ? toolArgs['prompt'].trim()
              : typeof toolArgs['prompt_name'] === 'string' && toolArgs['prompt_name'].trim() !== ''
                ? toolArgs['prompt_name'].trim()
                : undefined
    const normalizedTarget = rawPromptName
        ?.replace(/^mj_/, '')
        .replace(/_/g, '-')
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
    const targetPrompt =
        rawPromptName !== undefined
            ? prompts.find((p) => p.name === rawPromptName || p.name === normalizedTarget)
            : undefined
    return {
        targetName: targetPrompt?.name ?? rawPromptName ?? 'get_prompt',
        capabilities: targetPrompt?.capabilities,
    }
}

function isResourceFallbackTool(requestedTool: string): boolean {
    return (
        matchesExactName(requestedTool, DUMMY_RESOURCE_TOOL_NAMES) ||
        requestedTool === 'mjReadResource' ||
        requestedTool.startsWith('memory://')
    )
}

export function resolvePromptOrResourceAccessTargets(
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
    if (isResourceFallbackTool(requestedTool)) {
        const extractedUri = extractUriFromArgs(toolArgs)
        const rawUri =
            extractedUri !== undefined && extractedUri !== ''
                ? extractedUri
                : requestedTool.startsWith('memory://')
                  ? requestedTool
                  : 'memory://briefing'
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

function wrapFallbackResult(res: unknown): unknown {
    if (isSuccessObject(res)) return formatSuccessPayload(res)
    if (isFailureObject(res)) return formatTokenEstimatedError(res, true)
    return undefined
}

export async function tryPromptAndResourceFallbacks(
    requestedTool: string,
    toolArgs: Record<string, unknown>,
    matchingPrompt: PromptDefinition | undefined,
    toolContext: ToolContext
): Promise<unknown> {
    if (matchingPrompt !== undefined) {
        const out = wrapFallbackResult(await handlePrompt(toolArgs, requestedTool, toolContext))
        if (out !== undefined) return out
    }
    if (isResourceFallbackTool(requestedTool)) {
        const out = wrapFallbackResult(await handleReadResource(toolArgs, requestedTool, toolContext))
        if (out !== undefined) return out
    }
    if (matchesExactName(requestedTool, DUMMY_LIST_RESOURCE_TOOL_NAMES)) {
        return formatSuccessPayload(handleListResources(requestedTool))
    }
    if (matchesExactName(requestedTool, DUMMY_LIST_PROMPT_TOOL_NAMES)) {
        return formatSuccessPayload(handleListPrompts(requestedTool))
    }
    if (matchesExactName(requestedTool, DUMMY_GET_PROMPT_TOOL_NAMES)) {
        return wrapFallbackResult(await handleGetPrompt(toolArgs, requestedTool, toolContext))
    }
    return undefined
}
