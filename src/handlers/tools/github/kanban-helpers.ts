/**
 * GitHub Kanban Tool Handler Helpers
 */

import { z } from 'zod'
import type { KanbanBoard, ToolContext } from '../../../types/index.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { fenceUntrustedInline } from '../../resources/shared.js'
import {
    githubScopeParseFields,
    resolveOwner,
    resolveOwnerRepo,
    resolveProjectNumber,
} from './helpers.js'
import { ensureInlineFenced, fenceKanbanStatus, fenceUntrustedHandle } from './fencing-helpers.js'

export const MISSING_PROJECT_NUMBER_ERROR = {
    success: false,
    error: 'project_number is required and could not be resolved from registry. Please supply it explicitly.',
    code: 'VALIDATION_ERROR',
    category: 'validation',
    recoverable: true,
}

const GetKanbanBoardSchema = z
    .object({
        project_number: githubScopeParseFields.project_number,
        owner: z.string().optional(),
        repo: z.string().optional(),
        workspace_id: githubScopeParseFields.workspace_id,
        summary_only: z.boolean().optional().default(false),
        item_limit: z
            .preprocess((val) => {
                if (typeof val !== 'string') return val
                const trimmed = val.trim()
                if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) return val
                const parsed = Number(trimmed)
                return Number.isSafeInteger(parsed) && String(parsed) === trimmed ? parsed : val
            }, z.number().int().min(0).max(100))
            .optional()
            .default(25),
    })
    .strict()

const MoveKanbanItemSchema = z
    .object({
        project_number: githubScopeParseFields.project_number,
        item_id: z.string().min(1),
        target_status: z.string().min(1),
        owner: z.string().optional(),
        repo: z.string().optional(),
        workspace_id: githubScopeParseFields.workspace_id,
    })
    .strict()

const AddKanbanItemSchema = z
    .object({
        project_number: githubScopeParseFields.project_number,
        issue_number: z.number().int().positive(),
        owner: z.string().optional(),
        repo: z.string().optional(),
        workspace_id: githubScopeParseFields.workspace_id,
    })
    .strict()

const DeleteKanbanItemSchema = z
    .object({
        project_number: githubScopeParseFields.project_number,
        item_id: z.string().min(1),
        owner: z.string().optional(),
        repo: z.string().optional(),
        workspace_id: githubScopeParseFields.workspace_id,
    })
    .strict()

function kanbanBoardNotFoundResponse(projectNum: number, owner: string): Record<string, unknown> {
    return {
        success: false,
        error: `Project #${String(projectNum)} not found or Status field not configured`,
        projectNumber: projectNum,
        owner,
        hint: 'Projects can be at user, repository, or organization level.',
        code: 'RESOURCE_NOT_FOUND',
        category: 'resource',
        suggestion: 'Verify the project number and owner. Use GitHub to check project settings.',
        recoverable: true,
    }
}

function formatKanbanBoardResponse(
    board: KanbanBoard,
    summaryOnly: boolean,
    itemLimit: number
): Record<string, unknown> {
    const projectTitle = fenceUntrustedInline(board.projectTitle)
    const fencedStatusOptions = board.statusOptions.map((opt) => ({
        ...opt,
        name: fenceKanbanStatus(opt.name),
    }))
    if (summaryOnly || itemLimit === 0) {
        return {
            ...board,
            projectTitle,
            statusOptions: fencedStatusOptions,
            columns: board.columns.map((col) => ({
                status: fenceKanbanStatus(col.status),
                statusOptionId: col.statusOptionId,
                items: [],
                itemCount: col.items.length,
            })),
            summaryOnly: true,
            itemDirectory: board.columns.flatMap((col) =>
                col.items.map((item) => ({
                    id: item.id,
                    title: fenceUntrustedInline(item.title),
                    status: item.status !== null ? fenceKanbanStatus(item.status) : null,
                }))
            ),
        }
    }

    return {
        ...board,
        projectTitle,
        statusOptions: fencedStatusOptions,
        columns: board.columns.map((col) => {
            const fencedColStatus = fenceKanbanStatus(col.status)
            const sliced = col.items.slice(0, itemLimit).map((item) => ({
                ...item,
                status: item.status !== null ? fenceKanbanStatus(item.status) : null,
                title: fenceUntrustedInline(item.title),
                ...(item.labels !== undefined
                    ? { labels: item.labels.map(ensureInlineFenced) }
                    : {}),
                ...(item.assignees !== undefined
                    ? { assignees: item.assignees.map(fenceUntrustedHandle) }
                    : {}),
            }))
            return col.items.length <= itemLimit
                ? { ...col, status: fencedColStatus, items: sliced, itemCount: col.items.length }
                : { ...col, status: fencedColStatus, items: sliced, itemCount: col.items.length, truncated: true }
        }),
    }
}

