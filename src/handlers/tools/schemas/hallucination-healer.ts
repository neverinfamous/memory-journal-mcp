/**
 * Shared Preprocessor to Heal Common LLM Hallucinations in Payloads Before Zod Validation
 */

import { resolveProjectContext } from '../../../utils/workspace-resolver.js'
import {
    ENTRY_TYPES,
    SIGNIFICANCE_TYPES,
    coerceSignificanceAlias,
    safeString,
} from './constants-and-primitives.js'

const KEY_ALIAS_MAP: Record<string, string> = {
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
    session: 'session_id', sessionId: 'session_id', conversation_id: 'session_id',
    conversationId: 'session_id', thread_id: 'session_id', threadId: 'session_id',
}

const CONTENT_ALIASES = [
    'entry', 'text', 'message', 'description', 'summary', 'notes', 'body', 'instructions',
    'details', 'markdown', 'post', 'journal_entry', 'journalEntry', 'entry_text', 'entryText',
]

const PASSED_VALIDATION_ALIASES = new Set([
    'pass', 'success', 'ok', 'passed', 'validated', 'valid', 'verified', 'true', '1',
])
const FAILED_VALIDATION_ALIASES = new Set(['fail', 'failed', 'error', 'failing', 'false', '0'])
const NONE_VALIDATION_ALIASES = new Set([
    'none', 'null', 'undefined', 'skip', 'skipped', 'unknown', 'pending',
])
const SESSION_SUMMARY_TAG_ALIASES = new Set([
    'session summary', 'session_summary', 'team-session-summary', 'team_session_summary', 'team session summary',
])
const TECHNICAL_NOTE_ALIASES = new Set([
    'task', 'chore', 'refactor', 'fix', 'update', 'technical', 'note', 'documentation', 'code', 'coding',
])
const BUG_FIX_ALIASES = new Set(['bug', 'bugfix', 'bug_fix', 'bug-fix', 'hotfix', 'defect'])

function toStr(v: unknown): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (v !== null && v !== undefined) {
        try {
            return JSON.stringify(v)
        } catch {
            return ''
        }
    }
    return ''
}

function healMetadataAndContextFields(obj: Record<string, unknown>): boolean {
    let modified = false

    for (const extraKey of ['date', 'created_at', 'updated_at', 'type', 'status']) {
        if (extraKey in obj && extraKey !== 'entry_type') {
            if (extraKey === 'type' && !('entry_type' in obj)) obj['entry_type'] = obj['type']
            Reflect.deleteProperty(obj, extraKey)
            modified = true
        }
    }

    for (const [field, label] of [
        ['context', 'Context'], ['focus', 'Focus'], ['resolution', 'Resolution'],
    ] as const) {
        if (field in obj) {
            const val =
                field === 'context' && typeof obj[field] === 'object' && obj[field] !== null
                    ? JSON.stringify(obj[field], null, 2)
                    : toStr(obj[field])
            if (val !== '') {
                const existingContent = toStr(obj['content'])
                obj['content'] =
                    existingContent !== '' ? `${existingContent}\n\n**${label}:** ${val}` : val
            }
            Reflect.deleteProperty(obj, field)
            modified = true
        }
    }

    if ('artifacts' in obj) {
        if (Array.isArray(obj['artifacts']) && obj['artifacts'].length > 0) {
            const artStr = obj['artifacts']
                .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                .join(', ')
            const existingContent = toStr(obj['content'])
            obj['content'] =
                existingContent !== '' ? `${existingContent}\n\n**Artifacts:** ${artStr}` : artStr
        }
        Reflect.deleteProperty(obj, 'artifacts')
        modified = true
    }

    if ('category' in obj) {
        if (typeof obj['category'] === 'string' && obj['category'].trim() !== '') {
            const cat = obj['category'].trim()
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes(cat)) obj['tags'].push(cat)
        }
        Reflect.deleteProperty(obj, 'category')
        modified = true
    }

    return modified
}

