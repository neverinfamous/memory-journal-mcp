/**
 * memory-journal-mcp — Minimal YAML Frontmatter Parser
 *
 * Provides a minimal, zero-dependency YAML frontmatter parser for the external
 * importers (Obsidian, Logseq). Only supports the simple subset of YAML needed
 * for metadata extraction (scalars and simple arrays).
 *
 * This avoids introducing heavy dependencies like js-yaml, adhering to the
 * established pattern of zero-dependency parsers for better supply chain security.
 */

/** Structure of extracted YAML frontmatter */
export type FrontmatterData = Record<string, string | string[]>;

/** Result of parsing a file with YAML frontmatter */
export interface YamlParseResult {
    metadata: FrontmatterData
    body: string
}

/**
 * Extract and minimally parse YAML frontmatter from a markdown string.
 *
 * Handles:
 * - key: value
 * - key: [item1, item2]
 * - key:
 *     - item1
 *     - item2
 *
 * @param content Full markdown content
 * @returns Parsed frontmatter and remaining body text
 */
const FORBIDDEN_FRONTMATTER_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_FRONTMATTER_LINES = 500
const MAX_FRONTMATTER_CONTENT_LENGTH = 512 * 1024

function assignFrontmatterKey(
    metadata: FrontmatterData,
    key: string,
    value: string | string[]
): void {
    const cleanKey = key.trim()
    if (cleanKey === '' || FORBIDDEN_FRONTMATTER_KEYS.has(cleanKey)) return
    Object.defineProperty(metadata, cleanKey, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    })
}

function extractFrontmatterHeaderBounds(
    content: string
): { fmLines: string[]; body: string } | null {
    const firstNl = content.indexOf('\n')
    if (firstNl === -1) return null
    const firstLine = content.slice(0, firstNl).replace(/\r$/, '').trim()
    if (firstLine !== '---') return null

    const fmLines: string[] = []
    let pos = firstNl + 1
    while (pos < content.length && fmLines.length < MAX_FRONTMATTER_LINES && pos <= MAX_FRONTMATTER_CONTENT_LENGTH) {
        const nextNl = content.indexOf('\n', pos)
        const rawLine = nextNl === -1 ? content.slice(pos) : content.slice(pos, nextNl)
        const cleanLine = rawLine.replace(/\r$/, '')
        if (cleanLine.trim() === '---') {
            const bodyStart = nextNl === -1 ? content.length : nextNl + 1
            return {
                fmLines,
                body: content.slice(bodyStart).replace(/^\r?\n/, ''),
            }
        }
        fmLines.push(cleanLine)
        if (nextNl === -1) break
        pos = nextNl + 1
    }
    return null
}

function parseYamlFrontmatterLines(fmLines: string[]): FrontmatterData {
    const metadata = Object.create(null) as FrontmatterData
    let currentArrayKey: string | null = null
    let currentArray: string[] = []

    for (const rawLine of fmLines) {
        const line = rawLine ?? ''
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        if (trimmed.startsWith('-') && currentArrayKey) {
            currentArray.push(stripQuotes(trimmed.substring(1).trim()))
            continue
        }

        const colonIdx = line.indexOf(':')
        if (colonIdx <= 0) continue

        if (currentArrayKey) {
            assignFrontmatterKey(metadata, currentArrayKey, currentArray)
            currentArrayKey = null
            currentArray = []
        }

        const key = line.substring(0, colonIdx).trim()
        const val = line.substring(colonIdx + 1).trim()
        if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) continue

        if (!val) {
            currentArrayKey = key
            currentArray = []
        } else if (val.startsWith('[') && val.endsWith(']')) {
            const itemsStr = val.substring(1, val.length - 1)
            assignFrontmatterKey(
                metadata,
                key,
                itemsStr
                    .split(',')
                    .map((s) => stripQuotes(s.trim()))
                    .filter(Boolean)
            )
        } else {
            assignFrontmatterKey(metadata, key, stripQuotes(val))
        }
    }

    if (currentArrayKey) {
        assignFrontmatterKey(metadata, currentArrayKey, currentArray)
    }
    return metadata
}

export function parseYamlFrontmatter(content: string): YamlParseResult {
    if (content.length > MAX_FRONTMATTER_CONTENT_LENGTH) {
        return { metadata: Object.create(null) as FrontmatterData, body: content }
    }
    const extracted = extractFrontmatterHeaderBounds(content)
    if (extracted === null) {
        return { metadata: Object.create(null) as FrontmatterData, body: content }
    }
    return {
        metadata: parseYamlFrontmatterLines(extracted.fmLines),
        body: extracted.body,
    }
}

function stripQuotes(str: string): string {
    if (
        (str.startsWith('"') && str.endsWith('"')) ||
        (str.startsWith("'") && str.endsWith("'"))
    ) {
        return str.substring(1, str.length - 1)
    }
    return str
}
