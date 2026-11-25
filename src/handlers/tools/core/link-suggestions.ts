import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { JournalEntry, RelationshipType } from '../../../types/index.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import { isoDaysAgo } from '../../../database/sqlite-adapter/graph-pivots.js'
import { previewLabel } from '../../resources/core/briefing/graph-pivots-section.js'
import { logger } from '../../../utils/logger.js'

export interface SuggestedLink {
    targetId: number
    relationType: RelationshipType
    reason: 'same-session' | 'shared-anchor' | 'semantic'
    preview: string
}

const DEFAULT_SUGGESTION_LIMIT = 3
const ANCHOR_LOOKBACK_DAYS = 30
const SEMANTIC_SUGGESTION_THRESHOLD = 0.55

function isEligibleCandidate(
    candidate: JournalEntry,
    excludeId: number | undefined,
    projectNumber: number | undefined
): boolean {
    if (excludeId !== undefined && candidate.id === excludeId) return false
    if (candidate.deletedAt !== undefined && candidate.deletedAt !== null) return false
    if (projectNumber !== undefined && candidate.projectNumber !== projectNumber) return false
    return true
}

function appendSessionLinkSuggestions(params: {
    db: IDatabaseAdapter
    sessionId: string | undefined
    workspaceId: string
    excludeId: number | undefined
    projectNumber: number | undefined
    limit: number
    seenIds: Set<number>
    suggestions: SuggestedLink[]
}): void {
    const { db, sessionId, workspaceId, excludeId, projectNumber, limit, seenIds, suggestions } =
        params
    if (
        sessionId === undefined ||
        sessionId.trim() === '' ||
        typeof db.getEntriesBySession !== 'function'
    ) {
        return
    }
    const sessionEntries = db.getEntriesBySession(sessionId.trim(), 5, workspaceId)
    for (const candidate of sessionEntries) {
        if (suggestions.length >= limit) break
        if (seenIds.has(candidate.id) || !isEligibleCandidate(candidate, excludeId, projectNumber)) {
            continue
        }
        seenIds.add(candidate.id)
        suggestions.push({
            targetId: candidate.id,
            relationType: 'evolves_from',
            reason: 'same-session',
            preview: previewLabel(candidate.content),
        })
    }
}

function appendSharedAnchorSuggestions(params: {
    db: IDatabaseAdapter
    entryId: number
    workspaceId: string
    projectNumber: number | undefined
    limit: number
    seenIds: Set<number>
    suggestions: SuggestedLink[]
}): void {
    const { db, entryId, workspaceId, projectNumber, limit, seenIds, suggestions } = params
    if (suggestions.length >= limit || typeof db.getEntriesSharingAnchors !== 'function') return
    const anchorPeers = db.getEntriesSharingAnchors(
        entryId,
        isoDaysAgo(ANCHOR_LOOKBACK_DAYS),
        5,
        workspaceId,
        projectNumber
    )
    for (const peer of anchorPeers) {
        if (suggestions.length >= limit) break
        if (seenIds.has(peer.entryId)) continue
        seenIds.add(peer.entryId)
        suggestions.push({
            targetId: peer.entryId,
            relationType: 'references',
            reason: 'shared-anchor',
            preview: previewLabel(peer.content),
        })
    }
}

async function appendSemanticLinkSuggestions(params: {
    db: IDatabaseAdapter
    vectorManager: VectorSearchManager | undefined
    entry: JournalEntry
    workspaceId: string
    projectNumber: number | undefined
    limit: number
    seenIds: Set<number>
    suggestions: SuggestedLink[]
}): Promise<void> {
    const { db, vectorManager, entry, workspaceId, projectNumber, limit, seenIds, suggestions } =
        params
    if (
        suggestions.length >= limit ||
        vectorManager === undefined ||
        typeof vectorManager.searchByEntryId !== 'function'
    ) {
        return
    }
    try {
        const hits = await vectorManager.searchByEntryId(
            entry.id,
            5,
            SEMANTIC_SUGGESTION_THRESHOLD,
            workspaceId,
            projectNumber,
            entry
        )
        const unseenHits = hits.filter((h) => !seenIds.has(h.entryId))
        if (unseenHits.length === 0) return

        const prehydratedById = new Map<number, JournalEntry>()
        const missingIds: number[] = []
        for (const h of unseenHits) {
            if (h.entry !== undefined) prehydratedById.set(h.entryId, h.entry)
            else missingIds.push(h.entryId)
        }
        const hydratedMap =
            missingIds.length > 0
                ? db.getEntriesByIds(missingIds, workspaceId)
                : new Map<number, JournalEntry>()
        const missingTagIds: number[] = []
        for (const h of unseenHits) {
            const candidate = prehydratedById.get(h.entryId) ?? hydratedMap.get(h.entryId)
            if (candidate !== undefined && !Array.isArray(candidate.tags)) {
                missingTagIds.push(h.entryId)
            }
        }
        const extraTags =
            missingTagIds.length > 0 && typeof db.getTagsForEntries === 'function'
                ? db.getTagsForEntries(missingTagIds)
                : undefined

        for (const h of unseenHits) {
            if (suggestions.length >= limit) break
            const id = h.entryId
            const candidate = prehydratedById.get(id) ?? hydratedMap.get(id)
            if (candidate === undefined || !isEligibleCandidate(candidate, entry.id, projectNumber)) {
                continue
            }
            const tags = Array.isArray(candidate.tags)
                ? candidate.tags
                : (extraTags?.get(id) ?? [])
            if (tags.includes('commit-narrative')) continue
            seenIds.add(id)
            suggestions.push({
                targetId: id,
                relationType: 'references',
                reason: 'semantic',
                preview: previewLabel(candidate.content),
            })
        }
    } catch (err: unknown) {
        // Semantic suggestions are best-effort; never fail entry creation if vector index is degraded.
        logger.debug('Best-effort semantic link suggestion skipped', {
            error: err instanceof Error ? err.message : String(err),
        })
    }
}