function healTagsAndEntryType(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('tag' in obj && !('tags' in obj)) {
        obj['tags'] = obj['tag']
        delete obj['tag']
        modified = true
    }

    if ('tags' in obj && typeof obj['tags'] === 'string') {
        obj['tags'] = obj['tags'].split(',').map((t: string) => t.trim()).filter(Boolean)
        modified = true
    }

    if ('tags' in obj && Array.isArray(obj['tags'])) {
        const healedTags = obj['tags'].map((t: unknown) => {
            if (typeof t === 'string') {
                const lower = t.toLowerCase().trim()
                if (SESSION_SUMMARY_TAG_ALIASES.has(lower)) return 'session-summary'
                if (lower === 'commit narrative' || lower === 'commit_narrative')
                    return 'commit-narrative'
            }
            return t
        })
        if (JSON.stringify(obj['tags']) !== JSON.stringify(healedTags)) {
            obj['tags'] = healedTags
            modified = true
        }
    }

    if ('entry_type' in obj && typeof obj['entry_type'] === 'string') {
        const etLower = obj['entry_type'].toLowerCase()
        if (etLower === 'session-summary' || SESSION_SUMMARY_TAG_ALIASES.has(etLower)) {
            obj['entry_type'] = 'retrospective'
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes('session-summary')) {
                obj['tags'].push('session-summary')
            }
            modified = true
        } else if (etLower === 'progress' || etLower === 'status' || etLower === 'development') {
            obj['entry_type'] = 'development_note'
            modified = true
        } else if (TECHNICAL_NOTE_ALIASES.has(etLower)) {
            obj['entry_type'] = 'technical_note'
            obj['tags'] ??= []
            if (Array.isArray(obj['tags']) && !obj['tags'].includes(etLower)) {
                obj['tags'].push(etLower)
            }
            modified = true
        } else if (BUG_FIX_ALIASES.has(etLower)) {
            obj['entry_type'] = 'bug_fix'
            modified = true
        } else if (etLower === 'feature') {
            obj['entry_type'] = 'feature_implementation'
            modified = true
        } else if (etLower === 'meeting') {
            obj['entry_type'] = 'meeting_notes'
            modified = true
        } else if (!ENTRY_TYPES.some((t) => t === obj['entry_type'])) {
            obj['tags'] ??= []
            const cleanedTag = etLower.replace(/^[^a-z0-9]+/, '').replace(/_/g, '-')
            if (Array.isArray(obj['tags']) && cleanedTag.length > 0 && !obj['tags'].includes(cleanedTag)) {
                obj['tags'].push(cleanedTag)
            }
            obj['entry_type'] = 'other'
            modified = true
        }
    }

    if ('significance_type' in obj) {
        const originalSigType = obj['significance_type']
        coerceSignificanceAlias(obj)

        if (typeof obj['significance_type'] === 'string') {
            if (!SIGNIFICANCE_TYPES.some((t) => t === obj['significance_type'])) {
                const badSig = obj['significance_type'].toLowerCase().trim()
                obj['tags'] ??= []
                if (Array.isArray(obj['tags'])) obj['tags'].push(`significance:${badSig}`)
                delete obj['significance_type']
            }
        }

        if (originalSigType !== obj['significance_type']) modified = true
    }

    return modified
}

