/**
 * Team Vector Tool Helpers — decomposed execution helpers (<= 80 lines per function).
 */

import { z } from 'zod'
import type { ToolContext } from '../../../types/index.js'
import { ValidationError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { logger } from '../../../utils/logger.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import {
    activeProjectRegistry,
    alignedProjectFilter,
} from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'
import { passMetadataFilters } from '../search/helpers.js'
import { StrictProjectNumberSchema } from '../schemas.js'
import {
    TEAM_DB_ERROR_RESPONSE,
    batchFetchAuthors,
    missingTeamProjectNumberError,
    resolveTeamProjectNumber,
} from './helpers.js'
import {
    canRealignOrphanedRegisteredProject,
    resolveTeamMutationProjectNumber,
} from './admin-tools/team-pk-scope-helpers.js'
import { TeamAddToVectorIndexSchema, TeamSemanticSearchSchema } from './schemas.js'

const QUALITY_FLOOR = 0.5

type TeamSemanticSearchInput = z.infer<typeof TeamSemanticSearchSchema>
type TeamDbInstance = NonNullable<ToolContext['teamDb']>
type TeamVectorInstance = NonNullable<ToolContext['teamVectorManager']>

async function runTeamVectorQuery(
    teamDb: TeamDbInstance,
    teamVectorManager: TeamVectorInstance,
    input: TeamSemanticSearchInput,
    wsId: string,
    projectNumber: number | undefined
): Promise<SemanticSearchResult[] | { errorResponse: Record<string, unknown> }> {
    const hasFilters =
        input.tags !== undefined ||
        (input.exclude_tags !== undefined && input.exclude_tags.length > 0) ||
        input.entry_type !== undefined ||
        input.start_date !== undefined ||
        input.end_date !== undefined ||
        projectNumber !== undefined ||
        input.issue_number !== undefined ||
        input.pr_number !== undefined ||
        input.workflow_run_id !== undefined
    const internalLimit = hasFilters
        ? Math.min(Math.max(input.limit * 10, 100), 1000)
        : input.limit * 2
    const threshold = input.similarity_threshold ?? 0.25

    if (input.entry_id !== undefined) {
        const seed = teamDb.getEntryById(input.entry_id, wsId)
        if (!seed || (projectNumber !== undefined && seed.projectNumber !== projectNumber)) {
            return {
                errorResponse: {
                    success: false,
                    error: `Entry ${String(input.entry_id)} not found`,
                    code: 'RESOURCE_NOT_FOUND',
                    category: 'resource',
                    recoverable: true,
                    ...(input.query !== undefined ? { query: input.query } : {}),
                },
            }
        }
        return teamVectorManager.searchByEntryId(
            input.entry_id,
            internalLimit,
            threshold,
            wsId,
            projectNumber
        )
    }

    return teamVectorManager.search(input.query ?? '', internalLimit, threshold, wsId, projectNumber)
}

