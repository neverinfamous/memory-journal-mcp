import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
import type { AnchorStatus, ToolContext, ToolHandlerConfig } from '../../types/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { formatHandlerError } from '../../utils/error-helpers.js'
import { ValidationError, ResourceNotFoundError } from '../../types/errors.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveWorkspaceId,
} from '../../utils/workspace-resolver.js'
import { parseCanonicalPositiveInt } from '../../utils/safe-positive-int.js'
import {
    formatStalenessResponse,
    isEnoent,
    resolvePrefetchedLookup,
    stalenessFailure,
    type PrefetchedCommitFiles,
    type StalenessCheckRow,
} from './git-staleness-prefetch.js'

export { stalenessFailure, type PrefetchedCommitFiles, type StalenessCheckRow } from './git-staleness-prefetch.js'
export { resolveGitWorkingDir, type GitWorkingDirInput } from './git-workdir.js'

function stderrText(err: unknown): string {
    if (typeof err !== 'object' || err === null || !('stderr' in err)) return ''
    const stderr = err.stderr
    if (typeof stderr === 'string') return stderr
    if (stderr instanceof Uint8Array) return new TextDecoder().decode(stderr)
    return ''
}

/** `git describe` with no tags. Other describe failures must propagate. */
export async function readLatestGitTag(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], {
            cwd,
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 5000,
        })
        const described = stdout.trim()
        return described === '' || described.startsWith('-') ? null : described
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        if (`${message}\n${stderrText(err)}`.includes('No names found')) return null
        throw err
    }
}

async function pathExistsAsync(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath)
        return true
    } catch {
        return false
    }
}

function isOutsideRoot(rootPath: string, candidatePath: string): boolean {
    const relPath =
        process.platform === 'win32'
            ? path.relative(rootPath.toLowerCase(), candidatePath.toLowerCase())
            : path.relative(rootPath, candidatePath)
    return relPath === '..' || relPath.startsWith('..' + path.sep) || path.isAbsolute(relPath)
}

async function assertAnchorWithinRealWorkspaceRoot(
    resolvedRoot: string,
    fullPath: string,
    rawAnchorPath: string,
    precomputedRealRoot?: string
): Promise<boolean> {
    try {
        if ((await fs.promises.lstat(fullPath)).isSymbolicLink()) {
            throw new Error(`Path traversal detected: ${rawAnchorPath}`)
        }
        const [realRoot, realFull] = await Promise.all([
            precomputedRealRoot !== undefined
                ? Promise.resolve(precomputedRealRoot)
                : fs.promises.realpath(resolvedRoot).catch(() => resolvedRoot),
            fs.promises.realpath(fullPath),
        ])
        if (isOutsideRoot(realRoot, realFull)) {
            throw new Error(`Path traversal detected: ${rawAnchorPath}`)
        }
        return false
    } catch (err) {
        if (isEnoent(err)) return true
        throw err
    }
}

