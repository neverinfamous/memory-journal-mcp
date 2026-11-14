import { QueryError, ValidationError } from '../../types/errors.js'
import { effectiveWorkspace } from '../workspace-scope.js'
import { isMissingTableError } from './schema-errors.js'
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
        if (workspaceId?.trim() === '*') {
            throw new ValidationError(
                "Aliases are stored per workspace; workspaceId '*' is not a valid destination. Provide a concrete workspace."
            )
        }
        try {
            if (alias.toLowerCase() === canonicalAuthor.toLowerCase()) {
                throw new QueryError('Cannot alias an author to themselves')
            }

            const storedWorkspace = effectiveWorkspace(workspaceId)
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
            const scopeId = effectiveWorkspace(workspaceId)
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
            const scopeId = effectiveWorkspace(workspaceId)
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
            if (isMissingTableError(error)) {
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
            const scopeId = effectiveWorkspace(workspaceId)
            const scoped = scopeId !== '*'
            const sql = scoped
                ? `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE AND (workspace_id IS NULL OR workspace_id = ?) ORDER BY workspace_id IS NULL ASC LIMIT 1`
                : `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE ORDER BY workspace_id IS NULL ASC LIMIT 1`
            const params = scoped ? [rawAuthor, scopeId] : [rawAuthor]
            const results = this.db.exec(sql, params)
            const row = this.getSingleRow(results)
            if (row && typeof row['canonical_author'] === 'string') {
                return row['canonical_author']
            }
            return rawAuthor
        } catch (error) {
            // If table doesn't exist yet, just return the raw author
            if (isMissingTableError(error)) {
                return rawAuthor
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to resolve author: ${error.message}`)
            }
            throw error
        }
    }

    resolveAuthors(rawAuthors: string[], workspaceId?: string): Map<string, string> {
        const resultMap = new Map<string, string>()
        if (rawAuthors.length === 0) return resultMap

        // Pre-fill with original authors as fallback
        for (const author of rawAuthors) {
            resultMap.set(author, author)
        }

        try {
            const placeholders = rawAuthors.map(() => '?').join(',')
            const scopeId = effectiveWorkspace(workspaceId)
            const scoped = scopeId !== '*'
            const sql = scoped
                ? `SELECT alias, canonical_author FROM author_aliases WHERE alias IN (${placeholders}) COLLATE NOCASE AND (workspace_id IS NULL OR workspace_id = ?) ORDER BY workspace_id IS NULL DESC`
                : `SELECT alias, canonical_author FROM author_aliases WHERE alias IN (${placeholders}) COLLATE NOCASE ORDER BY workspace_id IS NULL DESC`
            const params = scoped ? [...rawAuthors, scopeId] : rawAuthors
            const results = this.db.exec(sql, params)

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
            if (!isMissingTableError(error)) {
                throw error
            }
        }

        return resultMap
    }

    consolidateAuthors(
        canonicalAuthor: string,
        workspaceId?: string,
        projectNumber?: number | null
    ): number {
        try {
            const scopeId = effectiveWorkspace(workspaceId)
            const scoped = scopeId !== '*'
            const projectScoped = typeof projectNumber === 'number'
            const journalFilter =
                (scoped ? ' AND workspace_id = ?' : '') +
                (projectScoped ? ' AND project_number = ?' : '')
            const aliasScopeClause = scoped
                ? ' AND (aa.workspace_id IS NULL OR aa.workspace_id = ?)'
                : ''
            const countParams: unknown[] = [
                ...(scoped ? [scopeId] : []),
                ...(projectScoped ? [projectNumber] : []),
                canonicalAuthor,
                ...(scoped ? [scopeId] : []),
            ]
            const countResults = this.db.exec(
                `SELECT COUNT(*) as count FROM memory_journal
                 WHERE deleted_at IS NULL${journalFilter} AND EXISTS (
                     SELECT 1 FROM author_aliases aa
                     WHERE aa.canonical_author = ? COLLATE NOCASE
                       AND aa.alias = memory_journal.author
                       AND (aa.workspace_id IS NULL OR aa.workspace_id = memory_journal.workspace_id)${aliasScopeClause}
                 )`,
                countParams
            )

            const countRow = this.getSingleRow(countResults)
            const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0

            if (count > 0) {
                const updateParams: unknown[] = [
                    canonicalAuthor,
                    ...(scoped ? [scopeId] : []),
                    ...(projectScoped ? [projectNumber] : []),
                    canonicalAuthor,
                    ...(scoped ? [scopeId] : []),
                ]
                this.db.run(
                    `UPDATE memory_journal
                     SET author = ?
                     WHERE deleted_at IS NULL${journalFilter} AND EXISTS (
                         SELECT 1 FROM author_aliases aa
                         WHERE aa.canonical_author = ? COLLATE NOCASE
                           AND aa.alias = memory_journal.author
                           AND (aa.workspace_id IS NULL OR aa.workspace_id = memory_journal.workspace_id)${aliasScopeClause}
                     )`,
                    updateParams
                )
            }

            return count
        } catch (error) {
            if (isMissingTableError(error)) {
                return 0
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to consolidate authors: ${error.message}`)
            }
            throw error
        }
    }
}
