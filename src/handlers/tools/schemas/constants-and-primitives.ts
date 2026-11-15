/**
 * Shared Constants and Primitive Validators for Tool Handlers
 */

import { z } from 'zod'

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
    'system_integration_test',
    'test_entry',
    'plan_draft',
    'adversarial_review',
    'plan_refinement',
    'plan_finalized',
    'copilot_validation',
    'maintenance',
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

const SIGNIFICANCE_ALIAS_MAP: Readonly<Record<string, string | undefined>> = {
    important: 'milestone',
    major: 'breakthrough',
    critical: 'security',
    learning: 'lesson_learned',
    key_decision: 'decision',
    resolved: 'blocker_resolved',
    architectural: 'architecture',
    maintenance: undefined,
    minor: undefined,
}

/**
 * Normalize common significance_type aliases to their canonical enum equivalent,
 * returning `undefined` when an alias represents non-significant noise (`maintenance`/`minor`),
 * or returning the trimmed raw value otherwise.
 */
export function normalizeSignificanceValue(raw: string): string | undefined {
    const trimmed = raw.trim()
    const lower = trimmed.toLowerCase()
    if (Object.hasOwn(SIGNIFICANCE_ALIAS_MAP, lower)) {
        return SIGNIFICANCE_ALIAS_MAP[lower]
    }
    return trimmed
}

/**
 * Coerce common invalid significance_type aliases to their valid enum equivalents.
 * Mutates the params object directly before Zod validation.
 */
export function coerceSignificanceAlias(params: unknown): void {
    if (params !== null && params !== undefined && typeof params === 'object') {
        const obj = params as Record<string, unknown>
        if (typeof obj['significance_type'] === 'string') {
            const normalized = normalizeSignificanceValue(obj['significance_type'])
            if (normalized === undefined) {
                delete obj['significance_type']
            } else {
                obj['significance_type'] = normalized
            }
        }
    }
}

export function safeString(val: unknown): string {
    if (typeof val === 'string') return val
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint')
        return String(val)
    if (typeof val === 'object' && val !== null) {
        try {
            return JSON.stringify(val)
        } catch {
            return ''
        }
    }
    return ''
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
 */
export const relaxedNumber = (): z.ZodUnion<[z.ZodNumber, z.ZodString]> =>
    z.union([z.number(), z.string()])

/**
 * Strict schema for project_number validation.
 * Used in handler strict schemas to provide an informative error when missing,
 * since project_number is left optional in the SDK's MCP schema so it reaches the handler.
 */
export const StrictProjectNumberSchema = z
    .number({
        message:
            'Missing project_number. You MUST provide a valid project_number (e.g., 1) to associate this action with a specific project context.',
    })
    .int({
        message:
            'Invalid project_number. Expected a positive integer (e.g., 1).',
    })
    .positive({
        message:
            'Invalid project_number. Expected a positive integer (e.g., 1).',
    })
    .optional()

/**
 * Normalize relationship item aliases (target_id, to_entry_id, relation_type, type, etc.)
 * into canonical { targetId, relationType } shape before Zod validation.
 */
export const RELATIONSHIP_TARGET_KEYS = [
    'targetId',
    'target_id',
    'target_entry_id',
    'targetEntryId',
    'to_entry_id',
    'toEntryId',
    'to_id',
    'toId',
    'entry_id',
    'entryId',
    'target',
    'to',
    'id',
] as const

export const RELATIONSHIP_TYPE_KEYS = [
    'relationType',
    'relation_type',
    'relationship_type',
    'relationshipType',
    'type',
] as const

/** Pick the first defined value matching `keys` from a plain record. */
export function pickRecordField(obj: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const key of keys) {
        if (obj[key] !== undefined) return obj[key]
    }
    return undefined
}

