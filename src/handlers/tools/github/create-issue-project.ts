/**
 * Kanban helper for create_github_issue_with_entry: add a new issue to a GitHub Project
 * and optionally move it to its initial status column.
 */

import type { GitHubIntegration } from '../../../github/github-integration/index.js'
import { sanitizeErrorMessageForResponse } from '../../../utils/error-helpers.js'
import { fenceUntrustedInline } from '../../../handlers/resources/uri-and-fencing.js'
import { fenceKanbanStatus } from './fencing-helpers.js'

export interface IssueProjectResult {
    projectNumber: number
    added: boolean
    message?: string
    error?: string | undefined
    initialStatus?: { status: string; set: boolean; error?: string | undefined } | undefined
}

type KanbanBoard = NonNullable<Awaited<ReturnType<GitHubIntegration['getProjectKanban']>>>

/** Move the added item to `initialStatus` and report whether it worked. */
async function applyInitialStatus(
    github: GitHubIntegration,
    board: KanbanBoard,
    itemId: string,
    initialStatus: string
): Promise<{ status: string; set: boolean; error?: string | undefined }> {
    const statusOption = board.statusOptions.find(
        (opt) => opt.name.toLowerCase() === initialStatus.toLowerCase()
    )
    if (!statusOption) {
        const safeStatus = fenceUntrustedInline(initialStatus)
        const available = board.statusOptions
            .map((o) => fenceUntrustedInline(o.name))
            .join(', ')
        return {
            status: fenceKanbanStatus(initialStatus),
            set: false,
            error: `Status "${safeStatus}" not found. Available: ${available}`,
        }
    }
    const moveResult = await github.moveProjectItem(
        board.projectId,
        itemId,
        board.statusFieldId,
        statusOption.id
    )
    if (moveResult.success) {
        return { status: fenceKanbanStatus(statusOption.name), set: true }
    }
    return {
        status: fenceKanbanStatus(initialStatus),
        set: false,
        error:
            moveResult.error !== undefined
                ? sanitizeErrorMessageForResponse(moveResult.error)
                : undefined,
    }
}

/** Add the issue (by node id) to the project board; never throws. */
export async function addIssueToProject(
    github: GitHubIntegration,
    owner: string,
    repo: string,
    issueNodeId: string,
    projectNumber: number,
    initialStatusInput: string | undefined
): Promise<IssueProjectResult> {
    try {
        const board = await github.getProjectKanban(owner, projectNumber, repo)
        if (!board) {
            return {
                projectNumber,
                added: false,
                error: `Project #${projectNumber} not found`,
            }
        }
        const added = await github.addProjectItem(board.projectId, issueNodeId)
        if (!added.success) {
            return {
                projectNumber,
                added: false,
                error:
                    added.error !== undefined
                        ? sanitizeErrorMessageForResponse(added.error)
                        : undefined,
            }
        }

        let statusResult: IssueProjectResult['initialStatus']
        const initialStatus = initialStatusInput ?? 'Backlog'
        if (initialStatus && added.itemId) {
            statusResult = await applyInitialStatus(github, board, added.itemId, initialStatus)
        }

        return {
            projectNumber,
            added: true,
            message:
                `Added to project #${projectNumber}` +
                (statusResult?.set ? ` (${statusResult.status})` : ''),
            initialStatus: statusResult,
        }
    } catch (error) {
        return {
            projectNumber,
            added: false,
            error: sanitizeErrorMessageForResponse(
                error instanceof Error ? error.message : String(error)
            ),
        }
    }
}
