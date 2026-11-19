/**
 * memory-journal-mcp — Markdown Importer
 *
 * Reads frontmattered `.md` files from a directory and upserts them
 * into the journal database. Supports create, update, tag reconciliation,
 * relationship linking, and dry-run mode.
 */

import { opendir, open } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import type { JournalEntry, ToolHandlerConfig } from '../types/index.js'
import {
    applyImportedRelationshipBatch,
    validateDryRunRelationships,
    type PendingRelationshipLink,
} from './import-relationships.js'
import { parseFrontmatter, type FrontmatterAnchor } from './frontmatter.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
    sanitizeAuthor,
} from '../utils/security-utils.js'
import {
    indexImportedEntries,
    prefetchImportedEntriesById,
    readMarkdownFilesParallel,
    resolveCanonicalImportAuthor,
    validateImportedFileEntry,
    type ImportedVectorItem,
} from './importer-scope.js'

/** Maximum size (5 MB) permitted for a single markdown file during import. */
const MAX_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024

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
    /** Whether newly created entries are marked personal (pass false for team imports) */
    isPersonal?: boolean
    /** Associate imported entries with a specific GitHub project number */
    project_number?: number
    /** Workspace isolation identifier */
    workspaceId?: string
    /** Handler config (registry/session defaults) threaded into project resolution */
    config?: ToolHandlerConfig
    /** Enforce strict team ownership rules (e.g., block non-admins from overwriting NULL-authored rows) */
    enforceStrictTeamOwnership?: boolean
    /** Allow authenticated team admins to override entry author ownership during import */
    allowAdminAuthorOverride?: boolean
}

/** Result of an import operation */
export interface ImportResult {
    success: boolean
    created: number
    updated: number
    skipped: number
    relationshipsLinked: number
    vectorsIndexed: number
    errors: { file: string; error: string }[]
    dry_run: boolean
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

export interface ParsedFile {
    filename: string
    body: string
    metadata: {
        mj_id?: number
        entry_type?: string
        author?: string
        tags?: string[]
        timestamp?: string
        significance?: string
        workspace_id?: string
        project_number?: number
        relationships?: { type: string; target_id: number }[]
        anchors?: FrontmatterAnchor[]
    }
}
async function readAndParseMarkdownFile(
    sourceDir: string,
    filename: string,
    allowedRoots: string[]
): Promise<{ parsed?: ParsedFile; skipped?: boolean }> {
    let handle
    try {
        const filepath = join(sourceDir, filename)
        assertSafeFilePath(filepath, allowedRoots)
        try {
            handle = await open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW)
        } catch (err: unknown) {
            const code =
                err instanceof Error && 'code' in err
                    ? (err as { code?: string }).code
                    : undefined
            if (code === 'ELOOP') {
                throw new Error(`Refusing to read symlink during import: ${filename}`, {
                    cause: err,
                })
            }
            throw err
        }

        const stats = await handle.stat()
        if (stats.size > MAX_IMPORT_FILE_SIZE_BYTES) {
            throw new Error(
                `File exceeds maximum size limit of 5MB (${String(stats.size)} bytes)`
            )
        }

        const content = await handle.readFile('utf-8')
        const { metadata, body } = parseFrontmatter(content)
        if (!body.trim()) {
            return { skipped: true }
        }
        return { parsed: { filename, body, metadata } }
    } finally {
        if (handle) {
            await handle.close()
        }
    }
}

