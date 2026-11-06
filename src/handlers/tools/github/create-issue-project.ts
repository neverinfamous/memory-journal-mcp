/**
 * Kanban helper for create_github_issue_with_entry: add a new issue to a GitHub Project
 * and optionally move it to its initial status column.
 */

import type { GitHubIntegration } from '../../../github/github-integration/index.js'

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
        return {
            status: initialStatus,
            set: false,
            error: `Status "${initialStatus}" not found. Available: ${board.statusOptions.map((o) => o.name).join(', ')}`,
        }
    }
    const moveResult = await github.moveProjectItem(
        board.projectId,
        itemId,
        board.statusFieldId,
        statusOption.id
    )
    if (moveResult.success) {
        return { status: statusOption.name, set: true }
    }
    return { status: initialStatus, set: false, error: moveResult.error }
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
            return { projectNumber, added: false, error: added.error }
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
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
