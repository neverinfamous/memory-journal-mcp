/**
 * Legacy commit-narrative detection and entry_type canonicalization.
 *
 * [INTENT] Commit narratives written by older commit pipelines carry
 * `auto_context.type = "session-commits"` and a trailing `Commit: <sha>` line but
 * may lack the `commit-narrative` tag and/or use the non-canonical
 * `entry_type: "architecture"`. These pure helpers are shared by migration 019,
 * the search read-side fallback, and the adapter write guard.
 */

import { ENTRY_TYPES, type EntryType } from '../types/entities.js'

/** Canonical tag applied to commit narratives. */
export const COMMIT_NARRATIVE_TAG = 'commit-narrative'

/** auto_context marker emitted by the commit pipeline (`type: "session-commits"`). */
export const SESSION_COMMITS_MARKER = 'session-commits'

/** Trailing commit line appended by the commit pipeline: `\n\nCommit: <7-40 hex>`. */
const COMMIT_TRAILER_RE = /\n\nCommit: [0-9a-f]{7,40}\s*$/i

const CANONICAL_ENTRY_TYPES: ReadonlySet<string> = new Set<string>(ENTRY_TYPES)

/** True when `value` is one of the canonical ENTRY_TYPES. */
export function isCanonicalEntryType(value: string): value is EntryType {
    return CANONICAL_ENTRY_TYPES.has(value)
}

/** True when the caller asked to exclude commit narratives (case-insensitive). */
export function excludesCommitNarrative(excludeTags: readonly string[] | undefined): boolean {
    if (excludeTags === undefined) return false
    return excludeTags.some((tag) => tag.trim().toLowerCase() === COMMIT_NARRATIVE_TAG)
}

/** True when a raw auto_context value marks a session-commits narrative. */
export function isSessionCommitsAutoContext(autoContext: string | null | undefined): boolean {
    return typeof autoContext === 'string' && autoContext.includes(SESSION_COMMITS_MARKER)
}

/** True when content ends with the commit pipeline's `Commit: <sha>` trailer. */
export function hasCommitTrailer(content: string): boolean {
    return COMMIT_TRAILER_RE.test(content)
}

/** True when a row is a (possibly untagged) legacy commit narrative. */
export function isLegacyCommitNarrative(row: {
    readonly autoContext: string | null | undefined
    readonly content: string
}): boolean {
    return isSessionCommitsAutoContext(row.autoContext) && hasCommitTrailer(row.content)
}

/**
 * SQL predicate that drops session-commits rows (read-side fallback for untagged legacy rows).
 * [BOUNDARY] Literal-only SQL; safe to inline because it binds no user input.
 */
export function legacyCommitExclusionSql(alias = 'e'): string {
    return `COALESCE(${alias}.auto_context, '') NOT LIKE '%${SESSION_COMMITS_MARKER}%'`
}

export interface CanonicalizedEntryType {
    readonly entryType: EntryType
    readonly significanceType: string | null
    readonly changed: boolean
}

/**
 * Canonicalize a stored (legacy) entry_type for migration 019.
 * `architecture` -> `technical_note` (+ significance `architecture` when null);
 * other unknown values -> `other`.
 */
export function canonicalizeStoredEntryType(
    entryType: string,
    significanceType: string | null
): CanonicalizedEntryType {
    if (isCanonicalEntryType(entryType)) {
        return { entryType, significanceType, changed: false }
    }
    const lowered = entryType.trim().toLowerCase()
    if (isCanonicalEntryType(lowered)) {
        return { entryType: lowered, significanceType, changed: true }
    }
    if (lowered === 'architecture') {
        return {
            entryType: 'technical_note',
            significanceType: significanceType ?? 'architecture',
            changed: true,
        }
    }
    const fallback: EntryType = isCanonicalEntryType('other') ? 'other' : 'technical_note'
    return { entryType: fallback, significanceType, changed: true }
}
