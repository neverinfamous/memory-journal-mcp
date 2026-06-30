export function extractTags(yamlMeta: Record<string, unknown>, mergedTags: Set<string>, aliasKey = 'aliases'): void {
    if (yamlMeta['tags'] !== undefined) {
        const t = yamlMeta['tags']
        const tagsArray = Array.isArray(t) ? t : (typeof t === 'string' ? t : '').split(/[, ]+/).map(s => s.trim())
        for (const tag of tagsArray) {
            if (typeof tag === 'string' && tag) mergedTags.add(tag.replace(/^#/, ''))
        }
    }

    if (yamlMeta[aliasKey] !== undefined) {
        const a = yamlMeta[aliasKey]
        const aliasesArray = Array.isArray(a) ? a : (typeof a === 'string' ? [a] : [])
        for (const alias of aliasesArray) {
            if (typeof alias === 'string' && alias) mergedTags.add(alias.replace(/ /g, '-').toLowerCase())
        }
    }
}

export function formatToISODate(dateStr: string): string {
    const parsed = new Date(dateStr)
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString()
    }
    return dateStr // Fallback if unparseable
}

export function getFirstString(yamlMeta: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        if (typeof yamlMeta[key] === 'string') return yamlMeta[key]
        if (typeof yamlMeta[key] === 'number') return String(yamlMeta[key])
    }
    return undefined
}
