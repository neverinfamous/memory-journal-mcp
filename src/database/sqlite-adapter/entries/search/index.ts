/**
 * Search module barrel — re-exports cursor pagination, FTS5 sanitization,
 * and core query functions.
 */

export { encodeCursor, decodeCursor, type SortBy } from './cursor.js'
export { sanitizeFtsQuery } from './fts-sanitizer.js'
export {
    ftsRankToRelevance,
    extractSnippet,
    type SearchQueryRow,
    getRecentEntries,
    getEntriesPage,
    getEntryCount,
    getFilteredEntryCount,
    searchEntries,
    getSearchFacets,
    searchByDateRange,
    getEntriesByProject,
    getEntriesByIssue,
    getEntriesByPR,
    getEntriesByWorkflowRun,
    getEntriesBySession,
} from './query.js'
