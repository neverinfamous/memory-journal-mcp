import type { NativeConnectionManager } from './native-connection.js'
import { effectiveWorkspace } from '../workspace-scope.js'
import { isMissingTableError } from './schema-errors.js'
import { bucketInParams } from './row-helpers.js'

/** Initial KNN over-fetch factor applied before the workspace filter. */
const VECTOR_KNN_OVERFETCH = 4
/** sqlite-vec rejects k above 4096. */
const VECTOR_KNN_MAX_K = 4096

export class VectorOperations {
    constructor(private connection: NativeConnectionManager) {}

    getVectorMetadata(key: string): string | undefined {
        return this.connection.getVectorMetadata(key)
    }

    setVectorMetadata(key: string, value: string): void {
        this.connection.setVectorMetadata(key, value)
    }

    createVecTable(dimensions: number): void {
        this.connection.createVecTable(dimensions)
    }

    dropVecTable(): void {
        this.connection.dropVecTable()
    }

    upsertVector(entryId: number, embedding: Float32Array): void {
        const bigId = BigInt(entryId)
        const db = this.connection.getNativeDb()
        const deleteStmt = db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
        const insertStmt = db.prepare(
            'INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)'
        )
        db.transaction(() => {
            deleteStmt.run(bigId)
            insertStmt.run(bigId, embedding)
        })()
    }

    upsertVectors(vectors: { entryId: number; embedding: Float32Array }[]): void {
        const db = this.connection.getNativeDb()
        const deleteStmt = db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
        const insertStmt = db.prepare(
            'INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)'
        )

        db.transaction(() => {
            for (const vec of vectors) {
                const bigId = BigInt(vec.entryId)
                deleteStmt.run(bigId)
                insertStmt.run(bigId, vec.embedding)
            }
        })()
    }

    searchVectors(
        embedding: Float32Array,
        limit: number,
        workspaceId?: string,
        projectNumber?: number
    ): { entry_id: number; distance: number }[] {
        const db = this.connection.getNativeDb()
        const scopeId = effectiveWorkspace(workspaceId)
        const wsScoped = scopeId !== '*'
        const pnScoped = projectNumber !== undefined
        const scoped = wsScoped || pnScoped

        const clauses = ['v.embedding MATCH ?', 'v.k = ?', 'mj.deleted_at IS NULL']
        if (wsScoped) clauses.push('mj.workspace_id = ?')
        if (pnScoped) clauses.push('mj.project_number = ?')
        const sql = `SELECT v.entry_id, v.distance
             FROM vec_embeddings v
             CROSS JOIN memory_journal mj ON v.entry_id = mj.id
             WHERE ${clauses.join(' AND ')}
             LIMIT ?`
        const params = (k: number): unknown[] => [
            embedding,
            k,
            ...(wsScoped ? [scopeId] : []),
            ...(pnScoped ? [projectNumber] : []),
            limit,
        ]
        let runKnn: (kVal: number) => { entry_id: number; distance: number }[]
        let rows: { entry_id: number; distance: number }[]
        let k = Math.min(Math.max(1, limit * VECTOR_KNN_OVERFETCH), VECTOR_KNN_MAX_K)
        try {
            const stmt = db.prepare(sql)
            runKnn = (kVal: number): { entry_id: number; distance: number }[] =>
                stmt.all(...params(kVal)) as { entry_id: number; distance: number }[]
            rows = runKnn(k)
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return []
            }
            throw error
        }

        if (!scoped || rows.length >= limit || k >= VECTOR_KNN_MAX_K) {
            return rows
        }

        // Lazy bounds check: only query total/scoped counts when the initial KNN probe under-fills `limit`.
        const totalVectors = this.getVectorCount()
        if (totalVectors === 0) return []
        const effectiveMaxK = Math.min(VECTOR_KNN_MAX_K, totalVectors)
        if (k >= effectiveMaxK) return rows

