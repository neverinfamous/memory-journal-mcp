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

    addAlias(alias: string, canonicalAuthor: string, createdBy?: string, workspaceId?: string): AuthorAlias {
        try {
            if (alias.toLowerCase() === canonicalAuthor.toLowerCase()) {
                throw new QueryError('Cannot alias an author to themselves')
            }

            const storedWorkspace = workspaceId === '*' || workspaceId === undefined ? 'default' : workspaceId
            this.db.run(
                `INSERT INTO author_aliases (alias, canonical_author, created_by, workspace_id)
                 VALUES (?, ?, ?, ?)`,
                [alias, canonicalAuthor, createdBy ?? null, storedWorkspace]
            )

            const results = this.db.exec(
                `SELECT * FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`,
                [alias, storedWorkspace]
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

    removeAlias(alias: string, workspaceId?: string): boolean {
        try {
            const scopeId = workspaceId ?? 'default'
            const scoped = scopeId !== '*'
            const selectSql = scoped
                ? `SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`
                : `SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE`
            const selectParams = scoped ? [alias, scopeId] : [alias]
            const results = this.db.exec(selectSql, selectParams)
            const row = this.getSingleRow(results)
            if (!row) return false

            const deleteSql = scoped
                ? `DELETE FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`
                : `DELETE FROM author_aliases WHERE alias = ? COLLATE NOCASE`
            this.db.run(deleteSql, selectParams)
            return true
        } catch (error) {
            if (error instanceof Error) {
                throw new QueryError(`Failed to remove author alias: ${error.message}`)
            }
            throw error
        }
    }

    listAliases(canonicalAuthor?: string, workspaceId?: string): AuthorAlias[] {
        try {
            let query = `SELECT * FROM author_aliases`
            const params: unknown[] = []
            const clauses: string[] = []

            if (canonicalAuthor) {
                clauses.push(`canonical_author = ? COLLATE NOCASE`)
                params.push(canonicalAuthor)
            }
            const scopeId = workspaceId ?? 'default'
            if (scopeId !== '*') {
                clauses.push(`(workspace_id IS NULL OR workspace_id = ?)`)
                params.push(scopeId)
            }
            if (clauses.length > 0) {
                query += ` WHERE ${clauses.join(' AND ')}`
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

    resolveAuthor(rawAuthor: string, workspaceId?: string): string {
        try {
            const scopeId = workspaceId ?? 'default'
            const scoped = scopeId !== '*'
            const sql = scoped
                ? `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE AND (workspace_id IS NULL OR workspace_id = ?)`
                : `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE`
            const params = scoped ? [rawAuthor, scopeId] : [rawAuthor]
            const results = this.db.exec(sql, params)
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

    consolidateAuthors(canonicalAuthor: string, workspaceId?: string): number {
        try {
            const scopeId = workspaceId ?? 'default'
            const scoped = scopeId !== '*'
            const journalFilter = scoped ? ' AND workspace_id = ?' : ''
            const aliasFilter = scoped ? ' AND (workspace_id IS NULL OR workspace_id = ?)' : ''
            const countParams: unknown[] = scoped
                ? [scopeId, canonicalAuthor, scopeId]
                : [canonicalAuthor]
            const countResults = this.db.exec(
                `SELECT COUNT(*) as count FROM memory_journal
                 WHERE deleted_at IS NULL${journalFilter} AND author IN (
                     SELECT alias FROM author_aliases WHERE canonical_author = ? COLLATE NOCASE${aliasFilter}
                 )`,
                countParams
            )

            const countRow = this.getSingleRow(countResults)
            const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0

            if (count > 0) {
                const updateParams: unknown[] = scoped
                    ? [canonicalAuthor, scopeId, canonicalAuthor, scopeId]
                    : [canonicalAuthor, canonicalAuthor]
                this.db.run(
                    `UPDATE memory_journal
                     SET author = ?
                     WHERE deleted_at IS NULL${journalFilter} AND author IN (
                         SELECT alias FROM author_aliases WHERE canonical_author = ? COLLATE NOCASE${aliasFilter}
                     )`,
                    updateParams
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
