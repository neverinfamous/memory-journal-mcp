/**
 * Team Search & Metadata Filtering Helpers
 *
 * Extracted from `src/handlers/tools/search/helpers.ts` to keep modules under 450 lines
 * without introducing circular value imports.
 */

import type { JournalEntry, ToolHandlerConfig } from '../../../types/index.js'
import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import { logger } from '../../../utils/logger.js'
import { enforceAccessBoundary } from '../../../auth/validation.js'
import { isToolVisibleForFilter } from '../../../filtering/tool-filter.js'
import { isTargetExcludedByRules } from '../dummy-filter-helpers.js'
import { canReadTeamEntriesRbac } from '../team/rbac.js'
import { sanitizeAuthor } from '../../../utils/security-utils.js'
import {
    excludesCommitNarrative,
    isSessionCommitsAutoContext,
} from '../../../utils/legacy-commit-narrative.js'

export interface EntryWithSource {
    content: string
    timestamp: string
    source: 'personal' | 'team'
    team_db?: string // Optional label for cross-team search
    [key: string]: unknown
}

export interface ISearchFilters {
    limit?: number | undefined
    isPersonal?: boolean | undefined
    projectNumber?: number | undefined
    issueNumber?: number | undefined
    prNumber?: number | undefined
    prStatus?: string | undefined
    workflowRunId?: number | undefined
    tags?: string[] | undefined
    excludeTags?: string[] | undefined
    entryType?: string | undefined
    startDate?: string | undefined
    endDate?: string | undefined
    includeTeam?: boolean | undefined
    includeArchived?: boolean | undefined
    workspaceId?: string | undefined
    similarityThreshold?: number | undefined
    enforceSimilarityThreshold?: boolean | undefined
    config?: ToolHandlerConfig | undefined
}

/**
 * Return true when an optional team database adapter is defined and initialized.
 * Guards implicit personal+team search merges when `use_test_db=true` and `TEST_TEAM_DB_PATH` is unset.
 */
export function isTeamDbReady(teamDb: IDatabaseAdapter | undefined): teamDb is IDatabaseAdapter {
    if (teamDb === undefined) return false
    const candidate: {
        getEntriesByIds: IDatabaseAdapter['getEntriesByIds']
        isInitialized?: () => boolean
    } = teamDb
    return typeof candidate.isInitialized === 'function' ? candidate.isInitialized() : true
}

/** Return true if active `--tool-filter` rules permit team search/read operations. */
export function isTeamFilterAllowed(
    teamToolName: string,
    config:
        | {
              filterConfig?: ToolHandlerConfig['filterConfig']
              codemodeInternalFullAccess?: boolean | undefined
          }
        | undefined,
    allowCodemodeProxy = false
): boolean {
    const filterCfg = config?.filterConfig
    if (filterCfg === undefined || filterCfg === null) return true
    if (
        isTargetExcludedByRules([teamToolName, 'team'], filterCfg) ||
        !isToolVisibleForFilter(teamToolName, true, filterCfg.raw)
    ) {
        return false
    }
    return (
        config?.codemodeInternalFullAccess === true ||
        filterCfg.enabledTools.has(teamToolName) ||
        (allowCodemodeProxy && filterCfg.enabledTools.has('mj_execute_code'))
    )
}

/** Return true if team boundary access passes without triggering denial audit logs. */
export function canAccessTeamSilently(
    toolName = 'search_entries',
    context?: {
        teamDb?: IDatabaseAdapter | undefined
        config?: ToolHandlerConfig | undefined
    },
    workspaceId?: string
): boolean {
    try {
        enforceAccessBoundary(toolName, 'tool', { requiresTeamScope: true })
        const filterTool = toolName.startsWith('team_') ? toolName : 'team_search'
        if (!isTeamFilterAllowed(filterTool, context?.config)) return false
        if (context?.teamDb !== undefined) {
            if (!isTeamDbReady(context.teamDb)) return false
            if (context.teamDb.isTeamRbacActive?.()) {
                return canReadTeamEntriesRbac(context.teamDb, context.config, workspaceId)
            }
        }
        return true
    } catch {
        return false
    }
}

