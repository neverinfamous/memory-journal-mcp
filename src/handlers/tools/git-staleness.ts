import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AnchorStatus, ToolHandlerConfig } from '../../types/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { mcpLogger } from '../../utils/mcp-logger.js'
import { ValidationError, ResourceNotFoundError } from '../../types/errors.js'
import { findCanonicalRegistryKey, resolveWorkspaceId } from '../../utils/workspace-resolver.js'

export { resolveGitWorkingDir, type GitWorkingDirInput } from './git-workdir.js'

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

function stderrText(err: unknown): string {
    if (typeof err !== 'object' || err === null || !('stderr' in err)) return ''
    const stderr = err.stderr
    if (typeof stderr === 'string') return stderr
    if (stderr instanceof Uint8Array) return new TextDecoder().decode(stderr)
    return ''
}

/** `git describe` with no tags. Other describe failures must propagate. */
export function readLatestGitTag(cwd: string): string | null {
    try {
        const described = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
            cwd,
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 5000,
        }).trim()
        return described === '' ? null : described
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        if (`${message}\n${stderrText(err)}`.includes('No names found')) return null
        throw err
    }
}

function isEnoent(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

/**
 * Evaluate one anchor against the repository at `workspaceRoot`, persist any status change,
 * and return the result row. Failures are mapped through `stalenessFailure`.
 * `countCommitsSince` returns how many commits touched `anchorPath` since `since`.
 */
export async function evaluateAnchorStaleness(
    db: Pick<IDatabaseAdapter, 'updateAnchorStatus'>,
    anchor: { id?: number; anchorPath: string; status: AnchorStatus },
    entryTimestamp: string,
    workspaceRoot: string,
    countCommitsSince: (anchorPath: string, since: string) => Promise<number>,
    workspaceId: string | undefined
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
        const relPath =
            process.platform === 'win32'
                ? path.relative(resolvedRoot.toLowerCase(), fullPath.toLowerCase())
                : path.relative(resolvedRoot, fullPath)
        if (relPath === '..' || relPath.startsWith('..' + path.sep) || path.isAbsolute(relPath)) {
            throw new Error(`Path traversal detected: ${anchor.anchorPath}`)
        }

        const isDeleted = !fs.existsSync(fullPath)
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
            db.updateAnchorStatus(anchor.id, newStatus, workspaceId)
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
            db.updateAnchorStatus(anchor.id, 'unresolvable', workspaceId)
        }
        return failure.row
    }
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
    resolvedEntryId: number | undefined
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
    const { entries: recent } = db.getRecentEntries(20, undefined, undefined, undefined, false, wsId, projectNumber)
    return recent.map((r) => ({ id: r.id, timestamp: r.timestamp }))
}

/** Evaluate all anchors in a single workspace and report whether it was skipped for missing a path. */
export async function evaluateWorkspaceAnchors(options: {
    db: IDatabaseAdapter
    wsId: string
    rawWs: string | undefined
    rawProj: number | undefined
    resolvedEntryId: number | undefined
    registry: ToolHandlerConfig['projectRegistry'] | undefined
    countCommitsSince: (anchorPath: string, since: string, cwd: string) => Promise<number>
}): Promise<{ rows: StalenessCheckRow[]; skipped: boolean }> {
    const { db, wsId, rawWs, rawProj, resolvedEntryId, registry, countCommitsSince } = options
    const canonicalWs = findCanonicalRegistryKey(wsId, registry) ?? wsId
    const registryPath = registry?.[canonicalWs]?.path
    if (registryPath === undefined || registryPath.length === 0 || !fs.existsSync(registryPath)) {
        if (rawWs === '*') return { rows: [], skipped: true }
        throw new ValidationError(
            registryPath !== undefined && registryPath.length > 0
                ? `Registered repository path for workspace '${wsId}' does not exist: ${registryPath}`
                : `No registered repository path for workspace '${wsId}'. Register the project path before checking its anchors.`
        )
    }

    const targets = collectStalenessTargetsForWorkspace(db, wsId, rawWs, rawProj, resolvedEntryId)
    const rows: StalenessCheckRow[] = []
    for (const target of targets) {
        for (const anchor of db.getAnchorsByEntryId(target.id, wsId)) {
            rows.push(
                await evaluateAnchorStaleness(
                    db,
                    anchor,
                    target.timestamp,
                    registryPath,
                    (anchorPath, since) => countCommitsSince(anchorPath, since, registryPath),
                    wsId
                )
            )
        }
    }
    return { rows, skipped: false }
}
