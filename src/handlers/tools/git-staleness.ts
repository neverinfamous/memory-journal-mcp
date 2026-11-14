import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AnchorStatus, ToolHandlerConfig } from '../../types/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { mcpLogger } from '../../utils/mcp-logger.js'
import { assertSafeDirectoryPath } from '../../utils/security-utils.js'
import { ValidationError } from '../../types/errors.js'
import {
    loadProjectRegistryFromConfig,
    findCanonicalRegistryKey,
    cwdMatchesRegistryPath,
} from '../../utils/workspace-resolver.js'

export interface GitWorkingDirInput {
    cwd?: string
    repo?: string
    repo_name?: string
    workspace_id?: string
    workspaceId?: string
    project_number?: number | string
    path?: string
}

export function resolveGitWorkingDir(
    input: GitWorkingDirInput,
    config?: ToolHandlerConfig
): string {
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    const buildAllowedRoots = (): string[] => [
        ...(config?.allowedIoRoots ?? []),
        ...Object.values(registry ?? {})
            .map((entry) => entry.path)
            .filter((entryPath) => entryPath.length > 0),
    ]

    if (input.cwd !== undefined && input.cwd !== '') {
        if (!fs.existsSync(input.cwd)) {
            throw new Error(`Git working directory does not exist: ${input.cwd}`)
        }
        const roots = buildAllowedRoots()
        if (roots.length === 0) {
            throw new Error(
                'Git working directory must be a registered repository path or an allowed I/O root'
            )
        }
        assertSafeDirectoryPath(input.cwd, roots)
        return input.cwd
    }
    const rawTarget = input.repo ?? input.repo_name ?? input.workspace_id ?? input.workspaceId
    const trimmedRawTarget = rawTarget?.trim()
    // [INVARIANT] Sentinel workspaces ('default', '*') never name a repository; fall through to project_number.
    const target =
        trimmedRawTarget !== undefined && ['default', '*'].includes(trimmedRawTarget.toLowerCase())
            ? undefined
            : trimmedRawTarget
    const pNum =
        typeof input.project_number === 'string' ? Number(input.project_number) : input.project_number
    if (registry && pNum !== undefined && !Number.isNaN(pNum) && trimmedRawTarget !== undefined && trimmedRawTarget !== '' && trimmedRawTarget !== '*') {
        const owners = Object.entries(registry)
            .filter(([, entry]) => entry.project_number === pNum)
            .map(([key]) => key)
        if (trimmedRawTarget.toLowerCase() === 'default' && owners.length > 0) {
            throw new ValidationError(
                `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not 'default'.`
            )
        }
        if (target !== undefined && target !== '') {
            const matchedKey =
                findCanonicalRegistryKey(target, registry) ??
                (Object.prototype.hasOwnProperty.call(registry, target) ? target : undefined) ??
                Object.entries(registry).find(
                    ([, entry]) => Boolean(entry.path) && cwdMatchesRegistryPath(entry.path, target)
                )?.[0]
            if (matchedKey !== undefined) {
                const registeredProj = registry[matchedKey]?.project_number
                if (registeredProj !== undefined && registeredProj !== pNum) {
                    throw new ValidationError(
                        `project_number ${String(pNum)} does not match registered project ${String(registeredProj)} for workspace '${matchedKey}'.`
                    )
                }
                if (owners.length > 0 && !owners.some((o) => o.toLowerCase() === matchedKey.toLowerCase())) {
                    throw new ValidationError(
                        `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not '${matchedKey}'.`
                    )
                }
            } else if (owners.length > 0) {
                throw new ValidationError(
                    `project_number ${String(pNum)} belongs to workspace '${owners[0] ?? ''}', not '${target}'.`
                )
            }
        }
    }
    if (target !== undefined && target !== '') {
        if (registry) {
            const canonicalKey = findCanonicalRegistryKey(target, registry)
            const entry = canonicalKey ? registry[canonicalKey] : registry[target]
            if (entry?.path && fs.existsSync(entry.path)) return entry.path
            for (const regEntry of Object.values(registry)) {
                if (
                    regEntry.path &&
                    cwdMatchesRegistryPath(regEntry.path, target) &&
                    fs.existsSync(regEntry.path)
                ) {
                    return regEntry.path
                }
            }
        }
        if (fs.existsSync(target)) {
            const roots = buildAllowedRoots()
            if (roots.length > 0) {
                assertSafeDirectoryPath(target, roots)
                return target
            }
        }
        throw new Error(`Git repository '${target}' did not resolve to an existing path`)
    }
    if (pNum !== undefined && !Number.isNaN(pNum)) {
        if (registry) {
            for (const entry of Object.values(registry)) {
                if (entry.project_number === pNum && entry.path && fs.existsSync(entry.path)) {
                    return entry.path
                }
            }
        }
        throw new Error(`Git repository for project ${String(pNum)} did not resolve to an existing path`)
    }
    const currentCwd = process.cwd()
    if (fs.existsSync(path.join(currentCwd, '.git'))) {
        return currentCwd
    }
    if (registry) {
        for (const entry of Object.values(registry)) {
            if (entry.path && cwdMatchesRegistryPath(entry.path, currentCwd)) {
                return entry.path
            }
        }
        const defaultWs = config?.defaultWorkspaceId
        const defaultEntry = defaultWs !== undefined ? registry[defaultWs] : undefined
        if (defaultEntry?.path && fs.existsSync(defaultEntry.path)) {
            return defaultEntry.path
        }
    }
    return currentCwd
}

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
        const fullPath = path.resolve(workspaceRoot, anchor.anchorPath)
        const relPath = path.relative(workspaceRoot, fullPath)
        if (relPath === '..' || relPath.startsWith('..' + path.sep) || path.isAbsolute(relPath)) {
            throw new Error(`Path traversal detected: ${anchor.anchorPath}`)
        }

        const isDeleted = !fs.existsSync(fullPath)
        let commitsSince = 0
        let newStatus: AnchorStatus = anchor.status

        if (isDeleted) {
            newStatus = 'invalidated'
        } else {
            commitsSince = await countCommitsSince(anchor.anchorPath, entryTimestamp)
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