/**
 * Filter an entry in-memory according to search options.
 * Used for post-filtering vector search results which don't support SQL metadata filtering.
 */
export function passMetadataFilters(
    entry: JournalEntry,
    options: ISearchFilters,
    db: IDatabaseAdapter
): boolean {
    if (
        options.workspaceId !== undefined &&
        options.workspaceId !== '*' &&
        (entry.workspaceId ?? 'default') !== options.workspaceId
    ) {
        return false
    }
    if (options.isPersonal !== undefined && entry.isPersonal !== options.isPersonal) return false
    if (options.projectNumber !== undefined && entry.projectNumber !== options.projectNumber)
        return false
    if (options.issueNumber !== undefined && entry.issueNumber !== options.issueNumber) return false
    if (options.prNumber !== undefined && entry.prNumber !== options.prNumber) return false
    if (options.prStatus !== undefined && entry.prStatus !== options.prStatus) return false
    if (options.workflowRunId !== undefined && entry.workflowRunId !== options.workflowRunId)
        return false
    if (options.entryType && entry.entryType !== options.entryType) return false
    if (options.startDate || options.endDate) {
        const sepIdx = entry.timestamp.search(/[Tt ]/)
        const entryDate = sepIdx === -1 ? entry.timestamp : entry.timestamp.slice(0, sepIdx)
        if (options.startDate && entryDate < options.startDate) return false
        if (options.endDate && entryDate > options.endDate) return false
    }
    if (options.tags && options.tags.length > 0) {
        const entryTags: string[] = Array.isArray(entry.tags)
            ? entry.tags
            : db.getTagsForEntry(entry.id)
        if (!options.tags.some((t: string) => entryTags.includes(t))) return false
    }
    if (options.excludeTags && options.excludeTags.length > 0) {
        const entryTags: string[] = Array.isArray(entry.tags)
            ? entry.tags
            : db.getTagsForEntry(entry.id)
        if (options.excludeTags.some((t: string) => entryTags.includes(t))) return false
        // [INVARIANT] M1 read-side fallback for untagged legacy session-commits rows (vector/hybrid paths).
        if (
            excludesCommitNarrative(options.excludeTags) &&
            isSessionCommitsAutoContext(entry.autoContext)
        ) {
            return false
        }
    }
    if (!options.includeArchived && entry.isArchived) return false
    return true
}

function readTeamHitScore(hit: { entryId: number; score?: number; similarity?: number }): number {
    if (typeof hit.score === 'number') return hit.score
    if (typeof hit.similarity === 'number') return hit.similarity
    return 0
}

function hydrateMissingTeamTags(
    teamDb: IDatabaseAdapter,
    resolvedEntries: JournalEntry[],
    options: ISearchFilters
): void {
    const hasTagFilters =
        (options.tags !== undefined && options.tags.length > 0) ||
        (options.excludeTags !== undefined && options.excludeTags.length > 0)
    if (!hasTagFilters) return

    const untaggedIds = resolvedEntries
        .filter((entry) => !Array.isArray(entry.tags))
        .map((entry) => entry.id)
    if (untaggedIds.length === 0) return

    const tagsMap = teamDb.getTagsForEntries(untaggedIds)
    for (const entry of resolvedEntries) {
        if (!Array.isArray(entry.tags)) {
            entry.tags = tagsMap.get(entry.id) ?? []
        }
    }
}

async function hydrateTeamVectorHits(
    query: string,
    teamDb: IDatabaseAdapter,
    teamVectorManager: VectorSearchManager,
    options: ISearchFilters & { limit: number },
    limit: number,
    pushEntry: (entry: JournalEntry, similarity?: number) => void
): Promise<boolean> {
    try {
        const hits = await teamVectorManager.search(
            query,
            limit,
            options.similarityThreshold ?? 0.15,
            options.workspaceId,
            options.projectNumber
        )
        const missingIds = hits.filter((hit) => hit.entry === undefined).map((hit) => hit.entryId)
        const hydrated =
            missingIds.length > 0
                ? teamDb.getEntriesByIds(missingIds, options.workspaceId ?? 'default')
                : new Map<number, JournalEntry>()
        const resolvedEntries: JournalEntry[] = []
        for (const hit of hits) {
            const entry = hit.entry ?? hydrated.get(hit.entryId)
            if (entry !== undefined) resolvedEntries.push(entry)
        }
        hydrateMissingTeamTags(teamDb, resolvedEntries, options)
        for (const hit of hits) {
            const entry = hit.entry ?? hydrated.get(hit.entryId)
            if (entry !== undefined) {
                pushEntry(entry, Math.round(readTeamHitScore(hit) * 100) / 100)
            }
        }
        return false
    } catch (err) {
        logger.debug('Team vector search failed; falling back to full-text results', {
            module: 'Search',
            error: err instanceof Error ? err.message : String(err),
        })
        return true
    }
}