function resolveTeamSemanticEntries(
    teamDb: TeamDbInstance,
    results: SemanticSearchResult[],
    wsId: string
): Map<number, NonNullable<SemanticSearchResult['entry']>> {
    const missingIds = results.filter((r) => r.entry === undefined).map((r) => r.entryId)
    const entriesMap =
        missingIds.length > 0
            ? teamDb.getEntriesByIds(missingIds, wsId)
            : new Map<number, NonNullable<SemanticSearchResult['entry']>>()
    const resolvedEntries = new Map<number, NonNullable<SemanticSearchResult['entry']>>()
    for (const r of results) {
        const entry = r.entry ?? entriesMap.get(r.entryId)
        if (entry !== undefined) resolvedEntries.set(r.entryId, entry)
    }
    const missingTagIds = Array.from(resolvedEntries.values())
        .filter((entry) => !Array.isArray(entry.tags))
        .map((entry) => entry.id)
    if (missingTagIds.length > 0) {
        const tagsMap = teamDb.getTagsForEntries(missingTagIds)
        for (const id of missingTagIds) {
            const entry = resolvedEntries.get(id)
            if (entry) entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
    return resolvedEntries
}

function hydrateAndFilterTeamSemanticHits(
    teamDb: TeamDbInstance,
    teamVectorManager: TeamVectorInstance,
    results: SemanticSearchResult[],
    input: TeamSemanticSearchInput,
    wsId: string,
    projectNumber: number | undefined
): Record<string, unknown> {
    const resolvedEntries = resolveTeamSemanticEntries(teamDb, results, wsId)

    const filterOpts = {
        tags: input.tags,
        excludeTags: input.exclude_tags,
        entryType: input.entry_type,
        startDate: input.start_date,
        endDate: input.end_date,
        issueNumber: input.issue_number,
        prNumber: input.pr_number,
        workflowRunId: input.workflow_run_id,
        includeArchived: input.include_archived,
    }
    const filtered: { entry: NonNullable<SemanticSearchResult['entry']>; similarity: number }[] = []
    for (const r of results) {
        const entry = resolvedEntries.get(r.entryId)
        if (!entry) continue
        if (input.entry_id !== undefined && entry.id === input.entry_id) continue
        if (projectNumber !== undefined && entry.projectNumber !== projectNumber) continue
        if (wsId !== '*' && entry.workspaceId !== wsId) continue
        if (!passMetadataFilters(entry, filterOpts, teamDb)) continue
        filtered.push({ entry, similarity: Math.round(r.score * 100) / 100 })
        if (filtered.length >= input.limit) break
    }

    const filteredIds = filtered.map((item) => item.entry.id)
    const authorMap =
        filteredIds.length > 0 ? batchFetchAuthors(teamDb, filteredIds) : new Map<number, string | null>()
    const entries = filtered.map(({ entry, similarity }) => ({
        ...entry,
        author: authorMap.get(entry.id) ?? null,
        similarity,
        source: 'team' as const,
    }))

    const includeHint = input.hint_on_empty ?? true
    const bestSimilarity = entries[0]?.similarity ?? 0
    const hint =
        entries.length === 0 && includeHint
            ? teamVectorManager.getStats().itemCount === 0
                ? 'No entries in team vector index. Use team_rebuild_vector_index to index existing entries.'
                : `No entries matched your query above the similarity threshold (${String(input.similarity_threshold ?? 0.25)}). Try lowering similarity_threshold (e.g., 0.15) for broader matches.`
            : entries.length > 0 && bestSimilarity < QUALITY_FLOOR
              ? `Results may be noise — best similarity (${String(bestSimilarity)}) is below quality floor (${String(QUALITY_FLOOR)}). Try a more specific query or raise similarity_threshold to filter weak matches.`
              : undefined

    return {
        success: true,
        query: input.query,
        ...(input.entry_id !== undefined ? { entryId: input.entry_id } : {}),
        entries,
        count: entries.length,
        ...(hint !== undefined ? { hint } : {}),
    }
}

export async function executeTeamSemanticSearch(
    context: ToolContext,
    params: unknown
): Promise<Record<string, unknown>> {
    try {
        const { teamDb, teamVectorManager } = context
        if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

        const input = TeamSemanticSearchSchema.parse(params)
        if (
            input.start_date !== undefined &&
            input.end_date !== undefined &&
            input.start_date > input.end_date
        ) {
            throw new ValidationError('start_date cannot be after end_date')
        }
        const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
        const projectNumber =
            resolveTeamProjectNumber(context, wsId, input.project_number, input.workspace_id) ??
            undefined
        if (projectNumber === undefined) {
            return missingTeamProjectNumberError(
                wsId === '*'
                    ? 'Missing project_number. Cross-tenant searches without project_number are not allowed.'
                    : undefined
            )
        }
        if ((input.query === undefined || input.query === '') && input.entry_id === undefined) {
            return {
                success: false,
                error: 'Either query or entry_id must be provided',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion:
                    'Provide a text query for semantic search, or an entry_id to find related entries',
                recoverable: true,
            }
        }
        if (!teamVectorManager) {
            return {
                success: false,
                error: 'Team vector search not available. Ensure TEAM_DB_PATH is configured and semantic search is enabled.',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                suggestion: 'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                recoverable: true,
                query: input.query,
            }
        }

        const queryResult = await runTeamVectorQuery(
            teamDb,
            teamVectorManager,
            input,
            wsId,
            projectNumber
        )
        if (!Array.isArray(queryResult)) return queryResult.errorResponse
        return hydrateAndFilterTeamSemanticHits(
            teamDb,
            teamVectorManager,
            queryResult,
            input,
            wsId,
            projectNumber
        )
    } catch (err) {
        return { ...formatHandlerError(err) }
    }
}

export async function executeTeamRebuildVectorIndex(
    context: ToolContext,
    params: unknown
): Promise<Record<string, unknown>> {
    try {
        const { teamDb, teamVectorManager, progress } = context
        if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

        const parsed = z
            .object({
                workspace_id: z.string().max(255).optional(),
                project_number: StrictProjectNumberSchema.optional(),
                session_id: z.string().optional(),
            })
            .strict()
            .parse(params ?? {})
        if (!teamVectorManager) {
            return {
                success: false,
                entriesIndexed: 0,
                error: 'Team vector search not available',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                suggestion: 'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                recoverable: true,
            }
        }
        const isWildcard = parsed.workspace_id?.trim() === '*'
        const registry = activeProjectRegistry(context.config?.projectRegistry)
        const wsId = isWildcard
            ? '*'
            : resolveWorkspaceId(parsed.workspace_id, parsed.project_number, context.config)
        const projectNumber = alignedProjectFilter(wsId, parsed.project_number, registry)
        const { success, indexed, failed, firstError, warning } =
            await teamVectorManager.rebuildIndex(progress, {
                workspaceId: wsId,
                ...(projectNumber !== undefined ? { projectNumber } : {}),
            })
        if (!success && firstError !== undefined && firstError !== '') {
            logger.warning(`Team vector index rebuild had errors: ${firstError}`)
        }
        const partial = failed > 0 && indexed > 0

        return {
            success,
            ...(partial ? { partial: true } : {}),
            entriesIndexed: indexed,
            ...(failed > 0 ? { failedEntries: failed } : {}),
            ...(warning !== undefined ? { warning } : {}),
            ...(!success
                ? { error: firstError ?? 'All entries failed to generate embeddings' }
                : {}),
        }
    } catch (err) {
        return { ...formatHandlerError(err) }
    }
}

export async function executeTeamAddToVectorIndex(
    context: ToolContext,
    params: unknown
): Promise<Record<string, unknown>> {
    try {
        const { teamDb, teamVectorManager } = context
        if (!teamDb) return { ...TEAM_DB_ERROR_RESPONSE }

        const { entry_id, project_number, workspace_id } = TeamAddToVectorIndexSchema.parse(params)
        if (!teamVectorManager) {
            return {
                success: false,
                entryId: entry_id,
                error: 'Team vector search not available',
                code: 'CONFIGURATION_ERROR',
                category: 'configuration',
                suggestion: 'Enable semantic search with --auto-rebuild-index or set up the vector manager',
                recoverable: true,
            }
        }

        const wsId = resolveWriteWorkspaceId(workspace_id, project_number, context.config)
        const entry = teamDb.getEntryById(entry_id, wsId)
        const projectNumber = resolveTeamMutationProjectNumber(
            context,
            wsId,
            project_number,
            workspace_id,
            entry?.projectNumber
        )
        if (projectNumber === undefined || projectNumber === null) {
            return {
                success: false,
                entryId: entry_id,
                error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                suggestion:
                    'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
                recoverable: true,
            }
        }
        if (
            !entry ||
            (entry.projectNumber !== projectNumber &&
                !canRealignOrphanedRegisteredProject(context, wsId, projectNumber, entry))
        ) {
            return {
                success: false,
                entryId: entry_id,
                error: `Team entry ${String(entry_id)} not found or lacks permission for project ${String(projectNumber)}`,
                code: 'RESOURCE_NOT_FOUND',
                category: 'resource',
                suggestion: 'Verify the team entry ID and project number, and try again',
                recoverable: true,
            }
        }

        try {
            await teamVectorManager.addEntry(entry)
            return { success: true, entryId: entry_id }
        } catch (err) {
            return {
                success: false,
                entryId: entry_id,
                error: err instanceof Error ? err.message : 'Failed to generate or store embedding',
            }
        }
    } catch (err) {
        return { ...formatHandlerError(err) }
    }
}