function healWorkspaceAndProjectContext(obj: Record<string, unknown>): boolean {
    let modified = false

    const rawProjName = obj['project_name'] ?? obj['projectName']
    if (rawProjName !== undefined) {
        if (!('project_number' in obj) || obj['project_number'] === undefined) {
            const num = Number(rawProjName)
            const strVal =
                typeof rawProjName === 'string' || typeof rawProjName === 'number'
                    ? String(rawProjName)
                    : ''
            if (!Number.isNaN(num) && strVal.trim() !== '') obj['project_number'] = num
        }
        delete obj['project_name']
        delete obj['projectName']
        modified = true
    }

    if ('project_number' in obj && typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        let num = Number(cleaned)
        if (Number.isNaN(num) && /^p-?\d+$/i.test(cleaned)) {
            num = Number(cleaned.replace(/^p-?/i, ''))
        }
        if (!Number.isNaN(num) && cleaned !== '') {
            obj['project_number'] = num
            modified = true
        } else {
            if (
                obj['workspace_id'] === undefined ||
                obj['workspace_id'] === null ||
                obj['workspace_id'] === 'default'
            ) {
                obj['workspace_id'] = cleaned
            }
            delete obj['project_number']
            modified = true
        }
    }

    const wsId = typeof obj['workspace_id'] === 'string' ? obj['workspace_id'] : undefined
    const projNum =
        typeof obj['project_number'] === 'number' && !Number.isNaN(obj['project_number'])
            ? obj['project_number']
            : undefined
    const contentStr = typeof obj['content'] === 'string' ? obj['content'] : undefined
    const tagsArr = Array.isArray(obj['tags'])
        ? obj['tags'].filter((t): t is string => typeof t === 'string')
        : undefined

    if (wsId === undefined || wsId === '' || wsId === 'default' || projNum === undefined) {
        const resolved = resolveProjectContext({
            workspace_id: wsId,
            project_number: projNum,
            content: contentStr,
            tags: tagsArr,
        })
        if (
            resolved.workspaceId !== undefined &&
            resolved.workspaceId !== 'default' &&
            (wsId === undefined || wsId === 'default')
        ) {
            obj['workspace_id'] = resolved.workspaceId
            modified = true
        } else if (
            process.env['MCP_WORKSPACE_ID'] !== undefined &&
            (wsId === undefined || wsId === 'default')
        ) {
            obj['workspace_id'] = process.env['MCP_WORKSPACE_ID']
            modified = true
        } else if (wsId === undefined) {
            obj['workspace_id'] = 'default'
            modified = true
        }
        if (obj['project_number'] === undefined && resolved.projectNumber !== undefined) {
            obj['project_number'] = resolved.projectNumber
            modified = true
        }
    }

    return modified
}

