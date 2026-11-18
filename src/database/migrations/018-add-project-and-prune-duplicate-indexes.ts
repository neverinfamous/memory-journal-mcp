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
        requiredColumns: ['workspace_id', 'project_number', 'deleted_at', 'timestamp', 'id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_ws_proj_recent ON memory_journal(workspace_id, project_number, timestamp DESC, id DESC) WHERE deleted_at IS NULL`,
        ],
    },
    {
        table: 'entry_tags',
        requiredColumns: ['tag_id', 'entry_id'],
        statements: [
            `CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_entry ON entry_tags(tag_id, entry_id)`,
            `DROP INDEX IF EXISTS idx_entry_tags_tag`,
        ],
    },
    {
        table: 'team_members',
        requiredColumns: ['author'],
        statements: [`DROP INDEX IF EXISTS idx_team_members_author`],
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
 * [INTENT] Add composite `(workspace_id, project_number, timestamp DESC, id DESC)` partial index
 * for project-scoped counts/pagination and drop redundant prefix/unique duplicate indexes.
 * [INVARIANT] Preserves covering `idx_memory_journal_deleted` and unscoped `idx_memory_journal_active_timestamp`.
 */
export const Migration018AddProjectAndPruneDuplicateIndexes: Migration = {
    version: 18,
    name: '018-add-project-and-prune-duplicate-indexes',
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
