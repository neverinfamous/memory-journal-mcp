/**
 * Shared Zod Schemas for Tool Handlers
 *
 * Contains cross-group schemas used by multiple tool modules:
 * - EntryOutputSchema: used by core, search, export, admin
 * - EntriesListOutputSchema: used by search, core
 * - RelationshipOutputSchema: used by core, relationships
 * - TagOutputSchema: used by core, analytics
 * - ImportanceBreakdownSchema: used by core
 * - Shared constants: ENTRY_TYPES, SIGNIFICANCE_TYPES, DATE_FORMAT_REGEX
 *
 * Group-specific output schemas stay colocated with their group files.
 */

import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'

// ============================================================================
// Shared Constants
// ============================================================================

/**
 * Valid entry types (matches EntryType union in types/index.ts)
 */
export const ENTRY_TYPES = [
    'personal_reflection',
    'project_decision',
    'technical_achievement',
    'bug_fix',
    'feature_implementation',
    'code_review',
    'meeting_notes',
    'learning',
    'research',
    'planning',
    'retrospective',
    'standup',
    'technical_note',
    'development_note',
    'enhancement',
    'milestone',
    'flag',
    'system_integration_test',
    'test_entry',
    'plan_draft',
    'adversarial_review',
    'plan_refinement',
    'copilot_validation',
    'other',
] as const

export const SOURCE_FORMATS = ['notion', 'obsidian', 'logseq'] as const

/**
 * Valid significance types (matches SignificanceType union in types/index.ts)
 */
export const SIGNIFICANCE_TYPES = [
    'milestone',
    'breakthrough',
    'decision',
    'architecture',
    'lesson_learned',
    'blocker_resolved',
    'release',
    'security',
] as const

/**
 * Coerce common invalid significance_type aliases to their valid enum equivalents.
 * Mutates the params object directly before Zod validation.
 */
export function coerceSignificanceAlias(params: unknown): void {
    if (params !== null && params !== undefined && typeof params === 'object') {
        const obj = params as Record<string, unknown>
        if (typeof obj['significance_type'] === 'string') {
            const lower = obj['significance_type'].toLowerCase()
            if (lower === 'important') obj['significance_type'] = 'milestone'
            else if (lower === 'major') obj['significance_type'] = 'breakthrough'
            else if (lower === 'critical') obj['significance_type'] = 'security'
            else if (lower === 'learning') obj['significance_type'] = 'lesson_learned'
            else if (lower === 'key_decision') obj['significance_type'] = 'decision'
            else if (lower === 'resolved') obj['significance_type'] = 'blocker_resolved'
            else if (lower === 'maintenance' || lower === 'minor') delete obj['significance_type']
        }
    }
}

/**
 * Shared preprocessor to heal common LLM hallucinations in payloads before Zod validation.
 * Addresses `tag` vs `tags`, stringified array elements, invalid `entry_type` / `significance_type`,
 * hallucinated parameter keys, and missing `content` fields.
 */