        const countClauses = ['deleted_at IS NULL']
        const countParams: unknown[] = []
        if (wsScoped) {
            countClauses.push('workspace_id = ?')
            countParams.push(scopeId)
        }
        if (pnScoped) {
            countClauses.push('project_number = ?')
            countParams.push(projectNumber)
        }
        const countRow = db
            .prepare(`SELECT COUNT(*) as count FROM memory_journal WHERE ${countClauses.join(' AND ')}`)
            .get(...countParams) as { count: number } | undefined
        const targetRows = Math.min(limit, countRow?.count ?? 0)
        if (targetRows === 0) return []

        while (rows.length < targetRows && k < effectiveMaxK) {
            k = Math.min(k * 2, effectiveMaxK)
            rows = runKnn(k)
        }
        return rows
    }

    hasVectors(): boolean {
        try {
            const row = this.connection.getNativeDb().prepare('SELECT 1 FROM vec_embeddings LIMIT 1').get()
            return row !== undefined
        } catch (error) {
            if (isMissingTableError(error)) {
                return false
            }
            throw error
        }
    }

    deleteVectors(entryIds: number[]): number {
        if (entryIds.length === 0) return 0
        const db = this.connection.getNativeDb()
        let deleted = 0
        try {
            for (const { placeholders, params } of bucketInParams(entryIds)) {
                const bigIds = params.map((id) => BigInt(Math.trunc(id)))
                const result = db
                    .prepare(`DELETE FROM vec_embeddings WHERE entry_id IN (${placeholders})`)
                    .run(...bigIds)
                deleted += result.changes
            }
            return deleted
        } catch (error) {
            if (isMissingTableError(error)) {
                return 0
            }
            throw error
        }
    }

    getVector(entryId: number): Float32Array | null {
        try {
            const db = this.connection.getNativeDb()
            const row = db
                .prepare('SELECT embedding FROM vec_embeddings WHERE entry_id = ?')
                .get(BigInt(entryId)) as { embedding: Buffer } | undefined
            if (!row) return null
            const count = Math.floor(row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT)
            if (row.embedding.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
                return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, count)
            }
            const aligned = row.embedding.buffer.slice(
                row.embedding.byteOffset,
                row.embedding.byteOffset + count * Float32Array.BYTES_PER_ELEMENT
            )
            return new Float32Array(aligned)
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return null
            }
            throw error
        }
    }

    getExistingVectorIds(entryIds: number[]): Set<number> {
        const existing = new Set<number>()
        if (entryIds.length === 0) return existing
        try {
            const db = this.connection.getNativeDb()
            for (const { placeholders, params } of bucketInParams(entryIds)) {
                const bigIds = params.map((id) => BigInt(Math.trunc(id)))
                const rows = db
                    .prepare(`SELECT entry_id FROM vec_embeddings WHERE entry_id IN (${placeholders})`)
                    .all(...bigIds) as { entry_id: number | bigint }[]
                for (const row of rows) {
                    existing.add(typeof row.entry_id === 'bigint' ? Number(row.entry_id) : row.entry_id)
                }
            }
            return existing
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return existing
            }
            throw error
        }
    }

    deleteVector(entryId: number): boolean {
        try {
            const result = this.connection
                .getNativeDb()
                .prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
                .run(BigInt(entryId))
            return result.changes > 0
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return false
            }
            throw error
        }
    }

    clearVectors(): void {
        try {
            this.connection.getNativeDb().prepare('DELETE FROM vec_embeddings').run()
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return
            }
            throw error
        }
    }

    getVectorCount(): number {
        try {
            const row = this.connection
                .getNativeDb()
                .prepare('SELECT COUNT(*) as count FROM vec_embeddings')
                .get() as { count: number } | undefined
            return row?.count ?? 0
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return 0
            }
            throw error
        }
    }

    cleanupStaleVectors(): number {
        try {
            const db = this.connection.getNativeDb()
            const result = db
                .prepare(
                    'DELETE FROM vec_embeddings WHERE NOT EXISTS (SELECT 1 FROM memory_journal mj WHERE mj.id = vec_embeddings.entry_id AND mj.deleted_at IS NULL)'
                )
                .run()
            return result.changes
        } catch (error: unknown) {
            if (isMissingTableError(error)) {
                return 0
            }
            throw error
        }
    }
}
