/**
 * Team Admin Batch Create Helpers
 *
 * Author/RBAC validation and batch creation workflow for `team_create_entry`
 * and `team_batch_create_entries`.
 */

import type { z } from 'zod'
import type { ToolContext, ToolHandlerConfig } from '../../../../types/index.js'
import { sanitizeAuthor } from '../../../../utils/security-utils.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../../../../utils/workspace-resolver.js'
import { activeProjectRegistry, pairStoredScope } from '../../../../utils/write-scope.js'
import { sendProgress } from '../../../../utils/progress-utils.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../../batch-indexing.js'
import { linkRequestedRelationships } from '../../relationship-linking.js'
import { applyAutoLinksForEntry } from '../../core/create-entry-helpers.js'
import { resolveWriteWorkspaceId } from '../../write-workspace.js'
import { assertCanonicalFallbackToolAllowed, triggerTeamNotifications } from '../helpers.js'
import type { TeamBatchCreateEntriesSchema } from '../schemas.js'
import type { TeamDbInstance } from './batch-delete-helpers.js'
import { runTeamBatchTx } from './batch-prefetch-helpers.js'
import {
    buildTeamBatchCreateInputs,
    type ResolvedTeamBatchCreateItem,
} from './batch-create-hydration.js'

type TeamBatchCreateInput = z.infer<typeof TeamBatchCreateEntriesSchema>
type TeamBatchCreateItem = TeamBatchCreateInput['entries'][number]

import { resolveTeamCreateAuthor } from './create-author-helper.js'

export { resolveTeamCreateAuthor }

type ResolvedBatchCreateItem = ResolvedTeamBatchCreateItem

function resolveBatchItemProjectNumber(
    namedWorkspace: string | undefined,
    effectiveProject: number | undefined,
    config: ToolHandlerConfig | undefined
): number | undefined {
    const callerWorkspace =
        namedWorkspace !== undefined && namedWorkspace.trim() !== '*'
            ? namedWorkspace
            : undefined
    const callerRegistry = activeProjectRegistry(config?.projectRegistry)
    const canonicalCaller =
        callerWorkspace !== undefined
            ? (findCanonicalRegistryKey(callerWorkspace, callerRegistry) ?? callerWorkspace)
            : undefined
    return (
        effectiveProject ??
        (canonicalCaller !== undefined ? callerRegistry?.[canonicalCaller]?.project_number : undefined)
    )
}

function validateRootBatchScope(
    input: TeamBatchCreateInput,
    config: ToolHandlerConfig | undefined
): { errorResponse: Record<string, unknown> } | undefined {
    if (input.workspace_id?.trim() === '*') {
        return {
            errorResponse: {
                success: false,
                error: "workspace_id '*' is a read-only wildcard and cannot be used to create team entries.",
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion: 'Pass a concrete workspace_id or a project_number.',
                recoverable: true,
            },
        }
    }
    if (input.workspace_id !== undefined && input.project_number !== undefined) {
        const registry = activeProjectRegistry(config?.projectRegistry)
        const explicitDefault = input.workspace_id.trim().toLowerCase() === 'default'
        const resolved = resolveProjectContext(
            { workspace_id: input.workspace_id, project_number: input.project_number },
            config
        )
        const rootWs = resolveWriteWorkspaceId(
            explicitDefault
                ? 'default'
                : resolved.workspaceId !== 'default'
                  ? resolved.workspaceId
                  : input.workspace_id,
            input.project_number,
            config
        )
        pairStoredScope(rootWs, input.project_number, registry)
    }
    return undefined
}

