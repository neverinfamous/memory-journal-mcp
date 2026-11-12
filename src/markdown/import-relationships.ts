import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { RelationshipType } from '../types/index.js'
import { RELATIONSHIP_TYPES } from '../types/index.js'

const VALID_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES)

export function linkImportedRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    relationships: { type: string; target_id: number }[] | undefined,
    workspaceId: string | undefined,
    idRemap: ReadonlyMap<number, number>
): { linked: number; rejected: string[]; missingTargets: number[] } {
    if (relationships === undefined) return { linked: 0, rejected: [], missingTargets: [] }
    let linked = 0
    const missingTargets: number[] = []
    const existingRels =
        typeof db.getRelationships === 'function'
            ? db.getRelationships(entryId, workspaceId)
            : []
    const rejected: string[] = []
    for (const rel of relationships) {
        if (!VALID_RELATIONSHIP_TYPES.has(rel.type)) {
            rejected.push(rel.type)
            continue
        }
        const targetId = idRemap.get(rel.target_id) ?? rel.target_id
        if (targetId === entryId) continue
        const alreadyExists = existingRels.some(
            (r) =>
                r.fromEntryId === entryId &&
                r.toEntryId === targetId &&
                r.relationshipType === rel.type
        )
        if (alreadyExists) continue
        const targetExists = db.getEntryById(targetId, workspaceId)
        if (targetExists === null || targetExists === undefined) {
            missingTargets.push(targetId)
            continue
        }
        if (workspaceId !== undefined) {
            db.linkEntries(entryId, targetId, rel.type as RelationshipType, undefined, workspaceId)
        } else {
            db.linkEntries(entryId, targetId, rel.type as RelationshipType)
        }
        existingRels.push({
            id: 0,
            fromEntryId: entryId,
            toEntryId: targetId,
            relationshipType: rel.type as RelationshipType,
            description: null,
            createdAt: '',
        })
        linked++
    }
    return { linked, rejected, missingTargets }
}
