import type { z } from 'zod'
import type { CreateEntryInput, ToolContext } from '../../../types/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import type { CreateEntrySchema } from './schemas.js'

type CreateEntryParams = z.infer<typeof CreateEntrySchema>

type EntryAnchors = CreateEntryInput['anchors']

/** Fields resolved by the handler before the entry is written. */
export interface ResolvedEntryFields {
    projectNumber: number
    workspaceId: string
    issueUrl: string | undefined
    anchors: EntryAnchors
}

/** Build the adapter input for `create_entry` from the parsed params and resolved fields. */
export function buildCreateEntryInput(
    input: CreateEntryParams,
    resolved: ResolvedEntryFields
): CreateEntryInput {
    return {
        content: input.content,
        entryType: input.entry_type,
        tags: input.tags,
        isPersonal: input.is_personal,
        significanceType: input.significance_type,
        projectNumber: resolved.projectNumber,
        projectOwner: input.project_owner,
        issueNumber: input.issue_number,
        issueUrl: resolved.issueUrl,
        prNumber: input.pr_number,
        prUrl: input.pr_url,
        prStatus: input.pr_status,
        workflowRunId: input.workflow_run_id,
        workflowName: input.workflow_name,
        workflowStatus: input.workflow_status as 'queued' | 'in_progress' | 'completed' | undefined,
        autoContext: input.auto_context,
        workspaceId: resolved.workspaceId,
        impactScore: input.impact_score,
        trustScore: input.trust_score,
        validationStatus: input.validation_status,
        sessionId: input.session_id,
        ...(resolved.anchors !== undefined ? { anchors: resolved.anchors } : {}),
    }
}

/**
 * Copy a freshly created entry into the team database when `share_with_team` is set.
 * Returns the author when the entry was shared, otherwise `undefined`.
 */
export function shareCreatedEntryWithTeam(
    context: ToolContext,
    entryInput: CreateEntryInput
): string | undefined {
    const { teamDb } = context
    if (!teamDb) return undefined
    enforceAccessBoundary(
        'team_create_entry',
        'tool',
        { requiresTeamScope: true },
        context.config?.runtime?.auditLogger
    )
    const author = resolveAuthenticatedAuthor()
    if (!author || author === 'unknown') return undefined

    teamDb.createEntry({ ...entryInput, isPersonal: false, author })
    teamDb.flushSave()
    return author
}
