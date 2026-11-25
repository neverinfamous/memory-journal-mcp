/**
 * Builds the frozen sandbox `context` object (session scope, registry payload, result-size limits).
 * Split out of `payload-synthesizer.ts`.
 */

import { getRequestContext } from '../../../utils/request-context.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import {
    normalizeUserContextPayload,
    parseByteSizeValue,
} from '../../../codemode/shared-context-parsers.js'
import type { ToolContext } from '../../../types/index.js'
import { getNonEmptyString, type ExecuteCodeInput } from './natural-language-synthesizer.js'
import { firstNonBlankString } from './json-entry-scope.js'

export function buildSandboxUserContext(
    input: ExecuteCodeInput,
    sessionContext: ToolContext,
    projectId: number | string | undefined,
    numericProjectId: number | undefined,
    workspaceId: string | undefined,
    _explicitWorkspace?: boolean
): { userContext: Record<string, unknown>; requestedMaxResultSize: number | undefined } {
    const userContext = normalizeUserContextPayload(input.context)
    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)

    const resolvedProjectNumber =
        numericProjectId ?? (typeof projectId === 'number' ? projectId : undefined)
    const sessionFromUser = getNonEmptyString(userContext, {}, ['session_id', 'sessionId'])
    const resolvedSessionId =
        firstNonBlankString(input.session_id, input.sessionId) ??
        sessionFromUser ??
        getRequestContext()?.sessionId ??
        'session-default'
    const resolvedWorkspaceId = workspaceId ?? sessionContext.config?.defaultWorkspaceId

    if (resolvedProjectNumber !== undefined) {
        userContext['project_number'] ??= resolvedProjectNumber
        userContext['projectNumber'] ??= resolvedProjectNumber
        userContext['project_id'] ??= resolvedProjectNumber
        userContext['projectId'] ??= resolvedProjectNumber
    }
    userContext['session_id'] ??= resolvedSessionId
    userContext['sessionId'] ??= resolvedSessionId
    const pinnedWs =
        resolvedWorkspaceId !== undefined && resolvedWorkspaceId !== '' && resolvedWorkspaceId !== '*'
            ? resolvedWorkspaceId
            : undefined
    if (pinnedWs !== undefined) {
        userContext['workspace_id'] ??= pinnedWs
        userContext['workspaceId'] ??= pinnedWs
        userContext['__mj_workspace_id'] = pinnedWs
    } else {
        Reflect.deleteProperty(userContext, '__mj_workspace_id')
    }
    if (typeof resolvedProjectNumber === 'number' && Number.isSafeInteger(resolvedProjectNumber) && resolvedProjectNumber > 0) {
        userContext['__mj_project_number'] = resolvedProjectNumber
    } else {
        Reflect.deleteProperty(userContext, '__mj_project_number')
    }
    if (reg !== undefined) {
        userContext['__mj_project_registry'] = reg
    } else {
        Reflect.deleteProperty(userContext, '__mj_project_registry')
    }

    const directSize = parseByteSizeValue(
        input.max_result_size ?? input.maxResultSize ?? input.max_result_size_bytes ?? input.maxResultSizeBytes ??
        input['max_bytes'] ?? input['maxBytes'] ??
        userContext['max_result_size'] ?? userContext['maxResultSize'] ?? userContext['max_result_size_bytes'] ?? userContext['maxResultSizeBytes'] ??
        userContext['max_bytes'] ?? userContext['maxBytes']
    )
    const kbSize = parseByteSizeValue(
        input.max_result_size_kb ?? input.maxResultSizeKb ?? userContext['max_result_size_kb'] ?? userContext['maxResultSizeKb'],
        'kb'
    )
    const requestedMaxResultSize = directSize ?? kbSize

    return { userContext, requestedMaxResultSize }
}
