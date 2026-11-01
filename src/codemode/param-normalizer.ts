/**
 * Parameter normalization and hallucination interception pipeline for Code Mode & MCP tools.
 */

import { applyGitInterceptions } from './api/git-api.js'
import { isRecord } from './normalizers/shared-utils.js'
import { applyGenericInterceptions } from './normalizers/generic-interceptions.js'
import { applyEntryAndSearchInterceptions } from './normalizers/entry-and-search-interceptions.js'
import { applyDomainToolInterceptions } from './normalizers/domain-tool-interceptions.js'

export { isRecord }

export function applyArgInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    const gitIntercept = applyGitInterceptions(methodName, args)
    if (gitIntercept) return gitIntercept

    // 1. Generic parameter aliases, metadata extraction, ID coercion, and entry mutation field synthesis
    const genericRes = applyGenericInterceptions(methodName, args)
    if ('error' in genericRes) return genericRes
    let currentArgs = genericRes.args

    // 2. Domain-specific tool hallucinations (update_configuration, IO, vector, deleted, analytics, GitHub, backup, etc.)
    const domainRes = applyDomainToolInterceptions(methodName, currentArgs)
    if ('error' in domainRes) return domainRes
    currentArgs = domainRes.args

    // 3. Entry creation/update, single-ID, batch, search, and session-summary healing
    const entrySearchRes = applyEntryAndSearchInterceptions(methodName, currentArgs)
    if ('error' in entrySearchRes) return entrySearchRes

    return entrySearchRes
}
