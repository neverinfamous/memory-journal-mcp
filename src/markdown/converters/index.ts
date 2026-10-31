/**
 * memory-journal-mcp — External Format Converters
 *
 * Converters normalize third-party exports (Notion, Obsidian, Logseq) into the
 * internal standard frontmatter format for importing.
 */

import type { FrontmatterData } from '../frontmatter.js'
import { convertObsidian } from './obsidian.js'
import { convertNotion } from './notion.js'
import { convertLogseq } from './logseq.js'
import { parseYamlFrontmatter } from './yaml-parser.js'

export { parseYamlFrontmatter }

export type SourceFormat = 'notion' | 'obsidian' | 'logseq'

export interface ConvertedFile {
    filename: string
    metadata: FrontmatterData
    body: string
}

/**
 * Dispatcher to convert an external file to the internal format.
 *
 * @param content Raw markdown string from external export
 * @param filename Original filename
 * @param format The source platform format
 * @param defaultEntryType Optional fallback entry type override
 * @returns Normalized frontmatter metadata and body
 */
export function convertFile(
    content: string,
    filename: string,
    format: SourceFormat,
    defaultEntryType?: string
): ConvertedFile {
    switch (format) {
        case 'obsidian':
            return convertObsidian(content, filename, defaultEntryType)
        case 'notion':
            return convertNotion(content, filename, defaultEntryType)
        case 'logseq':
            return convertLogseq(content, filename, defaultEntryType)
        default:
            throw new Error(`Unsupported source format: ${String(format)}`)
    }
}
