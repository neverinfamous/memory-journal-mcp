import type { Database } from 'better-sqlite3'
import { addColumnIfNotExists, type Migration } from './migration.js'

/**
 * [INTENT] Team-only: back-reference from a team mirror to the personal entry it was shared from
 * (`create_entry({ share_with_team: true })`), so search merges can collapse personal/team pairs.
 * [INVARIANT] Nullable; legacy mirrors stay NULL and fall back to content-hash matching.
 * Applied only to team databases (see TEAM_ONLY_MIGRATION_VERSIONS in migration-manager.ts).
 */
export const Migration020AddTeamOriginPersonalId: Migration = {
    version: 20,
    name: '020-add-team-origin-personal-id',
    up(db: Database): void {
        const exists = db
            .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_journal'`)
            .get()
        if (exists === undefined) return
        addColumnIfNotExists(db, 'memory_journal', 'origin_personal_id INTEGER', 'origin_personal_id')
        db.exec(
            `CREATE INDEX IF NOT EXISTS idx_memory_journal_origin_personal ON memory_journal(origin_personal_id) WHERE origin_personal_id IS NOT NULL`
        )
    },
}