export async function evaluateAnchorStaleness(
    db: Pick<IDatabaseAdapter, 'updateAnchorStatus'>,
    anchor: { id?: number; anchorPath: string; status: AnchorStatus },
    entryTimestamp: string,
    workspaceRoot: string,
    countCommitsSince: (anchorPath: string, since: string) => Promise<number>,
    workspaceId: string | undefined,
    precomputedRealRoot?: string,
    pendingUpdates?: { anchorId: number; status: AnchorStatus }[]
): Promise<StalenessCheckRow> {
    try {
        const resolvedRoot = path.resolve(workspaceRoot)
        const normalizedRaw = anchor.anchorPath.replace(/\\/g, '/')
        const hashIdx = normalizedRaw.indexOf('#')
        const withoutSymbol = (hashIdx >= 0 ? normalizedRaw.slice(0, hashIdx) : normalizedRaw).trim()
        const relAnchorFile = withoutSymbol.replace(/:(\d+)(?::\d+)?$/, '').trim()
        if (relAnchorFile === '') {
            throw new Error(`Path traversal detected: ${anchor.anchorPath}`)
        }
        const fullPath = path.resolve(resolvedRoot, relAnchorFile)
        if (isOutsideRoot(resolvedRoot, fullPath)) {
            throw new Error(`Path traversal detected: ${anchor.anchorPath}`)
        }

        const isDeleted = await assertAnchorWithinRealWorkspaceRoot(
            resolvedRoot,
            fullPath,
            anchor.anchorPath,
            precomputedRealRoot
        )
        let commitsSince = 0
        let newStatus: AnchorStatus = anchor.status

        if (isDeleted) {
            newStatus = 'invalidated'
        } else {
            commitsSince = await countCommitsSince(relAnchorFile, entryTimestamp)
            if (commitsSince > 0) {
                newStatus = 'stale'
            } else if (anchor.status === 'pending') {
                newStatus = 'valid'
            }
        }

        if (newStatus !== anchor.status && anchor.id !== undefined) {
            if (pendingUpdates !== undefined) pendingUpdates.push({ anchorId: anchor.id, status: newStatus })
            else db.updateAnchorStatus(anchor.id, newStatus, workspaceId)
        }

        return {
            anchorId: anchor.id ?? 0,
            path: anchor.anchorPath,
            oldStatus: anchor.status,
            newStatus,
            commitsSince,
            isDeleted,
        }
    } catch (err: unknown) {
        const failure = stalenessFailure(anchor, err)
        if (failure.persistUnresolvable && anchor.id !== undefined) {
            if (pendingUpdates !== undefined) {
                pendingUpdates.push({ anchorId: anchor.id, status: 'unresolvable' })
            } else {
                db.updateAnchorStatus(anchor.id, 'unresolvable', workspaceId)
            }
        }
        return failure.row
    }
}

/** Resolve target workspaces to scan during `check_entry_staleness`. */
export function resolveStalenessTargetWorkspaces(
    db: Pick<IDatabaseAdapter, 'getEntryByIdIncludeDeleted'>,
    rawWs: string | undefined,
    rawProj: number | undefined,
    resolvedEntryId: number | undefined,
    registry: ToolHandlerConfig['projectRegistry'] | undefined,
    config: ToolHandlerConfig | undefined
): string[] {
    const defaultWs = resolveWorkspaceId(undefined, undefined, config)
    if (rawWs !== '*') {
        return [resolveWorkspaceId(rawWs, rawProj, config)]
    }
    if (resolvedEntryId !== undefined) {
        const entry = db.getEntryByIdIncludeDeleted(resolvedEntryId, '*')
        if (!entry) throw new ResourceNotFoundError('entry', String(resolvedEntryId))
        if (typeof rawProj === 'number' && entry.projectNumber !== rawProj) {
            throw new ResourceNotFoundError('entry', String(resolvedEntryId))
        }
        return [entry.workspaceId ?? defaultWs]
    }
    const registryKeys = Object.keys(registry ?? {}).filter(
        (key) => typeof rawProj !== 'number' || registry?.[key]?.project_number === rawProj
    )
    if (registryKeys.length > 0) return Array.from(new Set(registryKeys))
    return typeof rawProj !== 'number' ? [defaultWs] : []
}

function collectStalenessTargetsForWorkspace(
    db: Pick<IDatabaseAdapter, 'getEntryByIdIncludeDeleted' | 'getRecentEntries'>,
    wsId: string,
    rawWs: string | undefined,
    rawProj: number | undefined,
    resolvedEntryId: number | undefined,
    maxRecentEntries = 20,
    sessionId?: string
): { id: number; timestamp: string }[] {
    if (resolvedEntryId !== undefined) {
        const entry = db.getEntryByIdIncludeDeleted(resolvedEntryId, rawWs === '*' ? '*' : wsId)
        if (!entry || (typeof rawProj === 'number' && entry.projectNumber !== rawProj)) {
            if (rawWs !== '*') throw new ResourceNotFoundError('entry', String(resolvedEntryId))
            return []
        }
        return [{ id: entry.id, timestamp: entry.timestamp }]
    }
    const projectNumber = typeof rawProj === 'number' ? rawProj : undefined
    const { entries: recent } = db.getRecentEntries(maxRecentEntries, undefined, undefined, undefined, false, wsId, projectNumber)
    const trimmedSession = sessionId !== undefined && sessionId.trim() !== '' ? sessionId.trim() : undefined
    const filtered = trimmedSession !== undefined ? recent.filter((r) => r.sessionId === trimmedSession) : recent
    return filtered.map((r) => ({ id: r.id, timestamp: r.timestamp }))
}

