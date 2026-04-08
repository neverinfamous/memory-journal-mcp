/**
 * memory-journal-mcp — Markdown Importer
 *
 * Reads frontmattered `.md` files from a directory and upserts them
 * into the journal database. Supports create, update, tag reconciliation,
 * relationship linking, and dry-run mode.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager.js'
import type { EntryType, RelationshipType } from '../types/index.js'
import { parseFrontmatter } from './frontmatter.js'

// ============================================================================
// Types
// ============================================================================

/** Options for the import operation */
export interface ImportOptions {
    /** Parse and validate without writing to database */
    dry_run?: boolean
    /** Maximum files to process */
    limit?: number
    /** Author name for new entries (team journal) */
    author?: string
}

/** Result of an import operation */
export interface ImportResult {
    success: boolean
    created: number
    updated: number
    skipped: number
    errors: { file: string; error: string }[]
    dry_run: boolean
}

/** Supported relationship types for validation */
const VALID_RELATIONSHIP_TYPES = new Set<string>([
    'evolves_from',
    'references',
    'implements',
    'clarifies',
    'response_to',
    'blocked_by',
    'resolved',
    'caused',
])

/** Valid entry types for casting */
const VALID_ENTRY_TYPES = new Set<string>([
    'personal_reflection',
    'project_decision',
    'technical_achievement',
    'bug_fix',
    'feature_implementation',
    'code_review',
    'meeting_notes',
    'learning',
    'research',
    'planning',
    'retrospective',
    'standup',
    'technical_note',
    'development_note',
    'enhancement',
    'milestone',
    'system_integration_test',
    'test_entry',
    'other',
])

/**
 * Safely cast a string to EntryType, returning undefined for invalid values.
 */
function toEntryType(value: string | undefined): EntryType | undefined {
    if (value === undefined) return undefined
    return VALID_ENTRY_TYPES.has(value) ? (value as EntryType) : undefined
}

// ============================================================================
// Importer
// ============================================================================

/**
 * Import markdown files from a directory into the journal database.
 *
 * Upsert semantics:
 * - If frontmatter has `mj_id` AND entry exists → UPDATE
 * - If frontmatter has `mj_id` BUT entry not found → CREATE (DB assigns ID)
 * - If no `mj_id` in frontmatter → CREATE
 *
 * Post-import processing:
 * - Tags included in createEntry/updateEntry calls
 * - Relationship linking where targets exist
 * - Vector re-indexing (fire-and-forget)
 *
 * @param sourceDir - Directory containing `.md` files
 * @param db - Database adapter for entry operations
 * @param options - Import options (dry_run, limit, author)
 * @param vectorManager - Optional vector search manager for re-indexing
 * @returns Import result with counts and errors
 */
export async function importMarkdownEntries(
    sourceDir: string,
    db: IDatabaseAdapter,
    options: ImportOptions = {},
    vectorManager?: VectorSearchManager
): Promise<ImportResult> {
    const { dry_run = false, limit = 100 } = options

    // Read directory for .md files
    const allFiles = await readdir(sourceDir)
    const mdFiles = allFiles.filter((f) => f.endsWith('.md')).slice(0, limit)

    const result: ImportResult = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        dry_run,
    }

    for (const filename of mdFiles) {
        try {
            const filepath = join(sourceDir, filename)
            const content = await readFile(filepath, 'utf-8')

            // Parse frontmatter
            const { metadata, body } = parseFrontmatter(content)

            // Skip files with empty body
            if (!body.trim()) {
                result.skipped++
                continue
            }

            if (dry_run) {
                // In dry-run mode, just classify what would happen
                if (metadata.mj_id !== undefined) {
                    const existing = db.getEntryById(metadata.mj_id)
                    if (existing) {
                        result.updated++
                    } else {
                        result.created++
                    }
                } else {
                    result.created++
                }
                continue
            }

            // Determine operation: update or create
            let entryId: number
            const entryType = toEntryType(metadata.entry_type) ?? 'note' as EntryType

            if (metadata.mj_id !== undefined) {
                const existing = db.getEntryById(metadata.mj_id)
                if (existing) {
                    // UPDATE existing entry
                    db.updateEntry(metadata.mj_id, {
                        content: body,
                        entryType: toEntryType(metadata.entry_type),
                        tags: metadata.tags,
                    })
                    entryId = metadata.mj_id
                    result.updated++
                } else {
                    // CREATE new entry (mj_id pointed to nonexistent entry)
                    const newEntry = db.createEntry({
                        content: body,
                        entryType,
                        tags: metadata.tags,
                    })
                    entryId = newEntry.id
                    result.created++
                }
            } else {
                // CREATE new entry (no mj_id)
                const newEntry = db.createEntry({
                    content: body,
                    entryType,
                    tags: metadata.tags,
                })
                entryId = newEntry.id
                result.created++
            }

            // Relationship linking
            if (metadata.relationships !== undefined) {
                for (const rel of metadata.relationships) {
                    if (!VALID_RELATIONSHIP_TYPES.has(rel.type)) continue

                    // Only link if target entry exists
                    try {
                        const targetExists = db.getEntryById(rel.target_id)
                        if (targetExists) {
                            db.linkEntries(
                                entryId,
                                rel.target_id,
                                rel.type as RelationshipType
                            )
                        }
                    } catch {
                        // Relationship linking failure is non-fatal
                    }
                }
            }

            // Vector re-indexing (fire-and-forget)
            if (vectorManager) {
                void vectorManager.addEntry(entryId, body).catch(() => {
                    // Vector indexing failure is non-fatal
                })
            }
        } catch (err) {
            result.errors.push({
                file: filename,
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    return result
}
