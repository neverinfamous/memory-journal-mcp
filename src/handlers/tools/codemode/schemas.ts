import { z } from 'zod'
import { ErrorFieldsMixin } from './error-fields-mixin.js'
import { relaxedNumber } from './schemas.js'

// ============================================================================
// Tool Classification Sets
// ============================================================================

/**
 * Tools that modify state and should be blocked in dry runs
 */
export const MUTATION_TOOL_NAMES = new Set([
    // Core
    'create_entry',
    'batch_create_entries',
    // Team
    'team_pass_flag',
    'team_update_flag',
    'team_batch_create_entries',
    'team_update_entry',
    'team_delete_entry',
    // Aliases
    'team_create_alias',
    'team_update_alias',
    'team_delete_alias',
    // Relationships
    'create_relationship',
    // IO
    'export_markdown',
    'import_markdown',
    'import_external',
])

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
    dry_run: z.boolean().optional().default(false),
    context: z.record(z.unknown()).optional(),
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
    dry_run: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            'If true, state-modifying API calls (create_entry, update_entry, etc.) will be skipped, returning simulated success.'
        ),
    context: z
        .record(z.unknown())
        .optional()
        .describe(
            'A JSON object to pass variables directly into the sandbox (accessible via `context`). Use this for large strings or complex data to avoid string-escaping issues in the code parameter.'
        ),
})
