import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { RelationshipType } from '../types/index.js'
import { RELATIONSHIP_TYPES } from '../types/index.js'

const VALID_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES)

function isRelationshipType(value: string): value is RelationshipType {
    return VALID_RELATIONSHIP_TYPES.has(value)
}

export interface PendingRelationshipLink {
    entryId: number
    filename: string
    relationships: { type: string; target_id: number }[] | undefined
    workspaceId: string | undefined
    projectNumber: number | undefined
}

export interface ImportedRelationshipBatchResult {
    success: boolean
    relationshipsLinked: number
    errors: { file: string; error: string }[]
}

export function linkImportedRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    relationships: { type: string; target_id: number }[] | undefined,
    workspaceId: string | undefined,
    idRemap: ReadonlyMap<number, number>,
    projectNumber?: number
): { linked: number; rejected: string[]; missingTargets: number[] } {
    if (relationships === undefined) return { linked: 0, rejected: [], missingTargets: [] }
    let linked = 0
    const missingTargetsSet = new Set<number>()
    const rejectedSet = new Set<string>()
    const seenPairs = new Set<string>()
    const existingRels =
        typeof db.getRelationships === 'function'
            ? db.getRelationships(entryId, workspaceId)
            : []
    for (const rel of relationships) {
        const relType = rel.type
        if (!isRelationshipType(relType)) {
            rejectedSet.add(relType)
            continue
        }
        const targetId = idRemap.get(rel.target_id) ?? rel.target_id
        if (targetId === entryId) continue
        const pairKey = `${relType}:${String(targetId)}`
        if (seenPairs.has(pairKey)) continue
        seenPairs.add(pairKey)
        const alreadyExists = existingRels.some(
            (r) =>
                r.fromEntryId === entryId &&
                r.toEntryId === targetId &&
                r.relationshipType === relType
        )
        if (alreadyExists) continue
        const targetExists = db.getEntryById(targetId, workspaceId)
        if (
            targetExists === null ||
            targetExists === undefined ||
            (projectNumber !== undefined &&
                targetExists.projectNumber !== null &&
                targetExists.projectNumber !== undefined &&
                targetExists.projectNumber !== projectNumber)
        ) {
            missingTargetsSet.add(targetId)
            continue
        }
        if (workspaceId !== undefined) {
            db.linkEntries(entryId, targetId, relType, undefined, workspaceId)
        } else {
            db.linkEntries(entryId, targetId, relType)
        }
        existingRels.push({
            id: 0,
            fromEntryId: entryId,
            toEntryId: targetId,
            relationshipType: relType,
            description: null,
            createdAt: '',
        })
        linked++
    }
    return {
        linked,
        rejected: Array.from(rejectedSet),
        missingTargets: Array.from(missingTargetsSet),
    }
}

export function applyImportedRelationshipBatch(
    db: IDatabaseAdapter,
    pendingLinks: readonly PendingRelationshipLink[],
    idRemap: ReadonlyMap<number, number>,
    result: ImportedRelationshipBatchResult
): void {
    for (const pending of pendingLinks) {
        const linked = linkImportedRelationships(
            db,
            pending.entryId,
            pending.relationships,
            pending.workspaceId,
            idRemap,
            pending.projectNumber
        )
        result.relationshipsLinked += linked.linked
        for (const targetId of linked.missingTargets) {
            result.errors.push({
                file: pending.filename,
                error: `Relationship target ${String(targetId)} does not exist and was not linked`,
            })
            result.success = false
        }
        for (const relType of linked.rejected) {
            result.errors.push({
                file: pending.filename,
                error: `Unknown relationship type '${relType}' was not linked`,
            })
            result.success = false
        }
    }
}