async function awaitAllSettledOrThrow<T>(tasks: readonly Promise<T>[]): Promise<T[]> {
    const settled = await Promise.allSettled(tasks)
    const values: T[] = []
    for (const outcome of settled) {
        if (outcome.status === 'rejected') {
            throw outcome.reason instanceof Error
                ? outcome.reason
                : new Error(String(outcome.reason))
        }
        values.push(outcome.value)
    }
    return values
}

async function runAnchorChunkSettled(
    db: IDatabaseAdapter,
    chunk: readonly { anchor: { id?: number; anchorPath: string; status: AnchorStatus }; entryTimestamp: string }[],
    registryPath: string,
    cachedCountCommits: (anchorPath: string, since: string) => Promise<number>,
    wsId: string,
    precomputedRealRoot: string,
    pendingUpdates: { anchorId: number; status: AnchorStatus }[]
): Promise<StalenessCheckRow[]> {
    return awaitAllSettledOrThrow(
        chunk.map(({ anchor, entryTimestamp }) =>
            evaluateAnchorStaleness(db, anchor, entryTimestamp, registryPath, cachedCountCommits, wsId, precomputedRealRoot, pendingUpdates)
        )
    )
}

/** Evaluate all anchors in a single workspace and report whether it was skipped for missing a path. */
export async function evaluateWorkspaceAnchors(options: {
    db: IDatabaseAdapter
    wsId: string
    rawWs: string | undefined
    rawProj: number | undefined
    resolvedEntryId: number | undefined
    sessionId?: string | undefined
    registry: ToolHandlerConfig['projectRegistry'] | undefined
    maxRecentEntries?: number | undefined
    maxCommitsPerAnchor?: number | undefined
    countCommitsSince: (anchorPath: string, since: string, cwd: string) => Promise<number>
    prefetchCommitsSince?:
        | ((since: string, cwd: string, maxCount: number) => Promise<PrefetchedCommitFiles[]>)
        | undefined
}): Promise<{ rows: StalenessCheckRow[]; skipped: boolean }> {
    const {
        db, wsId, rawWs, rawProj, resolvedEntryId, sessionId, registry, maxRecentEntries,
        maxCommitsPerAnchor = 25, countCommitsSince, prefetchCommitsSince,
    } = options
    const canonicalWs = findCanonicalRegistryKey(wsId, registry) ?? wsId
    const registryPath = registry?.[canonicalWs]?.path
    if (registryPath === undefined || registryPath.length === 0 || !(await pathExistsAsync(registryPath))) {
        if (rawWs === '*') return { rows: [], skipped: true }
        throw new ValidationError(
            registryPath !== undefined && registryPath.length > 0
                ? `Registered repository path for workspace '${wsId}' does not exist: ${registryPath}`
                : `No registered repository path for workspace '${wsId}'. Register the project path before checking its anchors.`
        )
    }

    const resolvedRoot = path.resolve(registryPath)
    const [precomputedRealRoot, targets] = [
        await fs.promises.realpath(resolvedRoot).catch(() => resolvedRoot),
        collectStalenessTargetsForWorkspace(db, wsId, rawWs, rawProj, resolvedEntryId, maxRecentEntries ?? 20, sessionId),
    ]
    const anchorsByEntry =
        targets.length > 0 && typeof db.getAnchorsByEntryIds === 'function'
            ? db.getAnchorsByEntryIds(targets.map((t) => t.id), wsId)
            : undefined
    const anchorJobs: { anchor: { id?: number; anchorPath: string; status: AnchorStatus }; entryTimestamp: string }[] = []
    for (const target of targets) {
        const anchors = anchorsByEntry !== undefined ? (anchorsByEntry.get(target.id) ?? []) : db.getAnchorsByEntryId(target.id, wsId)
        for (const anchor of anchors) anchorJobs.push({ anchor, entryTimestamp: target.timestamp })
    }

    const fastLookup = await resolvePrefetchedLookup(anchorJobs, registryPath, maxCommitsPerAnchor, prefetchCommitsSince)
    const commitCountCache = new Map<string, Promise<number>>()
    const cachedCountCommits = (anchorPath: string, since: string): Promise<number> => {
        const fastCount = fastLookup?.(anchorPath, since)
        if (fastCount !== undefined) return Promise.resolve(fastCount)
        const key = `${anchorPath}\0${since}`
        let pending = commitCountCache.get(key)
        if (pending === undefined) {
            pending = countCommitsSince(anchorPath, since, registryPath)
            commitCountCache.set(key, pending)
        }
        return pending
    }
    const rows: StalenessCheckRow[] = []
    const pendingUpdates: { anchorId: number; status: AnchorStatus }[] = []
    const STALENESS_CONCURRENCY = 8
    for (let i = 0; i < anchorJobs.length; i += STALENESS_CONCURRENCY) {
        rows.push(...(await runAnchorChunkSettled(db, anchorJobs.slice(i, i + STALENESS_CONCURRENCY), registryPath, cachedCountCommits, wsId, precomputedRealRoot, pendingUpdates)))
    }
    if (pendingUpdates.length > 0) {
        const flushUpdates = (): void => {
            for (const u of pendingUpdates) db.updateAnchorStatus(u.anchorId, u.status, wsId)
        }
        if (typeof db.executeInTransaction === 'function') db.executeInTransaction(flushUpdates)
        else flushUpdates()
    }
    return { rows, skipped: false }
}

