import type { ToolContext } from '../../../../types/index.js'
import { DEFAULT_FLAG_VOCABULARY } from '../schemas.js'

// ============================================================================
// Constants
// ============================================================================

/** Staleness threshold in milliseconds (24 hours) */
export const STALE_THRESHOLD_MS = 86_400_000

/** Priority ordering for flag types (highest severity first) */
export const FLAG_PRIORITY: ReadonlyMap<string, number> = new Map([
    ['blocker', 0],
    ['needs_review', 1],
    ['help_requested', 2],
    ['fyi', 3],
])

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the active flag vocabulary from context config or defaults.
 */
export function getVocabulary(context: ToolContext): readonly string[] {
    const custom = context.config?.flagVocabulary
    return custom && custom.length > 0 ? custom : DEFAULT_FLAG_VOCABULARY
}

/**
 * Get the sort priority for a flag type. Unknown types sort last.
 */
export function getFlagPriority(flagType: string): number {
    return FLAG_PRIORITY.get(flagType) ?? 99
}

/**
 * Compute median of a numeric array. Returns null for empty arrays.
 */
export function median(values: number[]): number | null {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
        const lo = sorted[mid - 1] ?? 0
        const hi = sorted[mid] ?? 0
        return Math.round(((lo + hi) / 2) * 10) / 10
    }
    return Math.round((sorted[mid] ?? 0) * 10) / 10
}

/**
 * Get period boundaries in milliseconds for trend comparison.
 */
export function getPeriodMs(period: string): number {
    switch (period) {
        case 'day':
            return 86_400_000
        case 'month':
            return 2_592_000_000 // 30 days
        case 'week':
        default:
            return 604_800_000 // 7 days
    }
}

/**
 * Extract the message body from a flag's content string.
 * Content format: `flag:{type}[ — @{target}]: {message}[ [RESOLVED[: comment]]]`
 */
export function extractMessageBody(content: string): string {
    // Strip [RESOLVED...] suffix
    const stripped = content.replace(/\s*\[RESOLVED(?::\s*[^\\\]]*)?\]$/u, '')
    // Find the first `: ` after the prefix and return everything after it
    const colonIdx = stripped.indexOf(': ')
    return colonIdx >= 0 ? stripped.slice(colonIdx + 2) : stripped
}

// ============================================================================
// Parsed flag entry type
// ============================================================================

export interface ParsedFlagEntry {
    id: number
    flag_type: string
    target_user: string | null
    author: string | null
    message: string
    link: string | null
    resolved: boolean
    resolved_at: string | null
    resolution: string | null
    timestamp: string
    age_hours: number
    is_stale: boolean
    tags: string[]
    project_number: number | null
}
