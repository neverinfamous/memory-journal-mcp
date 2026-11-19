/**
 * Adapter-level entry_type write guard.
 *
 * [INTENT] Last line of defence against non-canonical `entry_type` values reaching storage
 * (no CHECK constraint exists). Mirrors the hallucination healer: `architecture`/`adr` ->
 * `project_decision` (+ significance `architecture` on create when unset); case variants of
 * canonical types are lowercased; anything else is rejected with a ValidationError.
 */

import type { EntryType } from '../../../types/index.js'
import { ENTRY_TYPES } from '../../../types/entities.js'
import { ValidationError } from '../../../types/errors.js'
import { isCanonicalEntryType } from '../../../utils/legacy-commit-narrative.js'

/** Aliases healed to `project_decision` + significance `architecture` (matches the tool healer). */
const ARCHITECTURE_ALIASES: ReadonlySet<string> = new Set([
    'architecture',
    'architecture_decision',
    'architecture-decision',
    'architectural_decision',
    'architectural-decision',
    'adr',
])

export interface GuardedEntryType {
    readonly entryType: EntryType
    /** Significance to apply when the caller left it unset (only for healed architecture aliases). */
    readonly defaultSignificance: 'architecture' | undefined
}

/** Validate (and heal) a raw entry_type before it is written. */
export function guardEntryTypeWrite(raw: string): GuardedEntryType {
    if (isCanonicalEntryType(raw)) return { entryType: raw, defaultSignificance: undefined }
    const lowered = raw.trim().toLowerCase()
    if (isCanonicalEntryType(lowered)) return { entryType: lowered, defaultSignificance: undefined }
    if (ARCHITECTURE_ALIASES.has(lowered)) {
        return { entryType: 'project_decision', defaultSignificance: 'architecture' }
    }
    throw new ValidationError(
        `Invalid entry_type '${raw}'. Expected one of: ${ENTRY_TYPES.join(', ')}`,
        { entryType: raw }
    )
}
