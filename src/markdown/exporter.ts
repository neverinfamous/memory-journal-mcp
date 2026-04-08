/**
 * memory-journal-mcp — Markdown Exporter
 *
 * Converts journal entries to frontmattered `.md` files.
 * Deterministic filenames allow re-export to overwrite identically.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { serializeFrontmatter } from './frontmatter.js'
import type { FrontmatterData } from './frontmatter.js'

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
    db: IDatabaseAdapter
): Promise<ExportResult> {
    await mkdir(outputDir, { recursive: true })

    const files: string[] = []
    let skipped = 0

    for (const entry of entries) {
        // Skip entries with empty content
        if (!entry.content.trim()) {
            skipped++
            continue
        }

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

        // Fetch relationships for this entry
        try {
            const relationships = db.getRelationships(entry.id)
            if (relationships.length > 0) {
                fmData.relationships = relationships.map((r) => ({
                    type: r.relationshipType,
                    target_id: r.fromEntryId === entry.id ? r.toEntryId : r.fromEntryId,
                }))
            }
        } catch {
            // Relationship lookup failure is non-fatal
        }

        // Generate file content
        const frontmatter = serializeFrontmatter(fmData)
        const fileContent = frontmatter + '\n' + entry.content + '\n'

        // Write file
        const filename = generateFilename(entry.id, entry.content)
        const filepath = join(outputDir, filename)
        await writeFile(filepath, fileContent, 'utf-8')
        files.push(filename)
    }

    return {
        success: true,
        exported_count: files.length,
        output_dir: outputDir,
        files,
        skipped,
    }
}
