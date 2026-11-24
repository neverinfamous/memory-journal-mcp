import { ENTRY_TYPE_ALIASES, isRecord, safeString } from './shared-utils.js'

const CONTEXT_WRAPPER_KEYS = new Set(['content', 'text', 'raw', 'body'])

function extractUnwrappedContextContent(val: unknown): string | undefined {
    if (!isRecord(val)) return undefined
    const rawContent = val['content']
    if (typeof rawContent !== 'string' || rawContent.trim() === '') return undefined
    const keys = Object.keys(val)
    return keys.length > 0 && keys.every((k) => CONTEXT_WRAPPER_KEYS.has(k)) ? rawContent : undefined
}

function canonicalizeEntryType(obj: Record<string, unknown>): void {
    if (obj['type'] !== undefined && obj['entry_type'] === undefined) {
        obj['entry_type'] = obj['type']
        delete obj['type']
    }
    if (typeof obj['entry_type'] !== 'string') return
    const alias = ENTRY_TYPE_ALIASES[obj['entry_type'].toLowerCase().trim()]
    if (alias !== undefined) obj['entry_type'] = alias
}

/** Synthesize structured entry fields (title, description, context, findings, etc.) into `content`. */
export function synthesizeEntryMutationFields(obj: Record<string, unknown>, isUpdate = false): void {
    canonicalizeEntryType(obj)
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

    if (isUpdate) {
        if (obj['title'] === undefined) {
            const altTitle = obj['heading'] ?? obj['subject']
            if (altTitle !== undefined) obj['title'] = altTitle
        }
        Reflect.deleteProperty(obj, 'heading')
        Reflect.deleteProperty(obj, 'subject')
    } else {
        consumeGroup(['title', 'heading', 'subject', 'name'], (v) => {
            const s = safeString(v)
            return s !== '' ? `# ${s}` : ''
        })
    }
    consumeGroup(['description', 'details', 'summary', 'notes', 'text', 'message'], safeString)
    const unwrappedContext = extractUnwrappedContextContent(obj['context'])
    if (unwrappedContext !== undefined) {
        Reflect.deleteProperty(obj, 'context')
        const existingContent =
            obj['content'] !== undefined ? safeString(obj['content']).trim() : ''
        if (existingContent === '') {
            obj['content'] = unwrappedContext
        } else if (existingContent !== unwrappedContext.trim()) {
            contentParts.push(unwrappedContext)
        }
    } else {
        consumeGroup(['context'], (v) => {
            const s = safeString(v)
            return s !== '' ? `**Context:** ${s}` : ''
        })
    }
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
        // Agents frequently double-escape quotes (\" / \') in entry content; heal them.
        obj['content'] = obj['content'].replace(/\\+'/g, "'").replace(/\\+"/g, '"')
    }
}
