import { ResourceNotFoundError } from '../../types/errors.js'
import type { Relationship, RelationshipType } from '../../types/index.js'
import type { ConnectionManager } from './connection.js'
import type { EntriesManager } from './entries.js'

export class RelationshipsManager {
    constructor(private ctx: ConnectionManager, private entries: EntriesManager) {}

    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship {
        const db = this.ctx.ensureDb()

        const fromEntry = this.entries.getEntryById(fromEntryId)
        if (!fromEntry) {
            throw new ResourceNotFoundError('Entry', String(fromEntryId))
        }
        const toEntry = this.entries.getEntryById(toEntryId)
        if (!toEntry) {
            throw new ResourceNotFoundError('Entry', String(toEntryId))
        }

        db.run(
            `
            INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type, description)
            VALUES (?, ?, ?, ?)
        `,
            [fromEntryId, toEntryId, relationshipType, description ?? null]
        )

        const result = db.exec('SELECT last_insert_rowid() as id')
        const id = result[0]?.values[0]?.[0] as number

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
        const db = this.ctx.ensureDb()
        const result = db.exec(
            `
            SELECT * FROM relationships
            WHERE from_entry_id = ? OR to_entry_id = ?
        `,
            [entryId, entryId]
        )

        if (result.length === 0) return []

        const columns = result[0]?.columns ?? []
        return (result[0]?.values ?? []).map((values: unknown[]) => {
            const row = this.rowToObject(columns, values)
            return {
                id: row['id'] as number,
                fromEntryId: row['from_entry_id'] as number,
                toEntryId: row['to_entry_id'] as number,
                relationshipType: row['relationship_type'] as RelationshipType,
                description: row['description'] as string | null,
                createdAt: row['created_at'] as string,
            }
        })
    }

    private rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
            obj[col] = values[i]
        })
        return obj
    }
}
