import { resolveProjectContext } from '../../utils/workspace-resolver.js'
import { isRecord, safeString } from './shared-utils.js'

const NUMERIC_ID_KEYS = [
    'entry_id', 'entryId', 'id', 'from_entry_id', 'fromEntryId', 'to_entry_id', 'toEntryId',
    'project_number', 'projectNumber', 'issue_number', 'issueNumber', 'pr_number', 'prNumber',
    'milestone_number', 'milestoneNumber', 'offset', 'limit',
]

const EXECUTE_METHODS = new Set([
    'execute', 'execute_code', 'executeCode', 'mj_execute_code', 'mjExecuteCode', 'mysql_execute_code', 'mysqlExecuteCode',
])

const CREATE_ENTRY_METHODS = new Set([
    'create_entry', 'createEntry', 'team_create_entry', 'teamCreateEntry',
])

export function applyGenericInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (EXECUTE_METHODS.has(methodName) && args.length === 1 && typeof args[0] === 'string') {
        args = [{ code: args[0] }]
    }
    if (CREATE_ENTRY_METHODS.has(methodName) && args.length === 1 && typeof args[0] === 'string') {
        args = [{ content: args[0] }]
    }

    if (args.length === 2 && typeof args[0] === 'string' && isRecord(args[1])) {
        const firstStr = args[0].trim()
        const mergedObj = { ...args[1] }
        if (mergedObj['workspace_id'] === undefined && mergedObj['workspaceId'] === undefined) {
            mergedObj['workspace_id'] = firstStr
        } else if (mergedObj['title'] === undefined && mergedObj['content'] === undefined) {
            mergedObj['title'] = firstStr
        }
        args = [mergedObj]
    }

    if (args.length !== 1 || !isRecord(args[0])) return { args }
    const obj = { ...args[0] }
    args[0] = obj

    cleanSdkMetadataKeys(obj)
    normalizeSearchGrepAliases(methodName, obj)
    extractMetadataContextAliases(obj)
    coerceNumericStringIds(obj)
    normalizeGenericFieldAliases(obj)

    if (CREATE_ENTRY_METHODS.has(methodName)) {
        resolveCreateEntryProjectContext(obj)
    }

    if (typeof obj['sort_by'] === 'string') {
        const lowerSort = obj['sort_by'].toLowerCase()
        if (lowerSort.endsWith('_asc')) {
            obj['sort_by'] = obj['sort_by'].replace(/_asc$/i, '')
            obj['sort_order'] ??= 'asc'
        } else if (lowerSort.endsWith('_desc')) {
            obj['sort_by'] = obj['sort_by'].replace(/_desc$/i, '')
            obj['sort_order'] ??= 'desc'
        }
    }

    if (EXECUTE_METHODS.has(methodName)) {
        normalizeExecuteCodeAliases(obj)
    } else if (obj['repo'] !== undefined && obj['repo_name'] === undefined) {
        obj['repo_name'] = obj['repo']
        delete obj['repo']
    }

    for (const [src, dst] of [['item_type', 'type'], ['category', 'type'], ['metadata', 'context']] as const) {
        if (obj[src] !== undefined && obj[dst] === undefined) {
            obj[dst] = obj[src]
            Reflect.deleteProperty(obj, src)
        }
    }

    if (CREATE_ENTRY_METHODS.has(methodName) || methodName === 'update_entry' || methodName === 'updateEntry') {
        synthesizeEntryMutationFields(obj)
    }

    if (obj['search'] !== undefined && obj['query'] === undefined) {
        obj['query'] = obj['search']
        delete obj['search']
    }
    if (
        ['import_external', 'importExternal', 'team_import_external', 'teamImportExternal'].includes(methodName) &&
        obj['source_dir'] === undefined &&
        obj['filename'] !== undefined
    ) {
        obj['source_dir'] = obj['filename']
        delete obj['filename']
    }

    return { args }
}

function cleanSdkMetadataKeys(obj: Record<string, unknown>): void {
    for (const k of ['_u_r_i', '_uri']) {
        if (obj[k] !== undefined) {
            if (obj['uri'] === undefined && obj['Uri'] === undefined) obj['uri'] = obj[k]
            Reflect.deleteProperty(obj, k)
        }
    }
    if (obj['_url'] !== undefined) {
        if (obj['url'] === undefined && obj['Url'] === undefined) obj['url'] = obj['_url']
        delete obj['_url']
    }
    delete obj['_server_name']
    delete obj['_tool_name']
    delete obj['_meta']
    for (const key of Object.keys(obj)) {
        if (key.startsWith('_') && key !== '_journal') {
            const strippedKey = key.replace(/^_+/, '')
            if (strippedKey.length > 0 && obj[strippedKey] === undefined) obj[strippedKey] = obj[key]
            Reflect.deleteProperty(obj, key)
        }
    }
}

