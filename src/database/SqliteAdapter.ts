/**
 * Memory Journal MCP Server - SQLite Database Adapter
 *
 * Manages SQLite database with FTS5 full-text search using sql.js.
 * Note: sql.js is pure JavaScript, no native compilation required.
 */

import initSqlJs, { type Database } from 'sql.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../utils/logger.js'
import { validateDateFormatPattern } from '../utils/security-utils.js'
import type {
    JournalEntry,
    Tag,
    Relationship,
    EntryType,
    SignificanceType,
    RelationshipType,
} from '../types/index.js'

// Schema SQL for initialization
const SCHEMA_SQL = `
-- Main journal entries table
CREATE TABLE IF NOT EXISTS memory_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    is_personal INTEGER DEFAULT 1,
    significance_type TEXT,
    auto_context TEXT,
    deleted_at TEXT,
    -- GitHub integration fields
    project_number INTEGER,
    project_owner TEXT,
    issue_number INTEGER,
    issue_url TEXT,
    pr_number INTEGER,
    pr_url TEXT,
    pr_status TEXT,
    workflow_run_id INTEGER,
    workflow_name TEXT,
    workflow_status TEXT
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    usage_count INTEGER DEFAULT 0
);

-- Junction table for entry-tag relationships
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Relationships between entries
CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_entry_id INTEGER NOT NULL,
    to_entry_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Embeddings for vector search (stored as JSON for sql.js compatibility)
CREATE TABLE IF NOT EXISTS embeddings (
    entry_id INTEGER PRIMARY KEY,
    embedding TEXT NOT NULL,
    model_name TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_journal_timestamp ON memory_journal(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_journal_type ON memory_journal(entry_type);
CREATE INDEX IF NOT EXISTS idx_memory_journal_personal ON memory_journal(is_personal);
CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at);
CREATE INDEX IF NOT EXISTS idx_memory_journal_project ON memory_journal(project_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_issue ON memory_journal(issue_number);
CREATE INDEX IF NOT EXISTS idx_memory_journal_pr ON memory_journal(pr_number);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id);
`

/**
 * Input for creating a new entry
 */
export interface CreateEntryInput {
    content: string
    entryType?: EntryType
    tags?: string[]
    isPersonal?: boolean
    significanceType?: SignificanceType
    autoContext?: string
    projectNumber?: number
    projectOwner?: string
    issueNumber?: number
    issueUrl?: string
    prNumber?: number
    prUrl?: string
    prStatus?: 'draft' | 'open' | 'merged' | 'closed'
    workflowRunId?: number
    workflowName?: string
    workflowStatus?: 'queued' | 'in_progress' | 'completed'
}

/**
 * SQLite Database Adapter for Memory Journal using sql.js
 */
export class SqliteAdapter {
    private db: Database | null = null
    private readonly dbPath: string
    private initialized = false

    constructor(dbPath: string) {
        this.dbPath = dbPath
    }

