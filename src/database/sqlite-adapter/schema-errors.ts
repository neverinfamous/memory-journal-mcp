/**
 * Shared helpers for classifying SQLite schema-related errors.
 */

/** True when the error is a SQLite "no such table" failure (e.g. optional/unmigrated table). */
export function isMissingTableError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('no such table')
}

/** True when the error is a SQLite "no such column" failure. */
export function isMissingColumnError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('no such column')
}
