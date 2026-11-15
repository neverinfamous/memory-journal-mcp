/**
 * Shared SQLite Row Mapping Helpers
 *
 * Extracts the first row from an IDatabaseConnection query result array into
 * a column-keyed record for adapter submodules.
 */

export interface SqliteQueryResult {
    columns: string[]
    values: unknown[][]
}

/**
 * Maps the first row of a SQLite query result set to an object keyed by column name.
 * Returns `null` when the result set, row values, or columns are empty.
 */
export function getSingleRow(queryResult: SqliteQueryResult[]): Record<string, unknown> | null {
    const first = queryResult[0]
    if (!first || first.values.length === 0 || first.columns.length === 0) {
        return null
    }
    const row = first.values[0]
    if (!row) {
        return null
    }

    const result: Record<string, unknown> = {}
    for (let i = 0; i < first.columns.length; i++) {
        const col = first.columns[i]
        if (col) {
            result[col] = row[i]
        }
    }
    return result
}
