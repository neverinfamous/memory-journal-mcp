/**
 * Search module barrel — re-exports cursor pagination, FTS5 sanitization,
 * and core query functions.
 */

export { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
export { sanitizeFtsQuery } from './fts-sanitizer.js'
export {
    extractSnippet,
    type SearchQueryRow,
    getRecentEntries,
    getEntriesPage,
    getEntriesAfter,
    searchEntries,
    getSearchFacets,
    searchByDateRange,
    getEntriesByProject,
    getEntriesByIssue,
    getEntriesByPR,
    getEntriesByWorkflowRun,
    getEntriesBySession,
    getLatestEntryPerProject,
} from './query.js'
