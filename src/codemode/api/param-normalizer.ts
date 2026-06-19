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
    pull_request_id: 'pr_number',
    pull_number: 'pr_number',
    user: 'target_user',
    assignee: 'target_user',
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
    mode: 'instruction_level',
    // §1.5: Sort/order aliases
    sort: 'sort_by',
    order_by: 'sort_by',
    order: 'sort_by',
    keep: 'keep_count',
    path: 'source_dir', // common fallback, handled contextually
    // Aliases for missing MCP Code Mode mapping fields
    impactScore: 'impact_score',
    trustScore: 'trust_score',
    validationStatus: 'validation_status',
    // Team identification hallucinations
    team_id: 'workspace_id',
    team: 'workspace_id',
}

/**
 * Common hallucinated entry types -> canonical types
 */
const ENTRY_TYPE_ALIASES: Record<string, string> = {
    'session-summary': 'retrospective',
    'session_summary': 'retrospective',
    'team-session-summary': 'retrospective',
    'team_session_summary': 'retrospective',
    'team session summary': 'retrospective',
    'summary': 'retrospective',
    'bug': 'bug_fix',
    'feature': 'feature_implementation',
    'note': 'technical_note',
    'technical-note': 'technical_note',
    'reflection': 'personal_reflection',
    'decision': 'project_decision',
    'review': 'code_review',
}

/**
 * Common hallucinated tags -> canonical tags
 */
const TAG_ALIASES: Record<string, string> = {
    'session_summary': 'session-summary',
    'team_session_summary': 'session-summary',
    'team-session-summary': 'session-summary',
    'team session summary': 'session-summary',
    'commit_narrative': 'commit-narrative',
    'bug_fix': 'bug-fix',
    'feature_implementation': 'feature',
}

/**
 * Convert camelCase object keys to snake_case
 */
