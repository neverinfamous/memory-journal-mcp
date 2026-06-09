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
import { basename, dirname } from 'node:path'

export function convertNotion(
    content: string,
    filename: string,
    defaultEntryType?: string
): ConvertedFile {
    const mjMeta: FrontmatterData = {
        source: 'notion',
        entry_type: defaultEntryType ?? 'other',
    }

    const mergedTags = new Set<string>()

    // 1. Tag derivation from directory structure
    // Notion nested exports look like: "Engineering a8f9.../Architecture f7e.../My Doc.md"
    const dir = dirname(filename)
    if (dir && dir !== '.' && dir !== '/') {
        const parts = dir.split(/[\\/]/)
        for (const part of parts) {
            // Remove the Notion 32-char hex hash suffix from folder names if present
            const cleanName = part.replace(/\s+[a-f0-9]{32}$/i, '').trim()
            if (cleanName) {
                // Convert to kebab-case
                const tag = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                if (tag && tag !== '-') mergedTags.add(tag)
            }
        }
    }

    // 2. Process Body Text
    let processedBody = content

    // Clean up internal links: [Page Title](Page%20Title%20hash.md) -> Page Title
    processedBody = processedBody.replace(/\[([^\]]+)\]\([^)]+\.md\)/gi, '$1')

    // Clean up image links with Notion hashes to avoid broken local refs in journal
    // Just preserve the alt text as an indicator
    processedBody = processedBody.replace(/!\[([^\]]*)\]\([^)]+\)/gi, '> _Image: $1_')

    // Check for a title in the first line
    const lines = processedBody.split('\n')
    const firstLine = lines[0]?.trim() ?? ''
    
    // Sometimes Notion puts the title as an H1 on line 1.
    if (firstLine.startsWith('# ')) {
        // It's already an H1, good.
    } else {
        // Fallback title from filename (removing the hash)
        const base = basename(filename, '.md')
        const cleanTitle = base.replace(/\s+[a-f0-9]{32}$/i, '').trim()
        if (cleanTitle && !processedBody.startsWith('# ')) {
            processedBody = `# ${cleanTitle}\n\n${processedBody}`
        }
    }

    if (mergedTags.size > 0) {
        mjMeta.tags = Array.from(mergedTags)
    }

    // 3. Heuristic Entry Type Inference
    if (!defaultEntryType) {
        const lowerBody = processedBody.toLowerCase()
        if (mergedTags.has('meeting-notes') || lowerBody.includes('meeting notes')) {
            mjMeta.entry_type = 'meeting_notes'
        } else if (mergedTags.has('decision') || lowerBody.includes('decision log')) {
            mjMeta.entry_type = 'project_decision'
        }
    }

    return {
        filename,
        metadata: mjMeta,
        body: processedBody.trim(),
    }
}