export function healAgentHallucinations(val: unknown): unknown {
    if (typeof val === 'object' && val !== null) {
        const obj = { ...(val as Record<string, unknown>) }
        let modified = false

        // 1. Heal hallucinated parameter keys
        const keyMap: Record<string, string> = {
            id: 'entry_id',
            ids: 'entry_ids',
            project_id: 'project_number',
            projectId: 'project_number',
            projectNumber: 'project_number',
            workspaceId: 'workspace_id',
            isPersonal: 'is_personal',
            entryType: 'entry_type',
            significanceType: 'significance_type',
            autoContext: 'auto_context',
            impactScore: 'impact_score',
            trustScore: 'trust_score',
            validationStatus: 'validation_status',
            workflowRunId: 'workflow_run_id',
            workflowName: 'workflow_name',
            workflowStatus: 'workflow_status',
            prNumber: 'pr_number',
            prUrl: 'pr_url',
            prStatus: 'pr_status',
            issueNumber: 'issue_number',
            issueUrl: 'issue_url',
            projectOwner: 'project_owner',
            shareWithTeam: 'share_with_team',
            anchorPath: 'anchor_path',
            anchorType: 'anchor_type',
        }
        for (const [badKey, goodKey] of Object.entries(keyMap)) {
            if (badKey in obj && !(goodKey in obj)) {
                obj[goodKey] = obj[badKey]
                Reflect.deleteProperty(obj, badKey)
                modified = true
            }
        }

        // 2. Heal 'text', 'message', 'description', 'title' -> 'content'
        for (const key of ['text', 'message', 'description']) {
            if (key in obj && !('content' in obj)) {
                obj['content'] = obj[key]
                Reflect.deleteProperty(obj, key)
                modified = true
                break
            }
        }
        if ('title' in obj) {
            if (!('content' in obj)) {
                obj['content'] = obj['title']
            } else {
                obj['content'] = `# ${String(obj['title'])}\n\n${String(obj['content'])}`
            }
            delete obj['title']
            modified = true
        }

        // 3. Heal auto_context
        if ('auto_context' in obj) {
            if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
                try {
                    obj['auto_context'] = JSON.stringify(obj['auto_context'])
                    modified = true
                } catch {
                    // Ignore stringify errors
                }
            }
            if (typeof obj['auto_context'] === 'string') {
                const ac = obj['auto_context'].trim().toLowerCase()
                if (ac === 'none' || ac === '{}' || ac === '{"commits":[]}') {
                    delete obj['auto_context']
                    modified = true
                } else if (ac.startsWith('{') && ac.includes("'")) {
                    try {
                        JSON.parse(obj['auto_context'])
                    } catch {
                        try {
                            const fixed = obj['auto_context'].replace(/'/g, '"')
                            const parsed = JSON.parse(fixed) as Record<string, unknown>
                            obj['auto_context'] = JSON.stringify(parsed)
                            modified = true
                        } catch {
                            // Ignore
                        }
                    }
                }
            }
        }

        // 4. Heal 'tag' -> 'tags'
        if ('tag' in obj && !('tags' in obj)) {
            obj['tags'] = obj['tag']
            delete obj['tag']
            modified = true
        }

        // 5. Heal string tags into arrays
        if ('tags' in obj && typeof obj['tags'] === 'string') {
            obj['tags'] = obj['tags'].split(',').map((t: string) => t.trim()).filter(Boolean)
            modified = true
        }

        // 6. Heal array tags normalization (e.g. 'session summary' -> 'session-summary')
        if ('tags' in obj && Array.isArray(obj['tags'])) {
            const healedTags = obj['tags'].map((t: unknown) => {
                if (typeof t === 'string') {
                    const lower = t.toLowerCase().trim()
                    if (lower === 'session summary' || lower === 'session_summary' || lower === 'team-session-summary' || lower === 'team_session_summary' || lower === 'team session summary') return 'session-summary'
                    if (lower === 'commit narrative' || lower === 'commit_narrative') return 'commit-narrative'
                }
                return t
            })
            // Only update if something changed
            if (JSON.stringify(obj['tags']) !== JSON.stringify(healedTags)) {
                obj['tags'] = healedTags
                modified = true
            }
        }

        // 7. Heal hallucinated entry types
        if ('entry_type' in obj && typeof obj['entry_type'] === 'string') {
            const et = obj['entry_type']
            const etLower = et.toLowerCase()
            if (etLower === 'session-summary' || etLower === 'session_summary' || etLower === 'team-session-summary' || etLower === 'team_session_summary' || etLower === 'team session summary') {
                obj['entry_type'] = 'retrospective'
                obj['tags'] ??= []
                if (Array.isArray(obj['tags']) && !obj['tags'].includes('session-summary')) {
                    obj['tags'].push('session-summary')
                }
                modified = true
            } else if (['task', 'chore', 'refactor', 'fix', 'update', 'technical', 'note', 'documentation'].includes(etLower)) {
                obj['entry_type'] = 'technical_note'
                obj['tags'] ??= []
                if (Array.isArray(obj['tags']) && !obj['tags'].includes(etLower)) {
                    obj['tags'].push(etLower)
                }
                modified = true
            } else if (etLower === 'bug') {
                obj['entry_type'] = 'bug_fix'
                modified = true
            } else if (etLower === 'feature') {
                obj['entry_type'] = 'feature_implementation'
                modified = true
            } else if (etLower === 'meeting') {
                obj['entry_type'] = 'meeting_notes'
                modified = true
            } else if (!ENTRY_TYPES.some(t => t === obj['entry_type'])) {
                obj['tags'] ??= []
                if (Array.isArray(obj['tags']) && !obj['tags'].includes(etLower)) {
                    obj['tags'].push(etLower)
                }
                obj['entry_type'] = 'other'
                modified = true
            }
        }

        // 8. Heal significance type alias
        if ('significance_type' in obj) {
            const originalSigType = obj['significance_type']
            coerceSignificanceAlias(obj)
            
            if (obj['significance_type'] !== undefined && obj['significance_type'] !== null && typeof obj['significance_type'] === 'string') {
                if (!SIGNIFICANCE_TYPES.some(t => t === obj['significance_type'])) {
                    const badSig = obj['significance_type'].toLowerCase().trim()
                    obj['tags'] ??= []
                    if (Array.isArray(obj['tags'])) {
                        obj['tags'].push(`significance:${badSig}`)
                    }
                    delete obj['significance_type']
                }
            }

            if (originalSigType !== obj['significance_type']) {
                modified = true
            }
        }

        return modified ? obj : val
    }
    return val
}

