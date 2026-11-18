import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { JournalEntry, Relationship, RelationshipType } from '../types/index.js'
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

export interface LinkImportedOptions {
    prefetchedTargets?: ReadonlyMap<number, JournalEntry>
    prefetchedExisting?: readonly Relationship[]
}

export function linkImportedRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    relationships: { type: string; target_id: number }[] | undefined,
    workspaceId: string | undefined,
    idRemap: ReadonlyMap<number, number>,
    projectNumber?: number,
    options?: LinkImportedOptions
): { linked: number; rejected: string[]; missingTargets: number[] } {
    if (relationships === undefined) return { linked: 0, rejected: [], missingTargets: [] }
    let linked = 0
    const missingTargetsSet = new Set<number>()
    const rejectedSet = new Set<string>()
    const seenPairs = new Set<string>()
    const existingRels: Relationship[] = options?.prefetchedExisting
        ? [...options.prefetchedExisting]
        : typeof db.getRelationships === 'function'
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
        const targetExists = options?.prefetchedTargets
            ? options.prefetchedTargets.get(targetId)
            : db.getEntryById(targetId, workspaceId)
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

function prefetchBatchRelationshipContext(
    db: IDatabaseAdapter,
    pendingLinks: readonly PendingRelationshipLink[],
    idRemap: ReadonlyMap<number, number>
): {
    prefetchedTargetsByWs: Map<string, Map<number, JournalEntry>>
    prefetchedRelsByWs: Map<string, Map<number, Relationship[]>>
} {
    const targetsByWs = new Map<string, Set<number>>()
    const entriesByWs = new Map<string, number[]>()
    for (const pending of pendingLinks) {
        if (pending.relationships === undefined || pending.relationships.length === 0) continue
        const wsKey = pending.workspaceId ?? '*'
        const eList = entriesByWs.get(wsKey) ?? []
        eList.push(pending.entryId)
        entriesByWs.set(wsKey, eList)
        const tSet = targetsByWs.get(wsKey) ?? new Set<number>()
        for (const rel of pending.relationships) {
            tSet.add(idRemap.get(rel.target_id) ?? rel.target_id)
        }
        targetsByWs.set(wsKey, tSet)
    }

    const prefetchedTargetsByWs = new Map<string, Map<number, JournalEntry>>()
    if (typeof db.getEntriesByIds === 'function') {
        for (const [wsKey, idSet] of targetsByWs) {
            prefetchedTargetsByWs.set(
                wsKey,
                db.getEntriesByIds(Array.from(idSet), wsKey === '*' ? undefined : wsKey)
            )
        }
    }

    const prefetchedRelsByWs = new Map<string, Map<number, Relationship[]>>()
    if (typeof db.getRelationshipsForEntries === 'function') {
        for (const [wsKey, entryIds] of entriesByWs) {
            prefetchedRelsByWs.set(
                wsKey,
                db.getRelationshipsForEntries(entryIds, wsKey === '*' ? undefined : wsKey)
            )
        }
    }

    return { prefetchedTargetsByWs, prefetchedRelsByWs }
}

export function applyImportedRelationshipBatch(
    db: IDatabaseAdapter,
    pendingLinks: readonly PendingRelationshipLink[],
    idRemap: ReadonlyMap<number, number>,
    result: ImportedRelationshipBatchResult
): void {
    const { prefetchedTargetsByWs, prefetchedRelsByWs } = prefetchBatchRelationshipContext(
        db,
        pendingLinks,
        idRemap
    )

    for (const pending of pendingLinks) {
        const wsKey = pending.workspaceId ?? '*'
        const targetsMap = prefetchedTargetsByWs.get(wsKey)
        const relsMap = prefetchedRelsByWs.get(wsKey)
        const options: LinkImportedOptions | undefined =
            targetsMap !== undefined || relsMap !== undefined
                ? {
                      ...(targetsMap !== undefined ? { prefetchedTargets: targetsMap } : {}),
                      ...(relsMap !== undefined
                          ? { prefetchedExisting: relsMap.get(pending.entryId) ?? [] }
                          : {}),
                  }
                : undefined
        const linked = linkImportedRelationships(
            db,
            pending.entryId,
            pending.relationships,
            pending.workspaceId,
            idRemap,
            pending.projectNumber,
            options
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

/** Validate relationship types and target existence during `dry_run` without mutating DB rows. */
export function validateDryRunRelationships(
    db: IDatabaseAdapter,
    pendingLinks: readonly PendingRelationshipLink[],
    inBatchMjIds: ReadonlySet<number>,
    result: ImportedRelationshipBatchResult
): void {
    const externalPending: PendingRelationshipLink[] = []
    for (const pending of pendingLinks) {
        if (pending.relationships === undefined || pending.relationships.length === 0) continue
        const filtered = pending.relationships.filter(
            (rel) => isRelationshipType(rel.type) && !inBatchMjIds.has(rel.target_id)
        )
        if (filtered.length > 0) {
            externalPending.push({ ...pending, relationships: filtered })
        }
    }
    const { prefetchedTargetsByWs } = prefetchBatchRelationshipContext(
        db,
        externalPending,
        new Map()
    )

    for (const pending of pendingLinks) {
        if (pending.relationships === undefined || pending.relationships.length === 0) continue
        const wsKey = pending.workspaceId ?? '*'
        const targetsMap = prefetchedTargetsByWs.get(wsKey)
        const rejectedSet = new Set<string>()
        const missingTargetsSet = new Set<number>()
        for (const rel of pending.relationships) {
            if (!isRelationshipType(rel.type)) {
                rejectedSet.add(rel.type)
                continue
            }
            if (rel.target_id === pending.entryId || inBatchMjIds.has(rel.target_id)) continue
            const target = targetsMap ? targetsMap.get(rel.target_id) : db.getEntryById(rel.target_id, pending.workspaceId)
            const wrongProject =
                pending.projectNumber !== undefined &&
                target?.projectNumber !== null &&
                target?.projectNumber !== undefined &&
                target.projectNumber !== pending.projectNumber
            if (target === null || target === undefined || wrongProject) {
                missingTargetsSet.add(rel.target_id)
            }
        }
        for (const targetId of missingTargetsSet) {
            result.errors.push({
                file: pending.filename,
                error: `Relationship target ${String(targetId)} does not exist and was not linked`,
            })
            result.success = false
        }
        for (const relType of rejectedSet) {
            result.errors.push({
                file: pending.filename,
                error: `Unknown relationship type '${relType}' was not linked`,
            })
            result.success = false
        }
    }
}