/**
 * Compute up to `limit` heuristic relationship candidates for a newly created entry when
 * no explicit `relationships` were provided: same-session -> shared file anchors -> semantic neighbors.
 */
export async function computeSuggestedLinks(params: {
    db: IDatabaseAdapter
    vectorManager?: VectorSearchManager | undefined
    entry: JournalEntry
    workspaceId: string
    projectNumber?: number | undefined
    sessionId?: string | undefined
    limit?: number | undefined
}): Promise<SuggestedLink[]> {
    const { db, vectorManager, entry, workspaceId, projectNumber, sessionId } = params
    const limit = Math.max(1, params.limit ?? DEFAULT_SUGGESTION_LIMIT)
    const suggestions: SuggestedLink[] = []
    const seenIds = new Set<number>([entry.id])

    appendSessionLinkSuggestions({
        db,
        sessionId,
        workspaceId,
        excludeId: entry.id,
        projectNumber,
        limit,
        seenIds,
        suggestions,
    })
    appendSharedAnchorSuggestions({
        db,
        entryId: entry.id,
        workspaceId,
        projectNumber,
        limit,
        seenIds,
        suggestions,
    })
    await appendSemanticLinkSuggestions({
        db,
        vectorManager,
        entry,
        workspaceId,
        projectNumber,
        limit,
        seenIds,
        suggestions,
    })

    return suggestions
}

function appendDraftAnchorSuggestions(params: {
    db: IDatabaseAdapter
    workspaceId: string
    projectNumber: number | undefined
    anchors: readonly { anchor_path: string }[] | undefined
    limit: number
    seenIds: Set<number>
    suggestions: SuggestedLink[]
}): void {
    const { db, workspaceId, projectNumber, anchors, limit, seenIds, suggestions } = params
    if (
        suggestions.length >= limit ||
        anchors === undefined ||
        anchors.length === 0 ||
        typeof db.getRecentEntries !== 'function'
    ) {
        return
    }
    const wantedPaths = new Set(
        anchors.map((a) => a.anchor_path.trim().toLowerCase()).filter(Boolean)
    )
    if (wantedPaths.size === 0) return

    const recent = db.getRecentEntries(
        30,
        undefined,
        'timestamp',
        undefined,
        false,
        workspaceId,
        projectNumber
    ).entries
    const recentIds = recent.map((r) => r.id)
    const anchorMap =
        recentIds.length > 0 && typeof db.getAnchorsByEntryIds === 'function'
            ? db.getAnchorsByEntryIds(recentIds, workspaceId)
            : undefined

    for (const candidate of recent) {
        if (suggestions.length >= limit) break
        if (seenIds.has(candidate.id) || !isEligibleCandidate(candidate, undefined, projectNumber)) {
            continue
        }
        const entryAnchors =
            anchorMap !== undefined
                ? (anchorMap.get(candidate.id) ?? [])
                : typeof db.getAnchorsByEntryId === 'function'
                  ? db.getAnchorsByEntryId(candidate.id, workspaceId)
                  : []
        if (!entryAnchors.some((a) => wantedPaths.has(a.anchorPath.trim().toLowerCase()))) continue
        seenIds.add(candidate.id)
        suggestions.push({
            targetId: candidate.id,
            relationType: 'references',
            reason: 'shared-anchor',
            preview: previewLabel(candidate.content),
        })
    }
}

/**
 * Preview same-session and shared-anchor relationship candidates before persisting an entry (`--dry-run-links`).
 */
export function previewDraftSuggestedLinks(params: {
    db: IDatabaseAdapter
    workspaceId: string
    projectNumber?: number | undefined
    sessionId?: string | undefined
    anchors?: readonly { anchor_path: string }[] | undefined
    limit?: number | undefined
}): SuggestedLink[] {
    const { db, workspaceId, projectNumber, sessionId, anchors } = params
    const limit = Math.max(1, params.limit ?? DEFAULT_SUGGESTION_LIMIT)
    const suggestions: SuggestedLink[] = []
    const seenIds = new Set<number>()

    appendSessionLinkSuggestions({
        db,
        sessionId,
        workspaceId,
        excludeId: undefined,
        projectNumber,
        limit,
        seenIds,
        suggestions,
    })
    appendDraftAnchorSuggestions({
        db,
        workspaceId,
        projectNumber,
        anchors,
        limit,
        seenIds,
        suggestions,
    })

    return suggestions
}
