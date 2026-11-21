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
        requiredColumns: ['workspace_id', 'workflow_run_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_workflow_recent ON memory_journal(workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND workflow_run_id IS NOT NULL`,
        ],
    },
    {
        table: 'memory_journal',
        requiredColumns: ['issue_number', 'workspace_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_issue_ws_recent ON memory_journal(issue_number, workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND issue_number IS NOT NULL`,
            `DROP INDEX IF EXISTS idx_memory_journal_issue`,
        ],
    },
    {
        table: 'memory_journal',
        requiredColumns: ['pr_number', 'workspace_id', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_pr_ws_recent ON memory_journal(pr_number, workspace_id, timestamp DESC, id DESC) WHERE deleted_at IS NULL AND pr_number IS NOT NULL`,
            `DROP INDEX IF EXISTS idx_memory_journal_pr`,
        ],
    },
    {
        table: 'author_aliases',
        requiredColumns: ['alias'],
        statements: [`DROP INDEX IF EXISTS idx_author_aliases_alias`],
    },
]

function getTableColumns(
    db: Database,
    table: string,
    cache: Map<string, Set<string>>
): Set<string> | null {
    const cached = cache.get(table)
    if (cached !== undefined) {
        return cached
    }
    const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
    if (exists === undefined) {
        return null
    }
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const cols = new Set(rows.map((row) => row.name.toLowerCase()))
    cache.set(table, cols)
    return cols
}

/**
 * [INTENT] Add partial composite indexes for workflow/issue/PR lookups (eliminating temp B-tree
 * sorts) and drop redundant single-column/prefix indexes duplicated by composite or UNIQUE indexes.
 */
export const Migration021AddEntityLookupAndPruneAliasIndex: Migration = {
    version: 21,
    name: '021-add-entity-lookup-and-prune-alias-index',
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
        db.pragma('optimize')
    },
}