function healTitleAndAutoContext(obj: Record<string, unknown>): boolean {
    let modified = false

    if ('title' in obj || 'heading' in obj || 'subject' in obj || 'name' in obj) {
        const rawTitle = obj['title'] ?? obj['heading'] ?? obj['subject'] ?? obj['name']
        if (rawTitle !== undefined && rawTitle !== null) {
            const titleStr = safeString(rawTitle).trim()
            if (titleStr !== '') {
                const cleanTitle = titleStr.replace(/^#+\s*/, '')
                const currentContent = safeString(obj['content']).trim()
                if (
                    !('content' in obj) ||
                    obj['content'] === undefined ||
                    obj['content'] === null ||
                    currentContent === ''
                ) {
                    if (!('query' in obj)) obj['content'] = `# ${cleanTitle}`
                } else if (!currentContent.startsWith(`# ${cleanTitle}`)) {
                    obj['content'] = `# ${cleanTitle}\n\n${currentContent}`
                }
            }
        }
        delete obj['title']
        delete obj['heading']
        delete obj['subject']
        delete obj['name']
        modified = true
    }

    if ('auto_context' in obj) {
        if (typeof obj['auto_context'] === 'object' && obj['auto_context'] !== null) {
            try {
                obj['auto_context'] = JSON.stringify(obj['auto_context'])
                modified = true
            } catch {
                // Ignore stringify errors
            }
        }
        if (typeof obj['auto_context'] === 'string') {
            const ac = obj['auto_context'].trim().toLowerCase()
            if (ac === 'none' || ac === '{}' || ac === '{"commits":[]}') {
                delete obj['auto_context']
                modified = true
            } else if (ac.startsWith('{') && ac.includes("'")) {
                try {
                    JSON.parse(obj['auto_context'])
                } catch {
                    try {
                        const fixed = obj['auto_context'].replace(/'/g, '"')
                        const parsed = JSON.parse(fixed) as Record<string, unknown>
                        obj['auto_context'] = JSON.stringify(parsed)
                        modified = true
                    } catch {
                        // Ignore
                    }
                }
            }
        }
    }

    return modified
}

/**
 * Shared preprocessor to heal common LLM hallucinations in payloads before Zod validation.
 */
export function healAgentHallucinations(val: unknown): unknown {
    if (typeof val !== 'object' || val === null) return val

    const obj = { ...(val as Record<string, unknown>) }
    let modified = false

    for (const [badKey, goodKey] of Object.entries(KEY_ALIAS_MAP)) {
        if (badKey in obj) {
            if (!(goodKey in obj) && obj[badKey] !== undefined) obj[goodKey] = obj[badKey]
            Reflect.deleteProperty(obj, badKey)
            modified = true
        }
    }

    for (const numField of ['trust_score', 'impact_score'] as const) {
        if (numField in obj && typeof obj[numField] === 'string') {
            const n = Number(obj[numField])
            if (!Number.isNaN(n)) {
                obj[numField] = n
                modified = true
            }
        }
    }

    if (
        'validation_status' in obj &&
        obj['validation_status'] !== undefined &&
        obj['validation_status'] !== null
    ) {
        const rawVs = obj['validation_status']
        const vsStr =
            typeof rawVs === 'string'
                ? rawVs.trim().toLowerCase()
                : typeof rawVs === 'number' || typeof rawVs === 'boolean'
                  ? String(rawVs)
                  : ''
        if (rawVs === true || PASSED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'passed'
            modified = true
        } else if (rawVs === false || FAILED_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'failed'
            modified = true
        } else if (NONE_VALIDATION_ALIASES.has(vsStr)) {
            obj['validation_status'] = 'none'
        } else if (typeof rawVs === 'string' && !['passed', 'none', 'failed'].includes(vsStr)) {
            obj['validation_status'] = 'none'
            modified = true
        }
    }

    if (healWorkspaceAndProjectContext(obj)) modified = true

    if (
        'entry' in obj &&
        typeof obj['entry'] === 'object' &&
        obj['entry'] !== null &&
        !Array.isArray(obj['entry'])
    ) {
        const nested = obj['entry'] as Record<string, unknown>
        Reflect.deleteProperty(obj, 'entry')
        for (const [k, v] of Object.entries(nested)) {
            if (!(k in obj) && v !== undefined) obj[k] = v
        }
        modified = true
    }

    if ('entry' in obj) {
        const entryVal = obj['entry']
        if (
            typeof entryVal === 'number' ||
            (typeof entryVal === 'string' &&
                /^\d+$/.test(entryVal.trim()) &&
                !('tags' in obj) &&
                !('entry_type' in obj) &&
                !('title' in obj))
        ) {
            if (!('entry_id' in obj)) {
                obj['entry_id'] = typeof entryVal === 'number' ? entryVal : Number(entryVal.trim())
                modified = true
            }
            Reflect.deleteProperty(obj, 'entry')
        }
    }

    for (const key of CONTENT_ALIASES) {
        if (key in obj && !('content' in obj)) {
            obj['content'] = obj[key]
            Reflect.deleteProperty(obj, key)
            modified = true
            break
        } else if (key in obj) {
            Reflect.deleteProperty(obj, key)
            modified = true
        }
    }

    if (healTitleAndAutoContext(obj)) modified = true

    if ('entry_id' in obj && typeof obj['entry_id'] === 'string') {
        const cleaned = obj['entry_id'].replace(/^[^0-9]+/, '')
        const num = Number(cleaned)
        if (!Number.isNaN(num) && cleaned.trim() !== '') {
            obj['entry_id'] = num
            modified = true
        }
    }
    if ('entry_ids' in obj && Array.isArray(obj['entry_ids'])) {
        const healedIds = obj['entry_ids'].map((id: unknown) => {
            if (typeof id === 'string') {
                const cleaned = id.replace(/^[^0-9]+/, '')
                const num = Number(cleaned)
                return !Number.isNaN(num) && cleaned.trim() !== '' ? num : id
            }
            return id
        })
        if (JSON.stringify(obj['entry_ids']) !== JSON.stringify(healedIds)) {
            obj['entry_ids'] = healedIds
            modified = true
        }
    }

    if (healMetadataAndContextFields(obj)) modified = true
    if (healTagsAndEntryType(obj)) modified = true

    return modified ? obj : val
}
