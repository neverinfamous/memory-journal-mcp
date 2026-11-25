import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'
import { applyLegacyCommitNormalization } from './legacy-commit-normalization.js'
import { logger } from '../../utils/logger.js'

/**
 * [INTENT] Tag legacy commit narratives (`auto_context` session-commits + `Commit: <sha>` trailer)
 * with `commit-narrative` and canonicalize non-ENTRY_TYPES `entry_type` values.
 * [INVARIANT] Idempotent and shared by personal and team databases.
 * Dry-run counterpart: `planLegacyCommitNormalization` in `legacy-commit-normalization.ts`.
 */
export const Migration019NormalizeLegacyCommitEntries: Migration = {
    version: 19,
    name: '019-normalize-legacy-commit-entries',
    up(db: Database): void {
        const report = applyLegacyCommitNormalization(db)
        if (report.untaggedCommitRows > 0 || report.nonCanonicalEntryTypeRows > 0) {
            logger.info('Normalized legacy commit entries', {
                module: 'MigrationManager',
                taggedCommitRows: report.untaggedCommitRows,
                canonicalizedEntryTypeRows: report.nonCanonicalEntryTypeRows,
                significanceBackfills: report.significanceBackfills,
            })
        }
    },
}
