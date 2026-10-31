import { QueryError } from '../../types/errors.js'
import type { IDatabaseConnection, AuthorAlias } from '../core/interfaces.js'

export class AliasManager {
    private db: IDatabaseConnection

    constructor(db: IDatabaseConnection) {
        this.db = db
    }

    private getSingleRow(queryResult: { columns: string[]; values: unknown[][] }[]): Record<string, unknown> | null {
        if (queryResult.length === 0 || (queryResult[0]?.values.length ?? 0) === 0 || (queryResult[0]?.columns.length ?? 0) === 0) {
            return null
        }
        const row = queryResult[0]?.values[0]
        if (!row) return null
        
        const result: Record<string, unknown> = {}
        const columns = queryResult[0]?.columns ?? []
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i]
            if (col) result[col] = row[i]
        }
        return result
    }

    private mapToAuthorAlias(row: Record<string, unknown>): AuthorAlias {
        return {
            id: Number(row['id']),
            alias: String(row['alias']),
            canonicalAuthor: String(row['canonical_author']),
            createdAt: String(row['created_at']),
            createdBy: typeof row['created_by'] === 'string' ? row['created_by'] : null,
        }
    }

    addAlias(alias: string, canonicalAuthor: string, createdBy?: string): AuthorAlias {
        try {
            if (alias.toLowerCase() === canonicalAuthor.toLowerCase()) {
                throw new QueryError('Cannot alias an author to themselves')
            }

            this.db.run(
                `INSERT INTO author_aliases (alias, canonical_author, created_by)
                 VALUES (?, ?, ?)`,
                [alias, canonicalAuthor, createdBy ?? null]
            )

            const results = this.db.exec(
                `SELECT * FROM author_aliases WHERE alias = ? COLLATE NOCASE`,
                [alias]
            )
            const row = this.getSingleRow(results)
            if (!row) {
                throw new QueryError(`Failed to retrieve newly added alias: ${alias}`)
            }
            return this.mapToAuthorAlias(row)
        } catch (error) {
            if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
                throw new QueryError(`Alias '${alias}' already exists`)
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to add author alias: ${error.message}`)
            }
            throw error
        }
    }

    removeAlias(alias: string): boolean {
        try {
            // First check if it exists so we can return false if not
            const results = this.db.exec(
                `SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE`,
                [alias]
            )
            const row = this.getSingleRow(results)
            if (!row) return false

            this.db.run(`DELETE FROM author_aliases WHERE alias = ? COLLATE NOCASE`, [alias])
            return true
        } catch (error) {
            if (error instanceof Error) {
                throw new QueryError(`Failed to remove author alias: ${error.message}`)
            }
            throw error
        }
    }

    listAliases(canonicalAuthor?: string): AuthorAlias[] {
        try {
            let query = `SELECT * FROM author_aliases`
            const params: unknown[] = []

            if (canonicalAuthor) {
                query += ` WHERE canonical_author = ? COLLATE NOCASE`
                params.push(canonicalAuthor)
            }
            query += ` ORDER BY canonical_author ASC, alias ASC`

            const results = this.db.exec(query, params)
            if (results.length === 0 || (results[0]?.values.length ?? 0) === 0 || (results[0]?.columns.length ?? 0) === 0) {
                return []
            }

            const firstResult = results[0]
            if (!firstResult) return []

            return firstResult.values.map(row => {
                const mappedRow: Record<string, unknown> = {}
                for (let i = 0; i < firstResult.columns.length; i++) {
                    const col = firstResult.columns[i]
                    if (col) mappedRow[col] = row[i]
                }
                return this.mapToAuthorAlias(mappedRow)
            })
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return []
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to list author aliases: ${error.message}`)
            }
            throw error
        }
    }

    resolveAuthor(rawAuthor: string): string {
        try {
            const results = this.db.exec(
                `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE`,
                [rawAuthor]
            )
            const row = this.getSingleRow(results)
            if (row && typeof row['canonical_author'] === 'string') {
                return row['canonical_author']
            }
            return rawAuthor
        } catch (error) {
            // If table doesn't exist yet, just return the raw author
            if (error instanceof Error && error.message.includes('no such table')) {
                return rawAuthor
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to resolve author: ${error.message}`)
            }
            throw error
        }
    }

    resolveAuthors(rawAuthors: string[]): Map<string, string> {
        const resultMap = new Map<string, string>()
        if (rawAuthors.length === 0) return resultMap

        // Pre-fill with original authors as fallback
        for (const author of rawAuthors) {
            resultMap.set(author, author)
        }

        try {
            const placeholders = rawAuthors.map(() => '?').join(',')
            const results = this.db.exec(
                `SELECT alias, canonical_author FROM author_aliases WHERE alias IN (${placeholders}) COLLATE NOCASE`,
                rawAuthors
            )

            if (results[0]) {
                const aliasIdx = results[0].columns.indexOf('alias')
                const canonicalIdx = results[0].columns.indexOf('canonical_author')
                
                results[0].values.forEach((row: unknown[]) => {
                    const alias = String(row[aliasIdx])
                    const canonical = String(row[canonicalIdx])
                    // We need to map back to the original casing that was passed in,
                    // so we do a case-insensitive search in our input array
                    const originalAuthor = rawAuthors.find(a => a.toLowerCase() === alias.toLowerCase())
                    if (originalAuthor) {
                        resultMap.set(originalAuthor, canonical)
                    }
                })
            }
        } catch (error) {
            // Ignore missing table
            if (!(error instanceof Error) || !error.message.includes('no such table')) {
                throw error
            }
        }

        return resultMap
    }

    consolidateAuthors(canonicalAuthor: string): number {
        try {
            // SQLite execute typically doesn't return the changes count in the result array format used here,
            // but we can query changes() if we need to. However, this project's exec doesn't return changes.
            // Let's use a workaround: run a select before to get the count.
            // Actually, better to query first, then run update.
            
            const countResults = this.db.exec(
                `SELECT COUNT(*) as count FROM memory_journal 
                 WHERE deleted_at IS NULL AND author IN (
                     SELECT alias FROM author_aliases WHERE canonical_author = ? COLLATE NOCASE
                 )`,
                 [canonicalAuthor]
            )
            
            const countRow = this.getSingleRow(countResults)
            const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0
            
            if (count > 0) {
                this.db.run(
                    `UPDATE memory_journal
                     SET author = ?
                     WHERE deleted_at IS NULL AND author IN (
                         SELECT alias FROM author_aliases WHERE canonical_author = ? COLLATE NOCASE
                     )`,
                     [canonicalAuthor, canonicalAuthor]
                )
            }
            
            return count
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return 0
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to consolidate authors: ${error.message}`)
            }
            throw error
        }
    }
}
