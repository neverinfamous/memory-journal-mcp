/**
 * Search Group — Semantic Search Helpers
 *
 * Extracted from semantic-search.ts (Appendix B decomposition).
 */

import type { z } from 'zod'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { JournalEntry, ToolContext } from '../../../types/index.js'
import { PermissionError } from '../../../types/errors.js'
import { formatHandlerError } from '../../../utils/error-helpers.js'
import { resolveWorkspaceId } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, alignedProjectFilter } from '../../../utils/write-scope.js'
import type { SemanticSearchResult } from '../../../vector/vector-search-manager/index.js'
import {
    passMetadataFilters,
    collectTeamSearchEntries,
    mergeAndDedup,
    resolveAuthorizedIncludeTeam,
    type EntryWithSource,
} from './helpers.js'
import { SemanticSearchSchema } from './schemas.js'

type SemanticSearchInput = z.infer<typeof SemanticSearchSchema>
type VectorManager = NonNullable<ToolContext['vectorManager']>

const QUALITY_FLOOR = 0.5

function extractHydratedEntry(r: { entry?: JournalEntry }): JournalEntry | undefined {
    return r.entry
}

function validateSemanticSearchPreconditions(
    input: SemanticSearchInput,
    vectorManager: ToolContext['vectorManager']
): Record<string, unknown> | undefined {
    if (!input.query && input.entry_id === undefined) {
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
    if (!vectorManager) {
        return {
            success: false,
            error: 'Semantic search not initialized. Vector search manager is not available.',
            code: 'CONFIGURATION_ERROR',
            category: 'configuration',
            suggestion: 'Enable semantic search with --auto-rebuild-index or set up the vector manager',
            recoverable: false,
            query: input.query,
        }
    }
    return undefined
}

function computeSemanticInternalLimit(input: SemanticSearchInput): number {
    const hasFilters =
        input.is_personal !== undefined ||
        input.tags !== undefined ||
        input.entry_type !== undefined ||
        input.start_date !== undefined ||
        input.end_date !== undefined ||
        input.project_number !== undefined ||
        input.issue_number !== undefined ||
        input.pr_number !== undefined ||
        input.workflow_run_id !== undefined
    return hasFilters ? Math.min(Math.max(input.limit * 10, 100), 1000) : input.limit * 2
}

async function fetchSemanticVectorResults(
    db: IDatabaseAdapter,
    vectorManager: VectorManager,
    input: SemanticSearchInput,
    wsId: string,
    projectNumber: number | undefined,
    internalLimit: number
): Promise<{ results: SemanticSearchResult[] } | { errorResponse: Record<string, unknown> }> {
    const threshold = input.similarity_threshold ?? 0.25
    if (input.entry_id === undefined) {
        const results = await vectorManager.search(
            input.query ?? '',
            internalLimit,
            threshold,
            wsId,
            projectNumber
        )
        return { results }
    }
    const seed = db.getEntryById(input.entry_id, wsId)
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
    const results = await vectorManager.searchByEntryId(
        input.entry_id,
        internalLimit,
        threshold,
        wsId,
        projectNumber
    )
    return { results }
}

function hydratePersonalSemanticEntries(
    db: IDatabaseAdapter,
    results: SemanticSearchResult[],
    input: SemanticSearchInput,
    filterOptions: Record<string, unknown>,
    wsId: string
): EntryWithSource[] {
    const unhydratedIds: number[] = []
    for (const r of results) {
        if (extractHydratedEntry(r) === undefined) {
            unhydratedIds.push(r.entryId)
        }
    }
    const fallbackMap = unhydratedIds.length > 0 ? db.getEntriesByIds(unhydratedIds, wsId) : null

    const entries: EntryWithSource[] = []
    for (const r of results) {
        const entry = extractHydratedEntry(r) ?? fallbackMap?.get(r.entryId)
        if (entry === undefined) continue
        if (!passMetadataFilters(entry, filterOptions, db)) continue
        if (input.entry_id !== undefined && entry.id === input.entry_id) continue
        entries.push({
            ...entry,
            similarity: Math.round(r.score * 100) / 100,
            source: 'personal' as const,
        })
    }
    return entries
}

function buildSemanticSearchHint(
    vectorManager: VectorManager,
    entries: EntryWithSource[],
    input: SemanticSearchInput
): string | undefined {
    const isIndexEmpty = vectorManager.getStats().itemCount === 0
    const includeHint = input.hint_on_empty ?? true
    const topSimilarity = entries[0]?.['similarity']
    const bestSimilarity = typeof topSimilarity === 'number' ? topSimilarity : 0

    if (isIndexEmpty && includeHint) {
        return 'No entries in vector index. Use rebuild_vector_index to index existing entries.'
    }
    if (entries.length === 0 && includeHint) {
        return `No entries matched your query above the similarity threshold (${String(input.similarity_threshold ?? 0.25)}). Try lowering similarity_threshold (e.g., 0.15) for broader matches.`
    }
    if (entries.length > 0 && bestSimilarity < QUALITY_FLOOR) {
        return `Results may be noise — best similarity (${String(bestSimilarity)}) is below quality floor (${String(QUALITY_FLOOR)}). Try a more specific query or raise similarity_threshold to filter weak matches.`
    }
    return undefined
}

function buildSemanticFilterOptions(
    input: SemanticSearchInput,
    wsId: string,
    projectNumber: number | undefined,
    includeTeam: boolean
): Record<string, unknown> {
    return {
        isPersonal: input.is_personal,
        projectNumber,
        issueNumber: input.issue_number,
        prNumber: input.pr_number,
        workflowRunId: input.workflow_run_id,
        tags: input.tags,
        entryType: input.entry_type,
        startDate: input.start_date,
        endDate: input.end_date,
        includeTeam,
        includeArchived: input.include_archived,
        workspaceId: wsId,
    }
}

async function resolveCombinedSemanticEntries(
    context: ToolContext,
    input: SemanticSearchInput,
    personalEntries: EntryWithSource[],
    filterOptions: Record<string, unknown>,
    includeTeam: boolean
): Promise<EntryWithSource[]> {
    const { teamDb, teamVectorManager } = context
    if (
        !includeTeam ||
        input.is_personal === true ||
        teamDb === undefined ||
        input.query === undefined ||
        input.query === ''
    ) {
        return personalEntries.slice(0, input.limit)
    }
    const teamEntries = await collectTeamSearchEntries(input.query, teamDb, teamVectorManager, {
        ...filterOptions,
        limit: input.limit,
        similarityThreshold: input.similarity_threshold ?? 0.25,
    })
    return mergeAndDedup(personalEntries, teamEntries, input.limit, 'similarity')
}

/**
 * Execute semantic/vector search across personal entries and optional team database.
 */
export async function executeSemanticSearch(
    context: ToolContext,
    params: unknown
): Promise<Record<string, unknown> | ReturnType<typeof formatHandlerError>> {
    const { db, vectorManager } = context
    try {
        const input = SemanticSearchSchema.parse(params)
        const wsId = resolveWorkspaceId(input.workspace_id, input.project_number, context.config)
        const projectNumber = alignedProjectFilter(
            wsId,
            input.project_number,
            activeProjectRegistry(context.config?.projectRegistry)
        )
        const includeTeam = resolveAuthorizedIncludeTeam(
            'semantic_search',
            input.include_team,
            params,
            context.config?.runtime?.auditLogger
        )

        const preconditionError = validateSemanticSearchPreconditions(input, vectorManager)
        if (preconditionError !== undefined || !vectorManager) {
            return preconditionError ?? { success: false, error: 'Vector manager unavailable' }
        }

        const internalLimit = computeSemanticInternalLimit(input)
        const vectorOutcome = await fetchSemanticVectorResults(
            db,
            vectorManager,
            input,
            wsId,
            projectNumber,
            internalLimit
        )
        if ('errorResponse' in vectorOutcome) {
            return vectorOutcome.errorResponse
        }

        const filterOptions = buildSemanticFilterOptions(input, wsId, projectNumber, includeTeam)
        const personalEntries = hydratePersonalSemanticEntries(
            db,
            vectorOutcome.results,
            input,
            filterOptions,
            wsId
        )
        const entries = await resolveCombinedSemanticEntries(
            context,
            input,
            personalEntries,
            filterOptions,
            includeTeam
        )
        const hint = buildSemanticSearchHint(vectorManager, entries, input)
        return {
            success: true,
            query: input.query,
            ...(input.entry_id !== undefined ? { entryId: input.entry_id } : {}),
            entries,
            count: entries.length,
            ...(hint !== undefined ? { hint } : {}),
        }
    } catch (err) {
        if (err instanceof PermissionError) throw err
        return formatHandlerError(err)
    }
}