function normalizeSearchGrepAliases(methodName: string, obj: Record<string, unknown>): void {
    const lower = methodName.toLowerCase()
    if (!lower.includes('search') && !lower.includes('grep') && !lower.includes('find')) return

    if (obj['search_path'] === undefined) {
        const p = obj['searchPath'] ?? obj['SearchPath'] ?? obj['path'] ?? obj['Path'] ?? obj['dir'] ?? obj['directory'] ?? obj['cwd']
        if (typeof p === 'string') obj['search_path'] = p
    }
    if (obj['query'] === undefined) {
        const q = obj['Query'] ?? obj['pattern'] ?? obj['text'] ?? obj['search'] ?? obj['q']
        if (typeof q === 'string') obj['query'] = q
    }
    if (obj['file_pattern'] === undefined) {
        const fp = obj['filePattern'] ?? obj['FilePattern'] ?? obj['include']
        if (typeof fp === 'string') obj['file_pattern'] = fp
    }
    if (obj['case_insensitive'] === undefined) {
        const ci = obj['caseInsensitive'] ?? obj['CaseInsensitive'] ?? obj['ignore_case'] ?? obj['ignoreCase']
        if (typeof ci === 'boolean') obj['case_insensitive'] = ci
    }
    if (obj['is_regex'] === undefined) {
        const ir = obj['isRegex'] ?? obj['IsRegex'] ?? obj['regex']
        if (typeof ir === 'boolean') obj['is_regex'] = ir
    }
    if (obj['match_per_line'] === undefined) {
        const mpl = obj['matchPerLine'] ?? obj['MatchPerLine']
        if (typeof mpl === 'boolean') obj['match_per_line'] = mpl
    }
}

function extractMetadataContextAliases(obj: Record<string, unknown>): void {
    const metaObj = isRecord(obj['metadata']) ? obj['metadata'] : isRecord(obj['context']) ? obj['context'] : undefined
    if (!metaObj) return
    obj['project_number'] ??= metaObj['project_number'] ?? metaObj['projectNumber']
    obj['session_id'] ??= metaObj['session_id'] ?? metaObj['sessionId']
    obj['type'] ??= metaObj['type'] ?? metaObj['entry_type'] ?? metaObj['category']
    obj['tags'] ??= metaObj['tags']
    obj['workspace_id'] ??= metaObj['workspace_id'] ?? metaObj['workspaceId']
}

function coerceNumericStringIds(obj: Record<string, unknown>): void {
    for (const key of NUMERIC_ID_KEYS) {
        const val = obj[key]
        if (typeof val === 'string') {
            const strVal = val.trim()
            if (/^-?\d+$/.test(strVal)) {
                const parsed = parseInt(strVal, 10)
                if (!isNaN(parsed)) obj[key] = parsed
            } else if ((key === 'project_number' || key === 'projectNumber') && /^p-?\d+$/i.test(strVal)) {
                const parsed = parseInt(strVal.replace(/^p-?/i, ''), 10)
                if (!isNaN(parsed)) obj[key] = parsed
            } else if (key === 'project_number' || key === 'projectNumber') {
                Reflect.deleteProperty(obj, key)
            }
        }
    }
}

