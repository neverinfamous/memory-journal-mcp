import { z } from 'zod'
import {
    ENTRY_TYPES,
    DATE_FORMAT_REGEX,
    DATE_FORMAT_MESSAGE,
    EntryOutputSchema,
    relaxedNumber,
    MAX_QUERY_LIMIT,
} from '../schemas.js'
import { ErrorFieldsMixin } from '../error-fields-mixin.js'

// Input Schemas
// ============================================================================

/** Strict schema — used inside handler for structured Zod errors */
export const SearchEntriesSchema = z.object({
    query: z.string().max(250).optional().describe('The search query string (use `query`, not `q`)'),
    cursor: z.string().optional().describe('Cursor for pagination'),
    mode: z
        .enum(['auto', 'fts', 'semantic', 'hybrid'])
        .optional()
        .default('auto')
        .describe(
            'Search strategy: auto (default, heuristic-based), fts (FTS5 keyword), semantic (vector), hybrid (RRF fusion of FTS5+vector)'
        ),
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(10),
    workspace_id: z.string().optional(),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    pr_status: z.enum(['draft', 'open', 'merged', 'closed']).optional(),
    workflow_run_id: z.number().optional(),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional(),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
    include_facets: z.boolean().optional().default(false).describe('Include facet distributions (tags, entry types) for the search results'),
    include_highlights: z.boolean().optional().default(false).describe('Include snippets with matched terms highlighted (only applies to fts mode)'),
    fts_weight: z.number().optional().default(1.0).describe('Weight multiplier for FTS5 results in hybrid search (default: 1.0)'),
    semantic_weight: z.number().optional().default(1.0).describe('Weight multiplier for semantic results in hybrid search (default: 1.0)'),
    fuzzy_match: z.boolean().optional().default(false).describe('If true and no exact FTS5 results found, returns typo-tolerant suggestions (fts mode only)'),
    auto_correct: z.boolean().optional().default(false).describe('If true and fuzzy_match=true, automatically runs a new search with the best suggestion if distance <= 1'),
    exact_match: z.boolean().optional().describe('Legacy hallucinated alias. Maps exact_match: false to fuzzy_match: true'),
}).strict()

/** Relaxed schema — passed to SDK inputSchema so Zod enum errors reach the handler */
export const SearchEntriesSchemaMcp = z.object({
    query: z.string().optional().describe('The search query string (use `query`, not `q`)'),
    cursor: z.string().optional().describe('Cursor for pagination'),
    mode: z
        .string()
        .optional()
        .default('auto')
        .describe(
            'Search strategy: auto (default, heuristic-based), fts (FTS5 keyword), semantic (vector), hybrid (RRF fusion of FTS5+vector)'
        ),
    limit: relaxedNumber().optional().default(10),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional(),
    issue_number: relaxedNumber().optional(),
    pr_number: relaxedNumber().optional(),
    pr_status: z.string().optional(),
    workflow_run_id: relaxedNumber().optional(),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional(),
    entry_type: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
    include_facets: z.boolean().optional().default(false).describe('Include facet distributions (tags, entry types) for the search results'),
    include_highlights: z.boolean().optional().default(false).describe('Include snippets with matched terms highlighted (only applies to fts mode)'),
    fts_weight: relaxedNumber().optional().default(1.0).describe('Weight multiplier for FTS5 results in hybrid search (default: 1.0)'),
    semantic_weight: relaxedNumber().optional().default(1.0).describe('Weight multiplier for semantic results in hybrid search (default: 1.0)'),
    fuzzy_match: z.boolean().optional().default(false).describe('If true and no exact FTS5 results found, returns typo-tolerant suggestions (fts mode only)'),
    auto_correct: z.boolean().optional().default(false).describe('If true and fuzzy_match=true, automatically runs a new search with the best suggestion if distance <= 1'),
    exact_match: z.boolean().optional().describe('Legacy hallucinated alias. Maps exact_match: false to fuzzy_match: true'),
}).strict()

/** Strict schema — used inside handler for structured Zod errors */
export const SearchByDateRangeSchema = z.object({
    start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).describe('Start date (use `start_date`, not `start`)'),
    end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).describe('End date (use `end_date`, not `end`)'),
    cursor: z.string().optional().describe('Cursor for pagination'),
    entry_type: z.enum(ENTRY_TYPES).optional(),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional(),
    workspace_id: z.string().optional(),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional(),
    issue_number: z.number().optional(),
    pr_number: z.number().optional(),
    workflow_run_id: z.number().optional(),
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(500),
    sort_by: z
        .enum(['timestamp', 'importance'])
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
}).strict()

