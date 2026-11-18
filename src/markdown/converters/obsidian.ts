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
import { posix } from 'node:path'
import { parseYamlFrontmatter } from './yaml-parser.js'
import {
    addBoundedTag,
    extractTags,
    formatToISODate,
    getFirstString,
    toBoundedTags,
    transformOutsideCodeFences,
} from './utils.js'

export function convertObsidian(
    content: string,
    filename: string,
    defaultEntryType?: string
): ConvertedFile {
    const { metadata: yamlMeta, body } = parseYamlFrontmatter(content)
    const baseFilename = posix.basename(filename.replace(/\\/g, '/'))
    
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
        const formatted = formatToISODate(dateStr)
        if (formatted !== undefined) {
            mjMeta.timestamp = formatted
        }
    }
    if (mjMeta.timestamp === undefined) {
        // Check if filename looks like a daily note (YYYY-MM-DD)
        const dateMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(baseFilename)
        if (dateMatch?.[1]) {
            const formatted = formatToISODate(`${dateMatch[1]}T12:00:00Z`)
            if (formatted !== undefined) {
                mjMeta.timestamp = formatted
            }
        }
    }

    // 2. Process Body Text (ignoring fenced code blocks so snippets/hashes are preserved)
    const processedBody = transformOutsideCodeFences(body, (segment) => {
        const inlineTagMatches = segment.matchAll(/(^|\s)#([a-zA-Z0-9_-]{1,128})\b/g)
        for (const match of inlineTagMatches) {
            if (match[2]) addBoundedTag(mergedTags, match[2].toLowerCase())
        }
        return segment
            .replace(/!\[\[([^\]]{1,500})\]\]/g, '> _Embedded: $1_')
            .replace(/\[\[([^\]]{1,500})\]\]/g, (_match: string, inner: string) => {
                const parts = inner.split('|')
                return (parts.length > 1 ? parts[1] : parts[0]) ?? ''
            })
    })

    if (mergedTags.size > 0) {
        mjMeta.tags = toBoundedTags(mergedTags)
    }

    // 3. Heuristic Entry Type Inference
    if (!defaultEntryType) {
        if (filename.toLowerCase().includes('daily') || (/^\d{4}-\d{2}-\d{2}/.exec(baseFilename))) {
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
