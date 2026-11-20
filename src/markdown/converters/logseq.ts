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
import { posix } from 'node:path'
import { parseYamlFrontmatter } from './yaml-parser.js'
import {
    addBoundedTag,
    extractTags,
    formatToISODate,
    isClosingCodeFence,
    toBoundedTags,
} from './utils.js'

function applyLogseqPropertyLine(
    line: string,
    mjMeta: FrontmatterData,
    mergedTags: Set<string>
): boolean {
    const propMatch = /^([ \t]*)([a-zA-Z0-9_-]+)::[ \t]+([^\s\r\n][^\r\n]*)$/.exec(line)
    if (propMatch === null) return false
    const [, , key, val] = propMatch
    const k = key?.toLowerCase()
    const v = val?.trim()
    if (k === 'tags' && v !== undefined && v !== '') {
        for (const rawTag of v.split(/[, ]+/)) {
            const trimmed = rawTag.trim()
            if (trimmed !== '') addBoundedTag(mergedTags, trimmed.replace(/^#/, ''))
        }
    } else if (k === 'date' && v !== undefined && v !== '') {
        const formatted = formatToISODate(v)
        if (formatted !== undefined) {
            mjMeta.timestamp = formatted
        }
    }
    return true
}

function transformLogseqLine(
    rawLine: string,
    mjMeta: FrontmatterData,
    mergedTags: Set<string>
): { line: string | null; hasTask: boolean; hasDoneTask: boolean } {
    let line = rawLine
    if (applyLogseqPropertyLine(line, mjMeta, mergedTags)) {
        return { line: null, hasTask: false, hasDoneTask: false }
    }

    let hasTask = false
    let hasDoneTask = false
    if (/^\s*-\s+(?:TODO|LATER)\b/.test(line)) {
        line = line.replace(/^(\s*-\s+)(?:TODO|LATER)\s+/, '$1[ ] ')
        hasTask = true
    } else if (/^\s*-\s+(?:DONE|NOW)\b/.test(line)) {
        line = line.replace(/^(\s*-\s+)(?:DONE|NOW)\s+/, '$1[x] ')
        hasDoneTask = true
    }

    for (const match of line.matchAll(/(^|\s)#([a-zA-Z0-9_-]{1,128})\b/g)) {
        if (match[2]) addBoundedTag(mergedTags, match[2].toLowerCase())
    }

    line = line.replace(/\[\[([^\][\r\n]{1,500})\]\]/g, (_match: string, inner: string) => {
        const parts = inner.split('|')
        return (parts.length > 1 ? parts[1] : parts[0]) ?? ''
    })

    return { line: line.trim() === '-' ? null : line, hasTask, hasDoneTask }
}

function inferLogseqEntryMetadata(
    filename: string,
    defaultEntryType: string | undefined,
    hasTasks: boolean,
    hasDoneTasks: boolean,
    mjMeta: FrontmatterData
): void {
    if (defaultEntryType) return
    const posixFile = filename.replace(/\\/g, '/')
    const baseFilename = posix.basename(posixFile)
    const journalMatch = /\b(\d{4}_\d{2}_\d{2})\b/.exec(baseFilename)
    if (journalMatch || /(?:^|\/)journals\//i.test(posixFile)) {
        mjMeta.entry_type = 'standup'
        if (journalMatch?.[1] && !mjMeta.timestamp) {
            const formatted = formatToISODate(`${journalMatch[1].replace(/_/g, '-')}T12:00:00Z`)
            if (formatted !== undefined) {
                mjMeta.timestamp = formatted
            }
        }
    } else if (hasDoneTasks && !hasTasks) {
        mjMeta.entry_type = 'feature_implementation'
    } else if (hasTasks) {
        mjMeta.entry_type = 'planning'
    }
}

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
    extractTags(yamlMeta, mergedTags, 'alias')

    const processedLines: string[] = []
    let hasTasks = false
    let hasDoneTasks = false

    const normalizedBody = body.replace(/\r\n?/g, '\n')
    let openFence: { marker: string; minLen: number } | undefined
    for (const rawLine of normalizedBody.split('\n')) {
        const line = rawLine ?? ''
        const trimmedLine = line.trimStart()
        if (openFence !== undefined) {
            if (isClosingCodeFence(trimmedLine, openFence.marker, openFence.minLen)) {
                openFence = undefined
            }
            processedLines.push(line)
            continue
        }
        const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmedLine)
        if (fenceMatch?.[1] !== undefined) {
            const marker = fenceMatch[1]
            openFence = { marker: marker[0] ?? '`', minLen: marker.length }
            processedLines.push(line)
            continue
        }
        const outcome = transformLogseqLine(line, mjMeta, mergedTags)
        if (outcome.hasTask) hasTasks = true
        if (outcome.hasDoneTask) hasDoneTasks = true
        if (outcome.line !== null) processedLines.push(outcome.line)
    }

    if (mergedTags.size > 0) {
        mjMeta.tags = toBoundedTags(mergedTags)
    }
    inferLogseqEntryMetadata(filename, defaultEntryType, hasTasks, hasDoneTasks, mjMeta)

    return {
        filename,
        metadata: mjMeta,
        body: processedLines.join('\n').trim(),
    }
}
