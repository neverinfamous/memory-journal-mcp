import { QueryError, ValidationError } from '../../types/errors.js'
import { effectiveWorkspace } from '../workspace-scope.js'
import { isMissingTableError } from './schema-errors.js'
import { bucketInParams, getSingleRow, runImmediateWriteTx, SCOPED_IN_PARAM_BUCKETS } from './row-helpers.js'
import type { IDatabaseConnection, AuthorAlias } from '../core/interfaces.js'

const AUTHOR_ALIAS_COLUMNS = 'id, alias, canonical_author, created_at, created_by'

export class AliasManager {
    private db: IDatabaseConnection

    constructor(db: IDatabaseConnection) {
        this.db = db
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
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const row = runImmediateWriteTx(nativeDb, () => {
                    nativeDb
                        .prepare(
                            `INSERT INTO author_aliases (alias, canonical_author, created_by, workspace_id)
                             VALUES (?, ?, ?, ?)`
                        )
                        .run(alias, canonicalAuthor, createdBy ?? null, storedWorkspace)
                    return nativeDb
                        .prepare<unknown[], Record<string, unknown>>(
                            `SELECT ${AUTHOR_ALIAS_COLUMNS} FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`
                        )
                        .get(alias, storedWorkspace)
                })
                if (!row) {
                    throw new QueryError(`Failed to retrieve newly added alias: ${alias}`)
                }
                return this.mapToAuthorAlias(row)
            }

            this.db.run(
                `INSERT INTO author_aliases (alias, canonical_author, created_by, workspace_id)
                 VALUES (?, ?, ?, ?)`,
                [alias, canonicalAuthor, createdBy ?? null, storedWorkspace]
            )

            const results = this.db.exec(
                `SELECT ${AUTHOR_ALIAS_COLUMNS} FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`,
                [alias, storedWorkspace]
            )
            const row = getSingleRow(results)
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
        if (workspaceId?.trim() === '*') {
            throw new ValidationError(
                "Wildcard workspace_id '*' is not allowed when removing an author alias."
            )
        }
        try {
            const scopeId = effectiveWorkspace(workspaceId)
            const isDefaultScope = scopeId === 'default'
            const deleteSql = isDefaultScope
                ? `DELETE FROM author_aliases WHERE id = (SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY workspace_id DESC LIMIT 1)`
                : `DELETE FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`
            const deleteParams = [alias, scopeId]
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                return nativeDb.prepare(deleteSql).run(...deleteParams).changes > 0
            }

            const selectSql = isDefaultScope
                ? `SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY workspace_id DESC LIMIT 1`
                : `SELECT id FROM author_aliases WHERE alias = ? COLLATE NOCASE AND workspace_id = ?`
            const results = this.db.exec(selectSql, deleteParams)
            const row = getSingleRow(results)
            if (!row) return false

            this.db.run(deleteSql, deleteParams)
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
            let query = `SELECT ${AUTHOR_ALIAS_COLUMNS} FROM author_aliases`
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

            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const rows = nativeDb
                    .prepare<unknown[], Record<string, unknown>>(query)
                    .all(...params)
                return rows.map((row) => this.mapToAuthorAlias(row))
            }

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
                ? `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE AND (workspace_id IS NULL OR workspace_id = ?) ORDER BY workspace_id DESC LIMIT 1`
                : `SELECT canonical_author FROM author_aliases WHERE alias = ? COLLATE NOCASE ORDER BY workspace_id DESC LIMIT 1`
            const params = scoped ? [rawAuthor, scopeId] : [rawAuthor]
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const row = nativeDb
                    .prepare<unknown[], { canonical_author?: unknown }>(sql)
                    .get(...params)
                return typeof row?.canonical_author === 'string' ? row.canonical_author : rawAuthor
            }
            const results = this.db.exec(sql, params)
            const row = getSingleRow(results)
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
            const scopeId = effectiveWorkspace(workspaceId)
            const scoped = scopeId !== '*'
            const resolvedByLower = new Map<string, string>()
            const nativeDb = this.db.getNativeDb?.()
            for (const { placeholders, params: chunk } of bucketInParams(rawAuthors, SCOPED_IN_PARAM_BUCKETS)) {
                // NULL sorts first in ASC so concrete workspace rows overwrite global aliases in the loop below.
                const sql = scoped
                    ? `SELECT alias, canonical_author FROM author_aliases WHERE alias COLLATE NOCASE IN (${placeholders}) AND (workspace_id IS NULL OR workspace_id = ?) ORDER BY workspace_id ASC`
                    : `SELECT alias, canonical_author FROM author_aliases WHERE alias COLLATE NOCASE IN (${placeholders}) ORDER BY workspace_id ASC`
                const params = scoped ? [...chunk, scopeId] : chunk
                if (nativeDb !== undefined) {
                    const rows = nativeDb
                        .prepare<unknown[], { alias: unknown; canonical_author: unknown }>(sql)
                        .all(...params)
                    for (const row of rows) {
                        resolvedByLower.set(String(row.alias).toLowerCase(), String(row.canonical_author))
                    }
                    continue
                }
                const results = this.db.exec(sql, params)

                if (results[0]) {
                    const aliasIdx = results[0].columns.indexOf('alias')
                    const canonicalIdx = results[0].columns.indexOf('canonical_author')

                    for (const row of results[0].values) {
                        const alias = String(row[aliasIdx])
                        const canonical = String(row[canonicalIdx])
                        resolvedByLower.set(alias.toLowerCase(), canonical)
                    }
                }
            }
            for (const author of rawAuthors) {
                const mapped = resolvedByLower.get(author.toLowerCase())
                if (mapped !== undefined) {
                    resultMap.set(author, mapped)
                }
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
            const updateSql = `UPDATE memory_journal
                 SET author = ?
                 WHERE deleted_at IS NULL${journalFilter}
                   AND (
                       SELECT aa.canonical_author
                       FROM author_aliases aa
                       WHERE aa.alias = memory_journal.author COLLATE NOCASE
                         AND (aa.workspace_id IS NULL OR aa.workspace_id = memory_journal.workspace_id)${aliasScopeClause}
                       ORDER BY aa.workspace_id DESC
                       LIMIT 1
                   ) = ? COLLATE NOCASE`
            const updateParams: unknown[] = [
                canonicalAuthor,
                ...(scoped ? [scopeId] : []),
                ...(projectScoped ? [projectNumber] : []),
                ...(scoped ? [scopeId] : []),
                canonicalAuthor,
            ]
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                return runImmediateWriteTx(
                    nativeDb,
                    () => nativeDb.prepare(updateSql).run(...updateParams).changes
                )
            }

            const countParams: unknown[] = [
                ...(scoped ? [scopeId] : []),
                ...(projectScoped ? [projectNumber] : []),
                ...(scoped ? [scopeId] : []),
                canonicalAuthor,
            ]
            const countResults = this.db.exec(
                `SELECT COUNT(*) as count FROM memory_journal
                 WHERE deleted_at IS NULL${journalFilter}
                   AND (
                       SELECT aa.canonical_author
                       FROM author_aliases aa
                       WHERE aa.alias = memory_journal.author COLLATE NOCASE
                         AND (aa.workspace_id IS NULL OR aa.workspace_id = memory_journal.workspace_id)${aliasScopeClause}
                       ORDER BY aa.workspace_id DESC
                       LIMIT 1
                   ) = ? COLLATE NOCASE`,
                countParams
            )
            const countRow = getSingleRow(countResults)
            const count = typeof countRow?.['count'] === 'number' ? countRow['count'] : 0
            if (count > 0) {
                this.db.run(updateSql, updateParams)
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
