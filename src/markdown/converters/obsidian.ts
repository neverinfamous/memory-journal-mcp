/**
 * memory-journal-mcp — Obsidian Converter
 *
 * Normalizes Obsidian markdown exports.
 * Features:
 * - Parses YAML frontmatter
 * - Strips `[[wikilinks]]` to plain text
 * - Converts `![[embeds]]` to blockquotes
 * - Extracts inline `#tags`
 * - Heuristics for `standup` (daily notes) vs `other`
 */

import type { ConvertedFile } from './index.js'
import type { FrontmatterData } from '../frontmatter.js'
import { parseYamlFrontmatter } from './yaml-parser.js'
import { extractTags, formatToISODate, getFirstString } from './utils.js'

export function convertObsidian(
    content: string,
    filename: string,
    defaultEntryType?: string
): ConvertedFile {
    const { metadata: yamlMeta, body } = parseYamlFrontmatter(content)
    
    const mjMeta: FrontmatterData = {
        source: 'obsidian',
        entry_type: defaultEntryType ?? 'other',
    }

    const mergedTags = new Set<string>()

    // 1. Process Frontmatter Tags and Aliases
    extractTags(yamlMeta, mergedTags, 'aliases')

    // Extract Timestamp (try common frontmatter keys, fallback to filename if daily note)
    const dateStr = getFirstString(yamlMeta, ['date', 'created', 'timestamp'])
    if (dateStr) {
        mjMeta.timestamp = formatToISODate(dateStr)
    } else {
        // Check if filename looks like a daily note (YYYY-MM-DD)
        const dateMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(filename)
        if (dateMatch?.[1]) {
            mjMeta.timestamp = `${dateMatch[1]}T12:00:00Z`
        }
    }

    // 2. Process Body Text
    let processedBody = body

    // Extract inline tags (#tag format)
    const inlineTagMatches = processedBody.matchAll(/(^|\s)#([a-zA-Z0-9_-]+)\b/g)
    for (const match of inlineTagMatches) {
        if (match[2]) mergedTags.add(match[2].toLowerCase())
    }

    // Convert embeds: ![[My Image.png]] -> > _Embedded: My Image.png_
    processedBody = processedBody.replace(/!\[\[(.*?)\]\]/g, '> _Embedded: $1_')

    // Strip wikilinks: [[Link target|Display text]] -> Display text
    processedBody = processedBody.replace(/\[\[([^\]]+)\]\]/g, (_match: string, inner: string) => {
        const parts = inner.split('|')
        return (parts.length > 1 ? parts[1] : parts[0]) ?? ''
    })

    if (mergedTags.size > 0) {
        mjMeta.tags = Array.from(mergedTags)
    }

    // 3. Heuristic Entry Type Inference
    if (!defaultEntryType) {
        if (filename.includes('daily') || (/^\d{4}-\d{2}-\d{2}/.exec(filename))) {
            mjMeta.entry_type = 'standup'
        } else if (mergedTags.has('decision') || mergedTags.has('adr')) {
            mjMeta.entry_type = 'project_decision'
        } else if (mergedTags.has('meeting') || filename.toLowerCase().includes('meeting')) {
            mjMeta.entry_type = 'meeting_notes'
        }
    }

    return {
        filename,
        metadata: mjMeta,
        body: processedBody.trim(),
    }
}
