/**
 * JSON and Entry payload recovery helpers for Code Mode execution payloads.
 */

import { isRecord } from '../../../codemode/normalizers/shared-utils.js'

/**
 * Auto-heals raw JSON objects or stringified JSON passed as Code Mode execution payloads,
 * translating them into type-safe mj.* Code Mode API calls.
 */
export function extractAndRecoverJsonCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null
    const trimmed = code.trim()
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        return null
    }

    if (!isRecord(parsed)) {
        return null
    }

    // Unwrap nested container if caller wrapped payload/entry/input
    let target: Record<string, unknown> = parsed
    if (isRecord(parsed['payload'])) {
        target = parsed['payload']
    } else if (isRecord(parsed['entry'])) {
        target = parsed['entry']
    } else if (isRecord(parsed['input'])) {
        target = parsed['input']
    }

    // Check if target has an explicit tool/method call invocation
    const toolName =
        typeof target['tool'] === 'string'
            ? target['tool']
            : typeof target['method'] === 'string'
              ? target['method']
              : typeof target['function'] === 'string'
                ? target['function']
                : undefined
    if (toolName !== undefined && toolName !== '') {
        const toolParams = isRecord(target['params'])
            ? target['params']
            : isRecord(target['args'])
              ? target['args']
              : {}
        const cleanTool = toolName.replace(/^mj[._]/, '')
        return `return await (mj.${cleanTool} || mj.core.${cleanTool} || mj.${toolName})(${JSON.stringify(toolParams)});`
    }

    // Check if target is a search/query request
    const isSearchAction = target['action'] === 'search' || target['operation'] === 'search' || target['op'] === 'search'
    if (
        isSearchAction ||
        (typeof target['query'] === 'string' &&
            target['content'] === undefined &&
            target['notes'] === undefined &&
            target['changes'] === undefined &&
            target['task'] === undefined)
    ) {
        const queryStr =
            typeof target['query'] === 'string'
                ? target['query']
                : typeof target['search'] === 'string'
                  ? target['search']
                  : ''
        const searchParams: Record<string, unknown> = { query: queryStr }
        if (typeof target['limit'] === 'number') searchParams['limit'] = target['limit']
        if (typeof target['project_number'] === 'number') searchParams['project_number'] = target['project_number']
        return `return await mj.search.searchEntries(${JSON.stringify(searchParams)});`
    }

    // Check if target is purely a read/get entry by ID
    const entryId =
        typeof target['entry_id'] === 'number'
            ? target['entry_id']
            : typeof target['id'] === 'number'
              ? target['id']
              : typeof target['entry_id'] === 'string' && !Number.isNaN(Number(target['entry_id']))
                ? Number(target['entry_id'])
                : undefined

    const op =
        typeof target['operation'] === 'string'
            ? target['operation']
            : typeof target['op'] === 'string'
              ? target['op']
              : typeof target['action'] === 'string'
                ? target['action']
                : ''

    const isDelete = op === 'delete' || op === 'delete_entry'
    if (isDelete && entryId !== undefined) {
        return `return await mj.core.deleteEntry({ entry_id: ${entryId} });`
    }

    const hasContent = typeof target['content'] === 'string' && target['content'].trim().length > 0
    const hasNotes = typeof target['notes'] === 'string' && target['notes'].trim().length > 0
    const hasChanges =
        (Array.isArray(target['changes']) && target['changes'].length > 0) ||
        (typeof target['changes'] === 'string' && target['changes'].trim().length > 0)
    const hasTask = typeof target['task'] === 'string' && target['task'].trim().length > 0
    const hasTitle = typeof target['title'] === 'string' && target['title'].trim().length > 0
    const hasSummary = typeof target['summary'] === 'string' && target['summary'].trim().length > 0
    const hasDescription = typeof target['description'] === 'string' && target['description'].trim().length > 0
    const hasFindings =
        (Array.isArray(target['findings']) && target['findings'].length > 0) ||
        (typeof target['findings'] === 'string' && target['findings'].trim().length > 0)
    const hasDetails = typeof target['details'] === 'string' && target['details'].trim().length > 0
    const hasStatus = typeof target['status'] === 'string' && target['status'].trim().length > 0
    const hasType =
        typeof target['type'] === 'string' ||
        typeof target['entry_type'] === 'string' ||
        typeof target['category'] === 'string'
    const hasOp = op === 'create_entry' || op === 'add_entry' || op === 'create' || op === 'update_entry' || op === 'update'

    if (
        !hasContent &&
        !hasNotes &&
        !hasChanges &&
        !hasTask &&
        !hasTitle &&
        !hasSummary &&
        !hasDescription &&
        !hasFindings &&
        !hasDetails &&
        !hasType &&
        !hasOp &&
        entryId !== undefined
    ) {
        return `return await mj.core.getEntryById({ entry_id: ${entryId} });`
    }

    if (
        !hasContent &&
        !hasNotes &&
        !hasChanges &&
        !hasTask &&
        !hasTitle &&
        !hasSummary &&
        !hasDescription &&
        !hasFindings &&
        !hasDetails &&
        !hasType &&
        !hasOp
    ) {
        return null
    }

    const contentSections: string[] = []
    if (hasContent) contentSections.push(String(target['content']).trim())
    if (hasNotes) contentSections.push(String(target['notes']).trim())
    if (hasSummary && target['summary'] !== target['title'] && target['summary'] !== target['task']) {
        contentSections.push(String(target['summary']).trim())
    }
    if (hasDescription) contentSections.push(String(target['description']).trim())
    if (hasDetails) contentSections.push(String(target['details']).trim())
    if (hasChanges) {
        if (Array.isArray(target['changes'])) {
            const list = target['changes'].map((c) => `- ${String(c)}`).join('\n')
            contentSections.push(`**Changes:**\n${list}`)
        } else {
            contentSections.push(`**Changes:**\n${String(target['changes']).trim()}`)
        }
    }
    if (hasFindings) {
        if (Array.isArray(target['findings'])) {
            const list = target['findings'].map((f) => `- ${String(f)}`).join('\n')
            contentSections.push(`**Findings:**\n${list}`)
        } else {
            contentSections.push(`**Findings:**\n${String(target['findings']).trim()}`)
        }
    }
    if (hasStatus) {
        contentSections.push(`**Status:** ${String(target['status']).trim()}`)
    }

    let finalContent = contentSections.filter(Boolean).join('\n\n')
    if (finalContent === '' && (hasTask || hasTitle)) {
        finalContent = String(target['task'] ?? target['title'])
    }
    if (finalContent === '') {
        finalContent = 'Recorded via Code Mode payload'
    }

    let title: string
    if (hasTitle) title = String(target['title']).trim()
    else if (hasTask) title = String(target['task']).trim()
    else if (hasSummary) title = String(target['summary']).trim().slice(0, 80)
    else title = 'Journal Entry'

    const rawType = target['entry_type'] ?? target['type'] ?? target['category']
    let entryType = 'technical_decision'
    if (typeof rawType === 'string') {
        const low = rawType.toLowerCase()
        if (low === 'code' || low === 'coding' || low === 'technical' || low === 'task') {
            entryType = 'technical_decision'
        } else {
            entryType = low
        }
    }

    const tags: string[] = []
    if (Array.isArray(target['tags'])) {
        for (const t of target['tags']) {
            if (typeof t === 'string' && t.trim().length > 0 && !tags.includes(t.trim())) {
                tags.push(t.trim())
            }
        }
    } else if (typeof target['tags'] === 'string') {
        for (const t of target['tags'].split(',')) {
            const trimmedTag = t.trim()
            if (trimmedTag.length > 0 && !tags.includes(trimmedTag)) {
                tags.push(trimmedTag)
            }
        }
    }
    if (
        typeof target['project'] === 'string' &&
        target['project'].trim().length > 0 &&
        !tags.includes(target['project'].trim())
    ) {
        tags.push(target['project'].trim())
    }

    const autoContext: Record<string, unknown> = {}
    for (const key of [
        'task',
        'status',
        'changes',
        'notes',
        'details',
        'action',
        'component',
        'pr_link',
        'issue_link',
        'validation_status',
    ]) {
        if (target[key] !== undefined) {
            autoContext[key] = target[key]
        }
    }

    const entryParams: Record<string, unknown> = {
        title,
        content: finalContent,
        entry_type: entryType,
        tags,
    }
    if (Object.keys(autoContext).length > 0) {
        entryParams['auto_context'] = autoContext
    }
    if (typeof target['workspace_id'] === 'string') entryParams['workspace_id'] = target['workspace_id']
    if (typeof target['session_id'] === 'string') entryParams['session_id'] = target['session_id']
    if (typeof target['project_number'] === 'number') entryParams['project_number'] = target['project_number']
    if (typeof target['impact'] === 'number') entryParams['impact'] = target['impact']
    if (typeof target['trust'] === 'number') entryParams['trust'] = target['trust']
    if (typeof target['validation_status'] === 'string') entryParams['validation_status'] = target['validation_status']

    const isUpdate = op === 'update_entry' || op === 'update' || (entryId !== undefined && !hasOp)
    if (isUpdate && entryId !== undefined) {
        entryParams['entry_id'] = entryId
        return `return await mj.admin.updateEntry(${JSON.stringify(entryParams)});`
    }

    return `return await mj.core.createEntry(${JSON.stringify(entryParams)});`
}

