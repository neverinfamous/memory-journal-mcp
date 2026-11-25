import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

interface IndexSpec {
    readonly table: string
    readonly requiredColumns: readonly string[]
    readonly statements: readonly string[]
}

const INDEX_SPECS: readonly IndexSpec[] = [
    {
        table: 'memory_journal',
        requiredColumns: ['workspace_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_recent ON memory_journal(workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL`,
        ],
    },
    {
        table: 'memory_journal',
        requiredColumns: ['session_id', 'workspace_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_session ON memory_journal(session_id, workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND session_id IS NOT NULL`,
        ],
    },
    {
        table: 'memory_journal',
        requiredColumns: ['workflow_run_id', 'workspace_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_workflow ON memory_journal(workflow_run_id, workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND workflow_run_id IS NOT NULL`,
        ],
    },
    {
        table: 'memory_journal',
        requiredColumns: ['workspace_id', 'significance_type', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_significant ON memory_journal(workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND significance_type IS NOT NULL`,
        ],
    },
    {
        table: 'tags',
        requiredColumns: ['id', 'name'],
        statements: [
            `DROP INDEX IF EXISTS idx_tags_name`,
            `CREATE INDEX IF NOT EXISTS idx_tags_lower_name ON tags(LOWER(name), id)`,
        ],
    },
    {
        table: 'entry_tags',
        requiredColumns: ['tag_id', 'entry_id'],
        statements: [
            `DROP INDEX IF EXISTS idx_entry_tags_entry`,
            `CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_entry ON entry_tags(tag_id, entry_id)`,
        ],
    },
    {
        table: 'relationships',
        requiredColumns: ['created_at', 'from_entry_id', 'to_entry_id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_relationships_created_at ON relationships(created_at DESC, from_entry_id, to_entry_id)`,
        ],
    },
]

function getTableColumns(db: Database, table: string, cache: Map<string, Set<string>>): Set<string> | null {
    const cached = cache.get(table)
    if (cached !== undefined) {
        return cached
    }
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
    if (exists === undefined) {
        return null
    }
    const rows = db.prepare<unknown[], { name: string }>(`PRAGMA table_info(${table})`).all()
    const cols = new Set(rows.map((row) => row.name.toLowerCase()))
    cache.set(table, cols)
    return cols
}

/**
 * [INTENT] Add workspace/session/workflow/significance/expression/covering indexes and drop redundant PK/UNIQUE duplicate indexes.
 * [INVARIANT] Guards every DDL statement against sqlite_master + PRAGMA table_info so partial legacy retrofit DBs never fail.
 */
export const Migration017AddPerformanceIndexes: Migration = {
    version: 17,
    name: '017-add-performance-indexes',
    up(db: Database): void {
        const columnCache = new Map<string, Set<string>>()
        for (const spec of INDEX_SPECS) {
            const cols = getTableColumns(db, spec.table, columnCache)
            if (cols === null) continue
            if (!spec.requiredColumns.every((col) => cols.has(col))) continue
            for (const sql of spec.statements) {
                db.exec(sql)
            }
        }
    },
}