    /**
     * Initialize the database (must be called before using)
     */
    async initialize(): Promise<void> {
        if (this.initialized) return

        const SQL = await initSqlJs()

        // Try to load existing database
        let dbBuffer: Buffer | null = null
        if (fs.existsSync(this.dbPath)) {
            try {
                dbBuffer = fs.readFileSync(this.dbPath)
            } catch {
                // File doesn't exist or can't be read, create new
            }
        }

        if (dbBuffer) {
            this.db = new SQL.Database(dbBuffer)
        } else {
            this.db = new SQL.Database()
            // Ensure directory exists
            const dir = path.dirname(this.dbPath)
            if (dir && !fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
        }

        // Initialize schema
        this.db.run(SCHEMA_SQL)
        this.initialized = true

        logger.info('Database opened', { module: 'SqliteAdapter', dbPath: this.dbPath })

        // Save after initialization
        this.save()
    }

    /**
     * Save database to disk
     */
    private save(): void {
        if (!this.db) return
        const data = this.db.export()
        const buffer = Buffer.from(data)
        fs.writeFileSync(this.dbPath, buffer)
    }

    /**
     * Close database connection
     */
    close(): void {
        if (this.db) {
            this.save()
            this.db.close()
            this.db = null
        }
        logger.info('Database closed', { module: 'SqliteAdapter' })
    }

    /**
     * Ensure database is initialized
     */
    private ensureDb(): Database {
        if (!this.db) {
            throw new Error('Database not initialized. Call initialize() first.')
        }
        return this.db
    }

    // =========================================================================
    // Entry Operations
    // =========================================================================

    /**
     * Create a new journal entry
     */
    createEntry(input: CreateEntryInput): JournalEntry {
        const db = this.ensureDb()
        const {
            content,
            entryType = 'personal_reflection',
            tags = [],
            isPersonal = true,
            significanceType = null,
            autoContext = null,
            projectNumber,
            projectOwner,
            issueNumber,
            issueUrl,
            prNumber,
            prUrl,
            prStatus,
            workflowRunId,
            workflowName,
            workflowStatus,
        } = input

        db.run(
            `
            INSERT INTO memory_journal (
                entry_type, content, is_personal, significance_type, auto_context,
                project_number, project_owner, issue_number, issue_url,
                pr_number, pr_url, pr_status, workflow_run_id, workflow_name, workflow_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
                entryType,
                content,
                isPersonal ? 1 : 0,
                significanceType,
                autoContext,
                projectNumber ?? null,
                projectOwner ?? null,
                issueNumber ?? null,
                issueUrl ?? null,
                prNumber ?? null,
                prUrl ?? null,
                prStatus ?? null,
                workflowRunId ?? null,
                workflowName ?? null,
                workflowStatus ?? null,
            ]
        )

        // Get the inserted ID
        const result = db.exec('SELECT last_insert_rowid() as id')
        const entryId = result[0]?.values[0]?.[0] as number

        // Create tags and link them
        if (tags.length > 0) {
            this.linkTagsToEntry(entryId, tags)
        }

        this.save()

        logger.info('Entry created', {
            module: 'SqliteAdapter',
            operation: 'createEntry',
            entityId: entryId,
        })

        const entry = this.getEntryById(entryId)
        if (!entry) {
            throw new Error(`Failed to retrieve created entry with ID ${entryId}`)
        }
        return entry
    }

    /**
     * Get entry by ID
     */
    getEntryById(id: number): JournalEntry | null {
        const db = this.ensureDb()
        const result = db.exec(`SELECT * FROM memory_journal WHERE id = ? AND deleted_at IS NULL`, [
            id,
        ])

        if (result.length === 0 || result[0]?.values.length === 0) return null

        const columns = result[0]?.columns ?? []
        const values = result[0]?.values[0] ?? []
        const row = this.rowToObject(columns, values)

        return this.rowToEntry(row)
    }

    /**
     * Calculate importance score for an entry (0.0-1.0)
     *
     * Formula:
     * - significanceWeight (0.30): 1.0 if significanceType set, else 0.0
     * - relationshipWeight (0.35): min(relCount / 5, 1.0)
     * - causalWeight (0.20): min(causalCount / 3, 1.0)
     * - recencyWeight (0.15): max(0, 1 - daysSince / 90)
     */
    calculateImportance(entryId: number): number {
        const db = this.ensureDb()

        // Get entry data
        const entryResult = db.exec(
            `SELECT significance_type, timestamp FROM memory_journal WHERE id = ? AND deleted_at IS NULL`,
            [entryId]
        )
        if (entryResult.length === 0 || entryResult[0]?.values.length === 0) return 0

        const significanceType = entryResult[0]?.values[0]?.[0] as string | null
        const timestamp = entryResult[0]?.values[0]?.[1] as string

        // Significance weight: 1.0 if set, else 0.0
        const significanceWeight = significanceType ? 1.0 : 0.0

        // Relationship count (total relationships involving this entry)
        const relResult = db.exec(
            `SELECT COUNT(*) FROM relationships WHERE from_entry_id = ? OR to_entry_id = ?`,
            [entryId, entryId]
        )
        const relCount = (relResult[0]?.values[0]?.[0] as number) ?? 0
        const relationshipWeight = Math.min(relCount / 5, 1.0)

        // Causal relationships count
        const causalResult = db.exec(
            `SELECT COUNT(*) FROM relationships
             WHERE (from_entry_id = ? OR to_entry_id = ?)
             AND relationship_type IN ('blocked_by', 'resolved', 'caused')`,
            [entryId, entryId]
        )
        const causalCount = (causalResult[0]?.values[0]?.[0] as number) ?? 0
        const causalWeight = Math.min(causalCount / 3, 1.0)

        // Recency weight: decays over 90 days
        const entryDate = new Date(timestamp)
        const now = new Date()
        const daysSince = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24))
        const recencyWeight = Math.max(0, 1 - daysSince / 90)

        // Weighted sum
        const importance =
            significanceWeight * 0.3 +
            relationshipWeight * 0.35 +
            causalWeight * 0.2 +
            recencyWeight * 0.15

        // Round to 2 decimal places
        return Math.round(importance * 100) / 100
    }

    /**
     * Get recent entries
     */
    getRecentEntries(limit = 10, isPersonal?: boolean): JournalEntry[] {
        const db = this.ensureDb()
        let sql = `SELECT * FROM memory_journal WHERE deleted_at IS NULL`
        const params: unknown[] = []

        if (isPersonal !== undefined) {
            sql += ` AND is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }

        sql += ` ORDER BY timestamp DESC, id DESC LIMIT ?`
        params.push(limit)

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        const columns = result[0]?.columns ?? []
        return (result[0]?.values ?? []).map((values) =>
            this.rowToEntry(this.rowToObject(columns, values))
        )
    }

    /**
     * Update an entry
     */
    updateEntry(
        id: number,
        updates: {
            content?: string
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
        }
    ): JournalEntry | null {
        const db = this.ensureDb()
        const entry = this.getEntryById(id)
        if (!entry) return null

        const setClause: string[] = []
        const params: unknown[] = []

        if (updates.content !== undefined) {
            setClause.push('content = ?')
            params.push(updates.content)
        }
        if (updates.entryType !== undefined) {
            setClause.push('entry_type = ?')
            params.push(updates.entryType)
        }
        if (updates.isPersonal !== undefined) {
            setClause.push('is_personal = ?')
            params.push(updates.isPersonal ? 1 : 0)
        }

        if (setClause.length > 0) {
            params.push(id)
            db.run(`UPDATE memory_journal SET ${setClause.join(', ')} WHERE id = ?`, params)
        }

        // Update tags if provided
        if (updates.tags !== undefined) {
            db.run('DELETE FROM entry_tags WHERE entry_id = ?', [id])
            this.linkTagsToEntry(id, updates.tags)
        }

        this.save()

        logger.info('Entry updated', {
            module: 'SqliteAdapter',
            operation: 'updateEntry',
            entityId: id,
        })

        return this.getEntryById(id)
    }

    /**
     * Soft delete an entry
     * Returns false if entry does not exist (P154: Proactive Object Existence Verification)
     */
    deleteEntry(id: number, permanent = false): boolean {
        const db = this.ensureDb()

        // P154: Pre-check entry existence before mutation
        const entry = this.getEntryById(id)
        if (!entry) return false

        if (permanent) {
            db.run('DELETE FROM memory_journal WHERE id = ?', [id])
        } else {
            db.run(`UPDATE memory_journal SET deleted_at = datetime('now') WHERE id = ?`, [id])
        }

        this.save()
        return true
    }

    // =========================================================================
    // Search Operations
    // =========================================================================

    /**
     * Full-text search entries (using LIKE for sql.js - FTS5 not supported)
     */
    searchEntries(
        query: string,
        options: {
            limit?: number
            isPersonal?: boolean
            projectNumber?: number
            issueNumber?: number
            prNumber?: number
        } = {}
    ): JournalEntry[] {
        const db = this.ensureDb()
        const { limit = 10, isPersonal, projectNumber, issueNumber, prNumber } = options

        let sql = `
            SELECT * FROM memory_journal
            WHERE deleted_at IS NULL AND content LIKE ?
        `
        const params: unknown[] = [`%${query}%`]

        if (isPersonal !== undefined) {
            sql += ` AND is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }
        if (projectNumber !== undefined) {
            sql += ` AND project_number = ?`
            params.push(projectNumber)
        }
        if (issueNumber !== undefined) {
            sql += ` AND issue_number = ?`
            params.push(issueNumber)
        }
        if (prNumber !== undefined) {
            sql += ` AND pr_number = ?`
            params.push(prNumber)
        }

        sql += ` ORDER BY timestamp DESC LIMIT ?`
        params.push(limit)

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        const columns = result[0]?.columns ?? []
        return (result[0]?.values ?? []).map((values) =>
            this.rowToEntry(this.rowToObject(columns, values))
        )
    }

    /**
     * Search by date range
     */
    searchByDateRange(
        startDate: string,
        endDate: string,
        options: {
            entryType?: EntryType
            tags?: string[]
            isPersonal?: boolean
            projectNumber?: number
        } = {}
    ): JournalEntry[] {
        const db = this.ensureDb()
        const { entryType, tags, isPersonal, projectNumber } = options

        let sql = `
            SELECT DISTINCT m.* FROM memory_journal m
            LEFT JOIN entry_tags et ON m.id = et.entry_id
            LEFT JOIN tags t ON et.tag_id = t.id
            WHERE m.deleted_at IS NULL
            AND m.timestamp >= ? AND m.timestamp <= ?
        `
        const params: unknown[] = [startDate, endDate + ' 23:59:59']

        if (entryType) {
            sql += ` AND m.entry_type = ?`
            params.push(entryType)
        }
        if (isPersonal !== undefined) {
            sql += ` AND m.is_personal = ?`
            params.push(isPersonal ? 1 : 0)
        }
        if (projectNumber !== undefined) {
            sql += ` AND m.project_number = ?`
            params.push(projectNumber)
        }
        if (tags && tags.length > 0) {
            const placeholders = tags.map(() => '?').join(',')
            sql += ` AND t.name IN (${placeholders})`
            params.push(...tags)
        }

        sql += ` ORDER BY m.timestamp DESC`

        const result = db.exec(sql, params)
        if (result.length === 0) return []

        const columns = result[0]?.columns ?? []
        return (result[0]?.values ?? []).map((values) =>
            this.rowToEntry(this.rowToObject(columns, values))
        )
    }

    // =========================================================================
    // Tag Operations
    // =========================================================================

    /**
     * Get or create tags and link to entry
     */
    private linkTagsToEntry(entryId: number, tagNames: string[]): void {
        const db = this.ensureDb()

        for (const tagName of tagNames) {
            // Insert or ignore tag
            db.run('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)', [tagName])

            // Get tag ID
            const result = db.exec('SELECT id FROM tags WHERE name = ?', [tagName])
            const tagId = result[0]?.values[0]?.[0] as number | undefined

            if (tagId !== undefined) {
                // Link tag to entry
                db.run('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [
                    entryId,
                    tagId,
                ])
                // Increment usage
                db.run('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?', [tagId])
            }
        }
    }

    /**
     * Get tags for an entry
     */
    getTagsForEntry(entryId: number): string[] {
        const db = this.ensureDb()
        const result = db.exec(
            `
            SELECT t.name FROM tags t
            JOIN entry_tags et ON t.id = et.tag_id
            WHERE et.entry_id = ?
        `,
            [entryId]
        )

        if (result.length === 0) return []
        return (result[0]?.values ?? []).map((v: unknown[]) => v[0] as string)
    }

    /**
     * List all tags
     */
    listTags(): Tag[] {
        const db = this.ensureDb()
        const result = db.exec('SELECT * FROM tags ORDER BY usage_count DESC')

        if (result.length === 0) return []

        return (result[0]?.values ?? []).map((v) => ({
            id: v[0] as number,
            name: v[1] as string,
            usageCount: v[2] as number,
        }))
    }

    /**
     * Merge one tag into another (consolidate similar tags)
     * @param sourceTag Tag to merge from (will be deleted)
     * @param targetTag Tag to merge into (will be created if not exists)
     * @returns Merge statistics
     */
    mergeTags(
        sourceTag: string,
        targetTag: string
    ): { entriesUpdated: number; sourceDeleted: boolean } {
        const db = this.ensureDb()

        // Get source tag ID
        const sourceResult = db.exec('SELECT id FROM tags WHERE name = ?', [sourceTag])
        const sourceTagId = sourceResult[0]?.values[0]?.[0] as number | undefined

        if (sourceTagId === undefined) {
            throw new Error(`Source tag not found: ${sourceTag}`)
        }

        // Get or create target tag
        db.run('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)', [targetTag])
        const targetResult = db.exec('SELECT id FROM tags WHERE name = ?', [targetTag])
        const targetTagId = targetResult[0]?.values[0]?.[0] as number | undefined

        if (targetTagId === undefined) {
            throw new Error(`Failed to get or create target tag: ${targetTag}`)
        }

        // Get entries linked to source tag
        const entriesResult = db.exec('SELECT entry_id FROM entry_tags WHERE tag_id = ?', [
            sourceTagId,
        ])
        const entryIds = entriesResult[0]?.values.map((v) => v[0] as number) ?? []

        let entriesUpdated = 0

        for (const entryId of entryIds) {
            // Check if entry already has target tag
            const existing = db.exec('SELECT 1 FROM entry_tags WHERE entry_id = ? AND tag_id = ?', [
                entryId,
                targetTagId,
            ])

            if (existing[0]?.values.length === 0 || !existing[0]) {
                // Add target tag link
                db.run('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)', [
                    entryId,
                    targetTagId,
                ])
                entriesUpdated++
            }
        }

        // Update target tag usage count
        if (entriesUpdated > 0) {
            db.run('UPDATE tags SET usage_count = usage_count + ? WHERE id = ?', [
                entriesUpdated,
                targetTagId,
            ])
        }

        // Remove source tag links and delete source tag
        db.run('DELETE FROM entry_tags WHERE tag_id = ?', [sourceTagId])
        db.run('DELETE FROM tags WHERE id = ?', [sourceTagId])

        this.save()

        logger.info('Tags merged', {
            module: 'SqliteAdapter',
            operation: 'mergeTags',
            context: { sourceTag, targetTag, entriesUpdated },
        })

        return { entriesUpdated, sourceDeleted: true }
    }

    // =========================================================================
    // Relationship Operations
    // =========================================================================

    /**
     * Link two entries
     * Throws if either entry does not exist (P154: Proactive Object Existence Verification)
     */
    linkEntries(
        fromEntryId: number,
        toEntryId: number,
        relationshipType: RelationshipType,
        description?: string
    ): Relationship {
        const db = this.ensureDb()

        // P154: Pre-check both entries exist before creating relationship
        const fromEntry = this.getEntryById(fromEntryId)
        if (!fromEntry) {
            throw new Error(`Source entry ${String(fromEntryId)} not found`)
        }
        const toEntry = this.getEntryById(toEntryId)
        if (!toEntry) {
            throw new Error(`Target entry ${String(toEntryId)} not found`)
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

        this.save()

        return {
            id,
            fromEntryId,
            toEntryId,
            relationshipType,
            description: description ?? null,
            createdAt: new Date().toISOString(),
        }
    }

    /**
     * Get relationships for an entry
     */
    getRelationships(entryId: number): Relationship[] {
        const db = this.ensureDb()
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

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * Get entry statistics with enhanced analytics metrics
     */
    getStatistics(groupBy: 'day' | 'week' | 'month' = 'week'): {
        totalEntries: number
        entriesByType: Record<string, number>
        entriesByPeriod: { period: string; count: number }[]
        // Enhanced analytics (v4.3.0)
        decisionDensity: { period: string; significantCount: number }[]
        relationshipComplexity: {
            totalRelationships: number
            avgPerEntry: number
        }
        activityTrend: {
            currentPeriod: string
            previousPeriod: string
            growthPercent: number | null
        }
        causalMetrics: {
            blocked_by: number
            resolved: number
            caused: number
        }
    } {
        const db = this.ensureDb()

        // Total entries
        const totalResult = db.exec(`
            SELECT COUNT(*) as count FROM memory_journal WHERE deleted_at IS NULL
        `)
        const totalEntries = (totalResult[0]?.values[0]?.[0] as number) ?? 0

        // By type
        const byTypeResult = db.exec(`
            SELECT entry_type, COUNT(*) as count
            FROM memory_journal
            WHERE deleted_at IS NULL
            GROUP BY entry_type
        `)
        const entriesByType: Record<string, number> = {}
        for (const row of byTypeResult[0]?.values ?? []) {
            entriesByType[row[0] as string] = row[1] as number
        }

        // By period - use validated date format pattern (defense-in-depth)
        const dateFormat = validateDateFormatPattern(groupBy)

        const byPeriodResult = db.exec(`
            SELECT strftime('${dateFormat}', timestamp) as period, COUNT(*) as count
            FROM memory_journal
            WHERE deleted_at IS NULL
            GROUP BY period
            ORDER BY period DESC
            LIMIT 52
        `)

        const entriesByPeriod = (byPeriodResult[0]?.values ?? []).map((v: unknown[]) => ({
            period: v[0] as string,
            count: v[1] as number,
        }))

        // =========================================================================
        // Enhanced Analytics Metrics (v4.3.0)
        // =========================================================================

        // Decision Density: significant entries per period
        const decisionDensityResult = db.exec(`
            SELECT strftime('${dateFormat}', timestamp) as period, COUNT(*) as count
            FROM memory_journal
            WHERE deleted_at IS NULL AND significance_type IS NOT NULL
            GROUP BY period
            ORDER BY period DESC
            LIMIT 52
        `)
        const decisionDensity = (decisionDensityResult[0]?.values ?? []).map((v: unknown[]) => ({
            period: v[0] as string,
            significantCount: v[1] as number,
        }))

        // Relationship Complexity: total relationships and avg per entry
        const relCountResult = db.exec(`SELECT COUNT(*) FROM relationships`)
        const totalRelationships = (relCountResult[0]?.values[0]?.[0] as number) ?? 0
        const avgPerEntry = totalEntries > 0 ? totalRelationships / totalEntries : 0

        // Activity Trend: week-over-week growth
        const currentPeriod = entriesByPeriod[0]?.period ?? ''
        const previousPeriod = entriesByPeriod[1]?.period ?? ''
        const currentCount = entriesByPeriod[0]?.count ?? 0
        const previousCount = entriesByPeriod[1]?.count ?? 0
        const growthPercent =
            previousCount > 0
                ? Math.round(((currentCount - previousCount) / previousCount) * 100)
                : null

        // Causal Metrics: counts for causal relationship types
        const causalResult = db.exec(`
            SELECT relationship_type, COUNT(*) as count
            FROM relationships
            WHERE relationship_type IN ('blocked_by', 'resolved', 'caused')
            GROUP BY relationship_type
        `)
        const causalMetrics = { blocked_by: 0, resolved: 0, caused: 0 }
        for (const row of causalResult[0]?.values ?? []) {
            const relType = row[0] as 'blocked_by' | 'resolved' | 'caused'
            causalMetrics[relType] = row[1] as number
        }

        return {
            totalEntries,
            entriesByType,
            entriesByPeriod,
            decisionDensity,
            relationshipComplexity: {
                totalRelationships,
                avgPerEntry: Math.round(avgPerEntry * 100) / 100, // 2 decimal places
            },
            activityTrend: {
                currentPeriod,
                previousPeriod,
                growthPercent,
            },
            causalMetrics,
        }
    }

    // =========================================================================
    // Backup Operations
    // =========================================================================

    /**
     * Get the backups directory path (relative to database location)
     */
    getBackupsDir(): string {
        return path.join(path.dirname(this.dbPath), 'backups')
    }

    /**
     * Export database to a backup file
     * @param backupName Optional custom name (default: timestamp-based)
     * @returns Backup file info
     */
    exportToFile(backupName?: string): { filename: string; path: string; sizeBytes: number } {
        const db = this.ensureDb()
        const backupsDir = this.getBackupsDir()

        // Ensure backups directory exists
        if (!fs.existsSync(backupsDir)) {
            fs.mkdirSync(backupsDir, { recursive: true })
        }

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const sanitizedName = backupName
            ? backupName.replace(/[/\\:*?"<>|]/g, '_').slice(0, 50)
            : `backup_${timestamp}`
        const filename = `${sanitizedName}.db`
        const backupPath = path.join(backupsDir, filename)

        // Export database
        const data = db.export()
        const buffer = Buffer.from(data)
        fs.writeFileSync(backupPath, buffer)

        const stats = fs.statSync(backupPath)

        logger.info('Backup created', {
            module: 'SqliteAdapter',
            operation: 'exportToFile',
            context: { backupPath, sizeBytes: stats.size },
        })

        return {
            filename,
            path: backupPath,
            sizeBytes: stats.size,
        }
    }

    /**
     * List all available backup files
     * @returns Array of backup file information
     */
    listBackups(): { filename: string; path: string; sizeBytes: number; createdAt: string }[] {
        const backupsDir = this.getBackupsDir()

        if (!fs.existsSync(backupsDir)) {
            return []
        }

        const files = fs.readdirSync(backupsDir)
        const backups: { filename: string; path: string; sizeBytes: number; createdAt: string }[] =
            []

        for (const filename of files) {
            if (!filename.endsWith('.db')) continue

            const filePath = path.join(backupsDir, filename)
            try {
                const stats = fs.statSync(filePath)
                if (stats.isFile()) {
                    backups.push({
                        filename,
                        path: filePath,
                        sizeBytes: stats.size,
                        createdAt: stats.birthtime.toISOString(),
                    })
                }
            } catch {
                // Skip files that can't be read
            }
        }

        // Sort by creation time, newest first
        backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

        return backups
    }

    /**
     * Delete old backups, keeping only the most recent N
     * @param keepCount Number of backups to keep (most recent)
     * @returns Object with deleted filenames and kept count
     */
    deleteOldBackups(keepCount: number): { deleted: string[]; kept: number } {
        const backups = this.listBackups() // Already sorted newest-first

        if (keepCount < 1) {
            throw new Error('keepCount must be at least 1')
        }

        const toKeep = backups.slice(0, keepCount)
        const toDelete = backups.slice(keepCount)
        const deleted: string[] = []

        for (const backup of toDelete) {
            try {
                fs.unlinkSync(backup.path)
                deleted.push(backup.filename)
            } catch {
                // Skip files that can't be deleted
            }
        }

        logger.info('Old backups cleaned up', {
            module: 'SqliteAdapter',
            operation: 'deleteOldBackups',
            context: { kept: toKeep.length, deleted: deleted.length },
        })

        return { deleted, kept: toKeep.length }
    }

    /**
     * Restore database from a backup file
     * @param filename Backup filename to restore from
     * @returns Statistics about the restore operation
     */
    async restoreFromFile(filename: string): Promise<{
        restoredFrom: string
        previousEntryCount: number
        newEntryCount: number
    }> {
        // Validate filename (prevent path traversal)
        if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
            throw new Error('Invalid backup filename: path separators not allowed')
        }

        const backupsDir = this.getBackupsDir()
        const backupPath = path.join(backupsDir, filename)

        if (!fs.existsSync(backupPath)) {
            throw new Error(`Backup file not found: ${filename}`)
        }

        // Get current entry count for comparison
        const db = this.ensureDb()
        const currentCountResult = db.exec(
            'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL'
        )
        const previousEntryCount = (currentCountResult[0]?.values[0]?.[0] as number) ?? 0

        // Create auto-backup before restore
        this.exportToFile(`pre_restore_${new Date().toISOString().replace(/[:.]/g, '-')}`)

        // Close current database
        this.db?.close()
        this.db = null
        this.initialized = false

        // Read backup file
        const backupBuffer = fs.readFileSync(backupPath)

        // Initialize new database from backup
        const SQL = await import('sql.js').then((m) => m.default())
        this.db = new SQL.Database(backupBuffer)
        this.initialized = true

        // Get new entry count
        const newCountResult = this.db.exec(
            'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL'
        )
        const newEntryCount = (newCountResult[0]?.values[0]?.[0] as number) ?? 0

        // Save to main database path
        this.save()

        logger.info('Database restored from backup', {
            module: 'SqliteAdapter',
            operation: 'restoreFromFile',
            context: { backupPath, previousEntryCount, newEntryCount },
        })

        return {
            restoredFrom: filename,
            previousEntryCount,
            newEntryCount,
        }
    }

    // =========================================================================
    // Health Status
    // =========================================================================

    /**
     * Get database health status for diagnostics
     */
    getHealthStatus(): {
        database: {
            path: string
            sizeBytes: number
            entryCount: number
            deletedEntryCount: number
            relationshipCount: number
            tagCount: number
        }
        backups: {
            directory: string
            count: number
            lastBackup: { filename: string; createdAt: string; sizeBytes: number } | null
        }
    } {
        const db = this.ensureDb()

        // Get file size
        let sizeBytes = 0
        try {
            const stats = fs.statSync(this.dbPath)
            sizeBytes = stats.size
        } catch {
            // File may not exist on disk yet
        }

        // Entry counts
        const entryResult = db.exec('SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NULL')
        const deletedResult = db.exec(
            'SELECT COUNT(*) FROM memory_journal WHERE deleted_at IS NOT NULL'
        )
        const relResult = db.exec('SELECT COUNT(*) FROM relationships')
        const tagResult = db.exec('SELECT COUNT(*) FROM tags')

        const entryCount = (entryResult[0]?.values[0]?.[0] as number) ?? 0
        const deletedEntryCount = (deletedResult[0]?.values[0]?.[0] as number) ?? 0
        const relationshipCount = (relResult[0]?.values[0]?.[0] as number) ?? 0
        const tagCount = (tagResult[0]?.values[0]?.[0] as number) ?? 0

        // Backup info
        const backups = this.listBackups()
        const lastBackup = backups[0] ?? null

        return {
            database: {
                path: this.dbPath,
                sizeBytes,
                entryCount,
                deletedEntryCount,
                relationshipCount,
                tagCount,
            },
            backups: {
                directory: this.getBackupsDir(),
                count: backups.length,
                lastBackup: lastBackup
                    ? {
                          filename: lastBackup.filename,
                          createdAt: lastBackup.createdAt,
                          sizeBytes: lastBackup.sizeBytes,
                      }
                    : null,
            },
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Convert columns and values to object
     */
    private rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
        const obj: Record<string, unknown> = {}
        columns.forEach((col, i) => {
            obj[col] = values[i]
        })
        return obj
    }

    /**
     * Convert database row to JournalEntry
     */
    private rowToEntry(row: Record<string, unknown>): JournalEntry {
        const id = row['id'] as number
        return {
            id,
            entryType: row['entry_type'] as EntryType,
            content: row['content'] as string,
            timestamp: row['timestamp'] as string,
            isPersonal: row['is_personal'] === 1,
            significanceType: row['significance_type'] as SignificanceType,
            autoContext: row['auto_context'] as string | null,
            deletedAt: row['deleted_at'] as string | null,
            tags: this.getTagsForEntry(id),
        }
    }

    /**
     * Get raw database for advanced operations
     */
    getRawDb(): Database {
        return this.ensureDb()
    }
}