export function convertKeysToSnakeCase(obj: Record<string, unknown>, methodName?: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
        let snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)

        // Handle common agent hallucination where they pass 'id' instead of 'entry_id'
        if (snakeKey === 'id' && !('entry_id' in obj) && !('entryId' in obj)) {
            snakeKey = 'entry_id'
        }

        // Context-aware 'type' hallucination
        if (snakeKey === 'type') {
            if (methodName?.toLowerCase().includes('export')) {
                snakeKey = 'format'
            } else if (
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
        let useAlias = alias !== undefined && !(alias in obj) && !(alias in result)

        // Context-aware protection for 'title' and 'body' in GitHub tools
        if (useAlias && (snakeKey === 'title' || snakeKey === 'body')) {
            if (methodName && (
                methodName.toLowerCase().includes('github') || 
                methodName.toLowerCase().includes('issue') || 
                methodName.toLowerCase().includes('milestone') || 
                methodName.toLowerCase().includes('pr')
            )) {
                useAlias = false
            }
        }

        // Context-aware protection for 'keep' (only for backup tools)
        if (useAlias && snakeKey === 'keep') {
            if (methodName && !methodName.toLowerCase().includes('backup')) {
                useAlias = false
            }
        }

        // Context-aware protection for 'mode' (only for config tools)
        if (useAlias && snakeKey === 'mode') {
            if (methodName && !methodName.toLowerCase().includes('config')) {
                useAlias = false
            }
        }

        // Context-aware protection for 'source' (only for importExternal)
        if (useAlias && snakeKey === 'source') {
            if (methodName?.toLowerCase().includes('import')) {
                useAlias = false
                snakeKey = 'source_format'
            } else if (methodName && !methodName.toLowerCase().includes('link')) {
                // For link tools, source_tag is correct. Otherwise, we don't know what they mean.
            }
        }

        // Context-aware protection for 'path'
        if (useAlias && snakeKey === 'path') {
            if (methodName?.toLowerCase().includes('export')) {
                useAlias = false
                snakeKey = 'output_dir'
            } else if (!methodName?.toLowerCase().includes('import')) {
                useAlias = false
            }
        }

        // Context-aware protection for 'text', 'body', 'note', 'title' (only for entry/comment tools)
        if (useAlias && (snakeKey === 'text' || snakeKey === 'body' || snakeKey === 'note' || snakeKey === 'title')) {
            if (methodName && !(
                methodName.toLowerCase().includes('create') || 
                methodName.toLowerCase().includes('update') || 
                methodName.toLowerCase().includes('entry') ||
                methodName.toLowerCase().includes('github') ||
                methodName.toLowerCase().includes('issue') ||
                methodName.toLowerCase().includes('pr') ||
                methodName.toLowerCase().includes('milestone')
            )) {
                useAlias = false
            }
        }

        if (useAlias && typeof alias === 'string') {
            snakeKey = alias
        }

        // Context-aware 'content' hallucination
        if (snakeKey === 'message' || snakeKey === 'msg' || snakeKey === 'name' || snakeKey === 'description' || snakeKey === 'content' || snakeKey === 'comment') {
            const isGithubTool = Boolean(methodName && (
                methodName.toLowerCase().includes('github') || 
                methodName.toLowerCase().includes('issue') || 
                methodName.toLowerCase().includes('pr') ||
                methodName.toLowerCase().includes('milestone')
            ));
            
            if (isGithubTool) {
                if (snakeKey === 'name') {
                    if (!('title' in obj) && !('title' in result)) {
                        snakeKey = 'title'
                    }
                } else if (snakeKey === 'description' && methodName?.toLowerCase().includes('milestone')) {
                    // milestones use description natively
                    snakeKey = 'description'
                } else if (methodName?.toLowerCase().includes('close') && (snakeKey === 'message' || snakeKey === 'msg' || snakeKey === 'content')) {
                    // close issue uses comment
                    if (!('comment' in obj) && !('comment' in result)) {
                        snakeKey = 'comment'
                    }
                } else {
                    if (!('body' in obj) && !('body' in result) && snakeKey !== 'comment') {
                        // PRs and issues use body for content
                        snakeKey = 'body'
                    }
                }
            } else if (methodName && (methodName.includes('create') || methodName.includes('update') || methodName.includes('Entry')) && !methodName.toLowerCase().includes('link')) {
                if (!('content' in obj) && !('content' in result)) {
                    snakeKey = 'content'
                }
            }
        }

        // Coerce hallucinated role values
        if (snakeKey === 'role' && typeof value === 'string' && value.toLowerCase() === 'contributor') {
            result[snakeKey] = 'member'
            continue
        }

        // Coerce hallucinated significance types
        if (snakeKey === 'significance_type' && typeof value === 'string') {
            const valLower = value.toLowerCase();
            const validTypes = new Set(['milestone', 'breakthrough', 'decision', 'architecture', 'lesson_learned', 'blocker_resolved', 'release', 'security']);
            if (!validTypes.has(valLower)) {
                // If it's invalid, skip assigning it entirely to prevent strict schema failure
                continue
            }
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

        // Heal hallucinated entry types
        if (snakeKey === 'entry_type' && typeof value === 'string') {
            const valLower = value.toLowerCase()
            if (ENTRY_TYPE_ALIASES[valLower]) {
                result[snakeKey] = ENTRY_TYPE_ALIASES[valLower]
                continue
            }
        }

        result[snakeKey] = value
    }

    // Coerce singular 'tag' to 'tags' array
    if ('tag' in result && !('tags' in result)) {
        const tagVal = result['tag']
        result['tags'] = Array.isArray(tagVal) ? tagVal : [tagVal]
        delete result['tag']
    }

    // Heal hallucinated tags
    if ('tags' in result && Array.isArray(result['tags'])) {
        result['tags'] = result['tags'].map((tag: unknown) => {
            if (typeof tag === 'string') {
                const tagLower = tag.trim().toLowerCase()
                return TAG_ALIASES[tagLower] || tag
            }
            return tag
        })
    }

    // Coerce top-level 'commits' array into auto_context for session summaries / commit narratives
    if ('commits' in result && Array.isArray(result['commits'])) {
        if (!('auto_context' in result) || typeof result['auto_context'] !== 'string') {
            result['auto_context'] = JSON.stringify({ commits: result['commits'] })
        }
        delete result['commits']
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

    // Auto-detect and heal forgotten session summary tags/entry_type based on content headers
    if ('content' in result && typeof result['content'] === 'string') {
        const c = result['content'];
        if (/#+\s+Accomplished/i.test(c) && /#+\s+Unfinished \/ Blocked/i.test(c)) {
            if (!('entry_type' in result)) result['entry_type'] = 'retrospective';
            
            let tags = result['tags'];
            if (!Array.isArray(tags)) {
                tags = tags !== undefined && tags !== null ? [tags] : [];
                result['tags'] = tags;
            }
            if (!(tags as unknown[]).includes('session-summary')) {
                (tags as unknown[]).push('session-summary');
            }
        }
    }

    // Heal session summary headers hallucination (Layer 2 Dispatcher Healing)
    if ('tags' in result && Array.isArray(result['tags']) && result['tags'].includes('session-summary') && 'content' in result && typeof result['content'] === 'string') {
        const c = result['content'];
        let healedContent = c;
        const requiredHeaders = [
            '## Accomplished',
            '## Unfinished / Blocked',
            '## Context for Next Session',
            '## Commits'
        ];
        
        let changed = false;
        for (const header of requiredHeaders) {
            // Check for loose match (case insensitive)
            const cleanHeader = header.replace(/^#+\s+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
            const regex = new RegExp(`#+\\s+${cleanHeader}`, 'i');
            if (!regex.test(healedContent)) {
                healedContent += `\n\n${header}\n- None.`;
                changed = true;
            }
        }
        
        if (changed) {
            result['content'] = healedContent.trim();
        }
    }

    // Heal auto_context 'commits' hallucination (e.g. passing a string instead of an array)
    if ('auto_context' in result) {
        const ac = result['auto_context'];
        if (typeof ac === 'string') {
            try {
                // Try to parse, fix, and re-stringify if it has a string commits field
                const parsed = JSON.parse(ac.replace(/'/g, '"')) as Record<string, unknown>;
                if ('commits' in parsed && typeof parsed['commits'] === 'string') {
                    parsed['commits'] = [parsed['commits']];
                    result['auto_context'] = JSON.stringify(parsed);
                }
            } catch { /* empty */ }
        } else if (typeof ac === 'object' && ac !== null) {
            const acObj = ac as Record<string, unknown>;
            if ('commits' in acObj && typeof acObj['commits'] === 'string') {
                acObj['commits'] = [acObj['commits']];
            }
        }
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
            const obj = convertKeysToSnakeCase(arg as Record<string, unknown>, methodName)

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
                Object.assign(result, convertKeysToSnakeCase(lastArg as Record<string, unknown>, methodName))
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
            Object.assign(result, convertKeysToSnakeCase(lastArg as Record<string, unknown>, methodName))
        }
    }

    return result
}
