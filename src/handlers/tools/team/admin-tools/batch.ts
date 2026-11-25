/**
 * Team Admin Batch Tools - 3 tools
 *
 * Tools: team_batch_create_entries, team_batch_update_entries, team_batch_delete_entries
 */

import type { z } from 'zod'
import type { JournalEntry, ToolDefinition, ToolContext } from '../../../../types/index.js'
import { formatHandlerError } from '../../../../utils/error-helpers.js'
import { resolveAuthenticatedAuthor } from '../../../../utils/security-utils.js'
import { TEAM_DB_ERROR_RESPONSE, fetchAuthor, batchFetchAuthors, triggerTeamNotifications } from '../helpers.js'
import { executeTeamBatchCreate } from './batch-create-helpers.js'
import {
    buildValidatedTeamBatchUpdates,
    executeTeamBatchDelete,
    type TeamDbInstance,
} from './batch-delete-helpers.js'
import {
    TeamBatchCreateEntriesSchema,
    TeamBatchCreateEntriesSchemaMcp,
    TeamBatchCreateEntriesOutputSchema,
    TeamBatchUpdateEntriesSchema,
    TeamBatchUpdateEntriesSchemaMcp,
    TeamBatchUpdateEntriesOutputSchema,
    TeamBatchDeleteEntriesSchema,
    TeamBatchDeleteEntriesSchemaMcp,
    TeamBatchDeleteEntriesOutputSchema,
} from '../schemas.js'
import { sendProgress } from '../../../../utils/progress-utils.js'
import { collectIndexWorkspaces, indexBatchEntries } from '../../batch-indexing.js'

type TeamBatchUpdateInput = z.infer<typeof TeamBatchUpdateEntriesSchema>

async function indexUpdatedTeamBatchEntries(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchUpdateInput,
    entries: JournalEntry[]
): ReturnType<typeof indexBatchEntries> {
    const vectorUpdatedIds = new Set(
        input.updates
            .filter(
                (u) =>
                    u.content !== undefined ||
                    u.tags !== undefined ||
                    u.entry_type !== undefined
            )
            .map((u) => u.entry_id)
    )
    return indexBatchEntries({
        progress: context.progress,
        vectorManager: context.teamVectorManager,
        db: teamDb,
        autoIndex: input.auto_index,
        entryIds: entries.map((e) => e.id),
        entries,
        errorPrefix: 'Team entry',
        doneMessage: 'Team batch update complete',
        shouldIndex: (id) => vectorUpdatedIds.has(id),
        workspaceByEntryId: collectIndexWorkspaces(entries),
    })
}

async function executeTeamBatchUpdate(
    context: ToolContext,
    teamDb: TeamDbInstance,
    input: TeamBatchUpdateInput
): Promise<Record<string, unknown>> {
    const currentUser = resolveAuthenticatedAuthor()
    const updateIds = input.updates.map((u) => u.entry_id)
    const preFetchedAuthors =
        typeof teamDb.getAuthorsForEntries === 'function'
            ? batchFetchAuthors(teamDb, updateIds)
            : null

    const validated = buildValidatedTeamBatchUpdates(
        teamDb,
        input.updates,
        input.workspace_id,
        input.project_number,
        context,
        currentUser,
        preFetchedAuthors
    )
    if ('errorResponse' in validated) return validated.errorResponse
    const { updates, notFound } = validated
    await sendProgress(context.progress, 0, 2, 'Updating team entries...')

    const { updated, notFound: updateNotFound, errors } = teamDb.updateEntries(updates)
    const entries = updated.map((r) => ({
        ...r,
        author: preFetchedAuthors
            ? (preFetchedAuthors.get(r.id) ?? null)
            : fetchAuthor(teamDb, r.id),
    }))
    await sendProgress(context.progress, 1, 2, `Updated ${String(entries.length)} team entries...`)

    const { indexStatuses, indexErrors } = await indexUpdatedTeamBatchEntries(
        context,
        teamDb,
        input,
        entries
    )
    const finalNotFound = [...notFound, ...updateNotFound]
    const allErrors = [
        ...finalNotFound.map((id) => new Error(`Team entry ${id} not found`)),
        ...errors.map((e) => new Error(`Team entry ${e.id} failed to update: ${e.error.message}`)),
        ...indexErrors,
    ]
    if (entries.length > 0) {
        triggerTeamNotifications(context)
    }
    if (allErrors.length > 0) {
        throw new AggregateError(
            allErrors,
            `Team batch update partially failed: ${allErrors.length} operations failed`
        )
    }

    const failedUpdateVectors = indexStatuses.filter((s) => s === 'failed').length
    return {
        success: true,
        count: entries.length,
        updated: entries,
        notFound: finalNotFound,
        indexStatuses,
        ...(failedUpdateVectors > 0
            ? { warning: `Vector indexing failed for ${String(failedUpdateVectors)} team entry(ies).` }
            : {}),
    }
}

// ============================================================================
// Tool Definitions
// ============================================================================

export function getTeamAdminBatchTools(context: ToolContext): ToolDefinition[] {
    const { teamDb } = context

    return [
        {
            name: 'team_batch_create_entries',
            title: 'Team Batch Create Entries',
            description: 'Create multiple team journal entries at once. Max 50 per batch. Select the most accurate entry_type for each. REQUIRED: You MUST include project_number. REQUIRED: You MUST include impact_score, trust_score, and validation_status. REQUIRED: You MUST use relationships (or related_to) to anchor entries to previous context.',
            group: 'team',
            inputSchema: TeamBatchCreateEntriesSchemaMcp,
            outputSchema: TeamBatchCreateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    const input = TeamBatchCreateEntriesSchema.parse(params)
                    return await executeTeamBatchCreate(context, teamDb, input)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_update_entries',
            title: 'Team Batch Update Entries',
            description: 'Update multiple existing team journal entries in a single transaction. Max 50 per batch. Can only update entries you authored. Pass expected_version for optimistic locking.',
            group: 'team',
            inputSchema: TeamBatchUpdateEntriesSchemaMcp,
            outputSchema: TeamBatchUpdateEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    const input = TeamBatchUpdateEntriesSchema.parse(params)
                    return await executeTeamBatchUpdate(context, teamDb, input)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
        {
            name: 'team_batch_delete_entries',
            title: 'Team Batch Delete Entries',
            description: 'Delete multiple existing team journal entries in a single transaction. Max 50 per batch. Can only delete entries you authored.',
            group: 'team',
            inputSchema: TeamBatchDeleteEntriesSchemaMcp,
            outputSchema: TeamBatchDeleteEntriesOutputSchema,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            handler: async (params: unknown) => {
                try {
                    if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }
                    const input = TeamBatchDeleteEntriesSchema.parse(params)
                    return await executeTeamBatchDelete(context, teamDb, input)
                } catch (err) {
                    return formatHandlerError(err)
                }
            },
        },
    ]
}
