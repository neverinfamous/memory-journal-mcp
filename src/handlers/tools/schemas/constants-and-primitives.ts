/**
 * Shared Constants and Primitive Validators for Tool Handlers
 */

import { z } from 'zod'
export {
    ENTRY_TYPES,
    SOURCE_FORMATS,
    SIGNIFICANCE_TYPES,
    normalizeSignificanceValue,
    coerceSignificanceAlias,
    safeString,
    MAX_CONTENT_LENGTH,
    MAX_QUERY_LIMIT,
    MAX_BATCH_SIZE,
    DATE_MIN_SENTINEL,
    DATE_MAX_SENTINEL,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    RELATIONSHIP_TARGET_KEYS,
    RELATIONSHIP_TYPE_KEYS,
    pickRecordField,
    preprocessRelationshipItem,
    KEY_ALIAS_MAP,
    CONTENT_ALIASES,
    PASSED_VALIDATION_ALIASES,
    FAILED_VALIDATION_ALIASES,
    NONE_VALIDATION_ALIASES,
    SESSION_SUMMARY_TAG_ALIASES,
    TECHNICAL_NOTE_ALIASES,
    BUG_FIX_ALIASES,
} from './entry-constants.js'

/**
 * Relaxed numeric schema for MCP SDK inputSchema registration.
 */
export const relaxedNumber = (): z.ZodUnion<[z.ZodNumber, z.ZodString]> =>
    z.union([z.number(), z.string()])

/** Non-throwing numeric string preprocessor for strict float/finite handler schemas. */
export function coerceFiniteNumberString(val: unknown): unknown {
    if (typeof val !== 'string') return val
    const trimmed = val.trim()
    if (trimmed === '' || trimmed === '-0' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
        return val
    }
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : val
}

/** Non-throwing integer string preprocessor for strict integer handler schemas. */
export function coerceIntString(val: unknown): unknown {
    if (typeof val !== 'string') return val
    const trimmed = val.trim()
    if (!/^(?:0|-?[1-9]\d*)$/.test(trimmed)) return val
    const n = Number(trimmed)
    return Number.isSafeInteger(n) && String(n) === trimmed ? n : val
}

/**
 * Strict schema for project_number validation.
 */
export const StrictProjectNumberSchema = z
    .preprocess(
        coerceIntString,
        z
            .number({
                message:
                    'Missing project_number. You MUST provide a valid project_number (e.g., 1) to associate this action with a specific project context.',
            })
            .int({
                message: 'Invalid project_number. Expected a positive integer (e.g., 1).',
            })
            .positive({
                message: 'Invalid project_number. Expected a positive integer (e.g., 1).',
            })
    )
    .optional()
