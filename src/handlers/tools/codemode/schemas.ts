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
    'update_entry',
    'delete_entry',
])

// ============================================================================
// Execution Schemas
// ============================================================================

export const ExecuteCodeSchema = z.preprocess((val) => {
    if (typeof val === 'string') return { code: val }
    return val
}, z.object({
    code: z.string().optional(),
    script: z.string().optional(),
    source: z.string().optional(),
    query: z.string().optional(),
    content: z.string().optional(),
    text: z.string().optional(),
    body: z.string().optional(),
    js: z.string().optional(),
    javascript: z.string().optional(),
    payload: z.string().optional(),
    executionCode: z.string().optional(),
    input: z.string().optional(),
    command: z.string().optional(),
    expression: z.string().optional(),
    fn: z.string().optional(),
    exec: z.string().optional(),
    eval: z.string().optional(),
    code_snippet: z.string().optional(),
    raw_code: z.string().optional(),
    statement: z.string().optional(),
    statements: z.string().optional(),
    codeBlock: z.string().optional(),
    code_block: z.string().optional(),
    script_content: z.string().optional(),
    js_code: z.string().optional(),
    code_string: z.string().optional(),
    action: z.string().optional(),
    task: z.string().optional(),
    instruction: z.string().optional(),
    instructions: z.string().optional(),
    entry: z.unknown().optional(),
    auto_version: z.boolean().optional().default(true),
    project_number: relaxedNumber().optional(),
    workspace_id: z.string().optional(),
    repo: z.string().optional(),
    dry_run: z.boolean().optional().default(false),
    context: z.unknown().optional(),
    timeout_ms: z.coerce.number().optional(),
    timeout: z.coerce.number().optional(),
    readonly: z.boolean().optional(),
}).catchall(z.unknown()))

export const ExecuteCodeSchemaMcp = z.object({
    code: z
        .string()
        .optional()
        .describe(
            'REQUIRED string parameter containing JavaScript code to execute inside the sandbox. Uses the `mj` global object for API access (e.g. `return await mj.core.createEntry(context.entry)`). Anti-Hallucination Hint: DO NOT call with an empty payload `{}` or pass entry/query payloads directly without including the `code` parameter. When passing markdown or strings with nested backticks (`), pass them safely via the `context` parameter (e.g., `mj.createEntry({ ...context.entry })`) or ensure nested backticks are escaped (\\`) to avoid premature template string termination. Node.js native modules (`fs`, `path`, `child_process`, `require()`, `import`) are disabled in the sandbox; pass file content or external data using the `context` parameter instead.'
        ),
    auto_version: z
        .boolean()
        .optional()
        .default(true)
        .describe('Automatically inject expected_version for optimistic concurrency on updates/deletes'),
    project_number: relaxedNumber().optional()
        .optional()
        .describe(
            'Numeric project ID to bind to all tool calls in this sandbox. ' +
            'Repo name strings (e.g., "mysql-mcp") are auto-resolved via the project registry. ' +
            'Falls back to DEFAULT_PROJECT_NUMBER if unspecified. Find it by querying memory://agent-id.'
        ),
    workspace_id: z
        .string()
        .optional()
        .describe(
            'Target workspace ID to isolate data. If omitted, uses defaultWorkspaceId if configured.'
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
    context: z.unknown()
        .optional()
        .describe(
            'A JSON object, string, or array to pass variables directly into the sandbox (accessible via `context` inside JS code). Use this to pass file contents, external text, or complex entry objects into Code Mode without requiring `fs` or dynamic `require()`.'
        ),
    readonly: z
        .boolean()
        .optional()
        .describe(
            'If true, execution is restricted to read-only operations. Write tools will be filtered out of the API bridge.'
        ),
    timeout: z.preprocess(
        (val) => {
            if (val === undefined || val === null) return undefined;
            const num = Number(val);
            return Number.isNaN(num) ? undefined : num;
        },
        z.number().optional()
    ).describe(
        'Maximum execution time in milliseconds before the sandbox forcibly terminates the script (max: 30000ms).'
    ),
})
