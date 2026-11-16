import type { z } from 'zod'
import type { CreateEntryInput, JournalEntry, ToolContext } from '../../../types/index.js'
import { AuthorizationError, PermissionError } from '../../../types/errors.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { sendProgress, type ProgressContext } from '../../../utils/progress-utils.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { canonicalizeTeamAuthor, enforceTeamRbac } from '../team/rbac.js'
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
        workflowStatus: input.workflow_status,
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
 * Returns the author and created team entry when shared, otherwise `undefined`.
 */
export function shareCreatedEntryWithTeam(
    context: ToolContext,
    entryInput: CreateEntryInput
): { author: string; entry: JournalEntry } | undefined {
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
    enforceTeamRbac(context, author, 'member', entryInput.workspaceId)
    const canonicalAuthor = canonicalizeTeamAuthor(teamDb, author, entryInput.workspaceId)

    const entry = teamDb.createEntry({ ...entryInput, isPersonal: false, author: canonicalAuthor })
    teamDb.flushSave()
    return { author: canonicalAuthor, entry }
}

/** Generate embeddings for a newly created entry, returning any soft-fail warning. */
export async function indexCreatedEntry(
    context: ToolContext,
    progress: ProgressContext | undefined,
    createdEntry: JournalEntry
): Promise<string | undefined> {
    if (!context.vectorManager) {
        await sendProgress(progress, 2, 2, 'Entry created successfully')
        return undefined
    }
    try {
        await sendProgress(progress, 1, 2, 'Generating embeddings...')
        await context.vectorManager.addEntry(createdEntry)
        await sendProgress(progress, 2, 2, 'Entry created successfully')
        return undefined
    } catch (e) {
        // Soft fail: continue notifications & team share, attach vector indexing warning
        await sendProgress(progress, 2, 2, 'Entry created (Vector indexing disabled)')
        return `Vector indexing failed: ${e instanceof Error ? e.message : String(e)}`
    }
}

/** Execute optional team sharing after personal entry creation, recording warnings rather than throwing. */
export async function recordTeamShareOutcome(
    context: ToolContext,
    entryInput: CreateEntryInput,
    relationshipWarnings: string[]
): Promise<{ sharedWithTeam: boolean; author?: string }> {
    if (!context.teamDb) {
        relationshipWarnings.push(
            'Team sharing skipped: team database is not configured (set TEAM_DB_PATH).'
        )
        return { sharedWithTeam: false }
    }
    // [INVARIANT] M5: the personal entry is already committed; a team-share or team-vector
    // failure must surface as a warning, not fail (or silently drop) the create.
    let shared: { author: string; entry: JournalEntry } | undefined
    try {
        shared = shareCreatedEntryWithTeam(context, entryInput)
    } catch (shareErr) {
        relationshipWarnings.push(
            `Team sharing failed: ${shareErr instanceof Error ? shareErr.message : String(shareErr)}`
        )
        return { sharedWithTeam: false }
    }
    if (shared === undefined) {
        relationshipWarnings.push(
            'Team sharing skipped: author identity could not be resolved (set TEAM_AUTHOR or enable OAuth).'
        )
        return { sharedWithTeam: false }
    }
    if (context.teamVectorManager !== undefined) {
        try {
            await context.teamVectorManager.addEntry(shared.entry)
        } catch (vecErr) {
            relationshipWarnings.push(
                `Team vector indexing failed: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`
            )
        }
    }
    return { sharedWithTeam: true, author: shared.author }
}

/**
 * [INTENT] Autonomous healing when an agent passes a non-entry MCP resource URI
 * (e.g. `memory://briefing/memory-journal-mcp`) to `get_entry_by_id` inside Code Mode.
 */
export function tryResolveEntryResourceUri(
    params: unknown,
    context: ToolContext
): Promise<unknown> | undefined {
    if (context.config?.agentHealing === false || typeof params !== 'object' || params === null) {
        return undefined
    }
    const obj = params as Record<string, unknown>
    if (obj['entry_id'] !== undefined || typeof obj['uri'] !== 'string') return undefined
    const uri = obj['uri'].trim()
    if (!uri.startsWith('memory://') || /^memory:\/\/(?:entries|entry)\/\d+$/i.test(uri)) {
        return undefined
    }
    return (async (): Promise<unknown> => {
        try {
            const { readResource } = await import('../../resources/index.js')
            const res = await readResource(
                uri,
                context.db,
                context.vectorManager,
                context.config?.filterConfig,
                context.github,
                undefined,
                context.teamDb,
                context.config?.briefingConfig,
                context.config?.runtime
            )
            return {
                success: true,
                data: res.data,
                _healing_note: `🛠️ AUTONOMOUS HEALING: 'get_entry_by_id' was called with an MCP resource URI instead of an entry_id. The resource '${uri}' was resolved successfully.`,
            }
        } catch (err) {
            if (err instanceof AuthorizationError || err instanceof PermissionError) {
                throw err
            }
            return {
                success: false,
                error: `Failed to read resource '${uri}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'RESOURCE_ERROR',
                category: 'resource',
                recoverable: true,
            }
        }
    })()
}
