/**
 * Legacy commit-narrative normalization (shared by migration 019 and its dry-run report).
 *
 * [INTENT] Tag untagged legacy commit narratives (`auto_context` mentions `session-commits`
 * AND content ends in `\n\nCommit: <7-40 hex>`) with `commit-narrative`, and canonicalize
 * non-ENTRY_TYPES `entry_type` values (`architecture` -> `technical_note` + significance
 * `architecture` when null; other unknown values -> `other`).
 * [INVARIANT] Idempotent: a second run finds nothing to change.
 * [BOUNDARY] Operates on the raw better-sqlite3 handle; works for personal and team DBs.
 */

import type { Database } from 'better-sqlite3'
import { ENTRY_TYPES } from '../../types/entities.js'
import {
    COMMIT_NARRATIVE_TAG,
    SESSION_COMMITS_MARKER,
    canonicalizeStoredEntryType,
    isLegacyCommitNarrative,
} from '../../utils/legacy-commit-narrative.js'

/** One distinct non-canonical (entry_type, significance_type) group and its rewrite target. */
export interface EntryTypeRewrite {
    readonly from: string | null
    readonly to: string
    readonly significanceFrom: string | null
    readonly significanceTo: string | null
    readonly count: number
}

/** Counts reported by the dry-run planner and returned by the live apply. */
export interface LegacyCommitNormalizationReport {
    /** Rows detected as commit narratives (session-commits auto_context + Commit trailer). */
    readonly commitNarrativeRows: number
    /** Commit-narrative rows lacking the `commit-narrative` tag (to be tagged). */
    readonly untaggedCommitRows: number
    /** Up to 50 sample IDs of untagged commit rows, for spot checks. */
    readonly sampleUntaggedIds: readonly number[]
    /** Total rows whose entry_type is not in ENTRY_TYPES. */
    readonly nonCanonicalEntryTypeRows: number
    /** Rows that will also receive significance_type='architecture' (was NULL). */
    readonly significanceBackfills: number
    /** Per-group rewrite plan. */
    readonly entryTypeRewrites: readonly EntryTypeRewrite[]
}

interface CommitCandidateRow {
    id: number
    content: string
    autoContext: string | null
}

interface EntryTypeGroupRow {
    entryType: string | null
    significanceType: string | null
    c: number
}

const SAMPLE_LIMIT = 50

function hasTable(db: Database, name: string): boolean {
    return (
        db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
        undefined
    )
}

function hasColumns(db: Database, table: string, columns: readonly string[]): boolean {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const names = new Set(rows.map((row) => row.name.toLowerCase()))
    return columns.every((col) => names.has(col))
}

function isSchemaSupported(db: Database): boolean {
    return (
        hasTable(db, 'memory_journal') &&
        hasTable(db, 'tags') &&
        hasTable(db, 'entry_tags') &&
        hasColumns(db, 'memory_journal', ['entry_type', 'content', 'auto_context', 'significance_type'])
    )
}

function findCommitNarrativeIds(db: Database): number[] {
    const rows = db
        .prepare(
            `SELECT id, content, auto_context AS autoContext FROM memory_journal WHERE auto_context LIKE ?`
        )
        .all(`%${SESSION_COMMITS_MARKER}%`) as CommitCandidateRow[]
    return rows.filter((row) => isLegacyCommitNarrative(row)).map((row) => row.id)
}

function findTaggedIds(db: Database): Set<number> {
    const rows = db
        .prepare(
            `SELECT et.entry_id AS entryId FROM entry_tags et JOIN tags t ON et.tag_id = t.id WHERE LOWER(t.name) = ?`
        )
        .all(COMMIT_NARRATIVE_TAG) as { entryId: number }[]
    return new Set(rows.map((row) => row.entryId))
}

function planEntryTypeRewrites(db: Database): EntryTypeRewrite[] {
    const placeholders = ENTRY_TYPES.map(() => '?').join(', ')
    const groups = db
        .prepare(
            `SELECT entry_type AS entryType, significance_type AS significanceType, COUNT(*) AS c
             FROM memory_journal
             WHERE entry_type IS NULL OR entry_type NOT IN (${placeholders})
             GROUP BY entry_type, significance_type
             ORDER BY entry_type, significance_type`
        )
        .all(...ENTRY_TYPES) as EntryTypeGroupRow[]
    return groups.map((group) => {
        const target = canonicalizeStoredEntryType(group.entryType ?? '', group.significanceType)
        return {
            from: group.entryType,
            to: target.entryType,
            significanceFrom: group.significanceType,
            significanceTo: target.significanceType,
            count: group.c,
        }
    })
}

