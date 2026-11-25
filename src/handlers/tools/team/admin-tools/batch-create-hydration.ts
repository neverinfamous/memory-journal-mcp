/**
 * Team Batch Create Hydration Helpers (M12 / Appendix A)
 *
 * Pre-fetches commit anchors and resolves GitHub issue URLs for `team_batch_create_entries`,
 * matching the personal `batch_create_entries` pipeline without growing `batch-create-helpers.ts`.
 */

import type { z } from 'zod'
import type { ToolContext } from '../../../../types/index.js'
import { resolveIssueUrl } from '../../../../utils/github-helpers.js'
import { prefetchBatchCommitFiles, resolveEntryAnchors } from '../../core/staleness-tools.js'
import type { TeamBatchCreateEntriesSchema } from '../schemas.js'
import type { TeamDbInstance } from './batch-delete-helpers.js'

type TeamBatchCreateItem = z.infer<typeof TeamBatchCreateEntriesSchema>['entries'][number]

export interface ResolvedTeamBatchCreateItem {
    e: TeamBatchCreateItem
    author: string
    projectNumber: number
    workspaceId: string
}

const TEAM_HYDRATE_CONCURRENCY = 8

async function hydrateSingleTeamEntry(
    item: ResolvedTeamBatchCreateItem,
    context: ToolContext,
    prefetchedCommitFiles: Awaited<ReturnType<typeof prefetchBatchCommitFiles>>
): Promise<Parameters<TeamDbInstance['createEntries']>[0][number]> {
    const { e, author, projectNumber, workspaceId } = item
    const resolvedIssueUrl = await resolveIssueUrl(
        context,
        projectNumber,
        e.issue_number,
        e.issue_url,
        workspaceId
    )
    const resolvedAnchors = await resolveEntryAnchors(
        e.anchors,
        e.auto_context,
        workspaceId,
        context,
        prefetchedCommitFiles
    )
    return {
        content: e.content,
        entryType: e.entry_type,
        tags: e.tags,
        significanceType: e.significance_type,
        autoContext: e.auto_context,
        projectNumber,
        projectOwner: e.project_owner,
        issueNumber: e.issue_number,
        issueUrl: resolvedIssueUrl,
        prNumber: e.pr_number,
        prUrl: e.pr_url,
        prStatus: e.pr_status,
        workflowRunId: e.workflow_run_id,
        workflowName: e.workflow_name,
        workflowStatus: e.workflow_status,
        isPersonal: false,
        author,
        impactScore: e.impact_score,
        trustScore: e.trust_score,
        validationStatus: e.validation_status,
        sessionId: e.session_id,
        workspaceId,
        ...(resolvedAnchors !== undefined ? { anchors: resolvedAnchors } : {}),
    }
}

/** Hydrate `issueUrl` and commit/explicit `anchors` for every validated team batch item. */
export async function buildTeamBatchCreateInputs(
    resolvedEntries: ResolvedTeamBatchCreateItem[],
    context: ToolContext
): Promise<Parameters<TeamDbInstance['createEntries']>[0]> {
    if (resolvedEntries.length === 0) return []
    const prefetchedCommitFiles = await prefetchBatchCommitFiles(
        resolvedEntries.map((item) => ({
            autoContext: item.e.auto_context,
            workspaceId: item.workspaceId,
        })),
        context
    )

    const chunks: ResolvedTeamBatchCreateItem[][] = []
    for (let i = 0; i < resolvedEntries.length; i += TEAM_HYDRATE_CONCURRENCY) {
        chunks.push(resolvedEntries.slice(i, i + TEAM_HYDRATE_CONCURRENCY))
    }
    return chunks.reduce<Promise<Parameters<TeamDbInstance['createEntries']>[0]>>(
        async (chain, chunk) => {
            const outputs = await chain
            const settled = await Promise.allSettled(
                chunk.map((item) => hydrateSingleTeamEntry(item, context, prefetchedCommitFiles))
            )
            for (const outcome of settled) {
                if (outcome.status === 'rejected') {
                    throw outcome.reason
                }
                outputs.push(outcome.value)
            }
            return outputs
        },
        Promise.resolve([])
    )
}
