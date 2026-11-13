/**
 * Builds the frozen sandbox `context` object (session scope, registry payload, result-size limits).
 * Split out of `payload-synthesizer.ts`.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'
import { getRequestContext } from '../../../utils/request-context.js'
import type { ToolContext } from '../../../types/index.js'
import { getNonEmptyString, type ExecuteCodeInput } from './natural-language-synthesizer.js'

function parseSizeInBytes(val: unknown): number | undefined {
    if (typeof val === 'number') return !Number.isNaN(val) && val > 0 ? val : undefined
    if (typeof val === 'string') {
        const trimmed = val.trim()
        const match = /^(\d+(?:\.\d+)?)\s*(kb|mb|bytes|b)?$/i.exec(trimmed)
        if (match?.[1] !== undefined) {
            const num = parseFloat(match[1])
            const unit = (match[2] ?? 'b').toLowerCase()
            if (unit === 'mb') return Math.round(num * 1024 * 1024)
            if (unit === 'kb') return Math.round(num * 1024)
            return Math.round(num)
        }
        const parsed = parseInt(trimmed, 10)
        return !Number.isNaN(parsed) && parsed > 0 ? parsed : undefined
    }
    return undefined
}

function parseStringContext(raw: string): Record<string, unknown> {
    const trimmed = raw.trim()
    const looksJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
    if (!looksJson) return { content: raw, text: raw, raw }
    try {
        const parsed: unknown = JSON.parse(trimmed)
        return isRecord(parsed) ? parsed : { value: parsed, raw, text: raw, content: raw }
    } catch {
        return { content: raw, text: raw, raw }
    }
}

function parseUserContext(context: unknown): Record<string, unknown> {
    if (context === undefined || context === null) return {}
    if (isRecord(context)) return { ...context }
    if (typeof context === 'string') return parseStringContext(context)
    return { value: context, raw: context }
}

export function buildSandboxUserContext(
    input: ExecuteCodeInput,
    sessionContext: ToolContext,
    projectId: number | string | undefined,
    numericProjectId: number | undefined,
    workspaceId: string | undefined
): { userContext: Record<string, unknown>; requestedMaxResultSize: number | undefined } {
    const userContext = parseUserContext(input.context)

    const resolvedProjectNumber =
        numericProjectId ?? (typeof projectId === 'number' ? projectId : sessionContext.config?.defaultProjectNumber)
    const sessionFromUser = getNonEmptyString(userContext, {}, ['session_id', 'sessionId'])
    const resolvedSessionId =
        typeof input['session_id'] === 'string' && input['session_id'].length > 0
            ? input['session_id']
            : (sessionFromUser ?? getRequestContext()?.sessionId ?? 'session-default')
    const resolvedWorkspaceId = workspaceId ?? sessionContext.config?.defaultWorkspaceId

    if (resolvedProjectNumber !== undefined) {
        userContext['project_number'] ??= resolvedProjectNumber
        userContext['projectNumber'] ??= resolvedProjectNumber
        userContext['project_id'] ??= resolvedProjectNumber
        userContext['projectId'] ??= resolvedProjectNumber
    }
    userContext['session_id'] ??= resolvedSessionId
    userContext['sessionId'] ??= resolvedSessionId
    if (resolvedWorkspaceId !== undefined) {
        userContext['workspace_id'] ??= resolvedWorkspaceId
        userContext['workspaceId'] ??= resolvedWorkspaceId
    }
    if (sessionContext.config?.projectRegistry !== undefined) {
        userContext['__mj_project_registry'] = sessionContext.config.projectRegistry
    } else {
        Reflect.deleteProperty(userContext, '__mj_project_registry')
    }

    const directSize = parseSizeInBytes(
        input.max_result_size ?? input.maxResultSize ?? input.max_result_size_bytes ?? input.maxResultSizeBytes ??
        userContext['max_result_size'] ?? userContext['maxResultSize'] ?? userContext['max_result_size_bytes'] ?? userContext['maxResultSizeBytes']
    )
    const kbSize = parseSizeInBytes(
        input.max_result_size_kb ?? input.maxResultSizeKb ?? userContext['max_result_size_kb'] ?? userContext['maxResultSizeKb']
    )
    const requestedMaxResultSize = directSize ?? (kbSize !== undefined ? kbSize * 1024 : undefined)

    return { userContext, requestedMaxResultSize }
}
