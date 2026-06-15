/**
 * Parameter normalization for Code Mode API.
 *
 * Handles agent hallucinations by mapping aliased parameter names to their
 * canonical equivalents, converting camelCase to snake_case, and supporting
 * positional argument patterns.
 */

import { POSITIONAL_PARAM_MAP } from '../api-constants.js'

// =============================================================================
// Parameter Normalization
// =============================================================================

/**
 * Known parameter alias map for common agent hallucinations.
 * Maps hallucinated parameter names to their canonical equivalents.
 * Only applied when the canonical name is not already present.
 */
const PARAM_ALIASES: Record<string, string> = {
    text: 'content',
    body: 'content',
    note: 'content',
    title: 'content',
    entry: 'entry_id',
    q: 'query',
    issue: 'issue_number',
    pr: 'pr_number',
    pr_id: 'pr_number',
    project: 'project_number',
    project_id: 'project_number',
    proj: 'project_number',
    milestone_id: 'milestone_number',
    issue_id: 'issue_number',
    user: 'target_user',
    assignee: 'target_user',
    msg: 'content',
    repo_name: 'repo',
    version: 'expected_version',
    search: 'query',
    term: 'query',
    keyword: 'query',
    source: 'source_tag',
    target: 'target_tag',
    from: 'from_entry_id',
    to: 'to_entry_id',
    kind: 'entry_type',
    format_type: 'format',
    webhook: 'report_webhook_url',
    // §1.3: Flag resolution comment aliases
    comment: 'resolution',
    resolution_comment: 'resolution',
    // §1.3: Severity escalation alias (agents say "escalate severity")
    severity: 'flag_type',
    // §1.5: Sort/order aliases
    sort: 'sort_by',
    order_by: 'sort_by',
    order: 'sort_by',
}

/**
 * Convert camelCase object keys to snake_case
 */
export function convertKeysToSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        let snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

        // Handle common agent hallucination where they pass 'id' instead of 'entry_id'
        if (snakeKey === 'id' && !('entry_id' in obj) && !('entryId' in obj)) {
            snakeKey = 'entry_id'
        }

        // Context-aware 'type' hallucination
        if (snakeKey === 'type') {
            if (
                !('entry_type' in obj) &&
                !('flag_type' in obj) &&
                !('entry_type' in result) &&
                !('flag_type' in result)
            ) {
                // We default to entry_type since it's the most common
                snakeKey = 'entry_type'
            }
        }

        // Context-aware 'filename' hallucination
        if (snakeKey === 'filename') {
            // 'filename' is the canonical parameter for restoreBackup
            // but agents often hallucinate it for import_markdown's 'source_dir'
            if (!('source_dir' in obj) && !('source_dir' in result)) {
                // If the object has import-specific fields like 'project_number' or 'tags', 
                // it's likely import_markdown. Otherwise, we leave it as 'filename'.
                if ('project_number' in obj || 'tags' in obj || 'dry_run' in obj) {
                    snakeKey = 'source_dir'
                }
            }
        }

        // Context-aware 'target_user' hallucination for team member tools
        if (snakeKey === 'target_user') {
            if (!('author' in obj) && !('author' in result)) {
                if ('role' in obj || 'role' in result) {
                    snakeKey = 'author'
                }
            }
        }

        // Remap known parameter aliases (only when canonical name is absent)
        const alias = PARAM_ALIASES[snakeKey]
        if (alias !== undefined && !(alias in obj) && !(alias in result)) {
            snakeKey = alias
        }

        // Coerce hallucinated role values
        if (snakeKey === 'role' && typeof value === 'string' && value.toLowerCase() === 'contributor') {
            result[snakeKey] = 'member'
            continue
        }

        // Coerce string numbers for ID fields
        if ((snakeKey.endsWith('_id') || snakeKey === 'id' || snakeKey === 'project_number') && typeof value === 'string') {
            const num = Number(value)
            if (!Number.isNaN(num) && value.trim() !== '') {
                result[snakeKey] = num
                continue
            }
        }
        
        // Coerce arrays of string numbers for ID fields (e.g. entry_ids)
        if ((snakeKey.endsWith('_ids') || snakeKey === 'ids') && Array.isArray(value)) {
            result[snakeKey] = value.map((v: unknown) => {
                if (typeof v === 'string') {
                    const num = Number(v)
                    if (!Number.isNaN(num) && v.trim() !== '') return num
                }
                return v
            })
            continue
        }

        result[snakeKey] = value
    }

    // Coerce singular 'tag' to 'tags' array
    if ('tag' in result && !('tags' in result)) {
        const tagVal = result['tag']
        result['tags'] = Array.isArray(tagVal) ? tagVal : [tagVal]
        delete result['tag']
    }

    // Propagate top-level project_number to batch elements
    if (typeof result['project_number'] === 'number') {
        const pn = result['project_number'];
        ['entries', 'updates', 'entry_ids'].forEach(key => {
            if (Array.isArray(result[key])) {
                for (const item of result[key]) {
                    interface BatchItem {
                        project_number?: number;
                        [key: string]: unknown;
                    }
                    if (typeof item === 'object' && item !== null && (item as BatchItem).project_number === undefined) {
                        (item as BatchItem).project_number = pn;
                    }
                }
            }
        });
    }

    return result
}