export async function importMarkdownEntries(
    sourceDir: string,
    db: IDatabaseAdapter,
    options: ImportOptions = {},
    vectorManager: VectorSearchManager | undefined,
    allowedRoots: string[]
): Promise<ImportResult> {
    const { dry_run = false, limit = 100 } = options

    assertSafeDirectoryPath(sourceDir, allowedRoots)

    const allMdFiles: string[] = []
    const MAX_IMPORT_DIR_ENTRIES = 10_000
    const dir = await opendir(sourceDir)
    for await (const dirent of dir) {
        if (dirent.isFile() && /\.md$/i.test(dirent.name)) {
            allMdFiles.push(dirent.name)
            if (allMdFiles.length >= MAX_IMPORT_DIR_ENTRIES) break
        }
    }
    allMdFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const mdFiles = allMdFiles.slice(0, Math.max(0, limit))

    const result: ImportResult = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        relationshipsLinked: 0,
        vectorsIndexed: 0,
        errors: [],
        dry_run,
    }

    const {
        parsedFiles,
        skipped: readSkipped,
        errors: readErrors,
    } = await readMarkdownFilesParallel(mdFiles, (filename) =>
        readAndParseMarkdownFile(sourceDir, filename, allowedRoots)
    )
    result.skipped += readSkipped
    if (readErrors.length > 0) {
        result.errors.push(...readErrors)
        result.success = false
    }

    const batchResult = await processImportBatch(parsedFiles, db, options, vectorManager)
    result.success = result.success && batchResult.success
    result.created += batchResult.created
    result.updated += batchResult.updated
    result.relationshipsLinked += batchResult.relationshipsLinked
    result.vectorsIndexed += batchResult.vectorsIndexed
    result.errors.push(...batchResult.errors)

    return result
}

/* Author ownership, validation, and prefetched lookup helpers imported from ./importer-scope.ts */

function runDryRunImportValidation(
    files: ParsedFile[],
    db: IDatabaseAdapter,
    options: ImportOptions,
    prefetchedById: ReturnType<typeof prefetchImportedEntriesById>,
    result: ImportResult
): void {
    const inBatchScopes = new Map<number, { workspaceId: string; projectNumber?: number | null }>()
    const pendingLinks: PendingRelationshipLink[] = []
    for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx]
        if (file === undefined) continue
        const { effectiveWsId, effectiveProjNum, existing } = validateImportedFileEntry(
            file,
            db,
            options,
            prefetchedById
        )
        if (existing) {
            result.updated++
        } else {
            result.created++
        }
        const storedProj = effectiveProjNum ?? existing?.projectNumber ?? undefined
        if (file.metadata.mj_id !== undefined) {
            inBatchScopes.set(file.metadata.mj_id, {
                workspaceId: effectiveWsId ?? 'default',
                ...(storedProj !== undefined ? { projectNumber: storedProj } : {}),
            })
        }
        if (file.metadata.relationships !== undefined && file.metadata.relationships.length > 0) {
            pendingLinks.push({
                entryId: file.metadata.mj_id ?? -(idx + 1),
                filename: file.filename,
                relationships: file.metadata.relationships,
                workspaceId: effectiveWsId,
                projectNumber: storedProj,
            })
        }
    }
    validateDryRunRelationships(db, pendingLinks, inBatchScopes, result)
}

