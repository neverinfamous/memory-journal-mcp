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
import type { EntryType, SignificanceType, ToolHandlerConfig } from '../types/index.js'
import { ENTRY_TYPES, SIGNIFICANCE_TYPES } from '../types/index.js'
import { ValidationError } from '../types/errors.js'
import { MAX_CONTENT_LENGTH, normalizeSignificanceValue } from '../handlers/tools/schemas/constants-and-primitives.js'
import {
    applyImportedRelationshipBatch,
    type PendingRelationshipLink,
} from './import-relationships.js'
import { parseFrontmatter } from './frontmatter.js'
import { assertSafeDirectoryPath, assertSafeFilePath } from '../utils/security-utils.js'
import {
    assertImportAuthorOwnership,
    indexImportedEntries,
    resolveCanonicalImportAuthor,
    resolveImportedFileContext,
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

/** Valid entry types and significance types for casting */
const VALID_ENTRY_TYPES = new Set<string>(ENTRY_TYPES)
const VALID_SIGNIFICANCE_TYPES = new Set<string>(SIGNIFICANCE_TYPES)

/**
 * Safely cast a string to EntryType, throwing ValidationError on invalid values.
 */
function toEntryType(value: string | undefined): EntryType | undefined {
    if (value === undefined) return undefined
    if (!VALID_ENTRY_TYPES.has(value)) {
        throw new ValidationError(
            `Invalid entry type: ${value}. Must be one of: ${Array.from(VALID_ENTRY_TYPES).join(', ')}`
        )
    }
    return value as EntryType
}

/**
 * Validate a string against canonical SignificanceType values before persistence.
 */
function toSignificanceType(value: string | undefined): SignificanceType | undefined {
    if (value === undefined) return undefined
    const normalized = normalizeSignificanceValue(value)
    if (normalized === undefined) return undefined
    if (!VALID_SIGNIFICANCE_TYPES.has(normalized)) {
        throw new ValidationError(
            `Invalid significance type: ${value}. Must be one of: ${Array.from(VALID_SIGNIFICANCE_TYPES).join(', ')}`
        )
    }
    return normalized as SignificanceType
}

function validateImportTimestamp(timestamp: string | undefined): void {
    if (timestamp === undefined) return
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(timestamp)
    if (ymdMatch !== null) {
        const y = Number(ymdMatch[1])
        const m = Number(ymdMatch[2])
        const d = Number(ymdMatch[3])
        const probe = new Date(Date.UTC(y, m - 1, d))
        if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
            throw new ValidationError(`Invalid timestamp format: ${timestamp}. Expected a valid ISO 8601 date or timestamp.`)
        }
    }
    const candidate = timestamp.includes('T') ? timestamp : `${timestamp}T00:00:00.000Z`
    if (Number.isNaN(new Date(candidate).getTime())) {
        throw new ValidationError(`Invalid timestamp format: ${timestamp}. Expected an ISO 8601 date or timestamp.`)
    }
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
    const dir = await opendir(sourceDir)
    for await (const dirent of dir) {
        if (dirent.isFile() && dirent.name.endsWith('.md')) {
            allMdFiles.push(dirent.name)
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

    const parsedFiles: ParsedFile[] = []
    for (const filename of mdFiles) {
        try {
            const outcome = await readAndParseMarkdownFile(sourceDir, filename, allowedRoots)
            if (outcome.skipped) {
                result.skipped++
            } else if (outcome.parsed) {
                parsedFiles.push(outcome.parsed)
            }
        } catch (err) {
            result.errors.push({
                file: filename,
                error: err instanceof Error ? err.message : String(err),
            })
            result.success = false
        }
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

/* Author ownership helpers imported from ./importer-scope.ts */

function validateImportedFileEntry(
    file: ParsedFile,
    db: IDatabaseAdapter,
    options: ImportOptions
): {
    effectiveWsId: string | undefined
    effectiveProjNum: number | undefined
    rawEntryType: EntryType | undefined
    significanceType: SignificanceType | undefined
    existing: ReturnType<IDatabaseAdapter['getEntryById']>
} {
    const { metadata } = file
    if (file.body.trim().length === 0) {
        throw new ValidationError('Imported markdown entry body cannot be empty')
    }
    if (file.body.length > MAX_CONTENT_LENGTH) {
        throw new ValidationError(
            `Imported markdown entry body exceeds maximum length of ${String(MAX_CONTENT_LENGTH)} characters`
        )
    }
    const { effectiveWsId, effectiveProjNum } = resolveImportedFileContext(file, options)
    if (effectiveWsId?.trim() === '*') {
        throw new ValidationError(
            "Wildcard workspace_id '*' cannot be used when importing entries. Specify a concrete workspace_id."
        )
    }
    const rawEntryType = toEntryType(metadata.entry_type)
    const significanceType = toSignificanceType(metadata.significance)
    validateImportTimestamp(metadata.timestamp)
    const existing =
        metadata.mj_id !== undefined
            ? db.getEntryById(metadata.mj_id, effectiveWsId ?? options.workspaceId)
            : null
    if (existing && metadata.mj_id !== undefined) {
        if (
            effectiveProjNum !== undefined &&
            (existing.projectNumber ?? null) !== effectiveProjNum
        ) {
            throw new ValidationError(
                `Entry ${String(metadata.mj_id)} belongs to project #${String(existing.projectNumber ?? 'none')}, not project #${String(effectiveProjNum)}.`
            )
        }
        assertImportAuthorOwnership(db, metadata.mj_id, options.author, effectiveWsId, options)
    }
    return { effectiveWsId, effectiveProjNum, rawEntryType, significanceType, existing }
}

function upsertParsedFile(
    file: ParsedFile,
    db: IDatabaseAdapter,
    options: ImportOptions,
    result: ImportResult
): { entryId: number; workspaceId: string | undefined; projectNumber: number | undefined } {
    const { body, metadata } = file
    const { author } = options
    const { effectiveWsId, effectiveProjNum, rawEntryType, significanceType, existing } =
        validateImportedFileEntry(file, db, options)

    if (existing && metadata.mj_id !== undefined) {
        const updated = db.updateEntry(metadata.mj_id, {
            content: body,
            entryType: rawEntryType,
            tags: metadata.tags,
            ...(significanceType !== undefined && { significanceType }),
            ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
            workspaceId: effectiveWsId,
        })
        if (updated === null) {
            throw new Error(`Entry ${String(metadata.mj_id)} could not be updated during import`)
        }
        result.updated++
        // [INTENT] Use the stored (canonical) workspace for relationship linking and vector indexing.
        return { entryId: metadata.mj_id, workspaceId: updated.workspaceId ?? effectiveWsId, projectNumber: effectiveProjNum }
    }

    const canonicalOptionAuthor = resolveCanonicalImportAuthor(db, author, effectiveWsId)
    const resolvedAuthor = canonicalOptionAuthor ?? metadata.author
    const newEntry = db.createEntry({
        content: body,
        entryType: rawEntryType ?? 'personal_reflection',
        tags: metadata.tags,
        ...(options.isPersonal !== undefined ? { isPersonal: options.isPersonal } : {}),
        ...(metadata.timestamp !== undefined && { timestamp: metadata.timestamp }),
        ...(significanceType !== undefined && { significanceType }),
        ...(resolvedAuthor !== undefined && { author: resolvedAuthor }),
        ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
        workspaceId: effectiveWsId,
    })
    result.created++
    return { entryId: newEntry.id, workspaceId: newEntry.workspaceId ?? effectiveWsId, projectNumber: effectiveProjNum }
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
    const files = limit !== undefined && limit >= 0 ? parsedFiles.slice(0, limit) : parsedFiles

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

    db.executeInTransaction(() => {
        const idRemap = new Map<number, number>()
        const pendingLinks: PendingRelationshipLink[] = []

        for (const file of files) {
            const { filename, metadata } = file

            if (dry_run) {
                const { existing } = validateImportedFileEntry(file, db, options)
                if (existing) {
                    result.updated++
                } else {
                    result.created++
                }
                continue
            }

            const { entryId, workspaceId: entryWsId, projectNumber: entryProjNum } = upsertParsedFile(
                file,
                db,
                options,
                result
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
            vectorQueue.push({ entryId, filename, workspaceId: entryWsId })
        }

        applyImportedRelationshipBatch(db, pendingLinks, idRemap, result)
    })

    if (!dry_run && vectorManager) {
        await indexImportedEntries(db, vectorManager, vectorQueue, result)
    }

    return result
}