function normalizeGenericFieldAliases(obj: Record<string, unknown>): void {
    // High H-2 fixed: delete obj['msg'] (not obj['message'])
    for (const [src, dst] of [
        ['user', 'target_user'],
        ['severity', 'flag_type'],
        ['msg', 'message'],
        ['sort', 'sort_by'],
        ['sortBy', 'sort_by'],
        ['orderBy', 'sort_by'],
        ['order_by', 'sort_by'],
        ['validation', 'validation_status'],
        ['validationStatus', 'validation_status'],
    ] as const) {
        if (obj[src] !== undefined) {
            if (obj[dst] === undefined) obj[dst] = obj[src]
            Reflect.deleteProperty(obj, src)
        }
    }

    for (const [aliasKey, targetKey] of [
        ['confidence', 'trust_score'],
        ['trust', 'trust_score'],
        ['trustScore', 'trust_score'],
        ['impact', 'impact_score'],
        ['impactScore', 'impact_score'],
    ] as const) {
        if (obj[aliasKey] !== undefined) {
            if (obj[targetKey] === undefined) {
                obj[targetKey] = typeof obj[aliasKey] === 'string' ? Number(obj[aliasKey]) : obj[aliasKey]
            }
            Reflect.deleteProperty(obj, aliasKey)
        }
    }

    if (obj['validation_status'] !== undefined && obj['validation_status'] !== null) {
        const vs = typeof obj['validation_status'] === 'string' ? obj['validation_status'].trim().toLowerCase() : obj['validation_status']
        if (vs === true || (typeof vs === 'string' && ['pass', 'success', 'ok', 'passed', 'validated', 'valid', 'verified', 'true', '1'].includes(vs))) {
            obj['validation_status'] = 'passed'
        } else if (vs === false || (typeof vs === 'string' && ['fail', 'failed', 'error', 'failing', 'false', '0'].includes(vs))) {
            obj['validation_status'] = 'failed'
        } else if (typeof vs === 'string' && !['passed', 'none', 'failed'].includes(vs)) {
            obj['validation_status'] = 'none'
        }
    }

    for (const projAlias of ['project_name', 'projectName'] as const) {
        if (obj[projAlias] !== undefined) {
            if (obj['project_number'] === undefined) {
                const num = Number(obj[projAlias])
                const strVal = typeof obj[projAlias] === 'string' || typeof obj[projAlias] === 'number' ? String(obj[projAlias]) : ''
                if (!Number.isNaN(num) && strVal.trim() !== '') obj['project_number'] = num
            }
            Reflect.deleteProperty(obj, projAlias)
        }
    }
    if (obj['project'] !== undefined) {
        if (obj['project_number'] === undefined) {
            const num = Number(obj['project'])
            const strVal = typeof obj['project'] === 'string' || typeof obj['project'] === 'number' ? String(obj['project']) : ''
            if (!Number.isNaN(num) && strVal.trim() !== '') {
                obj['project_number'] = num
            } else if (typeof obj['project'] === 'string' && obj['project'].trim() !== '') {
                const existingTags = Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : []
                obj['tags'] = [...existingTags, obj['project'].trim()]
            }
        }
        delete obj['project']
    }
}

function resolveCreateEntryProjectContext(obj: Record<string, unknown>): void {
    let projNum = typeof obj['project_number'] === 'number' ? obj['project_number'] : undefined
    if (typeof obj['project_number'] === 'string') {
        const cleaned = obj['project_number'].trim()
        let parsedNum = Number(cleaned)
        if (Number.isNaN(parsedNum) && /^p-?\d+$/i.test(cleaned)) {
            parsedNum = Number(cleaned.replace(/^p-?/i, ''))
        }
        if (!Number.isNaN(parsedNum) && cleaned !== '') {
            projNum = parsedNum
            obj['project_number'] = parsedNum
        } else {
            if (obj['workspace_id'] === undefined || obj['workspace_id'] === null || obj['workspace_id'] === '' || obj['workspace_id'] === 'default') {
                obj['workspace_id'] = cleaned
            }
            delete obj['project_number']
        }
    }
    const content = typeof obj['content'] === 'string' ? obj['content'] : undefined
    const tags = Array.isArray(obj['tags']) ? obj['tags'].filter((t): t is string => typeof t === 'string') : undefined
    const resolved = resolveProjectContext({
        ...(typeof obj['workspace_id'] === 'string' ? { workspace_id: obj['workspace_id'] } : {}),
        ...(projNum !== undefined ? { project_number: projNum } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(tags !== undefined ? { tags } : {}),
    })
    if (
        resolved.workspaceId !== undefined &&
        resolved.workspaceId !== '' &&
        (obj['workspace_id'] === undefined || obj['workspace_id'] === null || obj['workspace_id'] === '' || obj['workspace_id'] === 'default')
    ) {
        if (resolved.workspaceId !== 'default') {
            obj['workspace_id'] = resolved.workspaceId
        } else if (process.env['MCP_WORKSPACE_ID'] !== undefined && process.env['MCP_WORKSPACE_ID'] !== '') {
            obj['workspace_id'] = process.env['MCP_WORKSPACE_ID']
        } else {
            obj['workspace_id'] = 'default'
        }
    }
    if (obj['project_number'] === undefined && resolved.projectNumber !== undefined) {
        obj['project_number'] = resolved.projectNumber
    }
}

function normalizeExecuteCodeAliases(obj: Record<string, unknown>): void {
    if (obj['repo_name'] !== undefined && obj['repo'] === undefined) {
        obj['repo'] = obj['repo_name']
        delete obj['repo_name']
    }
    if (obj['code'] !== undefined) return

    const codeAlias =
        obj['script'] ?? obj['js'] ?? obj['javascript'] ?? obj['query'] ?? obj['command'] ?? obj['content'] ??
        obj['eval'] ?? obj['source'] ?? obj['body'] ?? obj['expression'] ?? obj['fn'] ?? obj['exec'] ??
        obj['code_snippet'] ?? obj['raw_code'] ?? obj['statement'] ?? obj['statements'] ?? obj['codeBlock'] ??
        obj['code_block'] ?? obj['script_content'] ?? obj['js_code'] ?? obj['code_string'] ?? obj['action'] ??
        obj['task'] ?? obj['instruction'] ?? obj['instructions'] ?? obj['input'] ?? obj['payload'] ?? obj['text']

    if (typeof codeAlias === 'string') obj['code'] = codeAlias
    else if (isRecord(obj['payload'])) obj['code'] = JSON.stringify(obj['payload'])
    else if (isRecord(obj['entry'])) obj['code'] = JSON.stringify(obj['entry'])
    else if (isRecord(obj['input'])) obj['code'] = JSON.stringify(obj['input'])
    else if (obj['action'] !== undefined || obj['task'] !== undefined || obj['notes'] !== undefined || obj['changes'] !== undefined) {
        obj['code'] = JSON.stringify(obj)
    } else {
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' && v.trim().length > 0 && !['repo', 'workspace_id', 'expected_version', 'auto_version', 'project_number'].includes(k)) {
                obj['code'] = v
                break
            }
        }
    }
}