/** Maximum content length for journal entries (chars) */
export const MAX_CONTENT_LENGTH = 50_000

/** Maximum entries returned by any single search query */
export const MAX_QUERY_LIMIT = 500

/** Maximum entries per batch operation */
export const MAX_BATCH_SIZE = 50

/** Date sentinels for "all time" date range queries */
export const DATE_MIN_SENTINEL = '1970-01-01'
export const DATE_MAX_SENTINEL = '2999-12-31'

/** YYYY-MM-DD date format regex */
export const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/
export const DATE_FORMAT_MESSAGE = 'Date must be YYYY-MM-DD format'

/**
 * Relaxed numeric schema for MCP SDK inputSchema registration.
 *
 * Uses `z.union([z.number(), z.string()])` so the SDK's Zod validation
 * accepts both native numbers and string-typed numbers (e.g., `"42"`).
 * The handler's strict schema (`z.number()`) then validates and coerces
 * the value, producing structured `{success: false, error}` responses
 * via `formatHandlerError()` for invalid input.
 *
 * NOTE: `z.preprocess()` was attempted but its `ZodEffects` return type
 * is too complex for ESLint's strict type resolver, causing cascading
 * `@typescript-eslint/no-unsafe-*` errors across all call sites.
 */
export const relaxedNumber = (): z.ZodUnion<[z.ZodNumber, z.ZodString]> =>
    z.union([z.number(), z.string()])

/**
 * Strict schema for project_number validation.
 * Used in handler strict schemas to provide an informative error when missing,
 * since project_number is left optional in the SDK's MCP schema so it reaches the handler.
 */
export const StrictProjectNumberSchema = z.number({
    message:
        'Missing project_number. You MUST provide a valid project_number (e.g., 1) to associate this action with a specific project context.',
}).optional()

// ============================================================================
// Cross-Group Output Schemas
// ============================================================================

export const BatchResultOutputSchema = z.object({
    success: z.boolean().optional(),
    count: z.number().optional(),
    error: z.string().optional(),
}).extend(ErrorFieldsMixin.shape)

/**
 * Schema for a journal entry in output responses.
 * Uses camelCase to match actual database output format.
 */
