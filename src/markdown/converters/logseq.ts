/**
 * memory-journal-mcp — Logseq Converter
 *
 * Normalizes Logseq markdown exports.
 * Features:
 * - Parses YAML frontmatter
 * - Flattens block hierarchy (`- ` bullets) to paragraph-style with indent context
 * - Strips `[[page refs]]` to plain text
 * - Extracts `#tags` and `key:: value` inline properties
 * - Normalizes task markers (`TODO`, `DONE`)
 */

import type { ConvertedFile } from './index.js'
import type { FrontmatterData } from '../frontmatter.js'
import { parseYamlFrontmatter } from './yaml-parser.js'

export function convertLogseq(
    content: string,
    filename: string,
    defaultEntryType?: string
): ConvertedFile {
    const { metadata: yamlMeta, body } = parseYamlFrontmatter(content)
    
    const mjMeta: FrontmatterData = {
        source: 'logseq',
        entry_type: defaultEntryType ?? 'other',
    }

    const mergedTags = new Set<string>()

    // 1. Process Frontmatter Tags
    if (yamlMeta['tags'] !== undefined) {
        const t = yamlMeta['tags']
        const tagsArray = Array.isArray(t) ? t : t.split(/[, ]+/).map(s => s.trim())
        for (const tag of tagsArray) {
            if (tag) mergedTags.add(tag.replace(/^#/, ''))
        }
    }

    // Process aliases as tags
    if (yamlMeta['alias'] !== undefined) {
        const a = yamlMeta['alias']
        const aliasesArray = Array.isArray(a) ? a : [a]
        for (const alias of aliasesArray) {
            if (alias) mergedTags.add(alias.replace(/ /g, '-').toLowerCase())
        }
    }

    // 2. Process Body Text
    const lines = body.split('\n')
    const processedLines: string[] = []
    
    let hasTasks = false
    let hasDoneTasks = false

    for (const rawLine of lines) {
        let line = rawLine ?? ''
        
        // Extract inline properties (key:: value)
        const propMatch = /^(\s*)([a-zA-Z0-9_-]+)::\s*(.+)$/.exec(line)
        if (propMatch !== null) {
            const [, , key, val] = propMatch
            const k = key?.toLowerCase()
            const v = val?.trim()
            if (k === 'tags' && v) {
                const tags = v.split(/[, ]+/).map(s => s.trim())
                for (const t of tags) if (t) mergedTags.add(t.replace(/^#/, ''))
            } else if (k === 'date' && v) {
                mjMeta.timestamp = formatToISODate(v)
            }
            // Strip the property line from output
            continue
        }

        // Handle task markers
        if (/^\s*-\s+(TODO|LATER)\b/.exec(line)) {
            line = line.replace(/\b(TODO|LATER)\s+/, '[ ] ')
            hasTasks = true
        } else if (/^\s*-\s+(DONE|NOW)\b/.exec(line)) {
            line = line.replace(/\b(DONE|NOW)\s+/, '[x] ')
            hasDoneTasks = true
        }

        // Extract inline tags
        const inlineTagMatches = line.matchAll(/(^|\s)#([a-zA-Z0-9_-]+)\b/g)
        for (const match of inlineTagMatches) {
            if (match[2]) mergedTags.add(match[2].toLowerCase())
        }

        // Strip wikilinks/page refs
        line = line.replace(/\[\[([^\]]+)\]\]/g, (_match: string, inner: string) => {
            const parts = inner.split('|')
            return (parts.length > 1 ? parts[1] : parts[0]) ?? ''
        })

        // Un-indent basic blocks slightly to make it read more like a document than an outline,
        // but preserve nesting relative to the parent.
        // If it starts with "- ", we can optionally turn it into a standard paragraph or keep as bullet.
        // For logseq, leaving as bullets often looks best, but we'll trim empty block prefixes.
        if (line.trim() === '-') {
            continue
        }

        processedLines.push(line)
    }

    const processedBody = processedLines.join('\n')

    if (mergedTags.size > 0) {
        mjMeta.tags = Array.from(mergedTags)
    }

    // 3. Heuristic Entry Type Inference
    if (!defaultEntryType) {
        // Logseq journal files are typically formatted as YYYY_MM_DD.md
        const journalMatch = /\b(\d{4}_\d{2}_\d{2})\b/.exec(filename)
        if (journalMatch || filename.includes('journals')) {
            mjMeta.entry_type = 'standup'
            if (journalMatch?.[1] && !mjMeta.timestamp) {
                mjMeta.timestamp = `${journalMatch[1].replace(/_/g, '-')}T12:00:00Z`
            }
        } else if (hasDoneTasks && !hasTasks) {
            mjMeta.entry_type = 'feature_implementation'
        } else if (hasTasks) {
            mjMeta.entry_type = 'planning'
        }
    }

    return {
        filename,
        metadata: mjMeta,
        body: processedBody.trim(),
    }
}

function formatToISODate(dateStr: string): string {
    try {
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) {
            return d.toISOString()
        }
    } catch {
        // ignore
    }
    return dateStr
}
