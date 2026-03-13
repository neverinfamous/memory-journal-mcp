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
}