export const EntryOutputSchema = z
    .object({
        id: z.number(),
        content: z.string().max(MAX_CONTENT_LENGTH),
        entryType: z.string(),
        isPersonal: z.boolean(),
        timestamp: z.string(),
        tags: z.array(z.string()).optional(),
        significanceType: z.string().nullable().optional(),
        autoContext: z
            .string()
            .nullable()
            .optional()
            .describe('@deprecated Use author and flagMetadata instead'),
        author: z.string().nullable().optional(),
        flagMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
        deletedAt: z.string().nullable().optional(),
        isArchived: z.boolean().optional(),
        projectNumber: z.number().nullable().optional(),
        projectName: z.string().optional().describe('Injected repository or project name resolved from projectRegistry'),
        projectOwner: z.string().nullable().optional(),
        issueNumber: z.number().nullable().optional(),
        issueUrl: z.string().nullable().optional(),
        prNumber: z.number().nullable().optional(),
        prUrl: z.string().nullable().optional(),
        prStatus: z.string().nullable().optional(),
        workflowRunId: z.number().nullable().optional(),
        workflowName: z.string().nullable().optional(),
        workflowStatus: z.string().nullable().optional(),
        workspaceId: z.string().optional().describe('Workspace isolation identifier'),
        source: z.enum(['personal', 'team']).optional(),
        importanceScore: z
            .number()
            .optional()
            .describe('Importance score (0.0-1.0), present when sort_by=importance'),
        trustScore: z.number().optional(),
        impactScore: z.number().optional(),
        validationStatus: z.string().optional(),
        version: z.number().optional(),
        sessionId: z.string().nullable().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for list of entries with count.
 * Used by get_recent_entries, search_entries, search_by_date_range.
 */
export const EntriesListOutputSchema = z
    .object({
        entries: z.array(EntryOutputSchema).optional(),
        count: z.number().optional(),
        searchMode: z.string().optional(),
        degraded: z
            .boolean()
            .optional()
            .describe(
                'True if the search degraded to a slower fallback method due to infrastructure failure'
            ),
        next_cursor: z.string().optional().describe('Cursor for the next page of results'),
        highlights: z.array(z.object({ id: z.number(), snippet: z.string() })).optional().describe('FTS5 search snippets when include_highlights is true'),
        facets: z.object({
            tags: z.array(z.object({ name: z.string(), count: z.number() })),
            entryTypes: z.array(z.object({ name: z.string(), count: z.number() })),
        }).optional().describe('Distribution counts when include_facets is true'),
        suggestions: z.array(z.string()).optional().describe('Fuzzy matches when fuzzy_match=true and no exact results were found'),
        correctedQuery: z.string().optional().describe('The corrected query when auto_correct=true and a confident match was found'),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a single entry revision (snapshot).
 */
export const EntryRevisionOutputSchema = z
    .object({
        id: z.number(),
        entryId: z.number(),
        revisionNumber: z.number(),
        contentSnapshot: z.string(),
        changedAt: z.string(),
        changedBy: z.string().nullable().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a list of entry revisions.
 */
export const EntryHistoryListOutputSchema = z
    .object({
        revisions: z.array(EntryRevisionOutputSchema).optional(),
        count: z.number().optional(),
        success: z.boolean().optional(),
        error: z.string().optional(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Schema for a relationship between entries.
 */
export const RelationshipOutputSchema = z
    .object({
        id: z.number(),
        fromEntryId: z.number(),
        toEntryId: z.number(),
        relationshipType: z.string(),
        description: z.string().nullable().optional(),
        createdAt: z.string(),
    })
    .extend(ErrorFieldsMixin.shape)

/**
 * Importance score breakdown schema.
 */
export const ImportanceBreakdownSchema = z.object({
    significance: z.number(),
    relationships: z.number(),
    causal: z.number(),
    recency: z.number(),
})

/**
 * Tag with usage count.
 */
export const TagOutputSchema = z
    .object({
        name: z.string(),
        count: z.number().nullable(),
    })
    .extend(ErrorFieldsMixin.shape)