function appendTeamFtsFallback(
    query: string,
    teamDb: IDatabaseAdapter,
    options: ISearchFilters & { limit: number },
    limit: number,
    pushEntry: (entry: JournalEntry, similarity?: number) => void
): void {
    const fts = teamDb.searchEntries(query, {
        limit,
        ...(options.projectNumber !== undefined ? { projectNumber: options.projectNumber } : {}),
        ...(options.issueNumber !== undefined ? { issueNumber: options.issueNumber } : {}),
        ...(options.prNumber !== undefined ? { prNumber: options.prNumber } : {}),
        ...(options.prStatus !== undefined ? { prStatus: options.prStatus } : {}),
        ...(options.workflowRunId !== undefined ? { workflowRunId: options.workflowRunId } : {}),
        ...(options.tags !== undefined ? { tags: options.tags } : {}),
        ...(options.excludeTags !== undefined ? { excludeTags: options.excludeTags } : {}),
        ...(options.entryType !== undefined
            ? { entryType: options.entryType as JournalEntry['entryType'] }
            : {}),
        ...(options.startDate !== undefined ? { startDate: options.startDate } : {}),
        ...(options.endDate !== undefined ? { endDate: options.endDate } : {}),
        ...(options.includeArchived !== undefined ? { includeArchived: options.includeArchived } : {}),
        ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
    })
    const fallbackSimilarity = options.similarityThreshold !== undefined ? 0 : undefined
    for (const entry of fts.entries) pushEntry(entry, fallbackSimilarity)
}

/**
 * Team hits for hybrid and semantic search. Vector hits come first. Full-text
 * hits fill the rest so include_team is not a no-op when the team index is absent.
 */
export async function collectTeamSearchEntries(
    query: string,
    teamDb: IDatabaseAdapter,
    teamVectorManager: VectorSearchManager | undefined,
    options: ISearchFilters & { limit: number },
    diagnostics?: { teamVectorFailed?: boolean }
): Promise<EntryWithSource[]> {
    if (
        !isTeamDbReady(teamDb) ||
        !canAccessTeamSilently('search_entries', { teamDb, config: options.config }, options.workspaceId)
    ) {
        return []
    }
    const seen = new Set<number>()
    const ranked: EntryWithSource[] = []
    const limit = Math.min(Math.max(options.limit, 1), 500)

    const pushEntry = (entry: JournalEntry, similarity?: number): void => {
        if (seen.has(entry.id) || !passMetadataFilters(entry, options, teamDb)) return
        seen.add(entry.id)
        ranked.push({
            ...entry,
            ...('author' in entry && typeof entry.author === 'string'
                ? { author: sanitizeAuthor(entry.author) }
                : {}),
            content: entry.content,
            timestamp: entry.timestamp,
            source: 'team',
            ...(similarity !== undefined ? { similarity } : {}),
        })
    }

    const teamVectorFailed =
        teamVectorManager !== undefined && query.trim() !== ''
            ? await hydrateTeamVectorHits(
                  query,
                  teamDb,
                  teamVectorManager,
                  options,
                  limit,
                  pushEntry
              )
            : false
    if (teamVectorFailed && diagnostics !== undefined) {
        diagnostics.teamVectorFailed = true
    }

    if (
        options.enforceSimilarityThreshold !== true &&
        (options.similarityThreshold === undefined ||
            teamVectorManager === undefined ||
            teamVectorFailed)
    ) {
        appendTeamFtsFallback(query, teamDb, options, limit, pushEntry)
    }
    return ranked
}
