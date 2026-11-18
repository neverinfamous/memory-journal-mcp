import type { z } from 'zod'
import type { CreateEntryInput, ToolContext } from '../../../types/index.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { resolveIssueUrl } from '../../../utils/github-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import { PermissionError, ValidationError } from '../../../types/errors.js'
import { canonicalizeTeamAuthor, enforceTeamRbac } from '../team/rbac.js'
import { logger } from '../../../utils/logger.js'
import { prefetchBatchCommitFiles, resolveEntryAnchors } from '../core/staleness-tools.js'
import type { BatchCreateEntriesSchema } from './schemas.js'

type BatchEntryInput = z.infer<typeof BatchCreateEntriesSchema>['entries'][number]
const BATCH_ENTRY_CONCURRENCY = 8

export interface PreparedBatchEntry {
    input: CreateEntryInput
    shareWithTeam: boolean
}

interface ResolvedBatchScope {
    e: BatchEntryInput
    wsId: string
    pNumber: number
}

function resolveBatchEntryScope(
    e: BatchEntryInput,
    rootProjectNumber: number | undefined,
    context: ToolContext,
    rootWorkspaceId?: string
): ResolvedBatchScope {
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
            `project_number is required. Batch entry must be assigned to a valid project (failed to resolve project_number for workspace '${wsId}'). To find your project_number, read memory://agent-context/<repo> via read_resource, call mj.core.listProjects(), or check memory://briefing/<project-name>.`
        )
    }
    return { e, wsId, pNumber }
}

/**
 * Resolve issue URL and anchors for one validated batch entry scope.
 * Mirrors the resolution performed by the single `create_entry` tool.
 */
async function hydratePreparedBatchEntry(
    scoped: ResolvedBatchScope,
    context: ToolContext,
    prefetchedCommitFiles?: ReadonlyMap<string, string[]>
): Promise<PreparedBatchEntry> {
    const { e, wsId, pNumber } = scoped
    const issueUrl = await resolveIssueUrl(context, pNumber, e.issue_number, e.issue_url, wsId)
    const resolvedAnchors = await resolveEntryAnchors(
        e.anchors,
        e.auto_context,
        wsId,
        context,
        prefetchedCommitFiles
    )

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
    if (entries.length === 0) return []
    const scopedEntries = entries.map((e) =>
        resolveBatchEntryScope(e, rootProjectNumber, context, rootWorkspaceId)
    )
    const prefetchedCommitFiles = await prefetchBatchCommitFiles(
        scopedEntries.map((item) => ({
            autoContext: item.e.auto_context,
            workspaceId: item.wsId,
        })),
        context
    )

    const prepared: PreparedBatchEntry[] = []
    for (let i = 0; i < scopedEntries.length; i += BATCH_ENTRY_CONCURRENCY) {
        const chunk = scopedEntries.slice(i, i + BATCH_ENTRY_CONCURRENCY)
        const outcomes = await Promise.allSettled(
            chunk.map((item) => hydratePreparedBatchEntry(item, context, prefetchedCommitFiles))
        )
        for (const outcome of outcomes) {
            if (outcome.status === 'rejected') {
                throw outcome.reason
            }
            prepared.push(outcome.value)
        }
    }
    return prepared
}

/**
 * Copy the entries flagged with `share_with_team` into the team database and
 * index them in `teamVectorManager` when configured. Returns warnings for failures.
 */