/**
 * Normalize parameters to support positional arguments.
 * Handles both single positional args and multiple positional args.
 */
export function normalizeParams(methodName: string, args: unknown[]): unknown {
    if (args.length === 0) return undefined

    if (args.length === 1) {
        const arg = args[0]

        // Object arg — pass through and convert camelCase to snake_case
        if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
            const obj = convertKeysToSnakeCase(arg as Record<string, unknown>)

            // Handle common agent hallucination where they omit 'content' and pass arbitrary fields
            if (
                (methodName === 'createEntry' ||
                    methodName === 'createEntryMinimal' ||
                    methodName === 'teamCreateEntry') &&
                !('content' in obj)
            ) {
                let content = ''
                const validFields = new Set([
                    'type',
                    'tags',
                    'entry_type',
                    'is_personal',
                    'share_with_team',
                    'significance_type',
                    'auto_context',
                    'project_number',
                    'project_owner',
                    'issue_number',
                    'issue_url',
                    'pr_number',
                    'pr_url',
                    'pr_status',
                    'workflow_run_id',
                    'workflow_name',
                    'workflow_status',
                ])
                for (const [key, value] of Object.entries(obj)) {
                    if (validFields.has(key)) continue
                    const strValue =
                        typeof value === 'object' && value !== null
                            ? JSON.stringify(value, null, 2)
                            : String(value)
                    content += `**${key}**\n${strValue}\n\n`
                }
                const trimmed = content.trim()
                if (trimmed) {
                    obj['content'] = trimmed
                }
            }

            return obj
        }

        // Primitive arg (string, number, boolean) — use positional mapping
        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
            const paramMapping = POSITIONAL_PARAM_MAP[methodName]
            if (typeof paramMapping === 'string') {
                return { [paramMapping]: arg }
            }
            if (Array.isArray(paramMapping) && paramMapping[0] !== undefined) {
                return { [paramMapping[0]]: arg }
            }
            // Fallback: try common names (only for strings)
            if (typeof arg === 'string') {
                return { content: arg, query: arg }
            }
            return arg
        }

        return arg
    }

    // Multi-arg: use positional parameter mapping
    const paramMapping = POSITIONAL_PARAM_MAP[methodName]
    if (paramMapping === undefined) {
        return args[0]
    }

    if (typeof paramMapping === 'string') {
        const result: Record<string, unknown> = { [paramMapping]: args[0] }
        if (args.length > 1) {
            const lastArg = args[args.length - 1]
            if (typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg)) {
                Object.assign(result, convertKeysToSnakeCase(lastArg as Record<string, unknown>))
            }
        }
        return result
    }

    // Array mapping — map positional args to named params
    const result: Record<string, unknown> = {}

    for (let i = 0; i < paramMapping.length && i < args.length; i++) {
        const key = paramMapping[i]
        if (key !== undefined) {
            result[key] = args[i]
        }
    }

    // Merge trailing options object
    if (args.length > paramMapping.length) {
        const lastArg = args[args.length - 1]
        if (typeof lastArg === 'object' && lastArg !== null && !Array.isArray(lastArg)) {
            Object.assign(result, convertKeysToSnakeCase(lastArg as Record<string, unknown>))
        }
    }

    return result
}
