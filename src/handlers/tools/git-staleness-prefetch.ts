/**
 * Prefetched Git Commit Counter Helpers
 *
 * Extracted from `git-staleness.ts` (Appendix A) to keep file line counts
 * within project modularization budgets.
 */

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
    } catch {
        return undefined
    }
}
