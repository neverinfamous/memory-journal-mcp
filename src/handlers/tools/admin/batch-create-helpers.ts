import type { z } from 'zod'
import type { CreateEntryInput, ToolContext } from '../../../types/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { ValidationError } from '../../../types/errors.js'
import { logger } from '../../../utils/logger.js'
import { resolveEntryAnchors } from '../core/staleness-tools.js'
import type { BatchCreateEntriesSchema } from './schemas.js'

type BatchEntryInput = z.infer<typeof BatchCreateEntriesSchema>['entries'][number]

export interface PreparedBatchEntry {
    input: CreateEntryInput
    shareWithTeam: boolean
}

/**
 * Resolve workspace, project number, issue URL and anchors for one batch entry.
 * Mirrors the resolution performed by the single `create_entry` tool.
 */
async function prepareBatchEntry(
    e: BatchEntryInput,
    rootProjectNumber: number | undefined,
    context: ToolContext,
    rootWorkspaceId?: string
): Promise<PreparedBatchEntry> {
    if (e.workspace_id?.trim() === '*') {
        throw new ValidationError(
            "workspace_id '*' is a read-only wildcard and cannot be used for write operations. Specify a concrete workspace_id or project_number."
        )
    }

    const itemNamesOtherWorkspace =
        e.workspace_id !== undefined &&
        rootWorkspaceId !== undefined &&
        e.workspace_id.trim().toLowerCase() !== rootWorkspaceId.trim().toLowerCase()
    const requestedProject =
        e.project_number ?? (!itemNamesOtherWorkspace ? rootProjectNumber : undefined)
    const resolved = resolveProjectContext(
        {
            workspace_id: e.workspace_id,
            project_number: requestedProject,
            content: e.content,
            tags: e.tags,
        },
        context.config
    )
    const wsId = resolved.workspaceId
    // [INVARIANT] C3: only fall back to the requested (root) project when the item did not
    // name its own workspace; never pair a foreign project with an explicit workspace/'default'.
    const pNumber =
        resolved.projectNumber ?? (e.workspace_id === undefined ? requestedProject : undefined)

    if (pNumber === undefined || pNumber <= 0) {
        throw new Error(
            `project_number is required. Batch entry must be assigned to a valid project (failed to resolve project_number for workspace '${wsId}'). To find your project_number, read memory://agent-id via read_resource, call mj.core.listProjects(), or check memory://briefing/<project-name>.`
        )
    }

    const issueUrl = await resolveIssueUrl(context, pNumber, e.issue_number, e.issue_url)
    const resolvedAnchors = resolveEntryAnchors(e.anchors, e.auto_context, wsId, context)

    return {
        shareWithTeam: e.share_with_team,
        input: {
            content: e.content,
            entryType: e.entry_type,
            tags: e.tags,
            isPersonal: e.is_personal,
            significanceType: e.significance_type,
            autoContext: e.auto_context,
            projectNumber: pNumber,
            projectOwner: e.project_owner,
            issueNumber: e.issue_number,
            issueUrl,
            prNumber: e.pr_number,
            prUrl: e.pr_url,
            prStatus: e.pr_status,
            workflowRunId: e.workflow_run_id,
            workflowName: e.workflow_name,
            workflowStatus: e.workflow_status,
            impactScore: e.impact_score,
            trustScore: e.trust_score,
            validationStatus: e.validation_status,
            sessionId: e.session_id,
            workspaceId: wsId,
            ...(resolvedAnchors !== undefined ? { anchors: resolvedAnchors } : {}),
        },
    }
}

export async function prepareBatchCreateInputs(
    entries: BatchEntryInput[],
    rootProjectNumber: number | undefined,
    context: ToolContext,
    rootWorkspaceId?: string
): Promise<PreparedBatchEntry[]> {
    const prepared: PreparedBatchEntry[] = []
    for (const e of entries) {
        prepared.push(await prepareBatchEntry(e, rootProjectNumber, context, rootWorkspaceId))
    }
    return prepared
}

/**
 * Copy the entries flagged with `share_with_team` into the team database.
 * Returns warnings for entries that could not be shared.
 */
export function shareBatchEntriesWithTeam(
    context: ToolContext,
    prepared: PreparedBatchEntry[],
    createdIndexes: number[]
): { sharedCount: number; warnings: string[] } {
    const warnings: string[] = []
    let sharedCount = 0
    const { teamDb } = context
    const wanted = createdIndexes.filter((i) => prepared[i]?.shareWithTeam === true)
    if (wanted.length === 0) return { sharedCount, warnings }

    if (!teamDb) {
        warnings.push('share_with_team was requested but no team database is configured; entries were not shared.')
        return { sharedCount, warnings }
    }

    enforceAccessBoundary(
        'team_create_entry',
        'tool',
        { requiresTeamScope: true },
        context.config?.runtime?.auditLogger
    )
    const author = resolveAuthenticatedAuthor()
    if (author === '' || author === 'unknown') {
        warnings.push('share_with_team was requested but the author could not be resolved; entries were not shared.')
        return { sharedCount, warnings }
    }

    for (const i of wanted) {
        const entry = prepared[i]
        if (!entry) continue
        try {
            teamDb.createEntry({ ...entry.input, isPersonal: false, author })
            sharedCount++
        } catch (err) {
            logger.warning('Batch share_with_team failed for entry', {
                module: 'BatchTools',
                index: i,
                error: err instanceof Error ? err.message : String(err),
            })
            warnings.push(`Entry at index ${String(i)} could not be shared with team.`)
        }
    }
    if (sharedCount > 0) teamDb.flushSave()
    return { sharedCount, warnings }
}
