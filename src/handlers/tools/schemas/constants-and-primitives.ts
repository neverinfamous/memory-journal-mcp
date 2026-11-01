/**
 * Shared Constants and Primitive Validators for Tool Handlers
 */

import { z } from 'zod'

/**
 * Valid entry types (matches EntryType union in types/index.ts)
 */
export const ENTRY_TYPES = [
    'personal_reflection',
    'project_decision',
    'technical_achievement',
    'bug_fix',
    'feature_implementation',
    'code_review',
    'meeting_notes',
    'learning',
    'research',
    'planning',
    'retrospective',
    'standup',
    'technical_note',
    'development_note',
    'enhancement',
    'milestone',
    'system_integration_test',
    'test_entry',
    'plan_draft',
    'adversarial_review',
    'plan_refinement',
    'plan_finalized',
    'copilot_validation',
    'maintenance',
    'other',
] as const

export const SOURCE_FORMATS = ['notion', 'obsidian', 'logseq'] as const

/**
 * Valid significance types (matches SignificanceType union in types/index.ts)
 */
export const SIGNIFICANCE_TYPES = [
    'milestone',
    'breakthrough',
    'decision',
    'architecture',
    'lesson_learned',
    'blocker_resolved',
    'release',
    'security',
] as const

/**
 * Coerce common invalid significance_type aliases to their valid enum equivalents.
 * Mutates the params object directly before Zod validation.
 */
export function coerceSignificanceAlias(params: unknown): void {
    if (params !== null && params !== undefined && typeof params === 'object') {
        const obj = params as Record<string, unknown>
        if (typeof obj['significance_type'] === 'string') {
            const lower = obj['significance_type'].toLowerCase()
            if (lower === 'important') obj['significance_type'] = 'milestone'
            else if (lower === 'major') obj['significance_type'] = 'breakthrough'
            else if (lower === 'critical') obj['significance_type'] = 'security'
            else if (lower === 'learning') obj['significance_type'] = 'lesson_learned'
            else if (lower === 'key_decision') obj['significance_type'] = 'decision'
            else if (lower === 'resolved') obj['significance_type'] = 'blocker_resolved'
            else if (lower === 'maintenance' || lower === 'minor') delete obj['significance_type']
        }
    }
}

export function safeString(val: unknown): string {
    if (typeof val === 'string') return val
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint')
        return String(val)
    if (typeof val === 'object' && val !== null) {
        try {
            return JSON.stringify(val)
        } catch {
            return ''
        }
    }
    return ''
}

/** Maximum content length for journal entries (chars) */
export const MAX_CONTENT_LENGTH = 50_000

/** Maximum entries returned by any single search query */
export const MAX_QUERY_LIMIT = 500

/** Maximum entries per batch operation */
export const MAX_BATCH_SIZE = 50

/** Date sentinels for "all time" date range queries */
export const DATE_MIN_SENTINEL = '1970-01-01'
export const DATE_MAX_SENTINEL = '2999-12-31'

/** YYYY-MM-DD date format regex */
export const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const DATE_FORMAT_MESSAGE = 'Date must be YYYY-MM-DD format'

/**
 * Relaxed numeric schema for MCP SDK inputSchema registration.
 *
 * Uses `z.union([z.number(), z.string()])` so the SDK's Zod validation
 * accepts both native numbers and string-typed numbers (e.g., `"42"`).
 * The handler's strict schema (`z.number()`) then validates and coerces
 * the value, producing structured `{success: false, error}` responses
 * via `formatHandlerError()` for invalid input.
 */
export const relaxedNumber = (): z.ZodUnion<[z.ZodNumber, z.ZodString]> =>
    z.union([z.number(), z.string()])

/**
 * Strict schema for project_number validation.
 * Used in handler strict schemas to provide an informative error when missing,
 * since project_number is left optional in the SDK's MCP schema so it reaches the handler.
 */
export const StrictProjectNumberSchema = z
    .number({
        message:
            'Missing project_number. You MUST provide a valid project_number (e.g., 1) to associate this action with a specific project context.',
    })
    .optional()
