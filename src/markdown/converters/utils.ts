/** Maximum tags emitted by external markdown converters (matches FrontmatterSchema). */
export const MAX_CONVERTER_TAGS = 50
/** Maximum length per tag emitted by external markdown converters (matches FrontmatterSchema). */
export const MAX_CONVERTER_TAG_LENGTH = 100

export function addBoundedTag(mergedTags: Set<string>, rawTag: string): void {
    if (mergedTags.size >= MAX_CONVERTER_TAGS) return
    const normalized = rawTag.trim().toLowerCase().slice(0, MAX_CONVERTER_TAG_LENGTH)
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

    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|[Tt ])/.exec(trimmed)
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

const FENCE_OPEN_RE = /^[ ]{0,3}(?:(`{3,})[^`]*$|(~{3,}))/

export function isClosingCodeFence(trimmedLine: string, fenceChar: string, fenceLen: number): boolean {
    let idx = 0
    while (idx < 3 && trimmedLine[idx] === ' ') idx++
    let count = 0
    while (trimmedLine[idx] === fenceChar) {
        count++
        idx++
    }
    if (count < fenceLen) return false
    return trimmedLine.slice(idx).trim() === ''
}

/**
 * Transform only prose segments outside fenced code blocks (` ``` ` / `~~~`),
 * leaving fenced code snippets byte-for-byte untouched.
 */
export function transformOutsideCodeFences(
    markdown: string,
    transform: (segment: string) => string
): string {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
    const out: string[] = []
    let proseLines: string[] = []
    let activeFenceChar: string | null = null
    let activeFenceLen = 0

    for (const line of lines) {
        const trimmed = line
        if (activeFenceChar === null) {
            const openMatch = FENCE_OPEN_RE.exec(trimmed)
            const fenceMarker = openMatch?.[1] ?? openMatch?.[2]
            if (fenceMarker !== undefined) {
                if (proseLines.length > 0) {
                    out.push(transform(proseLines.join('\n')))
                    proseLines = []
                }
                activeFenceChar = fenceMarker[0] ?? '`'
                activeFenceLen = fenceMarker.length
                out.push(line)
                continue
            }
            proseLines.push(line)
        } else {
            out.push(line)
            if (isClosingCodeFence(trimmed, activeFenceChar, activeFenceLen)) {
                activeFenceChar = null
                activeFenceLen = 0
            }
        }
    }

    if (proseLines.length > 0) {
        out.push(transform(proseLines.join('\n')))
    }
    return out.join('\n')
}
