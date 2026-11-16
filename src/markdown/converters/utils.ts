/** Maximum tags emitted by external markdown converters (matches FrontmatterSchema). */
export const MAX_CONVERTER_TAGS = 50
/** Maximum length per tag emitted by external markdown converters (matches FrontmatterSchema). */
export const MAX_CONVERTER_TAG_LENGTH = 100

export function addBoundedTag(mergedTags: Set<string>, rawTag: string): void {
    if (mergedTags.size >= MAX_CONVERTER_TAGS) return
    const normalized = rawTag.trim().slice(0, MAX_CONVERTER_TAG_LENGTH)
    if (normalized !== '') {
        mergedTags.add(normalized)
    }
}

export function toBoundedTags(mergedTags: Set<string>): string[] {
    return Array.from(mergedTags)
        .slice(0, MAX_CONVERTER_TAGS)
        .map((tag) => tag.slice(0, MAX_CONVERTER_TAG_LENGTH))
}

export function extractTags(
    yamlMeta: Record<string, unknown>,
    mergedTags: Set<string>,
    aliasKey = 'aliases'
): void {
    if (yamlMeta['tags'] !== undefined) {
        const t = yamlMeta['tags']
        const tagsArray = Array.isArray(t)
            ? t
            : (typeof t === 'string' ? t : '').split(/[, ]+/).map((s) => s.trim())
        for (const tag of tagsArray) {
            if (typeof tag === 'string' && tag) {
                addBoundedTag(mergedTags, tag.replace(/^#/, ''))
            }
        }
    }

    if (yamlMeta[aliasKey] !== undefined) {
        const a = yamlMeta[aliasKey]
        const aliasesArray = Array.isArray(a) ? a : typeof a === 'string' ? [a] : []
        for (const alias of aliasesArray) {
            if (typeof alias === 'string' && alias) {
                addBoundedTag(mergedTags, alias.replace(/ /g, '-').toLowerCase())
            }
        }
    }
}

export function formatToISODate(dateStr: string): string | undefined {
    const trimmed = dateStr.trim()
    if (trimmed === '') return undefined

    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(trimmed)
    if (ymdMatch !== null) {
        const year = Number(ymdMatch[1])
        const month = Number(ymdMatch[2])
        const day = Number(ymdMatch[3])
        const probe = new Date(Date.UTC(year, month - 1, day))
        if (
            probe.getUTCFullYear() !== year ||
            probe.getUTCMonth() !== month - 1 ||
            probe.getUTCDate() !== day
        ) {
            return undefined
        }
    }

    const parsedMs = Date.parse(trimmed)
    if (Number.isNaN(parsedMs)) {
        return undefined
    }
    return new Date(parsedMs).toISOString()
}

export function getFirstString(yamlMeta: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        if (typeof yamlMeta[key] === 'string') return yamlMeta[key]
        if (typeof yamlMeta[key] === 'number') return String(yamlMeta[key])
    }
    return undefined
}
