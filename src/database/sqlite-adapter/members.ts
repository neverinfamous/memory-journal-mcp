import { QueryError } from '../../types/errors.js'
import { isMissingTableError } from './schema-errors.js'
import { getSingleRow } from './row-helpers.js'
import type { IDatabaseConnection, TeamMember, TeamRole } from '../core/interfaces.js'

export class MembersManager {
    private db: IDatabaseConnection
    private rbacActiveCache: boolean | null = null

    constructor(db: IDatabaseConnection) {
        this.db = db
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
            if (!this.isRbacActive() && role !== 'admin') {
                throw new QueryError(
                    `First team member must be bootstrapped with the 'admin' role (received '${role}')`
                )
            }
            const existing = this.getMember(author)
            if (existing) {
                throw new QueryError(`Failed to add team member: Member already exists (${author})`)
            }

            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                nativeDb
                    .prepare(
                        `INSERT INTO team_members (author, role, added_by, display_name)
                         VALUES (?, ?, ?, ?)`
                    )
                    .run(author, role, addedBy ?? null, displayName ?? null)
            } else {
                this.db.run(
                    `INSERT INTO team_members (author, role, added_by, display_name)
                     VALUES (?, ?, ?, ?)`,
                    [author, role, addedBy ?? null, displayName ?? null]
                )
            }

            this.rbacActiveCache = true

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
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const info = nativeDb
                    .prepare(`DELETE FROM team_members WHERE author = ? COLLATE NOCASE`)
                    .run(author)
                if (info.changes === 0) return false
                this.rbacActiveCache = null
                return true
            }
            const existing = this.getMember(author)
            if (existing === null) {
                return false
            }

            this.db.run(`DELETE FROM team_members WHERE author = ? COLLATE NOCASE`, [author])
            this.rbacActiveCache = null
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
            const sql = `UPDATE team_members 
                 SET role = ?, updated_at = datetime('now') 
                 WHERE author = ? COLLATE NOCASE`
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                nativeDb.prepare(sql).run(newRole, author)
            } else {
                this.db.run(sql, [newRole, author])
            }
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
            const sql = `SELECT * FROM team_members WHERE author = ? COLLATE NOCASE`
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const row = nativeDb.prepare(sql).get(author) as Record<string, unknown> | undefined
                return row ? this.mapToTeamMember(row) : null
            }
            const results = this.db.exec(sql, [author])
            const row = getSingleRow(results)
            if (!row) return null
            return this.mapToTeamMember(row)
        } catch (error) {
            if (isMissingTableError(error)) {
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
            const sql = `SELECT * FROM team_members ORDER BY author ASC`
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const rows = nativeDb.prepare(sql).all() as Record<string, unknown>[]
                return rows.map((row) => this.mapToTeamMember(row))
            }
            const results = this.db.exec(sql)
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
            if (isMissingTableError(error)) {
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
            const sql = `SELECT COUNT(*) as count FROM team_members`
            const nativeDb = this.db.getNativeDb?.()
            if (nativeDb !== undefined) {
                const row = nativeDb.prepare(sql).get() as { count?: unknown } | undefined
                return typeof row?.count === 'number' ? row.count : 0
            }
            const results = this.db.exec(sql)
            const row = getSingleRow(results)
            return typeof row?.['count'] === 'number' ? row['count'] : 0
        } catch (error) {
             if (isMissingTableError(error)) {
                return 0
            }
            if (error instanceof Error) {
                throw new QueryError(`Failed to count team members: ${error.message}`)
            }
            throw error
        }
    }

    isRbacActive(): boolean {
        if (this.rbacActiveCache !== null) {
            return this.rbacActiveCache
        }
        const isActive = this.getMemberCount() > 0
        this.rbacActiveCache = isActive
        return isActive
    }

    invalidateCache(): void {
        this.rbacActiveCache = null
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