function validateTeamBatchCreateEntries(
    input: TeamBatchCreateInput,
    teamDb: TeamDbInstance,
    config: ToolHandlerConfig | undefined
): { errorResponse: Record<string, unknown> } | { resolvedEntries: ResolvedBatchCreateItem[] } {
    const rootError = validateRootBatchScope(input, config)
    if (rootError !== undefined) return rootError

    const registry = activeProjectRegistry(config?.projectRegistry)
    const authorCache = new Map<string, ReturnType<typeof resolveTeamCreateAuthor>>()
    const resolvedEntries: ResolvedBatchCreateItem[] = []
    for (const e of input.entries) {
        if (e.workspace_id?.trim() === '*') {
            return {
                errorResponse: {
                    success: false,
                    error: "workspace_id '*' is a read-only wildcard and cannot be used to create team entries.",
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Pass a concrete workspace_id or a project_number.',
                    recoverable: true,
                },
            }
        }
        const namedWorkspace = e.workspace_id ?? input.workspace_id
        const itemNamesOtherWorkspace =
            e.workspace_id !== undefined &&
            input.workspace_id !== undefined &&
            e.workspace_id.trim().toLowerCase() !== input.workspace_id.trim().toLowerCase()
        const effectiveProject =
            e.project_number ?? (!itemNamesOtherWorkspace ? input.project_number : undefined)
        const resolved = resolveProjectContext(
            { workspace_id: namedWorkspace, project_number: effectiveProject },
            config
        )
        const projectNumber = resolveBatchItemProjectNumber(namedWorkspace, effectiveProject, config)
        if (projectNumber === undefined || projectNumber === null) {
            return {
                errorResponse: {
                    success: false,
                    error: 'Missing project_number. Each entry in the batch MUST provide a valid project_number or name a registered workspace.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    suggestion: 'Specify the project_number for every entry, or name a registered workspace whose project is already known.',
                    recoverable: true,
                },
            }
        }
        const explicitDefault = namedWorkspace?.trim().toLowerCase() === 'default'
        const workspaceId = resolveWriteWorkspaceId(
            explicitDefault ? 'default' : resolved.workspaceId !== 'default' ? resolved.workspaceId : namedWorkspace,
            projectNumber,
            config
        )
        const paired = pairStoredScope(workspaceId, projectNumber, registry)
        const targetWorkspaceId = paired.workspaceId ?? workspaceId
        const authorCacheKey = `${e.author ?? ''}\0${targetWorkspaceId}`
        let authorResult = authorCache.get(authorCacheKey)
        if (authorResult === undefined) {
            authorResult = resolveTeamCreateAuthor(e.author, teamDb, config, targetWorkspaceId)
            authorCache.set(authorCacheKey, authorResult)
        }
        if ('errorResponse' in authorResult) return authorResult

        resolvedEntries.push({
            e,
            author: authorResult.author,
            projectNumber: paired.projectNumber ?? projectNumber,
            workspaceId: targetWorkspaceId,
        })
    }
    return { resolvedEntries }
}

function linkBatchCreatedRelationships(
    teamDb: TeamDbInstance,
    results: ReturnType<TeamDbInstance['createEntries']>['created'],
    createdSourceIndices: number[],
    rawEntries: TeamBatchCreateItem[],
    inputs: Parameters<TeamDbInstance['createEntries']>[0]
): string[] {
    const relationshipWarnings: string[] = []
    for (let i = 0; i < results.length; i++) {
        const createdEntry = results[i]
        const sourceIdx = createdSourceIndices[i] ?? i
        if (createdEntry) {
            relationshipWarnings.push(
                ...linkRequestedRelationships(
                    teamDb,
                    createdEntry.id,
                    rawEntries[sourceIdx]?.relationships,
                    inputs[sourceIdx]?.workspaceId,
                    inputs[sourceIdx]?.projectNumber
                )
            )
        }
    }
    return relationshipWarnings
}

function assertTeamBatchCreateLinksAllowed(
    context: ToolContext,
    entries: TeamBatchCreateInput['entries']
): void {
    const requestsLinking = entries.some(
        (e) => (e.relationships !== undefined && e.relationships.length > 0) || e.auto_link === true
    )
    if (requestsLinking) {
        assertCanonicalFallbackToolAllowed('team_link_entries', 'team', context, false)
    }
}