/**
 * Attempt fuzzy recovery of an entry creation or update call from broken/mangled code
 */
export function extractAndRecoverEntryCode(code: string): string | null {
    if (!code || typeof code !== 'string') return null

    const jsonRecovered = extractAndRecoverJsonCode(code)
    if (jsonRecovered !== null) return jsonRecovered

    const isCreate =
        /\b(?:createEntry|teamCreateEntry|appendEntry|create_entry|team_create_entry|addMemory|createMemory|saveMemory)\b/i.test(
            code
        )
    const isUpdate = /\b(?:updateEntry|teamUpdateEntry|update_entry|team_update_entry|updateMemory)\b/i.test(code)

    if (!isCreate && !isUpdate) return null

    const backtickMatch =
        /\bcontent\s*:\s*`([\s\S]*?)`(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const singleMatch =
        /\bcontent\s*:\s*'([\s\S]*?)'(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const doubleMatch =
        /\bcontent\s*:\s*"([\s\S]*?)"(?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code)
    const fallbackMatch =
        /\bcontent\s*:\s*[`'"]([\s\S]*?)(?:[`'"]\s*)?(?=,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\))/i.exec(
            code
        )

    let content: string | undefined =
        backtickMatch?.[1] ?? singleMatch?.[1] ?? doubleMatch?.[1] ?? fallbackMatch?.[1]

    if (content === undefined) {
        const altMatch = /\bcontent\s*:\s*`([\s\S]*?)`(?=,\s*[\w$]+\s*:|\s*\})/i.exec(code)
        if (altMatch?.[1] !== undefined) content = altMatch[1]
    }

    if (content === undefined) {
        const descMatch =
            /\b(?:description|summary)\s*:\s*[`'"]([\s\S]*?)[`'"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(
                code
            )
        if (descMatch?.[1] !== undefined) content = descMatch[1]
    }

    if (content === undefined || content === '') return null

    content = content.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')

    const typeMatch = /\b(?:entry_type|type)\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const titleMatch =
        /\btitle\s*:\s*[`'"]([\s\S]*?)`['"](?=\s*(?:,\s*[a-zA-Z_$][\w$]*\s*:|\s*,\s*\}|\s*\}|\s*\)))/i.exec(code) ??
        /\btitle\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const projectMatch = /\b(?:project_number|project)\s*:\s*(\d+)/i.exec(code)
    const sessionMatch = /\bsession_id\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const impactMatch = /\bimpact\s*:\s*([0-9.]+)/i.exec(code)
    const trustMatch = /\btrust\s*:\s*([0-9.]+)/i.exec(code)
    const validationMatch = /\bvalidation_status\s*:\s*['"]([^'"]+)['"]/i.exec(code)
    const tagsMatch = /\btags\s*:\s*\[([\s\S]*?)\]/i.exec(code)
    const autoContextMatch = /\bauto_context\s*:\s*(\{[\s\S]*?\})(?=\s*,\s*\n|\s*\n\s*\})/i.exec(code)

    const payload: Record<string, unknown> = {
        content,
        entry_type: typeMatch?.[1] ?? 'technical_decision',
    }

    const title = titleMatch?.[1]?.replace(/\\+'/g, "'").replace(/\\+"/g, '"').replace(/\\`/g, '`')
    if (title !== undefined && title !== '') payload['title'] = title

    const entryIdMatch = /\b(?:entry_id|id)\s*:\s*(\d+)/i.exec(code)
    if (entryIdMatch?.[1] !== undefined) payload['entry_id'] = parseInt(entryIdMatch[1], 10)
    if (projectMatch?.[1] !== undefined) payload['project_number'] = parseInt(projectMatch[1], 10)
    if (sessionMatch?.[1] !== undefined) payload['session_id'] = sessionMatch[1]
    if (impactMatch?.[1] !== undefined) payload['impact'] = parseFloat(impactMatch[1])
    if (trustMatch?.[1] !== undefined) payload['trust'] = parseFloat(trustMatch[1])
    if (validationMatch?.[1] !== undefined) payload['validation_status'] = validationMatch[1]

    const rawTags = tagsMatch?.[1]
    if (rawTags !== undefined) {
        try {
            payload['tags'] = rawTags
                .split(',')
                .map((s: string): string => s.trim().replace(/^['"]|['"]$/g, ''))
                .filter(Boolean)
        } catch {
            // Ignore tag parse error
        }
    }

    const rawAutoContext = autoContextMatch?.[1]
    if (rawAutoContext !== undefined) {
        try {
            payload['auto_context'] = JSON.parse(rawAutoContext)
        } catch {
            try {
                const normalizedJson = rawAutoContext.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
                payload['auto_context'] = JSON.parse(normalizedJson)
            } catch {
                // Ignore auto_context parse error
            }
        }
    }

    const fnName = isUpdate && payload['entry_id'] !== undefined ? 'mj.updateEntry' : 'mj.createEntry'
    return `return await ${fnName}(${JSON.stringify(payload)});`
}
