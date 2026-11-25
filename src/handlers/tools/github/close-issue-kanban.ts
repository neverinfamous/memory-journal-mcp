/**
 * Kanban helper for close_github_issue_with_entry: move a closed issue to the "Done" column.
 */

import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { sanitizeErrorMessageForResponse } from '../../../utils/error-helpers.js'

export interface KanbanMoveResult {
    moved: boolean
    error?: string | undefined
    projectNumber?: number | undefined
}

/** Move the issue (by node id) to the board's "Done" status column; never throws. */
export async function moveIssueToDone(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    issueNodeId: string,
    projectNumber: number
): Promise<KanbanMoveResult> {
    try {
        const board = await github.getProjectKanban(owner, projectNumber, repo)
        if (!board) {
            return { moved: false, error: `Project #${projectNumber} not found`, projectNumber }
        }
        const doneOption = board.statusOptions.find((opt) => opt.name.toLowerCase() === 'done')
        if (!doneOption) {
            return { moved: false, error: '"Done" status column not found on board', projectNumber }
        }
        const addResult = await github.addProjectItem(board.projectId, issueNodeId)
        if (!addResult.success || !addResult.itemId) {
            return {
                moved: false,
                error: addResult.error ?? 'Failed to resolve project item ID',
                projectNumber,
            }
        }
        const moveResult = await github.moveProjectItem(
            board.projectId,
            addResult.itemId,
            board.statusFieldId,
            doneOption.id
        )
        return {
            moved: moveResult.success,
            error:
                moveResult.error !== undefined
                    ? sanitizeErrorMessageForResponse(moveResult.error)
                    : undefined,
            projectNumber,
        }
    } catch (err) {
        return {
            moved: false,
            error: sanitizeErrorMessageForResponse(
                err instanceof Error ? err.message : String(err)
            ),
            projectNumber,
        }
    }
}