const coercedPositiveInt = z.preprocess(
    (v) => (typeof v === 'string' ? (parseCanonicalPositiveInt(v) ?? v) : v),
    z.number().int().positive()
)

const CheckEntryStalenessParseSchema = z.object({
    entry_id: coercedPositiveInt.optional(),
    entryId: coercedPositiveInt.optional(),
    workspace_id: z.string().max(255).optional(),
    workspaceId: z.string().max(255).optional(),
    project_number: coercedPositiveInt.optional(),
    projectNumber: coercedPositiveInt.optional(),
    session_id: z.string().optional(),
})

/** Execute `check_entry_staleness` across target workspaces and format the aggregate result. */
export async function runCheckEntryStaleness(
    params: unknown,
    context: ToolContext,
    countCommits: (anchorPath: string, since: string, cwd: string, maxCount: number) => Promise<number>,
    prefetchCommits?: (since: string, cwd: string, maxCount: number) => Promise<PrefetchedCommitFiles[]>
): Promise<unknown> {
    try {
        const parsed = CheckEntryStalenessParseSchema.parse(params)
        const resolvedEntryId = parsed.entry_id ?? parsed.entryId
        const rawWs = parsed.workspace_id ?? parsed.workspaceId
        const rawProj = parsed.project_number ?? parsed.projectNumber
        const registry = context.config?.projectRegistry ?? loadProjectRegistryFromConfig()
        const targetWorkspaces = resolveStalenessTargetWorkspaces(context.db, rawWs, rawProj, resolvedEntryId, registry, context.config)

        const maxRecentEntries = targetWorkspaces.length > 1 ? 8 : 20
        const maxCommitsPerAnchor = targetWorkspaces.length > 1 ? 5 : 25
        const outcomes = await awaitAllSettledOrThrow(
            targetWorkspaces.map((wsId) =>
                evaluateWorkspaceAnchors({
                    db: context.db,
                    wsId,
                    rawWs,
                    rawProj,
                    resolvedEntryId,
                    ...(parsed.session_id !== undefined ? { sessionId: parsed.session_id } : {}),
                    registry,
                    maxRecentEntries,
                    maxCommitsPerAnchor,
                    countCommitsSince: (anchorPath, since, cwd) => countCommits(anchorPath, since, cwd, maxCommitsPerAnchor),
                    ...(prefetchCommits !== undefined ? { prefetchCommitsSince: prefetchCommits } : {}),
                })
            )
        )
        return formatStalenessResponse(targetWorkspaces, outcomes)
    } catch (err) {
        return formatHandlerError(err)
    }
}