/** Relaxed schema — passed to SDK inputSchema so Zod errors reach the handler */
export const SearchByDateRangeSchemaMcp = z.object({
    start_date: z.string().describe('Start date (use `start_date`, not `start`)'),
    end_date: z.string().describe('End date (use `end_date`, not `end`)'),
    cursor: z.string().optional().describe('Cursor for pagination'),
    entry_type: z.string().optional(),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional(),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional(),
    issue_number: relaxedNumber().optional(),
    pr_number: relaxedNumber().optional(),
    workflow_run_id: relaxedNumber().optional(),
    limit: relaxedNumber().optional().default(500),
    sort_by: z
        .string()
        .optional()
        .default('timestamp')
        .describe('Sort results by timestamp (default) or importance score'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
}).strict()

/** Strict schema — used inside handler for structured Zod errors */
export const SemanticSearchSchema = z.object({
    query: z.string().max(250).optional().describe('The search query string (use `query`, not `q`)'),
    entry_id: z
        .number()
        .optional()
        .describe(
            'Find entries related to this entry ID (uses existing embedding, skips re-embedding)'
        ),
    limit: z.number().max(MAX_QUERY_LIMIT).optional().default(10),
    similarity_threshold: z.number().optional().default(0.25),
    workspace_id: z.string().optional(),
    is_personal: z.boolean().optional(),
    project_number: z.number().optional().describe('Filter results by project number'),
    issue_number: z.number().optional().describe('Filter results by GitHub issue number'),
    pr_number: z.number().optional().describe('Filter results by GitHub PR number'),
    workflow_run_id: z.number().optional().describe('Filter results by GitHub Actions workflow run ID'),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional().describe('Filter results by tags'),
    entry_type: z.enum(ENTRY_TYPES).optional().describe('Filter results by entry type'),
    start_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Filter results from this date (YYYY-MM-DD)'),
    end_date: z
        .string()
        .regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE)
        .optional()
        .describe('Filter results until this date (YYYY-MM-DD)'),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
}).strict()

/** Relaxed schema — passed to SDK inputSchema so Zod min/max errors reach the handler */
export const SemanticSearchSchemaMcp = z.object({
    query: z.string().optional().describe('The search query string (use `query`, not `q`)'),
    entry_id: relaxedNumber().optional()
        .optional()
        .describe(
            'Find entries related to this entry ID (uses existing embedding, skips re-embedding)'
        ),
    limit: relaxedNumber().optional().default(10),
    similarity_threshold: relaxedNumber().optional().default(0.25),
    workspace_id: z.string().optional().describe('Optional workspace isolation identifier (e.g. "alpha"). Do not use numeric project IDs or "workspace" as the key.'),
    is_personal: z.boolean().optional(),
    project_number: relaxedNumber().optional().describe('Filter results by project number'),
    issue_number: relaxedNumber().optional().describe('Filter results by GitHub issue number'),
    pr_number: relaxedNumber().optional().describe('Filter results by GitHub PR number'),
    workflow_run_id: relaxedNumber().optional().describe('Filter results by GitHub Actions workflow run ID'),
    tags: z.preprocess((val) => typeof val === 'string' ? [val] : val, z.array(z.string())).optional().describe('Filter results by tags'),
    entry_type: z.string().optional().describe('Filter results by entry type'),
    start_date: z.string().optional().describe('Filter results from this date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('Filter results until this date (YYYY-MM-DD)'),
    hint_on_empty: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include hint when no results found (default: true)'),
    include_team: z
        .boolean()
        .optional()
        .default(true)
        .describe('Include team entries in the search results'),
    include_archived: z.boolean().optional().default(false),
}).strict()

// ============================================================================
// Output Schemas
// ============================================================================

export const SemanticEntryOutputSchema = EntryOutputSchema.extend({
    similarity: z.number(),
})

export const SemanticSearchOutputSchema = z
    .object({
        query: z.string().optional(),
        entryId: z.number().optional(),
        entries: z.array(SemanticEntryOutputSchema).optional(),
        count: z.number().optional(),
        hint: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

export const VectorStatsOutputSchema = z
    .object({
        available: z.boolean(),
        error: z.string().optional(),
        itemCount: z.number().optional(),
        modelName: z.string().optional(),
        dimensions: z.number().optional(),
        success: z.boolean().optional(),
    })
    .extend(ErrorFieldsMixin.shape)
