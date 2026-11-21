import type { z } from 'zod'
import type { CreateEntryInput, JournalEntry, ToolContext } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import { AuthorizationError, PermissionError } from '../../../types/errors.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { sendProgress, type ProgressContext } from '../../../utils/progress-utils.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { canonicalizeTeamAuthor, enforceTeamRbac, getCallerIdentity } from '../team/rbac.js'
import {
    TEAM_DB_ERROR_RESPONSE,
    assertCanonicalFallbackToolAllowed,
    executeTeamGetEntryById,
} from '../team/helpers.js'
import { probeMatchingTeamEntry } from '../search/helpers.js'
import { isDummyToolAllowedByFilter } from '../dummy-filter-helpers.js'
import { GetEntryByIdSchema, type CreateEntrySchema } from './schemas.js'
import { linkRequestedRelationships } from '../relationship-linking.js'
import { computeSuggestedLinks } from './link-suggestions.js'

type CreateEntryParams = z.infer<typeof CreateEntrySchema>
type GetEntryByIdParams = z.infer<typeof GetEntryByIdSchema>

function delegateTeamGetEntryById(
    input: GetEntryByIdParams,
    context: ToolContext
): Record<string, unknown> {
    assertCanonicalFallbackToolAllowed('team_get_entry_by_id', 'team', context, true)
    enforceAccessBoundary(
        'team_get_entry_by_id',
        'tool',
        { requiresTeamScope: true },
        context.config?.runtime?.auditLogger
    )
    if (!context.teamDb) {
        return { ...TEAM_DB_ERROR_RESPONSE }
    }
    const targetWs = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    enforceTeamRbac(context, getCallerIdentity(), 'viewer', targetWs)
    const teamRes = executeTeamGetEntryById(context, context.teamDb, {
        entry_id: input.entry_id,
        include_relationships: input.include_relationships,
        ...(input.project_number !== undefined ? { project_number: input.project_number } : {}),
        ...(input.workspace_id !== undefined ? { workspace_id: input.workspace_id } : {}),
    })
    const rawImp = teamRes['importance']
    if (
        typeof rawImp === 'object' &&
        rawImp !== null &&
        'score' in rawImp &&
        typeof rawImp.score === 'number'
    ) {
        teamRes['importance'] = rawImp.score
        if ('breakdown' in rawImp && rawImp.breakdown !== undefined) {
            teamRes['importanceBreakdown'] = rawImp.breakdown
        }
    }
    return teamRes
}

