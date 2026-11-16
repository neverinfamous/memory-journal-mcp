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

export function parseYamlFrontmatter(content: string): YamlParseResult {
    if (content.length > MAX_FRONTMATTER_CONTENT_LENGTH) {
        return { metadata: {}, body: content }
    }
    const lines = content.split(/\r?\n/)

    // Must start with ---
    if (lines[0]?.trim() !== '---') {
        return { metadata: {}, body: content }
    }

    // Find closing --- within bounded frontmatter header lines
    let closingIndex = -1
    const maxScan = Math.min(lines.length, MAX_FRONTMATTER_LINES + 1)
    for (let i = 1; i < maxScan; i++) {
        if (lines[i]?.trim() === '---') {
            closingIndex = i
            break
        }
    }

    if (closingIndex === -1) {
        // Unclosed or oversized frontmatter — treat whole file as body
        return { metadata: {}, body: content }
    }

    const fmLines = lines.slice(1, closingIndex)
    const body = lines
        .slice(closingIndex + 1)
        .join('\n')
        .replace(/^\n/, '')

    const metadata: FrontmatterData = {}
    let currentArrayKey: string | null = null
    let currentArray: string[] = []

    for (const rawLine of fmLines) {
        const line = rawLine ?? ''
        const trimmed = line.trim()

        if (!trimmed || trimmed.startsWith('#')) {
            continue // Skip empty lines and comments
        }

        // Array item continuation
        if (trimmed.startsWith('-') && currentArrayKey) {
            const val = trimmed.substring(1).trim()
            currentArray.push(stripQuotes(val))
            continue
        }

        // New key-value pair
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
            // New key found, save previous array if active
            if (currentArrayKey) {
                assignFrontmatterKey(metadata, currentArrayKey, currentArray)
                currentArrayKey = null
                currentArray = []
            }

            const key = line.substring(0, colonIdx).trim()
            const val = line.substring(colonIdx + 1).trim()
            if (FORBIDDEN_FRONTMATTER_KEYS.has(key)) continue

            if (!val) {
                // Potential start of a multi-line array
                currentArrayKey = key
                currentArray = []
            } else if (val.startsWith('[') && val.endsWith(']')) {
                // Inline array: [item1, item2]
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
                // Scalar value
                assignFrontmatterKey(metadata, key, stripQuotes(val))
            }
        }
    }

    // Handle trailing array
    if (currentArrayKey) {
        assignFrontmatterKey(metadata, currentArrayKey, currentArray)
    }

    return { metadata, body }
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
