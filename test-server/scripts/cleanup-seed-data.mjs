#!/usr/bin/env node
/**
 * cleanup-seed-data.mjs
 *
 * Removes ALL entries from the personal journal and team databases EXCEPT:
 * - Real project entries for memory-journal-mcp (project #5)
 * - Real project entries for postgres-mcp (project #13)
 * - The original 17 seed entries (S1-S17) used for semantic search tests
 *
 * Prerequisites:
 *   The MCP server must NOT be running (direct SQLite access).
 *
 * Usage:
 *   node test-server/scripts/cleanup-seed-data.mjs            # Dry-run
 *   node test-server/scripts/cleanup-seed-data.mjs --execute  # Execute
 *
 */

import { createRequire } from 'module'
import { existsSync, realpathSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '..', '..')

const DRY_RUN = !process.argv.includes('--execute')
const DB_PATH = resolve(process.env.DB_PATH ?? join(PROJECT_ROOT, 'data', 'memory_journal.db'))
const TEAM_DB_PATH = process.env.TEAM_DB_PATH
    ? resolve(process.env.TEAM_DB_PATH)
    : resolve(join(PROJECT_ROOT, '.memory-journal-team.db'))

// The project numbers we want to strictly protect
const PROTECTED_PROJECT_NUMBERS = [5, 13]

// ---------------------------------------------------------------------------
// Seed content fingerprints (S1-S17 from test-seed.md)
// ---------------------------------------------------------------------------

/** @type {Array<{ label: string; fingerprint: string; db: 'personal' | 'team' | 'both' }>} */
const SEED_FINGERPRINTS = [
    // 0.1 FTS5 Content Entries
    {
        label: 'S1',
        fingerprint: 'Redesigned the authentication architecture for the OAuth 2.1 module',
        db: 'personal',
    },
    {
        label: 'S2',
        fingerprint:
            'Improved error handling in the database adapter layer with typed error classes',
        db: 'personal',
    },
    {
        label: 'S3',
        fingerprint: 'Deploy new release candidate to the CDN edge network',
        db: 'personal',
    },
    {
        label: 'S4',
        fingerprint: 'Released v5.0 with breaking API changes and migration guide',
        db: 'personal',
    },
    {
        label: 'S5',
        fingerprint: 'Deploy to staging environment failed — rollback initiated',
        db: 'personal',
    },
    {
        label: 'S6',
        fingerprint: "The test's scope was expanded to cover 100% of edge cases",
        db: 'personal',
    },
    // 0.2 Filter & GitHub-Linked Entries
    {
        label: 'S7',
        fingerprint:
            'Investigated performance regression in issue #44 — root cause was N+1 queries',
        db: 'personal',
    },
    {
        label: 'S8',
        fingerprint:
            'Code review feedback from PR #67 merged — refactored authentication middleware',
        db: 'personal',
    },
    {
        label: 'S9',
        fingerprint: 'CI workflow run completed — all 910 tests passing across 3 test suites',
        db: 'personal',
    },
    {
        label: 'S10',
        fingerprint:
            'Personal reflection on improving development velocity and reducing technical debt',
        db: 'personal',
    },
    // 0.3 Team & Cross-DB Entries
    {
        label: 'S11',
        fingerprint: 'Architecture decision: adopted event-driven design for webhook processing',
        db: 'both',
    },
    {
        label: 'S12',
        fingerprint: 'Team standup: discussed authorization flow improvements and deploy pipeline',
        db: 'team',
    },
    // 0.4 Cross-Project Insights Seed
    {
        label: 'S13',
        fingerprint: 'Completed sprint planning for project #5: scoped auth and deploy milestones',
        db: 'personal',
    },
    {
        label: 'S14',
        fingerprint:
            'Project #5 retrospective: identified bottlenecks in deployment pipeline and action items',
        db: 'personal',
    },
    {
        label: 'S15',
        fingerprint: 'Team kickoff for project #5: aligned on goals and delivery timeline',
        db: 'team',
    },
    {
        label: 'S16',
        fingerprint:
            'Project #5 mid-sprint check-in: auth module ahead of schedule, deploy pipeline at risk',
        db: 'team',
    },
    {
        label: 'S17',
        fingerprint:
            'Project #5 release review: all acceptance criteria met, feature flags enabled for rollout',
        db: 'team',
    },
]

