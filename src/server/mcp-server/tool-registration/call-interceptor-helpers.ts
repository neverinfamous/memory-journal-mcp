import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { logger } from '../../../utils/logger.js'
import { resolveMcpCreateWorkspaceScope } from './create-scope-interceptor.js'

export { resolveMcpCreateWorkspaceScope }

/**
 * Pure helpers for the call-tool interceptor (payload formatting, validation responses, name matching).
 */

export const ALL_KNOWN_GROUP_TOOLS = new Set(Object.values(TOOL_GROUPS).flat())

export interface ToolCallParams {
    name?: string
    arguments?: Record<string, unknown>
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
    if (!isPlainRecord(error) || error['code'] !== -32602) return undefined

    let errorMessage = typeof error['message'] === 'string' ? error['message'] : 'Validation Error'
    if (errorMessage.includes('Invalid arguments for tool')) {
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
    const enriched = JSON.stringify(payload, null, 2)
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
        if (parts.length > 1 && parts[1] !== undefined) {
            const parsed: unknown = JSON.parse('[' + parts[1])
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
