/**
 * memory-journal-mcp — Markdown Exporter
 *
 * Converts journal entries to frontmattered `.md` files.
 * Deterministic filenames allow re-export to overwrite identically.
 */

import { mkdir, open, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { constants } from 'node:fs'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { serializeFrontmatter } from './frontmatter.js'
import type { FrontmatterData } from './frontmatter.js'
import { logger } from '../utils/logger.js'
import type { Relationship } from '../types/index.js'
import { assertSafeDirectoryPath } from '../utils/security-utils.js'

// ============================================================================
// Types
// ============================================================================

/** Entry shape from database query results */
export interface ExportableEntry {
    id: number
    content: string
    entryType: string
    timestamp: string
    tags: string[]
    significance?: string
    author?: string
}

/** Result of an export operation */
export interface ExportResult {
    success: boolean
    exported_count: number
    output_dir: string
    files: string[]
    skipped: number
}

// ============================================================================
// Slug Generation
// ============================================================================

/**
 * Generate a URL-safe slug from content text.
 *
 * - Takes first 50 characters
 * - Lowercases, replaces non-alphanumeric with dashes
 * - Trims leading/trailing dashes, collapses multiple dashes
 * - Falls back to 'untitled' for empty content
 */
export function generateSlug(content: string): string {
    const slug = content
        .slice(0, 50)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')

    return slug || 'untitled'
}

/**
 * Generate a deterministic filename for an entry.
 * Format: `{id}-{slug}.md`
 */
export function generateFilename(id: number, content: string): string {
    return `${String(id)}-${generateSlug(content)}.md`
}

// ============================================================================
// Exporter
// ============================================================================

/**
 * Export journal entries to frontmattered markdown files.
 *
 * - Creates output directory if it doesn't exist
 * - Writes one `.md` file per entry
 * - Deterministic filenames allow re-export without duplication
 * - Fetches relationships per entry for frontmatter inclusion
 *
 * @param entries - Entries to export
 * @param outputDir - Target directory for `.md` files
 * @param db - Database adapter for relationship lookups
 * @returns Export result with file list and counts
 */
export async function exportEntriesToMarkdown(
    entries: ExportableEntry[],
    outputDir: string,
    db: IDatabaseAdapter,
    allowedRoots: string[]
): Promise<ExportResult> {
    // Dynamically enforce bounded root
    assertSafeDirectoryPath(outputDir, allowedRoots)

    // Guard: refuse to export into the OS temporary directory (CodeQL js/insecure-temporary-file)
    const resolvedOutputDir = resolve(outputDir)
    const resolvedTmpDir = resolve(tmpdir())
    const tmpPrefix = resolvedTmpDir.endsWith(sep) ? resolvedTmpDir : resolvedTmpDir + sep
    if (resolvedOutputDir === resolvedTmpDir || resolvedOutputDir.startsWith(tmpPrefix)) {
        throw new Error('Refusing to export markdown files into the OS temporary directory')
    }

    await mkdir(resolvedOutputDir, { recursive: true })

    const files: string[] = []
    let skipped = 0

    const validEntries = entries.filter((e) => e.content.trim())
    skipped += entries.length - validEntries.length
    
    // Batch fetch relationships
    let relationshipsMap = new Map<number, Relationship[]>()
    try {
        relationshipsMap = db.getRelationshipsForEntries(validEntries.map((e) => e.id))
    } catch (err) {
        logger.warning('Failed to lookup relationships during export (batch)', {
            module: 'Exporter',
            error: err instanceof Error ? err.message : String(err)
        })
    }


    for (const entry of validEntries) {
        // Build frontmatter data
        const fmData: FrontmatterData = {
            mj_id: entry.id,
            entry_type: entry.entryType,
            timestamp: entry.timestamp,
            source: 'memory-journal-mcp',
        }

        if (entry.tags !== undefined && entry.tags.length > 0) {
            fmData.tags = entry.tags
        }

        if (entry.significance !== undefined) {
            fmData.significance = entry.significance
        }

        if (entry.author !== undefined) {
            fmData.author = entry.author
        }

        // Apply pre-fetched relationships for this entry
        const relationships = relationshipsMap.get(entry.id) ?? []
        if (relationships.length > 0) {
            fmData.relationships = relationships.map((r) => ({
                type: r.relationshipType,
                target_id: r.fromEntryId === entry.id ? r.toEntryId : r.fromEntryId,
            }))
        }

        // Generate file content
        const frontmatter = serializeFrontmatter(fmData)
        const fileContent = frontmatter + '\n' + entry.content + '\n'

        // Write file atomically preventing symlink traversal via O_NOFOLLOW
        const filename = generateFilename(entry.id, entry.content)
        const filepath = join(resolvedOutputDir, filename)

        let handle;
        try {
            // Re-validate ancestor directory to ensure it hasn't been swapped for a symlink
            const stat = await lstat(resolvedOutputDir)
            if (stat.isSymbolicLink()) {
                throw new Error(`Export directory ${resolvedOutputDir} became a symlink during export.`)
            }

            // constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
            handle = await open(filepath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
            await handle.writeFile(fileContent, 'utf-8')
            files.push(filename)
        } catch (err: unknown) {
            const code = err instanceof Error && 'code' in err ? (err as {code?: string}).code : undefined;
            if (code === 'ELOOP' || code === 'EEXIST') {
                logger.warning('Refusing to overwrite symlink during export', {
                    module: 'Exporter',
                    filepath
                })
                skipped++
            } else {
                logger.error('Failed to write markdown file', {
                    module: 'Exporter',
                    filepath,
                    error: err instanceof Error ? err.message : String(err)
                })
                skipped++
            }
        } finally {
            if (handle) {
                await handle.close()
            }
        }
    }

    return {
        success: true,
        exported_count: files.length,
        output_dir: resolvedOutputDir,
        files,
        skipped,
    }
}
