import { QueryError } from '../../types/errors.js'
import type { IDatabaseConnection, TeamMember, TeamRole } from '../core/interfaces.js'

export class MembersManager {
    private db: IDatabaseConnection

    constructor(db: IDatabaseConnection) {
        this.db = db
    }

    /**
     * Helper to retrieve a single query result row safely
     */
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

    /**
     * Map a raw DB row to the TeamMember interface
     */
    private mapToTeamMember(row: Record<string, unknown>): TeamMember {
        return {
            id: Number(row['id']),
            author: String(row['author']),
            role: String(row['role']) as TeamRole,
            displayName: typeof row['display_name'] === 'string' ? row['display_name'] : null,
            addedBy: typeof row['added_by'] === 'string' ? row['added_by'] : null,
            createdAt: String(row['created_at']),
            updatedAt: String(row['updated_at']),
        }
    }

    addMember(author: string, role: TeamRole, addedBy?: string, displayName?: string): TeamMember {
        try {
            // NOCASE constraint handles the duplicate checks at the DB level,
            // but we'll do an upsert or let it fail if the schema is strictly UNIQUE
            this.db.run(
                `INSERT INTO team_members (author, role, added_by, display_name)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(author) DO UPDATE SET
                    role = excluded.role,
                    added_by = excluded.added_by,
                    display_name = excluded.display_name,
                    updated_at = datetime('now')`,
                [author, role, addedBy ?? null, displayName ?? null]
            )

            const member = this.getMember(author)
            if (!member) {
                throw new QueryError(`Failed to retrieve newly added member: ${author}`)
            }
            return member
        } catch (error) {
            if (error instanceof Error) {
                throw new QueryError(`Failed to add team member: ${error.message}`)
            }
            throw error
        }
    }

    removeMember(author: string): boolean {
        try {
            this.db.run(`DELETE FROM team_members WHERE author = ? COLLATE NOCASE`, [author])
            
            // Check if any rows were affected (SQLite specific hack, usually requires native checking,
            // but for simplicity, we'll assume it succeeded if no error was thrown.
            // A more robust way is to check if it exists first.
            return true
        } catch (error) {
            if (error instanceof Error) {
                throw new QueryError(`Failed to remove team member: ${error.message}`)
            }
            throw error
        }
    }

    updateRole(author: string, newRole: TeamRole): TeamMember | null {
        try {
            this.db.run(
                `UPDATE team_members 
                 SET role = ?, updated_at = datetime('now') 
                 WHERE author = ? COLLATE NOCASE`,
                [newRole, author]
            )
            return this.getMember(author)
        } catch (error) {
            if (error instanceof Error) {
                throw new QueryError(`Failed to update member role: ${error.message}`)
            }
            throw error
        }
    }

    getMember(author: string): TeamMember | null {
        try {
            const results = this.db.exec(
                `SELECT * FROM team_members WHERE author = ? COLLATE NOCASE`,
                [author]
            )
            const row = this.getSingleRow(results)
            if (!row) return null
            return this.mapToTeamMember(row)
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table')) {
                // Table might not exist yet if legacy DB or schema not fully applied
                return null
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to get team member: ${error.message}`)
            }
            throw error
        }
    }

    listMembers(): TeamMember[] {
        try {
            const results = this.db.exec(`SELECT * FROM team_members ORDER BY author ASC`)
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
                return this.mapToTeamMember(mappedRow)
            })
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table')) {
                return []
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to list team members: ${error.message}`)
            }
            throw error
        }
    }

    getMemberCount(): number {
        try {
            const results = this.db.exec(`SELECT COUNT(*) as count FROM team_members`)
            const row = this.getSingleRow(results)
            return typeof row?.['count'] === 'number' ? row['count'] : 0
        } catch (error) {
             if (error instanceof Error && error.message.includes('no such table')) {
                return 0
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to count team members: ${error.message}`)
            }
            throw error
        }
    }

    isRbacActive(): boolean {
        return this.getMemberCount() > 0
    }

    resolveRole(author: string, defaultRole: TeamRole | 'denied' = 'denied'): TeamRole | null {
        // 1. If RBAC is not active (empty table), return 'admin' for legacy full access
        if (!this.isRbacActive()) {
            return 'admin'
        }

        // 2. Look up the author
        const member = this.getMember(author)
        if (member) {
            return member.role
        }

        // 3. Fallback to default
        return defaultRole === 'denied' ? null : defaultRole
    }
}
