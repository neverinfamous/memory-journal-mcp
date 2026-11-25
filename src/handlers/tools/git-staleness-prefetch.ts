/**
 * Prefetched Git Commit Counter & Response Helpers
 *
 * Extracted from `git-staleness.ts` (Appendix A) to keep file line counts
 * within project modularization budgets.
 */

import type { AnchorStatus } from '../../types/index.js'
import { mcpLogger } from '../../utils/mcp-logger.js'

export interface StalenessCheckRow {
    anchorId: number
    path: string
    oldStatus: AnchorStatus
    newStatus: AnchorStatus
    commitsSince: number
    isDeleted: boolean
    /** Set when git failed for a reason other than a missing path or rejected traversal. */
    error?: string
}

export function isEnoent(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

/**
 * A missing path or a rejected traversal is a permanent resolution failure.
 * Other errors, including a failed git command, leave the stored status alone
 * and surface `error` on the row so the caller does not report success.
 */
export function stalenessFailure(
    anchor: { id?: number; anchorPath: string; status: AnchorStatus },
    err: unknown
): { row: StalenessCheckRow; persistUnresolvable: boolean } {
    const message = err instanceof Error ? err.message : String(err)
    const missingPath = isEnoent(err)
    const pathRejected = message.includes('Path traversal detected')
    if (missingPath || pathRejected) {
        return {
            persistUnresolvable: anchor.status !== 'unresolvable' && anchor.id !== undefined,
            row: {
                anchorId: anchor.id ?? 0,
                path: anchor.anchorPath,
                oldStatus: anchor.status,
                newStatus: 'unresolvable',
                commitsSince: 0,
                isDeleted: missingPath,
            },
        }
    }

    mcpLogger.warning('git', 'Staleness check failed', {
        path: anchor.anchorPath,
        error: message,
    })
    return {
        persistUnresolvable: false,
        row: {
            anchorId: anchor.id ?? 0,
            path: anchor.anchorPath,
            oldStatus: anchor.status,
            newStatus: anchor.status,
            commitsSince: 0,
            isDeleted: false,
            error: message,
        },
    }
}

export function formatStalenessResponse(
    targetWorkspaces: string[],
    outcomes: { rows: StalenessCheckRow[]; skipped: boolean }[]
): Record<string, unknown> {
    const results: StalenessCheckRow[] = []
    const skippedWorkspaces: string[] = []
    for (let i = 0; i < targetWorkspaces.length; i++) {
        const wsId = targetWorkspaces[i]
        const outcome = outcomes[i]
        if (wsId === undefined || outcome === undefined) continue
        if (outcome.skipped) skippedWorkspaces.push(wsId)
        else results.push(...outcome.rows)
    }

    const failureMessages = results
        .filter((row) => row.error !== undefined)
        .map((row) => `${row.path}: ${row.error ?? ''}`)
    const skipped = skippedWorkspaces.length > 0 ? { skippedWorkspaces } : {}
    if (failureMessages.length > 0) {
        return { success: false, results, error: failureMessages.join('; '), ...skipped }
    }
    if (
        results.length === 0 &&
        skippedWorkspaces.length > 0 &&
        skippedWorkspaces.length === targetWorkspaces.length
    ) {
        return {
            success: false,
            results,
            error: 'No anchor check ran because no workspace had a registered repository path.',
            skippedWorkspaces,
        }
    }
    return { success: true, results, ...skipped }
}

export interface PrefetchedCommitFiles {
    date: string
    files?: { file: string; oldFile?: string | undefined }[] | undefined
    isFilesTruncated?: boolean | undefined
}

export function normalizeRepoRelPath(p: string): string {
    const clean = p.replace(/\\/g, '/').replace(/^\.\//, '')
    return process.platform === 'win32' ? clean.toLowerCase() : clean
}

export function buildPrefetchedCommitCounter(
    prefetched: readonly PrefetchedCommitFiles[],
    fetchCap: number,
    maxCommitsPerAnchor: number
): (anchorPath: string, since: string) => number | undefined {
    const indexed = prefetched.map((c) => {
        const paths = new Set<string>()
        for (const f of c.files ?? []) {
            paths.add(normalizeRepoRelPath(f.file))
            if (f.oldFile !== undefined) paths.add(normalizeRepoRelPath(f.oldFile))
        }
        return { epochMs: Date.parse(c.date), paths, truncated: c.isFilesTruncated === true }
    })
    const windowTruncated = prefetched.length >= fetchCap
    const oldestMs = indexed.reduce(
        (m, c) => (!Number.isNaN(c.epochMs) && c.epochMs < m ? c.epochMs : m),
        Infinity
    )
    return (anchorPath: string, since: string): number | undefined => {
        const sinceMs = Date.parse(since)
        if (Number.isNaN(sinceMs)) return undefined
        const target = normalizeRepoRelPath(anchorPath)
        let hits = 0
        let sawTruncated = false
        for (const c of indexed) {
            if (Number.isNaN(c.epochMs) || c.epochMs < sinceMs) continue
            if (c.paths.has(target)) hits++
            else if (c.truncated) sawTruncated = true
        }
        if (hits === 0 && (sawTruncated || (windowTruncated && sinceMs < oldestMs))) return undefined
        return Math.min(hits, maxCommitsPerAnchor)
    }
}

export async function resolvePrefetchedLookup(
    anchorJobs: readonly { entryTimestamp: string }[],
    registryPath: string,
    maxCommitsPerAnchor: number,
    prefetchCommitsSince:
        | ((since: string, cwd: string, maxCount: number) => Promise<PrefetchedCommitFiles[]>)
        | undefined
): Promise<((anchorPath: string, since: string) => number | undefined) | undefined> {
    if (prefetchCommitsSince === undefined || anchorJobs.length < 4) return undefined
    let earliestSince = anchorJobs[0]?.entryTimestamp ?? ''
    let earliestMs = Date.parse(earliestSince)
    for (const job of anchorJobs) {
        const ms = Date.parse(job.entryTimestamp)
        if (!Number.isNaN(ms) && (Number.isNaN(earliestMs) || ms < earliestMs)) {
            earliestMs = ms
            earliestSince = job.entryTimestamp
        }
    }
    if (earliestSince === '') return undefined
    try {
        const prefetched = await prefetchCommitsSince(earliestSince, registryPath, 500)
        return buildPrefetchedCommitCounter(prefetched, 500, maxCommitsPerAnchor)
    } catch (err: unknown) {
        mcpLogger.debug(
            'GitStaleness',
            'Prefetched git commit counter failed; using per-anchor fallback',
            { error: err instanceof Error ? err.message : String(err) }
        )
        return undefined
    }
}
