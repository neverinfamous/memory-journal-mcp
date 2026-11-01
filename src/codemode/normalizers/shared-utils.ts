/**
 * Shared parameter normalization utilities, alias maps, and content healers.
 */

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
    webhook: 'report_webhook_url',
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
    team_id: 'workspace_id',
    team: 'workspace_id',
}

/**
 * Common hallucinated entry types -> canonical types
 */
export const ENTRY_TYPE_ALIASES: Record<string, string> = {
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
    'code': 'technical_note',
    'coding': 'technical_note',
    'progress': 'development_note',
    'status': 'development_note',
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

function deduplicateSectionHeader(str: string, headerRegexStr: string): string {
    let count = 0
    return str.replace(new RegExp(headerRegexStr, 'gim'), (match) => {
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
        healed = healed.replace(/^#+\s+(?:Accomplishments|Completed|Done|What I did|What we did)\s*$/gim, '## Accomplished')
        healed = healed.replace(/^#+\s+(?:Blockers|Unfinished|Unfinished\/?Blocked|Blocked)\s*$/gim, '## Unfinished / Blocked')
        healed = healed.replace(/^#+\s+(?:Next Session|Context|Next steps)\s*$/gim, '## Context for Next Session')
    }

    healed = healed.replace(/(?:^#+\s+Accomplished\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Accomplished\n- None.\n')
    healed = healed.replace(/(?:^#+\s+Unfinished \/ Blocked\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Unfinished / Blocked\n- None.\n')
    healed = healed.replace(/(?:^#+\s+Context for Next Session\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Context for Next Session\n- None.\n')
    healed = healed.replace(/(?:^#+\s+Commits\s*\n-\s*(?:None\.?|)\s*){2,}/gim, '## Commits\n- None.\n')

    healed = deduplicateSectionHeader(healed, '^#+\\s+Accomplished')
    healed = deduplicateSectionHeader(healed, '^#+\\s+Unfinished \\/ Blocked')
    healed = deduplicateSectionHeader(healed, '^#+\\s+Context for Next Session')
    healed = deduplicateSectionHeader(healed, '^#+\\s+Commits')

    if (options?.usePeriodOnNone === true) {
        const requiredHeaders = [
            '## Accomplished',
            '## Unfinished / Blocked',
            '## Context for Next Session',
            '## Commits',
        ]
        for (const header of requiredHeaders) {
            const cleanHeader = header.replace(/^#+\s+/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')
            const regex = new RegExp(`#+\\s+${cleanHeader}`, 'i')
            if (!regex.test(healed)) {
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
            const parsed = JSON.parse(ac.replace(/'/g, '"')) as unknown
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
        } catch {
            // ignore JSON parse errors
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