export function executeGetEntryById(params: unknown, context: ToolContext): unknown {
    const resourceFallback = tryResolveEntryResourceUri(params, context)
    if (resourceFallback !== undefined) return resourceFallback
    const input = GetEntryByIdSchema.parse(params)
    if (input.source === 'team') {
        return delegateTeamGetEntryById(input, context)
    }
    let wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
    const entry = context.db.getEntryById(input.entry_id, wsId)
    if (entry?.workspaceId !== undefined && (wsId === '*' || wsId === 'default')) {
        wsId = entry.workspaceId
    }
    if (
        !entry ||
        (input.project_number !== undefined && entry.projectNumber !== input.project_number)
    ) {
        const matchingTeamEntry =
            !entry &&
            probeMatchingTeamEntry(
                context,
                input.entry_id,
                wsId,
                input.project_number,
                'team_get_entry_by_id'
            )
        return {
            success: false,
            error: `Entry ${String(input.entry_id)} not found`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            suggestion: matchingTeamEntry
                ? `No personal entry #${String(input.entry_id)} was found in workspace '${wsId}', but team entry #${String(input.entry_id)} exists in the team database. Call team_get_entry_by_id (or mj.team.teamGetEntryById / mj.team.getEntryById) instead.`
                : 'Verify the entry ID exists and you have access to it',
            recoverable: true,
        }
    }

    const result: Record<string, unknown> = { success: true, entry }
    if (input.include_relationships) {
        result['relationships'] = context.db.getRelationships(input.entry_id, wsId)
    }
    const importance = context.db.calculateImportance(input.entry_id, wsId)
    if (importance !== null) {
        result['importance'] = importance.score
        result['importanceBreakdown'] = importance.breakdown
    }
    return result
}

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
    assertCanonicalFallbackToolAllowed('team_create_entry', 'team', context, false)
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
    if (
        context.config?.filterConfig !== undefined &&
        context.config.filterConfig !== null &&
        !isDummyToolAllowedByFilter(
            'read_resource',
            context.config.filterConfig,
            true,
            context.config.codemodeInternalFullAccess === true
        )
    ) {
        return Promise.resolve({
            success: false,
            error: "Tool 'read_resource' is disabled by the active --tool-filter configuration.",
            code: 'TOOL_DISABLED',
            category: 'authorization',
            suggestion: 'Update the active tool filter or use an enabled tool.',
            recoverable: false,
        })
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

function applyDeterministicAutoLinkCandidates(params: {
    db: IDatabaseAdapter
    createdEntryId: number
    candidateSuggestions: Awaited<ReturnType<typeof computeSuggestedLinks>>
    wsId: string
    projectNumber: number | undefined
    relationshipWarnings: string[]
}): number {
    const { db, createdEntryId, candidateSuggestions, wsId, projectNumber, relationshipWarnings } =
        params
    const autoTargets = candidateSuggestions
        .filter((s) => s.reason === 'same-session' || s.reason === 'shared-anchor')
        .slice(0, 2)
    if (autoTargets.length > 0) {
        relationshipWarnings.push(
            ...linkRequestedRelationships(
                db,
                createdEntryId,
                autoTargets.map((t) => ({ targetId: t.targetId, relationType: t.relationType })),
                wsId,
                projectNumber
            )
        )
    }
    return autoTargets.length
}

export interface ApplyAutoLinksParams {
    db: IDatabaseAdapter
    vectorManager?: VectorSearchManager | undefined
    createdEntry: JournalEntry
    wsId: string
    projectNumber: number | undefined
    sessionId: string | undefined
    relationshipWarnings: string[]
    tags?: readonly string[] | undefined
    hasExplicitRelationships?: boolean
}

/**
 * Deterministic same-session / shared-anchor auto-linking for `auto_link: true` entries
 * across batch and team entry-creation handlers.
 */
export async function applyAutoLinksForEntry(params: ApplyAutoLinksParams): Promise<number> {
    const {
        db,
        vectorManager,
        createdEntry,
        wsId,
        projectNumber,
        sessionId,
        relationshipWarnings,
        tags,
        hasExplicitRelationships = false,
    } = params
    if (hasExplicitRelationships || tags?.includes('commit-narrative') === true) {
        return 0
    }
    const candidates = await computeSuggestedLinks({
        db,
        vectorManager,
        entry: createdEntry,
        workspaceId: wsId,
        projectNumber,
        sessionId,
    })
    return applyDeterministicAutoLinkCandidates({
        db,
        createdEntryId: createdEntry.id,
        candidateSuggestions: candidates,
        wsId,
        projectNumber,
        relationshipWarnings,
    })
}

/**
 * Compute heuristic link suggestions and apply `auto_link` relationships for `create_entry`,
 * extracted so `executeCreateEntry` stays under the 80-line function budget (Appendix B).
 */
export async function resolveAndApplyCreateLinks(params: {
    context: ToolContext
    createdEntry: JournalEntry
    input: CreateEntryParams
    wsId: string
    projectNumber: number
    relationshipWarnings: string[]
}): Promise<Awaited<ReturnType<typeof computeSuggestedLinks>>> {
    const { context, createdEntry, input, wsId, projectNumber, relationshipWarnings } = params
    const candidateSuggestions =
        (!input.relationships || input.relationships.length === 0) &&
        !input.tags?.includes('commit-narrative')
            ? await computeSuggestedLinks({
                  db: context.db,
                  vectorManager: context.vectorManager,
                  entry: createdEntry,
                  workspaceId: wsId,
                  projectNumber,
                  sessionId: input.session_id,
              })
            : []
    const linked =
        input.auto_link === true
            ? applyDeterministicAutoLinkCandidates({
                  db: context.db,
                  createdEntryId: createdEntry.id,
                  candidateSuggestions,
                  wsId,
                  projectNumber,
                  relationshipWarnings,
              })
            : 0
    return linked > 0 ? [] : candidateSuggestions
}