function loadSqlite() {
    const require = createRequire(join(PROJECT_ROOT, 'package.json'))
    return { Database: require('better-sqlite3'), sqliteVec: require('sqlite-vec') }
}

function openDb(path, Database, sqliteVec) {
    if (!existsSync(path)) return { db: null, missing: true }
    try {
        const db = new Database(realpathSync(path))
        if (sqliteVec) {
            try {
                sqliteVec.load(db)
            } catch (err) {
                console.warn(
                    `[WARN] Could not load sqlite-vec for ${path}, vec_embeddings cleanup will be skipped: ${err.message}`
                )
            }
        }
        db.pragma('journal_mode = WAL')
        db.pragma('foreign_keys = ON')
        return { db, missing: false }
    } catch (err) {
        console.error(`❌  Could not open ${path}: ${err.message}`)
        process.exit(1)
    }
}

function plural(n, singular, pluralForm) {
    return `${n} ${n === 1 ? singular : (pluralForm ?? singular + 's')}`
}

function findSeedEntries(db, fingerprints) {
    const found = []
    for (const { label, fingerprint } of fingerprints) {
        const rows = db
            .prepare('SELECT id FROM memory_journal WHERE deleted_at IS NULL AND content LIKE ?')
            .all(`%${fingerprint}%`)
        // Intentionally collect ALL matches for a seed pattern as valid "seed data"
        // This handles cases where tests inadvertently ran multiple times creating dupes of seed data we want to protect
        for (const row of rows) {
            found.push({ id: row.id, label })
        }
    }
    return found
}

function processDatabase({ db, label, seedFingerprints }) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`📂  ${label}`)
    console.log('─'.repeat(60))

    // 1. Find all active rows with tags
    const allActiveRows = db
        .prepare(
            `
        SELECT m.id, m.project_number, m.entry_type, SUBSTR(m.content, 1, 80) AS preview, m.content,
               GROUP_CONCAT(t.name) as tagnames
        FROM memory_journal m
        LEFT JOIN entry_tags et ON m.id = et.entry_id
        LEFT JOIN tags t ON et.tag_id = t.id
        WHERE m.deleted_at IS NULL
        GROUP BY m.id
    `
        )
        .all()

    // 2. Find seed IDs
    const seedIds = new Set(findSeedEntries(db, seedFingerprints).map((e) => e.id))

    // 3. Determine what to delete
    const toDelete = []
    let protectedCount = 0

    const PROTECTED_TAGS = ['memory-journal-mcp', 'postgres-mcp']

    for (const row of allActiveRows) {
        let isProtectedProject =
            row.project_number !== null && PROTECTED_PROJECT_NUMBERS.includes(row.project_number)

        // Also protect if it includes the relevant tags
        if (row.tagnames) {
            const rowTags = row.tagnames.split(',')
            for (const pt of PROTECTED_TAGS) {
                if (rowTags.includes(pt)) {
                    isProtectedProject = true
                }
            }
        }

        // Also protect any formal Session Summaries which might be untagged but describe the project
        if (!isProtectedProject && row.content) {
            if (
                row.content.includes('# Session Summary') ||
                row.content.includes('memory-journal-mcp') ||
                row.content.includes('postgres-mcp')
            ) {
                isProtectedProject = true
            }
        }

        const isSeedData = seedIds.has(row.id)

        if (isProtectedProject || isSeedData) {
            protectedCount++
        } else {
            toDelete.push(row)
        }
    }

    console.log(`🛡️   Protected entries  : ${protectedCount}`)
    console.log(`🗑️   Targeted to delete : ${toDelete.length}`)

    if (toDelete.length > 0) {
        console.log('\nPreview of items to delete (first 10):')
        for (const row of toDelete.slice(0, 10)) {
            const pv = row.preview.replace(/\n/g, ' ')
            console.log(
                `    id=${row.id}  type=${row.entry_type}  project=${row.project_number ?? 'null'}\n      "${pv}${pv.length >= 80 ? '…' : ''}"`
            )
        }
        if (toDelete.length > 10) console.log(`    ...and ${toDelete.length - 10} more`)
    }

    if (toDelete.length === 0) {
        console.log('\n✅  Nothing to clean up.')
        return { deleted: 0, skipped: 0 }
    }

    if (DRY_RUN) {
        console.log(`\n⏸️   DRY RUN — won't delete ${plural(toDelete.length, 'entry', 'entries')}.`)
        return { deleted: 0, skipped: toDelete.length }
    }

    const deleteFn = db.transaction((idList) => {
        let total = 0
        let deleteVec = null
        try {
            deleteVec = db.prepare('DELETE FROM vec_embeddings WHERE entry_id = ?')
        } catch (e) {
            // vec_embeddings might not be loaded or exist, ignore safely
        }

        for (const id of idList) {
            if (deleteVec) {
                try {
                    deleteVec.run(id)
                } catch (e) {}
            }
            total += db.prepare('DELETE FROM memory_journal WHERE id = ?').run(id).changes
        }

        // Recompute tags usage_count and prune orphans
        db.prepare(
            `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM entry_tags)`
        ).run()
        db.prepare(
            `UPDATE tags SET usage_count = (SELECT COUNT(*) FROM entry_tags WHERE tag_id = tags.id)`
        ).run()

        return total
    })

    const deleted = deleteFn(toDelete.map((row) => row.id))
    console.log(`\n✅  Deleted ${plural(deleted, 'entry', 'entries')}.`)
    return { deleted, skipped: 0 }
}