export function preprocessRelationshipItem(item: unknown): unknown {
    if (typeof item === 'number' && !Number.isNaN(item)) {
        return { targetId: item, relationType: 'references' }
    }
    if (typeof item === 'string' && /^\d+$/.test(item.trim())) {
        return { targetId: Number(item.trim()), relationType: 'references' }
    }
    if (item !== null && typeof item === 'object') {
        const relObj = item as Record<string, unknown>
        const rawTarget = pickRecordField(relObj, RELATIONSHIP_TARGET_KEYS)
        const targetId =
            typeof rawTarget === 'string' && /^\d+$/.test(rawTarget.trim())
                ? Number(rawTarget.trim())
                : rawTarget
        return {
            targetId,
            relationType: pickRecordField(relObj, RELATIONSHIP_TYPE_KEYS) ?? 'references',
        }
    }
    return item
}

export const KEY_ALIAS_MAP: Record<string, string> = {
    id: 'entry_id', ids: 'entry_ids', entryId: 'entry_id',
    project_id: 'project_number', projectId: 'project_number', projectNumber: 'project_number', project: 'project_number',
    workspaceId: 'workspace_id', workspace: 'workspace_id', repo: 'workspace_id', repository: 'workspace_id', repo_name: 'workspace_id',
    isPersonal: 'is_personal', personal: 'is_personal',
    entryType: 'entry_type',
    significanceType: 'significance_type', significance: 'significance_type',
    autoContext: 'auto_context',
    impactScore: 'impact_score', impact: 'impact_score',
    trustScore: 'trust_score', trust: 'trust_score', confidence: 'trust_score',
    validationStatus: 'validation_status', validation: 'validation_status',
    workflowRunId: 'workflow_run_id', workflowName: 'workflow_name', workflowStatus: 'workflow_status',
    prNumber: 'pr_number', prUrl: 'pr_url', prStatus: 'pr_status',
    issueNumber: 'issue_number', issueUrl: 'issue_url', projectOwner: 'project_owner',
    shareWithTeam: 'share_with_team', share_team: 'share_with_team', team: 'share_with_team',
    anchorPath: 'anchor_path', anchorType: 'anchor_type',
    sourceTag: 'source_tag', targetTag: 'target_tag',
    old_tag: 'source_tag', oldTag: 'source_tag', from_tag: 'source_tag', fromTag: 'source_tag',
    new_tag: 'target_tag', newTag: 'target_tag', to_tag: 'target_tag', toTag: 'target_tag',
    fromEntryId: 'from_entry_id', fromId: 'from_entry_id',
    toEntryId: 'to_entry_id', toId: 'to_entry_id',
    relationshipType: 'relationship_type',
    session: 'session_id', sessionId: 'session_id', conversation_id: 'session_id',
    conversationId: 'session_id', thread_id: 'session_id', threadId: 'session_id',
}

export const CONTENT_ALIASES = [
    'entry', 'text', 'message', 'description', 'summary', 'notes', 'body', 'instructions',
    'details', 'markdown', 'post', 'journal_entry', 'journalEntry', 'entry_text', 'entryText',
]

export const PASSED_VALIDATION_ALIASES = new Set(['pass', 'success', 'ok', 'passed', 'validated', 'valid', 'verified', 'true', '1'])
export const FAILED_VALIDATION_ALIASES = new Set(['fail', 'failed', 'error', 'failing', 'false', '0'])
export const NONE_VALIDATION_ALIASES = new Set(['none', 'null', 'undefined', 'skip', 'skipped', 'unknown', 'pending'])
export const SESSION_SUMMARY_TAG_ALIASES = new Set(['session summary', 'session_summary', 'team-session-summary', 'team_session_summary', 'team session summary'])
export const TECHNICAL_NOTE_ALIASES = new Set(['task', 'chore', 'refactor', 'fix', 'update', 'technical', 'note', 'documentation', 'code', 'coding'])
export const BUG_FIX_ALIASES = new Set(['bug', 'bugfix', 'bug_fix', 'bug-fix', 'hotfix', 'defect'])

