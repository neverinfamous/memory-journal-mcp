/**
 * Search module barrel — re-exports cursor pagination, FTS5 sanitization,
 * and core query functions.
 */

export { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
export { sanitizeFtsQuery } from './fts-sanitizer.js'
export {
    getRecentEntries,
    getEntriesPage,
    searchEntries,
    getSearchFacets,
    searchByDateRange,
} from './query.js'
