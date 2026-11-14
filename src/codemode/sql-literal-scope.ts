export function splitSqlValueList(raw: string): string[] {
    const values: string[] = []
    let current = ''
    let quote: string | null = null
    for (const ch of raw) {
        if (quote !== null) {
            current += ch
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            current += ch
            continue
        }
        if (ch === ',') {
            values.push(current.trim())
            current = ''
            continue
        }
        current += ch
    }
    if (current.trim() !== '') values.push(current.trim())
    return values
}

export function scopeFromInsertLiterals(cleanSql: string): Record<string, unknown> {
    const match = /\bINSERT\s+INTO\b[\s\S]*?\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/i.exec(cleanSql)
    if (match?.[1] === undefined || match?.[2] === undefined) return {}
    const columns = match[1].split(',').map((column) => column.trim().replace(/[`"']/g, '').toLowerCase())
    const values = splitSqlValueList(match[2])
    const scope: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
        const column = columns[i]
        const raw = values[i]
        if (column === undefined || raw === undefined || raw === '?') continue
        if (column === 'workspace_id' && raw.length >= 2 && (raw.startsWith("'") || raw.startsWith('"'))) {
            scope['workspace_id'] = raw.slice(1, -1)
        }
        if (column === 'project_number' || column === 'project_id') {
            const unquoted =
                raw.length >= 2 &&
                ((raw.startsWith("'") && raw.endsWith("'")) ||
                    (raw.startsWith('"') && raw.endsWith('"')))
                    ? raw.slice(1, -1)
                    : raw
            if (/^\d+$/.test(unquoted)) {
                scope['project_number'] = Number(unquoted)
            }
        }
    }
    return scope
}

export function scopeFromSqlLiterals(cleanSql: string): Record<string, unknown> {
    const projectMatch = /\b(?:WHERE|AND)\s+\(*[`"']?(?:project_number|project_id)[`"']?\s*=\s*['"]?(\d+)['"]?/i.exec(cleanSql)
    const projectVal = projectMatch?.[1] !== undefined ? parseInt(projectMatch[1], 10) : undefined
    const wsMatch = /\b(?:WHERE|AND)\s+\(*[`"']?workspace_id[`"']?\s*=\s*['"]([^'"]+)['"]/i.exec(cleanSql)
    const wsVal = wsMatch?.[1]
    return {
        ...(projectVal !== undefined ? { project_number: projectVal } : {}),
        ...(wsVal !== undefined && wsVal !== '' ? { workspace_id: wsVal } : {}),
    }
}
