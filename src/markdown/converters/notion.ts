/**
 * memory-journal-mcp — Notion Converter
 *
 * Normalizes Notion markdown exports.
 * Features:
 * - No frontmatter parsing (Notion exports are plain MD)
 * - Derives tags from the directory hierarchy
 * - Preserves Notion callouts as markdown blockquotes
 * - Strips Notion internal file links to plain text
 * - Shifts the H1 title into a body prefix if needed
 */

import type { ConvertedFile } from './index.js'
import type { FrontmatterData } from '../frontmatter.js'
import { posix } from 'node:path'
import { addBoundedTag, toBoundedTags, transformOutsideCodeFences } from './utils.js'

function extractNotionDirectoryTags(posixFile: string, mergedTags: Set<string>): void {
    // Notion nested exports look like: "Engineering a8f9.../Architecture f7e.../My Doc.md"
    const dir = posix.dirname(posixFile)
    if (!dir || dir === '.' || dir === posix.parse(dir).root) return
    for (const part of dir.split('/')) {
        // Remove the Notion 32-char hex hash suffix and Windows drive prefix if present
        const cleanName = part
            .trim()
            .replace(/^[a-zA-Z]:/, '')
            .replace(/[ \t]{1,64}[a-f0-9]{32}$/i, '')
            .trim()
        if (!cleanName) continue
        const tag = cleanName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
        if (tag) addBoundedTag(mergedTags, tag)
    }
}

export function convertNotion(
    content: string,
    filename: string,
    defaultEntryType?: string
): ConvertedFile {
    const posixFile = filename.replace(/\\/g, '/')
    const mjMeta: FrontmatterData = {
        source: 'notion',
        entry_type: defaultEntryType ?? 'other',
    }

    const mergedTags = new Set<string>()
    extractNotionDirectoryTags(posixFile, mergedTags)

    // 2. Process Body Text (preserve links and images inside fenced code blocks)
    let processedBody = transformOutsideCodeFences(content, (segment) =>
        segment
            .replace(/\[([^\][\r\n]{1,500})\]\([^()\r\n]{1,500}\.md\)/gi, '$1')
            .replace(/!\[([^\][\r\n]{0,500})\]\([^()\r\n]{1,500}\)/gi, '> _Image: $1_')
    )

    // Check for a title in the first line
    const firstNewline = processedBody.indexOf('\n')
    const firstLine = (firstNewline === -1 ? processedBody : processedBody.slice(0, firstNewline)).trim()
    
    // Sometimes Notion puts the title as an H1 on line 1.
    if (firstLine.startsWith('# ')) {
        // It's already an H1, good.
    } else {
        // Fallback title from filename (removing the hash)
        const base = posix.basename(posixFile).replace(/\.md$/i, '')
        const cleanTitle = base.trim().replace(/[ \t]{1,64}[a-f0-9]{32}$/i, '').trim()
        if (cleanTitle && !processedBody.startsWith('# ')) {
            processedBody = `# ${cleanTitle}\n\n${processedBody}`
        }
    }

    if (mergedTags.size > 0) {
        mjMeta.tags = toBoundedTags(mergedTags)
    }

    // 3. Heuristic Entry Type Inference
    if (!defaultEntryType) {
        if (mergedTags.has('meeting-notes') || /meeting notes/i.test(processedBody)) {
            mjMeta.entry_type = 'meeting_notes'
        } else if (mergedTags.has('decision') || /decision log/i.test(processedBody)) {
            mjMeta.entry_type = 'project_decision'
        }
    }

    return {
        filename,
        metadata: mjMeta,
        body: processedBody.trim(),
    }
}
