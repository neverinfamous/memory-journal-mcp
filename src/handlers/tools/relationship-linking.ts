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
    getEntryById?(id: number, workspaceId?: string): { projectNumber?: number | null } | null
    getEntriesByIds?(
        ids: number[],
        workspaceId?: string
    ): Map<number, { projectNumber?: number | null }>
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

function lookupTargetProjectNumber(
    db: RelationshipLinker,
    targetId: number,
    workspaceId: string | undefined,
    prefetchedTargets: Map<number, { projectNumber?: number | null }> | undefined
): number | null | undefined {
    const target =
        prefetchedTargets !== undefined
            ? prefetchedTargets.get(targetId)
            : typeof db.getEntryById === 'function'
              ? db.getEntryById(targetId, workspaceId)
              : undefined
    return target?.projectNumber
}

/**
 * Link `entryId` to each requested target and return a warning per link that failed,
 * so the caller can report dropped relationships instead of claiming a clean success.
 */
export function linkRequestedRelationships(
    db: RelationshipLinker,
    entryId: number,
    relationships: readonly RequestedRelationship[] | undefined,
    workspaceId?: string,
    projectNumber?: number
): string[] {
    const warnings: string[] = []
    if (relationships === undefined || relationships.length === 0) return warnings

    const prefetchedTargets =
        projectNumber !== undefined &&
        relationships.length > 1 &&
        typeof db.getEntriesByIds === 'function'
            ? db.getEntriesByIds(
                  Array.from(new Set(relationships.map((rel) => rel.targetId))),
                  workspaceId
              )
            : undefined

    for (const rel of relationships) {
        try {
            const targetProject =
                projectNumber !== undefined
                    ? lookupTargetProjectNumber(db, rel.targetId, workspaceId, prefetchedTargets)
                    : undefined
            if (
                projectNumber !== undefined &&
                targetProject !== null &&
                targetProject !== undefined &&
                targetProject !== projectNumber
            ) {
                const reason = `Target entry #${String(rel.targetId)} belongs to project #${String(targetProject)}, not project #${String(projectNumber)}`
                logger.warning(`Relationship link skipped: ${reason}`, {
                    module: 'RelationshipLinking',
                })
                warnings.push(
                    `Relationship ${rel.relationType} #${String(entryId)} -> #${String(rel.targetId)} was not created: ${reason}`
                )
                continue
            }
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
