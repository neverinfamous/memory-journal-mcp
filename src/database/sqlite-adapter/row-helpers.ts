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

export const IN_PARAM_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 500] as const
export const SCOPED_IN_PARAM_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 480] as const
export const DUAL_IN_PARAM_BUCKETS = [1, 2, 4, 8, 16, 32, 64, 128, 240] as const

const BUCKET_PLACEHOLDERS = new Map<number, string>(
    [...IN_PARAM_BUCKETS, 480, 240].map((size) => [size, Array<string>(size).fill('?').join(',')])
)

export interface BucketedInChunk<T> {
    readonly placeholders: string
    readonly params: T[]
}

/**
 * [INTENT] Splits `ids` into chunks <= max bucket and pads each chunk to a power-of-2 bucket
 * by repeating its last element so SQLite prepared statements reuse at most 10 SQL shapes.
 */
export function bucketInParams<T>(
    ids: readonly T[],
    buckets: readonly number[] = IN_PARAM_BUCKETS
): BucketedInChunk<T>[] {
    if (ids.length === 0) return []
    const chunks: BucketedInChunk<T>[] = []
    const maxChunk = buckets[buckets.length - 1] ?? 500
    for (let offset = 0; offset < ids.length; offset += maxChunk) {
        const slice = ids.slice(offset, offset + maxChunk)
        const padValue = slice[slice.length - 1]
        if (padValue === undefined) continue
        const targetLen = buckets.find((b) => b >= slice.length) ?? maxChunk
        const params = slice.slice()
        while (params.length < targetLen) {
            params.push(padValue)
        }
        const placeholders =
            BUCKET_PLACEHOLDERS.get(targetLen) ?? Array<string>(targetLen).fill('?').join(',')
        chunks.push({ placeholders, params })
    }
    return chunks
}

/** Join bucketed `IN` fragments. Uses `json_each(?)` above 240 items to preserve the 500-bind budget. */
export function chunkedInPredicate(
    values: readonly string[],
    render: (placeholders: string) => string,
    join: 'AND' | 'OR'
): { sql: string; params: string[] } {
    if (values.length > 240) {
        return {
            sql: render('SELECT value FROM json_each(?)'),
            params: [JSON.stringify(values)],
        }
    }
    const parts: string[] = []
    const params: string[] = []
    for (const chunk of bucketInParams(values, DUAL_IN_PARAM_BUCKETS)) {
        parts.push(render(chunk.placeholders))
        params.push(...chunk.params)
    }
    if (parts.length <= 1) return { sql: parts[0] ?? '', params }
    return { sql: `(${parts.join(` ${join} `)})`, params }
}
