import type { NativeConnectionManager } from './native-connection.js'

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
        db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?').run(bigId)
        db.prepare('INSERT INTO vec_embeddings(entry_id, embedding) VALUES (?, ?)').run(
            bigId,
            embedding
        )
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
        limit: number
    ): { entry_id: number; distance: number }[] {
        const db = this.connection.getNativeDb()
        return db
            .prepare(
                `SELECT v.entry_id, v.distance 
                 FROM vec_embeddings v
                 LEFT JOIN memory_journal mj ON v.entry_id = mj.id
                 WHERE v.embedding MATCH ? AND v.k = ? AND mj.deleted_at IS NULL 
                 ORDER BY v.distance LIMIT ?`
            )
            .all(embedding, limit * 4, limit) as { entry_id: number; distance: number }[]
    }

    getVector(entryId: number): Float32Array | null {
        try {
            const db = this.connection.getNativeDb()
            const row = db
                .prepare('SELECT embedding FROM vec_embeddings WHERE entry_id = ?')
                .get(BigInt(entryId)) as { embedding: Buffer } | undefined
            if (!row) return null
            return new Float32Array(row.embedding.buffer, row.embedding.byteOffset)
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return null
            }
            throw error
        }
    }

    deleteVector(entryId: number): void {
        try {
            this.connection
                .getNativeDb()
                .prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
                .run(BigInt(entryId))
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return
            }
            throw error
        }
    }

    clearVectors(): void {
        try {
            this.connection.getNativeDb().prepare('DELETE FROM vec_embeddings').run()
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
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
            if (error instanceof Error && error.message.includes('no such table')) {
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
                    'DELETE FROM vec_embeddings WHERE entry_id NOT IN (SELECT id FROM memory_journal WHERE deleted_at IS NULL)'
                )
                .run()
            return result.changes
        } catch (error: unknown) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return 0
            }
            throw error
        }
    }
}
