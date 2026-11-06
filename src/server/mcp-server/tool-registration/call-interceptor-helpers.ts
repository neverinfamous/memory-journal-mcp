import { TOOL_GROUPS } from '../../../filtering/tool-constants.js'
import { logger } from '../../../utils/logger.js'

/**
 * Pure helpers for the call-tool interceptor (payload formatting, key healing, name matching).
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const ALL_KNOWN_GROUP_TOOLS = new Set(Object.values(TOOL_GROUPS).flat())
const UPPERCASE_RE = /[A-Z]/

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
