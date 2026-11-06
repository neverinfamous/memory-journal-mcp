/**
 * Shared helper for linking a newly created entry to its requested relationship targets.
 */

import type { RelationshipType } from '../../types/index.js'
import { logger } from '../../utils/logger.js'

/** A relationship request as accepted by the create tools (after schema parsing). */
interface RequestedRelationship {
    targetId: number
    relationType: RelationshipType | 'resolves' | 'relates_to' | 'depends_on'
}

/** Minimal adapter surface needed to create a relationship. */
interface RelationshipLinker {
    linkEntries(
        fromId: number,
        toId: number,
        type: RelationshipType,
        description?: string,
        workspaceId?: string
    ): unknown
}

/** Map accepted relationship aliases onto the canonical stored relationship type. */
function toCanonicalRelationType(relationType: RequestedRelationship['relationType']): RelationshipType {
    switch (relationType) {
        case 'resolves':
            return 'resolved'
        case 'relates_to':
            return 'references'
        case 'depends_on':
            return 'blocked_by'
        default:
            return relationType
    }
}

/**
 * Link `entryId` to each requested target and return a warning per link that failed,
 * so the caller can report dropped relationships instead of claiming a clean success.
 */
export function linkRequestedRelationships(
    db: RelationshipLinker,
    entryId: number,
    relationships: readonly RequestedRelationship[] | undefined,
    workspaceId?: string
): string[] {
    const warnings: string[] = []
    for (const rel of relationships ?? []) {
        try {
            const type = toCanonicalRelationType(rel.relationType)
            if (workspaceId !== undefined) {
                db.linkEntries(entryId, rel.targetId, type, undefined, workspaceId)
            } else {
                db.linkEntries(entryId, rel.targetId, type)
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            logger.warning(`Relationship link failed: ${reason}`, {
                module: 'RelationshipLinking',
            })
            warnings.push(
                `Relationship ${rel.relationType} #${String(entryId)} -> #${String(rel.targetId)} was not created: ${reason}`
            )
        }
    }
    return warnings
}