async function applyTeamBatchAutoLinks(
    context: ToolContext,
    teamDb: TeamDbInstance,
    results: ReturnType<TeamDbInstance['createEntries']>['created'],
    createdSourceIndices: number[],
    rawEntries: TeamBatchCreateItem[],
    inputs: Parameters<TeamDbInstance['createEntries']>[0],
    relationshipWarnings: string[]
): Promise<void> {
    let linked = 0
    for (let i = 0; i < results.length; i++) {
        const createdEntry = results[i]
        const sourceIdx = createdSourceIndices[i] ?? i
        const rawEntry = rawEntries[sourceIdx]
        if (!createdEntry || rawEntry?.auto_link !== true) continue
        linked += await applyAutoLinksForEntry({
            db: teamDb,
            vectorManager: context.teamVectorManager,
            createdEntry,
            wsId: inputs[sourceIdx]?.workspaceId ?? 'default',
            projectNumber: inputs[sourceIdx]?.projectNumber,
            sessionId: rawEntry.session_id,
            relationshipWarnings,
            tags: rawEntry.tags,
            hasExplicitRelationships:
                rawEntry.relationships !== undefined && rawEntry.relationships.length > 0,
        })
    }
    if (linked > 0) teamDb.flushSave()
}

/** Validate and execute `team_batch_create_entries` with shallow control flow. */
export async function executeTeamBatchCreate(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchCreateInput
): Promise<Record<string, unknown>> {
    await sendProgress(context.progress, 0, 2, 'Creating team entries...')
    const validation = validateTeamBatchCreateEntries(input, teamDb, context.config)
    if ('errorResponse' in validation) return validation.errorResponse
    assertTeamBatchCreateLinksAllowed(context, input.entries)

    const inputs = await buildTeamBatchCreateInputs(validation.resolvedEntries, context)
    const { created: results, errors } = teamDb.createEntries(inputs)
    const failedIndices = new Set(errors.map((err) => err.index))
    const createdSourceIndices = inputs.flatMap((_, idx) => (failedIndices.has(idx) ? [] : [idx]))

    const relationshipWarnings = runTeamBatchTx(teamDb, () =>
        linkBatchCreatedRelationships(teamDb, results, createdSourceIndices, input.entries, inputs)
    )
    await applyTeamBatchAutoLinks(
        context,
        teamDb,
        results,
        createdSourceIndices,
        input.entries,
        inputs,
        relationshipWarnings
    )
    const entries = results.map((r, i) => {
        const rawAuthor = inputs[createdSourceIndices[i] ?? i]?.author
        return {
            ...r,
            author: rawAuthor !== undefined ? sanitizeAuthor(rawAuthor) : undefined,
        }
    })
    await sendProgress(context.progress, 1, 2, `Created ${String(entries.length)} team entries...`)

    const { indexStatuses, indexErrors } = await indexBatchEntries({
        progress: context.progress,
        vectorManager: context.teamVectorManager,
        db: teamDb,
        autoIndex: input.auto_index,
        entryIds: entries.map((e) => e.id),
        entries,
        errorPrefix: 'Team entry',
        doneMessage: 'Team batch create complete',
        workspaceByEntryId: collectIndexWorkspaces(entries),
    })

    const allErrors = [
        ...errors.map((e) => new Error(`Item at index ${e.index} failed: ${e.error.message}`)),
        ...indexErrors,
    ]
    if (allErrors.length > 0) {
        throw new AggregateError(
            allErrors,
            `Team batch create partially failed: ${allErrors.length} operations failed`
        )
    }

    triggerTeamNotifications(context)
    const failedVectorCount = indexStatuses.filter((s) => s === 'failed').length
    const warnings: string[] = [
        ...(failedVectorCount > 0
            ? [`Vector indexing failed for ${String(failedVectorCount)} team entry(ies).`]
            : []),
        ...relationshipWarnings,
    ]

    return {
        success: true,
        count: entries.length,
        entries,
        indexStatuses,
        ...(relationshipWarnings.length > 0 ? { relationshipWarnings } : {}),
        ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
    }
}
