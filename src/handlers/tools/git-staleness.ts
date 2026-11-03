import type { AnchorStatus } from '../../types/index.js'
import { mcpLogger } from '../../utils/mcp-logger.js'

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
