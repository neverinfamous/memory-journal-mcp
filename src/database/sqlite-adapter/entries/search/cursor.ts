import { Buffer } from 'buffer'

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
        const parsed = JSON.parse(decoded) as unknown
        return parsed as { t: string; id: number } | { offset: number }
    } catch {
        return null
    }
}