function upsertParsedFile(
    file: ParsedFile,
    db: IDatabaseAdapter,
    options: ImportOptions,
    result: ImportResult,
    prefetchedById?: ReturnType<typeof prefetchImportedEntriesById>
): { entry: JournalEntry; entryId: number; workspaceId: string | undefined; projectNumber: number | undefined } {
    const { body, metadata } = file
    const { author } = options
    const { effectiveWsId, effectiveProjNum, rawEntryType, significanceType, existing } =
        validateImportedFileEntry(file, db, options, prefetchedById)
    const mappedAnchors = metadata.anchors?.map((anchor) => {
        if (typeof anchor === 'string') {
            return {
                anchorPath: anchor,
                anchorType: anchor.includes('#') ? 'symbol' : 'file',
            }
        }
        return {
            anchorPath: anchor.anchor_path,
            anchorType: anchor.anchor_type ?? (anchor.anchor_path.includes('#') ? 'symbol' : 'file'),
            ...(anchor.status !== undefined ? { status: anchor.status } : {}),
        }
    })

    if (existing && metadata.mj_id !== undefined) {
        const updated = db.updateEntry(metadata.mj_id, {
            content: body,
            entryType: rawEntryType,
            tags: metadata.tags,
            ...(significanceType !== undefined && { significanceType }),
            ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
            ...(mappedAnchors !== undefined ? { anchors: mappedAnchors } : {}),
            workspaceId: effectiveWsId,
        })
        if (updated === null) {
            throw new Error(`Entry ${String(metadata.mj_id)} could not be updated during import`)
        }
        result.updated++
        // [INTENT] Use the stored (canonical) workspace for relationship linking and vector indexing.
        return {
            entry: updated,
            entryId: metadata.mj_id,
            workspaceId: updated.workspaceId ?? effectiveWsId,
            projectNumber: updated.projectNumber ?? effectiveProjNum ?? existing.projectNumber ?? undefined,
        }
    }

    const canonicalOptionAuthor = resolveCanonicalImportAuthor(db, author, effectiveWsId)
    const sanitizedMetadataAuthor =
        metadata.author !== undefined ? sanitizeAuthor(metadata.author) : undefined
    const resolvedAuthor =
        canonicalOptionAuthor ??
        (sanitizedMetadataAuthor !== undefined && sanitizedMetadataAuthor.length > 0
            ? sanitizedMetadataAuthor
            : undefined)
    const newEntry = db.createEntry({
        content: body,
        entryType: rawEntryType ?? 'personal_reflection',
        tags: metadata.tags,
        ...(options.isPersonal !== undefined ? { isPersonal: options.isPersonal } : {}),
        ...(metadata.timestamp !== undefined && { timestamp: metadata.timestamp }),
        ...(significanceType !== undefined && { significanceType }),
        ...(resolvedAuthor !== undefined && { author: resolvedAuthor }),
        ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
        ...(mappedAnchors !== undefined ? { anchors: mappedAnchors } : {}),
        workspaceId: effectiveWsId,
    })
    result.created++
    return {
        entry: newEntry,
        entryId: newEntry.id,
        workspaceId: newEntry.workspaceId ?? effectiveWsId,
        projectNumber: effectiveProjNum,
    }
}

/**
 * Process a batch of parsed markdown files and upsert them into the database.
 */
export async function processImportBatch(
    parsedFiles: ParsedFile[],
    db: IDatabaseAdapter,
    options: ImportOptions = {},
    vectorManager: VectorSearchManager | undefined
): Promise<ImportResult> {
    const { dry_run = false, limit } = options
    // [BOUNDARY] Direct callers (e.g. team import) bypass the directory scan, so enforce limit here too.
    const files = limit !== undefined ? parsedFiles.slice(0, Math.max(0, limit)) : parsedFiles

    const result: ImportResult = {
        success: true,
        created: 0,
        updated: 0,
        skipped: 0,
        relationshipsLinked: 0,
        vectorsIndexed: 0,
        errors: [],
        dry_run,
    }

    const vectorQueue: ImportedVectorItem[] = []
    const prefetchedById = prefetchImportedEntriesById(db, files)

    db.executeInTransaction(() => {
        if (dry_run) {
            runDryRunImportValidation(files, db, options, prefetchedById, result)
            return
        }

        const idRemap = new Map<number, number>()
        const pendingLinks: PendingRelationshipLink[] = []

        for (const file of files) {
            const { filename, metadata } = file
            const {
                entry,
                entryId,
                workspaceId: entryWsId,
                projectNumber: entryProjNum,
            } = upsertParsedFile(
                file,
                db,
                options,
                result,
                prefetchedById
            )
            if (metadata.mj_id !== undefined) {
                idRemap.set(metadata.mj_id, entryId)
            }
            pendingLinks.push({
                entryId,
                filename,
                relationships: metadata.relationships,
                workspaceId: entryWsId,
                projectNumber: entryProjNum,
            })
            vectorQueue.push({ entryId, filename, workspaceId: entryWsId, entry })
        }

        applyImportedRelationshipBatch(db, pendingLinks, idRemap, result)
    })

    if (!dry_run && vectorManager) {
        await indexImportedEntries(db, vectorManager, vectorQueue, result)
    }

    return result
}