function synthesizeEntryMutationFields(obj: Record<string, unknown>): void {
    if (obj['type'] !== undefined && obj['entry_type'] === undefined) {
        obj['entry_type'] = obj['type']
        delete obj['type']
    }
    if (typeof obj['entry_type'] === 'string') {
        const etLower = obj['entry_type'].toLowerCase().trim()
        if (['bug', 'bugfix', 'bug_fix', 'bug-fix', 'hotfix', 'defect'].includes(etLower)) obj['entry_type'] = 'bug_fix'
        else if (['progress', 'status', 'development'].includes(etLower)) obj['entry_type'] = 'development_note'
        else if (etLower === 'feature') obj['entry_type'] = 'feature_implementation'
        else if (etLower === 'meeting') obj['entry_type'] = 'meeting_notes'
        else if (['task', 'chore', 'refactor', 'fix', 'update', 'technical', 'note', 'documentation', 'code', 'coding'].includes(etLower)) {
            obj['entry_type'] = 'technical_note'
        } else if (['session-summary', 'session_summary', 'team-session-summary', 'team_session_summary', 'team session summary'].includes(etLower)) {
            obj['entry_type'] = 'retrospective'
        }
    }
    const contentParts: string[] = []

    const consumeGroup = (keys: string[], format: (val: unknown) => string): void => {
        let found: unknown
        for (const k of keys) {
            if (found === undefined && obj[k] !== undefined) found = obj[k]
            Reflect.deleteProperty(obj, k)
        }
        if (found !== undefined) {
            const s = format(found)
            if (s !== '') contentParts.push(s)
        }
    }

    consumeGroup(['title', 'heading', 'subject', 'name'], (v) => {
        const s = safeString(v)
        return s !== '' ? `# ${s}` : ''
    })
    consumeGroup(['description', 'details', 'summary', 'notes', 'text', 'message'], safeString)
    consumeGroup(['context'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Context:** ${s}` : ''
    })
    consumeGroup(['focus', 'goal', 'objective'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Focus:** ${s}` : ''
    })
    consumeGroup(['resolution', 'fix', 'solution', 'result'], (v) => {
        const s = safeString(v)
        return s !== '' ? `**Resolution:** ${s}` : ''
    })
    consumeGroup(['artifacts', 'files', 'changes', 'modified_files'], (v) => {
        const s = Array.isArray(v) ? v.map(safeString).join(', ') : safeString(v)
        return s !== '' ? `**Artifacts:** ${s}` : ''
    })
    consumeGroup(['findings', 'results', 'key_findings', 'discoveries'], (v) => {
        const s = Array.isArray(v) ? v.map((f) => `- ${safeString(f)}`).join('\n') : safeString(v)
        return s !== '' ? `**Findings:**\n${s}` : ''
    })

    if (obj['content'] !== undefined) {
        const existing = safeString(obj['content'])
        if (contentParts.length > 0) {
            obj['content'] = existing !== '' ? `${existing}\n\n${contentParts.join('\n\n')}` : contentParts.join('\n\n')
        }
    } else if (contentParts.length > 0) {
        obj['content'] = contentParts.join('\n\n')
    }

    if (typeof obj['content'] === 'string') {
        obj['content'] = obj['content'].replace(/\\+'/g, "'").replace(/\\+"/g, '"')
    }
}
