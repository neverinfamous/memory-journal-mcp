/**
 * Shared parameter normalization utilities, alias maps, and content healers.
 */

type NormalizerDebugLogger = (message: string, context?: Record<string, unknown>) => void
let normalizerDebugLogger: NormalizerDebugLogger | undefined

/**
 * Register a host-side debug logger for normalizer parse warnings.
 * [BOUNDARY] Avoids pulling `logger.ts` / `security-utils.ts` into Code Mode worker bundles.
 */
export function setNormalizerDebugLogger(fn: NormalizerDebugLogger | undefined): void {
    normalizerDebugLogger = fn
}

export function logNormalizerDebug(message: string, context?: Record<string, unknown>): void {
    normalizerDebugLogger?.(message, context)
}

export function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val)
}

export function safeString(val: unknown): string {
    if (typeof val === 'string') return val
    if (typeof val === 'number' || typeof val === 'boolean') return String(val)
    if (typeof val === 'object' && val !== null) {
        try {
            return JSON.stringify(val, null, 2)
        } catch {
            return ''
        }
    }
    return ''
}

/**
 * Known parameter alias map for common agent hallucinations.
 * Maps hallucinated parameter names to their canonical equivalents.
 * Only applied when the canonical name is not already present.
 */
export const PARAM_ALIASES: Record<string, string> = {
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
    project_name: 'project_number',
    projectName: 'project_number',
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
    comment: 'resolution',
    resolution_comment: 'resolution',
    severity: 'flag_type',
    sort: 'sort_by',
    order_by: 'sort_by',
    order: 'sort_by',
    keep: 'keep_count',
    path: 'source_dir',
    impactScore: 'impact_score',
    trustScore: 'trust_score',
    validationStatus: 'validation_status',
}

/**
 * Common hallucinated entry types -> canonical types.
 * [INVARIANT] Single source of truth for Code Mode entry-type aliasing (key-normalizer and
 * generic-field-aliases both consume this map).
 */
export const ENTRY_TYPE_ALIASES: Record<string, string> = {
    'session-summary': 'retrospective',
    'session_summary': 'retrospective',
    'team-session-summary': 'retrospective',
    'team_session_summary': 'retrospective',
    'team session summary': 'retrospective',
    'summary': 'retrospective',
    'bug': 'bug_fix',
    'bugfix': 'bug_fix',
    'bug-fix': 'bug_fix',
    'hotfix': 'bug_fix',
    'defect': 'bug_fix',
    'feature': 'feature_implementation',
    'meeting': 'meeting_notes',
    'note': 'technical_note',
    'technical-note': 'technical_note',
    'technical': 'technical_note',
    'documentation': 'technical_note',
    'chore': 'technical_note',
    'refactor': 'technical_note',
    'fix': 'technical_note',
    'reflection': 'personal_reflection',
    'decision': 'project_decision',
    'review': 'code_review',
    'code': 'technical_note',
    'coding': 'technical_note',
    'progress': 'development_note',
    'status': 'development_note',
    'development': 'development_note',
    'update': 'development_note',
    'test': 'system_integration_test',
    'testing': 'system_integration_test',
    'task': 'technical_note',
}

/**
 * Common hallucinated tags -> canonical tags
 */
export const TAG_ALIASES: Record<string, string> = {
    'session_summary': 'session-summary',
    'team_session_summary': 'session-summary',
    'team-session-summary': 'session-summary',
    'team session summary': 'session-summary',
    'commit_narrative': 'commit-narrative',
    'bug_fix': 'bug-fix',
    'feature_implementation': 'feature',
}

const DEDUP_ACCOMPLISHED_RE = /^#+\s+Accomplished/gim
const DEDUP_UNFINISHED_RE = /^#+\s+Unfinished \/ Blocked/gim
const DEDUP_CONTEXT_RE = /^#+\s+Context for Next Session/gim
const DEDUP_COMMITS_RE = /^#+\s+Commits/gim

const SYNONYM_ACCOMPLISHED_RE =
    /^#+\s+(?:Accomplishments|Completed|Done|What I did|What we did)\s*$/gim
