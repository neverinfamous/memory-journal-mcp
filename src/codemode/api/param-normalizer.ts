/**
 * Parameter normalization for Code Mode API.
 *
 * Handles agent hallucinations by mapping aliased parameter names to their
 * canonical equivalents, converting camelCase to snake_case, and supporting
 * positional argument patterns.
 */

import { POSITIONAL_PARAM_MAP } from '../api-constants.js'
import { isRecord } from '../normalizers/shared-utils.js'
import { convertKeysToSnakeCase } from './key-normalizer.js'

export { convertKeysToSnakeCase }

const ENTRY_CREATE_METHODS = new Set(['createEntry', 'createEntryMinimal', 'teamCreateEntry'])

const VALID_ENTRY_FIELDS = new Set([
    '_alias_derived_workspace',
    'use_test_db',
    'useTestDb',
    'expected_version',
    'expectedVersion',
    'is_archived',
    'isArchived',
    'target_workspace_id',
    'targetWorkspaceId',
    'entry_id',
    'entryId',
    'auto_version',
    'autoVersion',
    'dry_run',
    'dryRun',
    'readonly',
    'readOnly',
    'read_only',
    'type',
    'tags',
    'entry_type',
    'is_personal',
    'share_with_team',
    'significance_type',
    'auto_context',
    'project',
    'project_id',
    'projectId',
    'project_name',
    'projectName',
    'projectNumber',
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
    'workspace',
    'workspaceId',
    'workspace_id',
    'session_id',
    'impact_score',
    'trust_score',
    'validation_status',
    'relationships',
    'anchors',
    'auto_link',
    'author',
    'repo',
    'repo_name',
    'repoName',
    'repository',
])

/**
 * Handle common agent hallucination where they omit 'content' and pass arbitrary fields:
 * the extra fields are folded into a markdown `content` string (mutates `obj`).
 */
function synthesizeMissingEntryContent(methodName: string, obj: Record<string, unknown>): void {
    if (!ENTRY_CREATE_METHODS.has(methodName) || 'content' in obj) return

    let content = ''
    for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith('_') || VALID_ENTRY_FIELDS.has(key)) continue
        const strValue =
            typeof value === 'object' && value !== null ? JSON.stringify(value, null, 2) : String(value)
        content += `**${key}**\n${strValue}\n\n`
    }
    const trimmed = content.trim()
    if (trimmed !== '') {
        obj['content'] = trimmed
    }
}

/** Map a single primitive argument onto its positional parameter name. */
function mapPrimitiveArg(methodName: string, arg: string | number | boolean): unknown {
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

function assignDefined(target: Record<string, unknown>, source: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) target[key] = value
    }
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
        if (isRecord(arg)) {
            const obj = convertKeysToSnakeCase(arg, methodName)
            synthesizeMissingEntryContent(methodName, obj)
            return obj
        }

        // Primitive arg (string, number, boolean) — use positional mapping
        if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
            return mapPrimitiveArg(methodName, arg)
        }

        return arg
    }

    // Multi-arg: use positional parameter mapping
    const paramMapping = POSITIONAL_PARAM_MAP[methodName]
    if (paramMapping === undefined) {
        return args[0]
    }

    if (typeof paramMapping === 'string') {
        const result: Record<string, unknown> = isRecord(args[0])
            ? convertKeysToSnakeCase(args[0], methodName)
            : { [paramMapping]: args[0] }
        if (args.length > 1) {
            const lastArg = args[args.length - 1]
            if (isRecord(lastArg)) {
                assignDefined(result, convertKeysToSnakeCase(lastArg, methodName))
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
        if (isRecord(lastArg)) {
            assignDefined(result, convertKeysToSnakeCase(lastArg, methodName))
        }
    }

    return result
}
