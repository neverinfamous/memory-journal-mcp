import * as fs from 'node:fs'
import * as path from 'node:path'
import type { AnchorStatus, ToolHandlerConfig } from '../../types/index.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { mcpLogger } from '../../utils/mcp-logger.js'
import {
    loadProjectRegistryFromConfig,
    findCanonicalRegistryKey,
    cwdMatchesRegistryPath,
} from '../../utils/workspace-resolver.js'

export interface GitWorkingDirInput {
    cwd?: string
    repo?: string
    workspace_id?: string
    workspaceId?: string
    project_number?: number | string
    path?: string
}

export function resolveGitWorkingDir(
    input: GitWorkingDirInput,
    config?: ToolHandlerConfig
): string {
    if (input.cwd !== undefined && input.cwd !== '') {
        if (fs.existsSync(input.cwd)) return input.cwd
        throw new Error(`Git working directory does not exist: ${input.cwd}`)
    }
    const target = input.repo ?? input.workspace_id ?? input.workspaceId
    const registry = config?.projectRegistry ?? loadProjectRegistryFromConfig()
    if (target !== undefined && target !== '') {
        if (registry) {
            const canonicalKey = findCanonicalRegistryKey(target, registry)
            const entry = canonicalKey ? registry[canonicalKey] : registry[target]
            if (entry?.path && fs.existsSync(entry.path)) return entry.path
        }
        throw new Error(`Git repository '${target}' did not resolve to an existing path`)
    }
    const pNum = typeof input.project_number === 'string' ? Number(input.project_number) : input.project_number
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
        const defaultWs = config?.defaultWorkspaceId ?? 'memory-journal-mcp'
        const defaultEntry = registry[defaultWs]
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
    countCommitsSince: (anchorPath: string, since: string) => Promise<number>
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
            db.updateAnchorStatus(anchor.id, newStatus)
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
            db.updateAnchorStatus(anchor.id, 'unresolvable')
        }
        return failure.row
    }
}

/**
 * A missing path or a rejected traversal is a permanent resolution failure.
 * Other errors, including a failed git command, leave the stored status alone.
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
        },
    }
}