export async function handleGetKanbanBoard(
    context: ToolContext,
    params: unknown
): Promise<unknown> {
    try {
        const input = GetKanbanBoardSchema.parse(params)
        const resolved = await resolveOwner(
            context,
            input.owner,
            input.repo,
            undefined,
            input.project_number,
            input.workspace_id
        )
        if ('error' in resolved) return resolved.response

        const effectiveRepo = resolved.repo ?? input.repo
        const projectNum = resolveProjectNumber(
            context,
            effectiveRepo,
            input.project_number,
            resolved.owner,
            resolved.detectedOwner
        )
        if (projectNum === undefined) {
            return {
                ...MISSING_PROJECT_NUMBER_ERROR,
                requiresUserInput: true,
                instruction:
                    'Ask the user: "What is the GitHub Project number for this repository? (Usually found in the URL: projects/<number>)"',
            }
        }

        const board = await resolved.github.getProjectKanban(
            resolved.owner,
            projectNum,
            effectiveRepo
        )
        if (!board) {
            return kanbanBoardNotFoundResponse(projectNum, resolved.owner)
        }

        return formatKanbanBoardResponse(board, input.summary_only, input.item_limit)
    } catch (err) {
        return formatHandlerError(err)
    }
}

export async function handleMoveKanbanItem(
    context: ToolContext,
    params: unknown
): Promise<unknown> {
    try {
        const input = MoveKanbanItemSchema.parse(params)
        const resolved = await resolveOwner(
            context,
            input.owner,
            input.repo,
            undefined,
            input.project_number,
            input.workspace_id
        )
        if ('error' in resolved) return resolved.response

        const effectiveRepo = resolved.repo ?? input.repo
        const projectNum = resolveProjectNumber(
            context,
            effectiveRepo,
            input.project_number,
            resolved.owner,
            resolved.detectedOwner
        )
        if (projectNum === undefined) return MISSING_PROJECT_NUMBER_ERROR

        const board = await resolved.github.getProjectKanban(
            resolved.owner,
            projectNum,
            effectiveRepo
        )
        if (!board) {
            return {
                success: false,
                error: `Project #${String(projectNum)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the project number and owner.',
                recoverable: true,
            }
        }

        const statusOption = board.statusOptions.find(
            (opt) => opt.name.toLowerCase() === input.target_status.toLowerCase()
        )
        if (!statusOption) {
            return {
                success: false,
                error: `Status "${input.target_status}" not found`,
                availableStatuses: board.statusOptions.map((o) => fenceKanbanStatus(o.name)),
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Use one of the available status column names.',
                recoverable: true,
            }
        }

        const result = await resolved.github.moveProjectItem(
            board.projectId,
            input.item_id,
            board.statusFieldId,
            statusOption.id
        )
        const fencedStatus = fenceKanbanStatus(statusOption.name)
        return {
            success: result.success,
            itemId: input.item_id,
            newStatus: fencedStatus,
            projectNumber: projectNum,
            message: result.success ? `Moved item to "${fencedStatus}"` : undefined,
            error: result.error,
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

export async function handleAddKanbanItem(
    context: ToolContext,
    params: unknown
): Promise<unknown> {
    try {
        const input = AddKanbanItemSchema.parse(params)
        const resolved = await resolveOwnerRepo(context, input)
        if ('error' in resolved) return resolved.response

        const projectNum = resolveProjectNumber(
            context,
            resolved.repo,
            input.project_number,
            resolved.owner,
            resolved.detectedOwner
        )
        if (projectNum === undefined) return MISSING_PROJECT_NUMBER_ERROR

        const issueDetails = await resolved.github.getIssue(
            resolved.owner,
            resolved.repo,
            input.issue_number
        )
        let nodeId = issueDetails?.nodeId
        if (!nodeId) {
            const prDetails = await resolved.github.getPullRequest(
                resolved.owner,
                resolved.repo,
                input.issue_number
            )
            nodeId = prDetails?.nodeId
        }
        if (!nodeId) {
            return {
                success: false,
                error: `Issue or PR #${String(input.issue_number)} not found or lacks a nodeId`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                recoverable: true,
            }
        }

        const board = await resolved.github.getProjectKanban(
            resolved.owner,
            projectNum,
            resolved.repo
        )
        if (!board) {
            return {
                success: false,
                error: `Project #${String(projectNum)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                recoverable: true,
            }
        }

        const result = await resolved.github.addProjectItem(board.projectId, nodeId)
        return {
            success: result.success,
            itemId: result.itemId,
            projectNumber: projectNum,
            message: result.success
                ? `Added Issue/PR #${String(input.issue_number)} to Project #${projectNum}`
                : undefined,
            error: result.error,
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}

export async function handleDeleteKanbanItem(
    context: ToolContext,
    params: unknown
): Promise<unknown> {
    try {
        const input = DeleteKanbanItemSchema.parse(params)
        const resolved = await resolveOwner(
            context,
            input.owner,
            input.repo,
            undefined,
            input.project_number,
            input.workspace_id
        )
        if ('error' in resolved) return resolved.response

        const effectiveRepo = resolved.repo ?? input.repo
        const projectNum = resolveProjectNumber(
            context,
            effectiveRepo,
            input.project_number,
            resolved.owner,
            resolved.detectedOwner
        )
        if (projectNum === undefined) return MISSING_PROJECT_NUMBER_ERROR

        const board = await resolved.github.getProjectKanban(
            resolved.owner,
            projectNum,
            effectiveRepo
        )
        if (!board) {
            return {
                success: false,
                error: `Project #${String(projectNum)} not found`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                recoverable: true,
            }
        }

        const result = await resolved.github.deleteProjectItem(board.projectId, input.item_id)
        return {
            success: result.success,
            itemId: input.item_id,
            projectNumber: projectNum,
            message: result.success
                ? `Deleted item ${input.item_id} from Project #${projectNum}`
                : undefined,
            error: result.error,
        }
    } catch (err) {
        return formatHandlerError(err)
    }
}