const SYNONYM_UNFINISHED_RE = /^#+\s+(?:Blockers|Unfinished|Unfinished\/?Blocked|Blocked)\s*$/gim
const SYNONYM_CONTEXT_RE = /^#+\s+(?:Next Session|Context|Next steps)\s*$/gim
const SYNONYM_COMMITS_RE = /^#+\s+(?:Commit History|Git Commits)\s*$/gim
const LEVEL_ACCOMPLISHED_RE = /^(?:#|#{3,})\s+Accomplished\s*$/gim
const LEVEL_UNFINISHED_RE = /^(?:#|#{3,})\s+Unfinished \/ Blocked\s*$/gim
const LEVEL_CONTEXT_RE = /^(?:#|#{3,})\s+Context for Next Session\s*$/gim
const LEVEL_COMMITS_RE = /^(?:#|#{3,})\s+Commits\s*$/gim

const COLLAPSE_ACCOMPLISHED_RE = /(?:^#+[ \t]+Accomplished[ \t]*\r?\n-[ \t]*(?:None\.?[ \t]*)?(?:\r?\n|$)){2,}/gim
const COLLAPSE_UNFINISHED_RE = /(?:^#+[ \t]+Unfinished \/ Blocked[ \t]*\r?\n-[ \t]*(?:None\.?[ \t]*)?(?:\r?\n|$)){2,}/gim
const COLLAPSE_CONTEXT_RE = /(?:^#+[ \t]+Context for Next Session[ \t]*\r?\n-[ \t]*(?:None\.?[ \t]*)?(?:\r?\n|$)){2,}/gim
const COLLAPSE_COMMITS_RE = /(?:^#+[ \t]+Commits[ \t]*\r?\n-[ \t]*(?:None\.?[ \t]*)?(?:\r?\n|$)){2,}/gim

const REQUIRED_PERIOD_HEADERS: readonly { header: string; testRe: RegExp }[] = [
    { header: '## Accomplished', testRe: /#+\s+Accomplished/i },
    { header: '## Unfinished / Blocked', testRe: /#+\s+Unfinished\s*\/\s*Blocked/i },
    { header: '## Context for Next Session', testRe: /#+\s+Context\s*for\s*Next\s*Session/i },
    { header: '## Commits', testRe: /#+\s+Commits/i },
]

function deduplicateSectionHeader(str: string, headerRe: RegExp): string {
    let count = 0
    headerRe.lastIndex = 0
    return str.replace(headerRe, (match) => {
        count++
        return count === 1 ? match : ''
    })
}

/**
 * Heal mangled, duplicate, or missing section headers in session summary content.
 */
export function healSessionSummaryContent(
    content: string,
    options?: { normalizeSynonyms?: boolean; usePeriodOnNone?: boolean }
): string {
    let healed = content

    if (options?.normalizeSynonyms !== false) {
        healed = healed.replace(SYNONYM_ACCOMPLISHED_RE, '## Accomplished')
        healed = healed.replace(SYNONYM_UNFINISHED_RE, '## Unfinished / Blocked')
        healed = healed.replace(SYNONYM_CONTEXT_RE, '## Context for Next Session')
        healed = healed.replace(SYNONYM_COMMITS_RE, '## Commits')
        healed = healed.replace(LEVEL_ACCOMPLISHED_RE, '## Accomplished')
        healed = healed.replace(LEVEL_UNFINISHED_RE, '## Unfinished / Blocked')
        healed = healed.replace(LEVEL_CONTEXT_RE, '## Context for Next Session')
        healed = healed.replace(LEVEL_COMMITS_RE, '## Commits')
    }

    healed = healed.replace(COLLAPSE_ACCOMPLISHED_RE, '## Accomplished\n- None.\n')
    healed = healed.replace(COLLAPSE_UNFINISHED_RE, '## Unfinished / Blocked\n- None.\n')
    healed = healed.replace(COLLAPSE_CONTEXT_RE, '## Context for Next Session\n- None.\n')
    healed = healed.replace(COLLAPSE_COMMITS_RE, '## Commits\n- None.\n')

    healed = deduplicateSectionHeader(healed, DEDUP_ACCOMPLISHED_RE)
    healed = deduplicateSectionHeader(healed, DEDUP_UNFINISHED_RE)
    healed = deduplicateSectionHeader(healed, DEDUP_CONTEXT_RE)
    healed = deduplicateSectionHeader(healed, DEDUP_COMMITS_RE)

    if (options?.usePeriodOnNone === true) {
        for (const { header, testRe } of REQUIRED_PERIOD_HEADERS) {
            if (!testRe.test(healed)) {
                healed += `\n\n${header}\n- None.`
            }
        }
    } else {
        if (!/#+\s+Accomplished/i.test(healed)) healed += '\n\n## Accomplished\n- \n'
        if (!/#+\s+Unfinished \/ Blocked/i.test(healed)) healed += '\n\n## Unfinished / Blocked\n- None\n'
        if (!/#+\s+Context for Next Session/i.test(healed)) healed += '\n\n## Context for Next Session\n- \n'
        if (!/#+\s+Commits/i.test(healed)) healed += '\n\n## Commits\n- None\n'
    }

    return healed.trim()
}

/**
 * Heal auto_context 'commits' hallucination (e.g. passing a string instead of an array, or using 'commit_shas').
 */
export function healAutoContext(result: Record<string, unknown>): void {
    if (!('auto_context' in result)) return
    const ac = result['auto_context']
    if (typeof ac === 'string') {
        try {
            let parsed: unknown
            try {
                parsed = JSON.parse(ac) as unknown
            } catch {
                parsed = JSON.parse(ac.replace(/'/g, '"')) as unknown
            }
            if (!isRecord(parsed)) return
            let changed = false

            for (const alias of ['commit_shas', 'shas', 'commit_sha', 'commitShas']) {
                if (alias in parsed) {
                    parsed['commits'] = parsed[alias]
                    Reflect.deleteProperty(parsed, alias)
                    changed = true
                }
            }

            if ('commits' in parsed && typeof parsed['commits'] === 'string') {
                parsed['commits'] = [parsed['commits']]
                changed = true
            }

            if (changed) {
                result['auto_context'] = JSON.stringify(parsed)
            }
        } catch (error) {
            logNormalizerDebug('Failed to parse auto_context JSON during normalization', {
                module: 'CodeMode',
                error: error instanceof Error ? error.message : String(error),
            })
        }
    } else if (isRecord(ac)) {
        for (const alias of ['commit_shas', 'shas', 'commit_sha', 'commitShas']) {
            if (alias in ac) {
                ac['commits'] = ac[alias]
                Reflect.deleteProperty(ac, alias)
            }
        }
        if ('commits' in ac && typeof ac['commits'] === 'string') {
            ac['commits'] = [ac['commits']]
        }
    }
}
