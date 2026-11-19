import type { IDatabaseAdapter } from '../../../database/core/interfaces.js'
import type { JournalEntry, RelationshipType } from '../../../types/index.js'
import type { VectorSearchManager } from '../../../vector/vector-search-manager/index.js'
import { isoDaysAgo } from '../../../database/sqlite-adapter/graph-pivots.js'
import { previewLabel } from '../../resources/core/briefing/graph-pivots-section.js'

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

    if (
        sessionId !== undefined &&
        sessionId.trim() !== '' &&
        typeof db.getEntriesBySession === 'function'
    ) {
        const sessionEntries = db.getEntriesBySession(sessionId.trim(), 5, workspaceId)
        for (const candidate of sessionEntries) {
            if (suggestions.length >= limit) break
            if (seenIds.has(candidate.id) || !isEligibleCandidate(candidate, entry.id, projectNumber)) {
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

    if (suggestions.length < limit && typeof db.getEntriesSharingAnchors === 'function') {
        const anchorPeers = db.getEntriesSharingAnchors(
            entry.id,
            isoDaysAgo(ANCHOR_LOOKBACK_DAYS),
            5,
            workspaceId
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

    if (
        suggestions.length < limit &&
        vectorManager !== undefined &&
        typeof vectorManager.searchByEntryId === 'function'
    ) {
        try {
            const hits = await vectorManager.searchByEntryId(
                entry.id,
                5,
                SEMANTIC_SUGGESTION_THRESHOLD,
                workspaceId,
                projectNumber,
                entry
            )
            const candidateIds = hits
                .map((h) => h.entryId)
                .filter((id) => !seenIds.has(id))
            if (candidateIds.length > 0) {
                const hydratedMap = db.getEntriesByIds(candidateIds, workspaceId)
                const missingTagIds = candidateIds.filter((id) => {
                    const c = hydratedMap.get(id)
                    return c !== undefined && !Array.isArray(c.tags)
                })
                const extraTags =
                    missingTagIds.length > 0 && typeof db.getTagsForEntries === 'function'
                        ? db.getTagsForEntries(missingTagIds)
                        : undefined
                for (const id of candidateIds) {
                    if (suggestions.length >= limit) break
                    const candidate = hydratedMap.get(id)
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
            }
        } catch {
            // Semantic suggestions are best-effort; never fail entry creation if vector index is degraded.
        }
    }

    return suggestions
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

    if (
        sessionId !== undefined &&
        sessionId.trim() !== '' &&
        typeof db.getEntriesBySession === 'function'
    ) {
        const sessionEntries = db.getEntriesBySession(sessionId.trim(), 5, workspaceId)
        for (const candidate of sessionEntries) {
            if (suggestions.length >= limit) break
            if (seenIds.has(candidate.id) || !isEligibleCandidate(candidate, undefined, projectNumber)) {
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

    if (
        suggestions.length < limit &&
        anchors !== undefined &&
        anchors.length > 0 &&
        typeof db.getRecentEntries === 'function'
    ) {
        const wantedPaths = new Set(anchors.map((a) => a.anchor_path.trim().toLowerCase()).filter(Boolean))
        if (wantedPaths.size > 0) {
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
                const sharesAnchor = entryAnchors.some((a) =>
                    wantedPaths.has(a.anchorPath.trim().toLowerCase())
                )
                if (!sharesAnchor) continue
                seenIds.add(candidate.id)
                suggestions.push({
                    targetId: candidate.id,
                    relationType: 'references',
                    reason: 'shared-anchor',
                    preview: previewLabel(candidate.content),
                })
            }
        }
    }

    return suggestions
}
