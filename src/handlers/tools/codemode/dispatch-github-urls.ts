/**
 * GitHub URL scope verification and issue/PR auto-population for Code Mode dispatch.
 */

import * as path from 'node:path'
import type { ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { lookupRegistryEntry } from './session-context.js'

function normalizeFsPath(filePath: string): string {
    const resolved = path.resolve(filePath)
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isSameOrSubdirectory(targetDir: string, rootDir: string): boolean {
    const rel = path.relative(normalizeFsPath(rootDir), normalizeFsPath(targetDir))
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function isPathOutsideCwd(
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    key: string
): boolean {
    const entry = lookupRegistryEntry(reg, key)
    return entry?.path !== undefined && entry.path !== '' && !isSameOrSubdirectory(process.cwd(), entry.path)
}

function isDefaultWs(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'default'
}

function resolveGithubUrlScope(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
): { allowed: boolean; repoHint: string | undefined } {
    const targetWs = typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'].trim() : undefined
    if (targetWs === '*' || isDefaultWs(targetWs)) return { allowed: false, repoHint: undefined }
    if (
        targetWs !== undefined &&
        sessionWorkspaceId !== undefined &&
        sessionWorkspaceId !== '*' &&
        targetWs.toLowerCase() !== sessionWorkspaceId.toLowerCase()
    ) {
        return { allowed: false, repoHint: undefined }
    }
    if (
        typeof paramsObj['project_number'] === 'number' &&
        typeof sessionProjectId === 'number' &&
        paramsObj['project_number'] !== sessionProjectId
    ) {
        return { allowed: false, repoHint: undefined }
    }
    const wsForLookup = targetWs ?? sessionWorkspaceId
    if (wsForLookup === '*' || isDefaultWs(wsForLookup)) return { allowed: false, repoHint: undefined }
    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
    if (wsForLookup !== undefined && isPathOutsideCwd(reg, wsForLookup)) return { allowed: false, repoHint: undefined }
    const repoHint =
        typeof paramsObj['repo'] === 'string' && paramsObj['repo'].trim() !== '' ? paramsObj['repo'].trim() : undefined
    if (repoHint !== undefined) {
        const repoSlug = repoHint.split(/[/\\]/).filter(Boolean).pop()?.trim() ?? repoHint
        const repoReg = lookupRegistryEntry(reg, repoHint) ?? lookupRegistryEntry(reg, repoSlug)
        if (repoReg?.path !== undefined && repoReg.path !== '' && !isSameOrSubdirectory(process.cwd(), repoReg.path)) {
            return { allowed: false, repoHint: undefined }
        }
    }
    return { allowed: true, repoHint }
}

/**
 * Auto-populates `issue_url` / `pr_url` from the CWD GitHub repository only when the
 * target scope matches the active CWD repository and is not `'default'` or `'*'`.
 */
export async function autoPopulateGithubUrls(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
): Promise<void> {
    const needsIssueUrl = paramsObj['issue_number'] !== undefined && paramsObj['issue_url'] === undefined
    const needsPrUrl = paramsObj['pr_number'] !== undefined && paramsObj['pr_url'] === undefined
    if ((!needsIssueUrl && !needsPrUrl) || sessionContext.github === undefined) return
    const scope = resolveGithubUrlScope(paramsObj, sessionContext, sessionWorkspaceId, sessionProjectId)
    if (!scope.allowed) return
    try {
        const repoInfo = await sessionContext.github.getRepoInfo()
        if (!repoInfo?.owner || !repoInfo?.repo) return
        if (scope.repoHint !== undefined) {
            const lowerHint = scope.repoHint.toLowerCase()
            const matchesRepo =
                lowerHint === repoInfo.repo.toLowerCase() ||
                lowerHint === `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase()
            if (!matchesRepo) return
        }
        if (needsIssueUrl) {
            paramsObj['issue_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/${String(Number(paramsObj['issue_number']))}`
        }
        if (needsPrUrl) {
            paramsObj['pr_url'] = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/${String(Number(paramsObj['pr_number']))}`
        }
    } catch (err) {
        logger.debug('Could not auto-populate GitHub URLs; proceeding without them', {
            module: 'CodeMode',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
