import type { Database } from 'better-sqlite3'
import type { Relationship, RelationshipType } from '../../types/index.js'
import type { NativeConnectionManager } from './native-connection.js'
import type { EntriesManager } from './entries/index.js'

export class RelationshipsManager {
    private ctx: NativeConnectionManager
    private entries: EntriesManager

    constructor(ctx: NativeConnectionManager, entries: EntriesManager) {
        this.ctx = ctx
        this.entries = entries
    }

    private get db(): Database {
        return this.ctx.getRawDb() as Database
    }

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship {
        const db = this.db

        this.entries.getEntryById(fromEntryId)
        this.entries.getEntryById(toEntryId)

        const result = db
            .prepare(
                `INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type, description)
                 VALUES (?, ?, ?, ?)`
            )
            .run(fromEntryId, toEntryId, relationshipType, description ?? null)

        const id = result.lastInsertRowid as number

        this.ctx.scheduleSave()

        return {
            id,
            fromEntryId,
            toEntryId,
            relationshipType,
            description: description ?? null,
            createdAt: new Date().toISOString(),
        }
    }

    getRelationships(entryId: number): Relationship[] {
        const rows = this.db
            .prepare(
                `SELECT id, from_entry_id as fromEntryId, to_entry_id as toEntryId,
                        relationship_type as relationshipType, description, created_at as createdAt
                 FROM relationships
                 WHERE from_entry_id = ? OR to_entry_id = ?`
            )
            .all(entryId, entryId) as {
            id: number
            fromEntryId: number
            toEntryId: number
            relationshipType: RelationshipType
            description: string | null
            createdAt: string
        }[]

        return rows
    }

    getRelationshipsForEntries(entryIds: number[]): Map<number, Relationship[]> {
        const result = new Map<number, Relationship[]>()
        if (entryIds.length === 0) return result
        
        for (const id of entryIds) {
            result.set(id, [])
        }

        const marks = entryIds.map(() => '?').join(', ')
        const rows = this.db
            .prepare(
                `SELECT id, from_entry_id as fromEntryId, to_entry_id as toEntryId,
                        relationship_type as relationshipType, description, created_at as createdAt
                 FROM relationships
                 WHERE from_entry_id IN (${marks}) OR to_entry_id IN (${marks})`
            )
            .all(...entryIds, ...entryIds) as {
            id: number
            fromEntryId: number
            toEntryId: number
            relationshipType: RelationshipType
            description: string | null
            createdAt: string
        }[]

        for (const row of rows) {
            const rel = {
                id: row.id,
                fromEntryId: row.fromEntryId,
                toEntryId: row.toEntryId,
                relationshipType: row.relationshipType,
                description: row.description,
                createdAt: row.createdAt,
            }
            const fromList = result.get(row.fromEntryId)
            if (fromList) {
                fromList.push(rel)
            }
            if (row.fromEntryId !== row.toEntryId) {
                const toList = result.get(row.toEntryId)
                if (toList) {
                    toList.push(rel)
                }
            }
        }

        return result
    }
}