const EMPTY_REPORT: LegacyCommitNormalizationReport = {
    commitNarrativeRows: 0,
    untaggedCommitRows: 0,
    sampleUntaggedIds: [],
    nonCanonicalEntryTypeRows: 0,
    significanceBackfills: 0,
    entryTypeRewrites: [],
}

function buildPlan(db: Database): {
    report: LegacyCommitNormalizationReport
    untaggedIds: number[]
} {
    if (!isSchemaSupported(db)) return { report: EMPTY_REPORT, untaggedIds: [] }
    const commitIds = findCommitNarrativeIds(db)
    const tagged = findTaggedIds(db)
    const untaggedIds = commitIds.filter((id) => !tagged.has(id))
    const rewrites = planEntryTypeRewrites(db)
    return {
        untaggedIds,
        report: {
            commitNarrativeRows: commitIds.length,
            untaggedCommitRows: untaggedIds.length,
            sampleUntaggedIds: untaggedIds.slice(0, SAMPLE_LIMIT),
            nonCanonicalEntryTypeRows: rewrites.reduce((sum, r) => sum + r.count, 0),
            significanceBackfills: rewrites
                .filter((r) => r.significanceFrom === null && r.significanceTo !== null)
                .reduce((sum, r) => sum + r.count, 0),
            entryTypeRewrites: rewrites,
        },
    }
}

/**
 * Dry run: report what migration 019 would change, without writing.
 * [SIDE-EFFECT] None (SELECT-only); safe on a read-only connection.
 */
export function planLegacyCommitNormalization(db: Database): LegacyCommitNormalizationReport {
    return buildPlan(db).report
}

function tagCommitRows(db: Database, ids: readonly number[]): void {
    if (ids.length === 0) return
    db.prepare('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 0)').run(
        COMMIT_NARRATIVE_TAG
    )
    const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(COMMIT_NARRATIVE_TAG) as
        | { id: number }
        | undefined
    if (tagRow === undefined) return
    const link = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)')
    let linked = 0
    for (const id of ids) {
        linked += link.run(id, tagRow.id).changes
    }
    if (linked > 0) {
        db.prepare('UPDATE tags SET usage_count = COALESCE(usage_count, 0) + ? WHERE id = ?').run(
            linked,
            tagRow.id
        )
    }
}

function rewriteEntryTypes(db: Database, rewrites: readonly EntryTypeRewrite[]): void {
    const byNull = db.prepare(
        `UPDATE memory_journal SET entry_type = ?, significance_type = COALESCE(significance_type, ?) WHERE entry_type IS NULL`
    )
    const byValue = db.prepare(
        `UPDATE memory_journal SET entry_type = ?, significance_type = COALESCE(significance_type, ?) WHERE entry_type = ?`
    )
    const seen = new Set<string | null>()
    for (const rewrite of rewrites) {
        if (seen.has(rewrite.from)) continue
        seen.add(rewrite.from)
        // Backfill significance only for `architecture` (null-only via COALESCE).
        const significance =
            rewrite.from !== null && rewrite.from.trim().toLowerCase() === 'architecture'
                ? 'architecture'
                : null
        if (rewrite.from === null) {
            byNull.run(rewrite.to, significance)
        } else {
            byValue.run(rewrite.to, significance, rewrite.from)
        }
    }
}

/**
 * Apply the normalization (called by migration 019 inside the migration transaction).
 * Returns the pre-apply plan so callers can log counts.
 */
export function applyLegacyCommitNormalization(db: Database): LegacyCommitNormalizationReport {
    let report: LegacyCommitNormalizationReport | undefined
    const run = (): void => {
        const plan = buildPlan(db)
        report = plan.report
        tagCommitRows(db, plan.untaggedIds)
        rewriteEntryTypes(db, plan.report.entryTypeRewrites)
    }
    const tx = db.transaction(run)
    if (!db.inTransaction && typeof tx.immediate === 'function') tx.immediate()
    else run()
    if (report === undefined) {
        throw new Error('Legacy commit normalization transaction did not produce a report')
    }
    return report
}