async function main() {
    const { Database, sqliteVec } = loadSqlite()

    console.log('═'.repeat(60))
    console.log('  memory-journal-mcp — Database Purge (Strict Whitelist)')
    console.log('═'.repeat(60))
    console.log(
        `  Mode            : ${DRY_RUN ? '🔍 DRY RUN (pass --execute to apply)' : '🗑️  EXECUTE'}`
    )
    console.log(`  Protecting      : Project #${PROTECTED_PROJECT_NUMBERS.join(', #')} & Seed Data`)
    console.log('═'.repeat(60))

    let totalDeleted = 0
    let totalSkipped = 0

    // --- Personal DB ---
    const { db: personalDb, missing: personalMissing } = openDb(DB_PATH, Database, sqliteVec)
    if (!personalMissing) {
        const result = processDatabase({
            db: personalDb,
            label: `Personal DB — ${DB_PATH}`,
            seedFingerprints: SEED_FINGERPRINTS.filter(
                (f) => f.db === 'personal' || f.db === 'both'
            ),
        })
        personalDb.close()
        totalDeleted += result.deleted
        totalSkipped += result.skipped
    }

    // --- Team DB ---
    const { db: teamDb, missing: teamMissing } = openDb(TEAM_DB_PATH, Database, sqliteVec)
    if (!teamMissing) {
        const result = processDatabase({
            db: teamDb,
            label: `Team DB — ${TEAM_DB_PATH}`,
            seedFingerprints: SEED_FINGERPRINTS.filter((f) => f.db === 'team' || f.db === 'both'),
        })
        teamDb.close()
        totalDeleted += result.deleted
        totalSkipped += result.skipped
    }

    console.log(`\n${'═'.repeat(60)}`)
    if (DRY_RUN) {
        console.log(`  Would delete : ${plural(totalSkipped, 'entry', 'entries')}`)
        console.log('  Run with --execute to apply changes.')
    } else {
        console.log(`  Deleted      : ${plural(totalDeleted, 'entry', 'entries')}`)
        if (totalDeleted > 0) {
            console.log(
                '\n  ⚡ The vector index will be rebuilt automatically on next server start.'
            )
        }
    }
    console.log('═'.repeat(60) + '\n')
}

main().catch((err) => {
    console.error('\n❌  Fatal error:', err.message)
    process.exit(1)
})
