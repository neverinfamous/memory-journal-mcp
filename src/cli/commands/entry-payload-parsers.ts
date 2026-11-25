import { z } from 'zod'
import type { RelationshipType } from '../../types/index.js'
import { ENTRY_TYPES, RELATIONSHIP_TYPES } from '../../types/entities.js'
import { ValidationError } from '../../types/errors.js'
import {
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    pickRecordField,
} from '../../handlers/tools/schemas/constants-and-primitives.js'

const POSITIVE_INT_RE = /^[1-9]\d*$/

export const CLI_MAX_CONTENT_LENGTH = 50_000
export const UNKNOWN_RECORD_SCHEMA = z.record(z.string(), z.unknown())
export const relationTypeSchema = z.enum(RELATIONSHIP_TYPES)
export const entryTypeSchema = z.enum(ENTRY_TYPES)

const PASSED_STATUSES = ['passed', 'pass', 'success', 'ok', 'validated', 'valid', 'verified', 'true', '1']
const FAILED_STATUSES = ['failed', 'fail', 'error', 'failing', 'false', '0']
const NONE_STATUSES = ['none', 'null', 'undefined', 'skip', 'skipped', 'unknown', 'pending']

const CLI_RELATION_TYPE_ALIASES: Readonly<Record<string, RelationshipType>> = {
    resolves: 'resolved',
    depends_on: 'blocked_by',
    relates_to: 'references',
}

/** Enforce 1..50,000 non-empty content bounds matching MCP Create/UpdateEntrySchema. */
export function validateCliEntryContent(content: string): void {
    if (content.trim().length === 0) {
        throw new ValidationError('Entry content cannot be empty.', { minLength: 1 })
    }
    if (content.length > CLI_MAX_CONTENT_LENGTH) {
        throw new ValidationError(
            `Entry content exceeds maximum length of ${String(CLI_MAX_CONTENT_LENGTH)} characters.`,
            { maxLength: CLI_MAX_CONTENT_LENGTH, actualLength: content.length }
        )
    }
}

export function firstNonBlankString(...values: readonly unknown[]): string | undefined {
    for (const val of values) {
        if (typeof val === 'string' && val.trim().length > 0) {
            return val.trim()
        }
    }
    return undefined
}

/** Normalise boolean/string/number validation inputs to passed | failed | none, failing closed on invalid values. */
export function normalizeValidationStatus(
    valStatusRaw: unknown
): 'passed' | 'failed' | 'none' | undefined {
    if (valStatusRaw === undefined || valStatusRaw === null || valStatusRaw === '') return undefined
    if (typeof valStatusRaw === 'boolean') return valStatusRaw ? 'passed' : 'failed'
    if (typeof valStatusRaw === 'string') {
        const lower = valStatusRaw.trim().toLowerCase()
        if (PASSED_STATUSES.includes(lower)) return 'passed'
        if (FAILED_STATUSES.includes(lower)) return 'failed'
        if (NONE_STATUSES.includes(lower)) return 'none'
    } else if (typeof valStatusRaw === 'number') {
        if (valStatusRaw === 1) return 'passed'
        if (valStatusRaw === 0) return 'failed'
    }
    const label =
        typeof valStatusRaw === 'string' || typeof valStatusRaw === 'number'
            ? String(valStatusRaw).trim()
            : typeof valStatusRaw
    throw new ValidationError(
        `Invalid validation_status '${label}'. Expected passed, failed, or none.`,
        { validationStatus: valStatusRaw }
    )
}

/** Parse and validate relationship objects (`target_id` / `targetId` / aliases + `relation_type` / `relationType` / aliases). */
export function parseRelationshipArray(
    raw: unknown[],
    source: string
): { target_id: number; relation_type: RelationshipType }[] {
    return raw.map((r: unknown, index: number) => {
        if (typeof r !== 'object' || r === null || Array.isArray(r)) {
            throw new ValidationError(
                `Invalid relationship at index ${String(index)} in ${source}: expected an object with target_id and relation_type.`
            )
        }
        const rec = UNKNOWN_RECORD_SCHEMA.parse(r)
        const rawTarget = pickRecordField(rec, RELATIONSHIP_TARGET_KEYS)
        const trimmedTarget = typeof rawTarget === 'string' ? rawTarget.trim() : undefined
        const targetId =
            typeof rawTarget === 'number'
                ? rawTarget
                : trimmedTarget !== undefined && POSITIVE_INT_RE.test(trimmedTarget)
                  ? Number(trimmedTarget)
                  : Number.NaN
        if (
            !Number.isSafeInteger(targetId) ||
            targetId < 1 ||
            (trimmedTarget !== undefined && String(targetId) !== trimmedTarget)
        ) {
            throw new ValidationError(
                `Invalid relationship target_id '${String(rawTarget)}' at index ${String(index)} in ${source}: expected a positive integer.`
            )
        }
        const rawRelType = pickRecordField(rec, RELATIONSHIP_TYPE_KEYS)
        const trimmedRelType = typeof rawRelType === 'string' ? rawRelType.trim().toLowerCase() : ''
        const normalizedRelType =
            typeof rawRelType === 'string'
                ? Object.hasOwn(CLI_RELATION_TYPE_ALIASES, trimmedRelType)
                    ? CLI_RELATION_TYPE_ALIASES[trimmedRelType]
                    : rawRelType.trim()
                : rawRelType
        const relType = relationTypeSchema.safeParse(normalizedRelType)
        if (!relType.success) {
            throw new ValidationError(
                `Invalid relation_type '${String(rawRelType)}' at index ${String(index)} in ${source}. Expected one of: ${relationTypeSchema.options.join(', ')}`
            )
        }
        return { target_id: targetId, relation_type: relType.data }
    })
}

/** Relationships declared inside a metadata array; throws ValidationError on invalid targets/types. */
export function relationshipsFromMetadata(
    raw: unknown[]
): { target_id: number; relation_type: RelationshipType }[] {
    return parseRelationshipArray(raw, '--metadata relationships')
}
