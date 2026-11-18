/**
 * GitHub URL scope verification and issue/PR auto-population for Code Mode dispatch.
 */

import type { ToolContext } from '../../../types/index.js'
import { logger } from '../../../utils/logger.js'
import { activeProjectRegistry } from '../../../utils/write-scope.js'
import { cwdMatchesRegistryPath } from '../../../utils/workspace-registry-match.js'
import { parsePositiveProjectNumber } from '../../../utils/safe-positive-int.js'
import { lookupRegistryEntry } from './session-context.js'

function isPathOutsideCwd(
    reg: NonNullable<ToolContext['config']>['projectRegistry'],
    key: string
): boolean {
    const entry = lookupRegistryEntry(reg, key)
    if (entry === undefined) return false
    if (entry.path === undefined || entry.path.trim() === '') return true
    return !cwdMatchesRegistryPath(entry.path, process.cwd())
}

function isDefaultWs(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'default'
}

function resolveGithubHost(): string {
    const raw = process.env['GITHUB_HOST']?.trim()
    if (raw === undefined || raw === '') return 'github.com'
    return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || 'github.com'
}

function matchesRepoSlug(candidate: string, owner: string, repo: string): boolean {
    const lower = candidate.toLowerCase()
    return (
        lower === repo.toLowerCase() ||
        lower === `${owner}/${repo}`.toLowerCase()
    )
}

function resolveGithubUrlScope(
    paramsObj: Record<string, unknown>,
    sessionContext: ToolContext,
    sessionWorkspaceId: string | undefined,
    sessionProjectId: number | string | undefined
): { allowed: boolean; repoHint: string | undefined; unregisteredWs: string | undefined } {
    const targetWs = typeof paramsObj['workspace_id'] === 'string' ? paramsObj['workspace_id'].trim() : undefined
    if (targetWs === '*' || isDefaultWs(targetWs)) {
        return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
    }
    if (
        targetWs !== undefined &&
        sessionWorkspaceId !== undefined &&
        sessionWorkspaceId !== '*' &&
        targetWs.toLowerCase() !== sessionWorkspaceId.toLowerCase()
    ) {
        return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
    }
    if (
        typeof paramsObj['project_number'] === 'number' &&
        typeof sessionProjectId === 'number' &&
        paramsObj['project_number'] !== sessionProjectId
    ) {
        return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
    }
    const wsForLookup = targetWs ?? sessionWorkspaceId
    if (wsForLookup === '*' || isDefaultWs(wsForLookup)) {
        return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
    }
    const reg = activeProjectRegistry(sessionContext.config?.projectRegistry)
    let unregisteredWs: string | undefined
    if (wsForLookup !== undefined) {
        const wsEntry = lookupRegistryEntry(reg, wsForLookup)
        if (wsEntry !== undefined) {
            if (wsEntry.path === undefined || wsEntry.path.trim() === '' || !cwdMatchesRegistryPath(wsEntry.path, process.cwd())) {
                return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
            }
        } else {
            unregisteredWs = wsForLookup
        }
    }
    const rawRepoHint = paramsObj['repo'] ?? paramsObj['repo_name']
    const repoHint =
        typeof rawRepoHint === 'string' && rawRepoHint.trim() !== '' ? rawRepoHint.trim() : undefined
    if (repoHint !== undefined && isPathOutsideCwd(reg, repoHint)) {
        return { allowed: false, repoHint: undefined, unregisteredWs: undefined }
    }
    return { allowed: true, repoHint, unregisteredWs }
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
    const issueNum =
        paramsObj['issue_url'] === undefined ? parsePositiveProjectNumber(paramsObj['issue_number']) : undefined
    const prNum =
        paramsObj['pr_url'] === undefined ? parsePositiveProjectNumber(paramsObj['pr_number']) : undefined
    if ((issueNum === undefined && prNum === undefined) || sessionContext.github === undefined) return
    const scope = resolveGithubUrlScope(paramsObj, sessionContext, sessionWorkspaceId, sessionProjectId)
    if (!scope.allowed) return
    try {
        const repoInfo = await sessionContext.github.getRepoInfo()
        if (!repoInfo?.owner || !repoInfo?.repo) return
        if (scope.unregisteredWs !== undefined && !matchesRepoSlug(scope.unregisteredWs, repoInfo.owner, repoInfo.repo)) {
            return
        }
        if (scope.repoHint !== undefined && !matchesRepoSlug(scope.repoHint, repoInfo.owner, repoInfo.repo)) {
            return
        }
        const host = resolveGithubHost()
        if (issueNum !== undefined) {
            paramsObj['issue_url'] = `https://${host}/${repoInfo.owner}/${repoInfo.repo}/issues/${String(issueNum)}`
        }
        if (prNum !== undefined) {
            paramsObj['pr_url'] = `https://${host}/${repoInfo.owner}/${repoInfo.repo}/pull/${String(prNum)}`
        }
    } catch (err) {
        logger.debug('Could not auto-populate GitHub URLs; proceeding without them', {
            module: 'CodeMode',
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
