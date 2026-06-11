import { z } from 'zod'

import { relaxedNumber } from '../schemas.js'

// ============================================================================
// Tool Classification Sets
// ============================================================================


/**
 * Tools that require version awareness (expected_version logic)
 */
export const VERSION_AWARE_TOOL_NAMES = new Set([
    'team_update_entry',
    'team_delete_entry',
])

// ============================================================================
// Execution Schemas
// ============================================================================

export const ExecuteCodeSchema = z.object({
    code: z.string().optional(),
    auto_version: z.boolean().optional().default(true),
    project_number: z.number().optional(),
    repo: z.string().optional(),
    dry_run: z.boolean().optional().default(false),
    context: z.record(z.string(), z.unknown()).optional(),
    timeout_ms: z.number().optional(),
})

export const ExecuteCodeSchemaMcp = z.object({
    code: z
        .string()
        .optional()
        .describe(
            'The JavaScript code to execute inside the sandbox. Uses the `mj` global object for API access.'
        ),
    auto_version: z
        .boolean()
        .optional()
        .default(true)
        .describe('Automatically inject expected_version for optimistic concurrency on updates/deletes'),
    project_number: relaxedNumber()
        .optional()
        .describe(
            'REQUIRED for team operations. The numerical ID (or owner/repo string) of the GitHub project to bind to. Falls back to DEFAULT_PROJECT_NUMBER if unspecified.'
        ),
    repo: z
        .string()
        .optional()
        .describe(
            'Target repository name to set as default context for all github/kanban tools executed in this sandbox (e.g., "memory-journal-mcp").'
        ),
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            'If true, state-modifying API calls (create_entry, update_entry, etc.) will be skipped, returning simulated success.'
        ),
    context: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
            'A JSON object to pass variables directly into the sandbox (accessible via `context`). Use this for large strings or complex data to avoid string-escaping issues in the code parameter.'
        ),
})