export async function shareBatchEntriesWithTeam(
    context: ToolContext,
    prepared: PreparedBatchEntry[],
    createdIndexes: number[]
): Promise<{ sharedCount: number; warnings: string[] }> {
    const warnings: string[] = []
    let sharedCount = 0
    const { teamDb, teamVectorManager } = context
    const wanted = createdIndexes.filter((i) => prepared[i]?.shareWithTeam === true)
    if (wanted.length === 0) return { sharedCount, warnings }

    if (!teamDb) {
        warnings.push('share_with_team was requested but no team database is configured; entries were not shared.')
        return { sharedCount, warnings }
    }

    try {
        enforceAccessBoundary(
            'team_create_entry',
            'tool',
            { requiresTeamScope: true },
            context.config?.runtime?.auditLogger
        )
    } catch (err) {
        if (err instanceof PermissionError) {
            warnings.push(`share_with_team skipped: ${err.message}`)
            return { sharedCount, warnings }
        }
        throw err
    }
    const author = resolveAuthenticatedAuthor()
    if (author === '' || author === 'unknown') {
        warnings.push('share_with_team was requested but the author could not be resolved; entries were not shared.')
        return { sharedCount, warnings }
    }

    const sharedEntries: ReturnType<typeof teamDb.createEntry>[] = []
    const rbacVerifiedWs = new Set<string>()
    const canonicalAuthorByWs = new Map<string, string>()

    const insertShared = (): void => {
        for (const i of wanted) {
            const entry = prepared[i]
            if (!entry) continue
            if (
                tryInsertBatchSharedEntry(
                    context,
                    teamDb,
                    author,
                    entry,
                    i,
                    rbacVerifiedWs,
                    canonicalAuthorByWs,
                    sharedEntries,
                    warnings
                )
            ) {
                sharedCount++
            }
        }
    }

    if (typeof teamDb.executeInTransaction === 'function') {
        teamDb.executeInTransaction(insertShared)
    } else {
        insertShared()
    }
    if (sharedCount > 0) teamDb.flushSave()
    if (teamVectorManager !== undefined && sharedEntries.length > 0) {
        await indexSharedTeamVectors(teamVectorManager, sharedEntries, warnings)
    }
    return { sharedCount, warnings }
}

function tryInsertBatchSharedEntry(
    context: ToolContext,
    teamDb: NonNullable<ToolContext['teamDb']>,
    author: string,
    entry: PreparedBatchEntry,
    index: number,
    rbacVerifiedWs: Set<string>,
    canonicalAuthorByWs: Map<string, string>,
    sharedEntries: ReturnType<NonNullable<ToolContext['teamDb']>['createEntry']>[],
    warnings: string[]
): boolean {
    try {
        const wsKey = entry.input.workspaceId ?? 'default'
        if (!rbacVerifiedWs.has(wsKey)) {
            enforceTeamRbac(context, author, 'member', entry.input.workspaceId)
            rbacVerifiedWs.add(wsKey)
        }
        let canonicalAuthor = canonicalAuthorByWs.get(wsKey)
        if (canonicalAuthor === undefined) {
            canonicalAuthor = canonicalizeTeamAuthor(teamDb, author, entry.input.workspaceId)
            canonicalAuthorByWs.set(wsKey, canonicalAuthor)
        }
        const teamEntry = teamDb.createEntry({
            ...entry.input,
            isPersonal: false,
            author: canonicalAuthor,
        })
        sharedEntries.push(teamEntry)
        return true
    } catch (err) {
        logger.warning('Batch share_with_team failed for entry', {
            module: 'BatchTools',
            index,
            error: err instanceof Error ? err.message : String(err),
        })
        const errMsg = err instanceof Error ? err.message : String(err)
        warnings.push(`Entry at index ${String(index)} could not be shared with team: ${errMsg}`)
        return false
    }
}

async function indexSharedTeamVectors(
    teamVectorManager: NonNullable<ToolContext['teamVectorManager']>,
    sharedEntries: ReturnType<NonNullable<ToolContext['teamDb']>['createEntry']>[],
    warnings: string[]
): Promise<void> {
    if (sharedEntries.length > 1 && typeof teamVectorManager.addEntries === 'function') {
        try {
            await teamVectorManager.addEntries(sharedEntries)
            return
        } catch {
            // Fall back per entry below for exact per-entry warning isolation.
        }
    }
    for (const teamEntry of sharedEntries) {
        try {
            await teamVectorManager.addEntry(teamEntry)
        } catch (vecErr) {
            warnings.push(
                `Team vector indexing failed for shared entry ${String(teamEntry.id)}: ${vecErr instanceof Error ? vecErr.message : String(vecErr)}`
            )
        }
    }
}
