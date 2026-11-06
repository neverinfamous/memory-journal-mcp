import { Buffer } from 'buffer'
import { logger } from '../../../../utils/logger.js'

/** Allowed sort dimensions for search results */
export type SortBy = 'timestamp' | 'importance'

// ============================================================================
// Cursor Pagination Helpers
// ============================================================================

export function encodeCursor(payload: { t: string; id: number } | { offset: number }): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64')
}

export function decodeCursor(cursor: string): { t: string; id: number } | { offset: number } | null {
    try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf8')
        const parsed: unknown = JSON.parse(decoded)
        if (typeof parsed !== 'object' || parsed === null) return null
        if ('offset' in parsed && typeof parsed.offset === 'number') {
            return { offset: parsed.offset }
        }
        if ('t' in parsed && 'id' in parsed && typeof parsed.t === 'string' && typeof parsed.id === 'number') {
            return { t: parsed.t, id: parsed.id }
        }
        return null
    } catch (error) {
        logger.debug('Invalid pagination cursor', {
            module: 'cursor',
            error: error instanceof Error ? error.message : String(error),
        })
        return null
    }
}
