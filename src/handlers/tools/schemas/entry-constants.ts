/**
 * Zero-dependency entry, relationship, validation, and alias constants.
 * [BOUNDARY] Must remain free of `zod`, `yaml`, or filesystem imports so worker-thread
 * normalizers and schema help (`dist/worker-script.js`) bundle zero external packages.
 */

import { isRecord } from '../../../utils/type-guards.js'

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
    if (isRecord(params)) {
        const obj = params
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
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
        return String(val)
    }
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

const CALENDAR_DATE_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Validate `YYYY-MM-DD` format AND real UTC calendar month/day (including leap years). */
export function isValidCalendarDate(val: string): boolean {
    const match = CALENDAR_DATE_PARTS_RE.exec(val)
    if (match === null) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const utc = new Date(Date.UTC(year, month - 1, day))
    return (
        utc.getUTCFullYear() === year &&
        utc.getUTCMonth() === month - 1 &&
        utc.getUTCDate() === day
    )
}

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

export const CAUSED_BY_RELATIONSHIP_ERROR =
    "[ANTI-HALLUCINATION] 'caused_by' is not a canonical relationship type. Invert source/target with 'caused', or use 'resolved' / 'evolves_from' / 'blocked_by'."

/**
 * Targeted Zod v4 enum error mapper for relationship type fields.
 * Returns a specific recovery hint for `'caused_by'` variants and falls back to Zod's default error otherwise.
 */
export function relationshipTypeEnumError(issue: { readonly input?: unknown }): string | undefined {
    if (typeof issue.input !== 'string') return undefined
    const normalized = issue.input
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    return normalized === 'caused_by' ? CAUSED_BY_RELATIONSHIP_ERROR : undefined
}

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
    if (typeof item === 'string') {
        const trimmed = item.trim()
        if (/^[1-9]\d*$/.test(trimmed)) {
            const parsed = Number(trimmed)
            if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) {
                return { targetId: parsed, relationType: 'references' }
            }
        }
    }
    if (isRecord(item)) {
        const relObj = item
        const rawTarget = pickRecordField(relObj, RELATIONSHIP_TARGET_KEYS)
        let targetId: unknown = rawTarget
        if (typeof rawTarget === 'string') {
            const trimmed = rawTarget.trim()
            if (/^[1-9]\d*$/.test(trimmed)) {
                const parsed = Number(trimmed)
                if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) {
                    targetId = parsed
                }
            }
        }
        return {
            targetId,
            relationType: pickRecordField(relObj, RELATIONSHIP_TYPE_KEYS) ?? 'references',
        }
    }
    return item
}

export const KEY_ALIAS_MAP: Record<string, string> = {
    id: 'entry_id',
    ids: 'entry_ids',
    entryId: 'entry_id',
    targetWorkspaceId: 'target_workspace_id',
    project_id: 'project_number',
    projectId: 'project_number',
    projectNumber: 'project_number',
    isPersonal: 'is_personal',
    personal: 'is_personal',
    entryType: 'entry_type',
    significanceType: 'significance_type',
    significance: 'significance_type',
    autoContext: 'auto_context',
    autoLink: 'auto_link',
    impactScore: 'impact_score',
    impact: 'impact_score',
    trustScore: 'trust_score',
    trust: 'trust_score',
    confidence: 'trust_score',
    validationStatus: 'validation_status',
    validation: 'validation_status',
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
    share_team: 'share_with_team',
    team: 'share_with_team',
    anchorPath: 'anchor_path',
    anchorType: 'anchor_type',
    sourceTag: 'source_tag',
    targetTag: 'target_tag',
    old_tag: 'source_tag',
    oldTag: 'source_tag',
    from_tag: 'source_tag',
    fromTag: 'source_tag',
    new_tag: 'target_tag',
    newTag: 'target_tag',
    to_tag: 'target_tag',
    toTag: 'target_tag',
    fromEntryId: 'from_entry_id',
    fromId: 'from_entry_id',
    toEntryId: 'to_entry_id',
    toId: 'to_entry_id',
    relationshipType: 'relationship_type',
    session: 'session_id',
    sessionId: 'session_id',
    conversation_id: 'session_id',
    conversationId: 'session_id',
    thread_id: 'session_id',
    threadId: 'session_id',
}

export const CONTENT_ALIASES = [
    'entry',
    'text',
    'message',
    'description',
    'summary',
    'notes',
    'body',
    'instructions',
    'details',
    'markdown',
    'post',
    'journal_entry',
    'journalEntry',
    'entry_text',
    'entryText',
    'note',
    'comment',
    'reason',
    'findings',
    'observation',
    'observations',
    'analysis',
    'problem',
    'issue',
    'fix',
    'solution',
    'result',
    'outcome',
    'action_taken',
    'actionTaken',
]

export const PASSED_VALIDATION_ALIASES = new Set([
    'pass',
    'success',
    'ok',
    'passed',
    'validated',
    'valid',
    'verified',
    'true',
    '1',
])
export const FAILED_VALIDATION_ALIASES = new Set([
    'fail',
    'failed',
    'error',
    'failing',
    'false',
    '0',
])
export const NONE_VALIDATION_ALIASES = new Set([
    'none',
    'null',
    'undefined',
    'skip',
    'skipped',
    'unknown',
    'pending',
])
export const SESSION_SUMMARY_TAG_ALIASES = new Set([
    'session summary',
    'session_summary',
    'team-session-summary',
    'team_session_summary',
    'team session summary',
])
export const TECHNICAL_NOTE_ALIASES = new Set([
    'task',
    'chore',
    'refactor',
    'fix',
    'update',
    'technical',
    'note',
    'documentation',
    'code',
    'coding',
])
export const BUG_FIX_ALIASES = new Set(['bug', 'bugfix', 'bug_fix', 'bug-fix', 'hotfix', 'defect'])
