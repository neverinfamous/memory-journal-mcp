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
import type { EntryType, RelationshipType, SignificanceType } from '../types/index.js'
import { ENTRY_TYPES, RELATIONSHIP_TYPES } from '../types/index.js'
import { parseFrontmatter } from './frontmatter.js'
import { assertSafeDirectoryPath, assertSafeFilePath } from '../utils/security-utils.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
    resolveProjectContext,
} from '../utils/workspace-resolver.js'

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
    /** Associate imported entries with a specific GitHub project number */
    project_number?: number
    /** Workspace isolation identifier */
    workspaceId?: string
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

/** Supported relationship types for validation */
const VALID_RELATIONSHIP_TYPES = new Set<string>(RELATIONSHIP_TYPES)

/** Valid entry types for casting */
const VALID_ENTRY_TYPES = new Set<string>(ENTRY_TYPES)

/**
 * Safely cast a string to EntryType, returning undefined for invalid values.
 */
function toEntryType(value: string | undefined): EntryType | undefined {
    if (value === undefined) return undefined
    if (!VALID_ENTRY_TYPES.has(value)) {
        throw new Error(
            `Invalid entry type: ${value}. Must be one of: ${Array.from(VALID_ENTRY_TYPES).join(', ')}`
        )
    }
    return value as EntryType
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

    const mdFiles: string[] = []
    const dir = await opendir(sourceDir)
    for await (const dirent of dir) {
        if (dirent.isFile() && dirent.name.endsWith('.md')) {
            mdFiles.push(dirent.name)
            if (mdFiles.length >= limit) break
        }
    }
    mdFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

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

function assertImportAuthorOwnership(
    db: IDatabaseAdapter,
    entryId: number,
    author: string | undefined
): void {
    if (author === undefined) return
    const existingAuthor = db.getAuthorsForEntries([entryId]).get(entryId)
    if (
        existingAuthor !== undefined &&
        existingAuthor !== null &&
        existingAuthor.toLowerCase() !== author.toLowerCase()
    ) {
        throw new Error(
            `Permission denied: cannot overwrite entry ${String(entryId)} owned by '${existingAuthor}' during import by '${author}'`
        )
    }
}

function concreteCallerWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*' || trimmed.toLowerCase() === 'default') return undefined
    return trimmed
}

function registryWorkspaceForProject(projectNumber: number): string | undefined {
    const registry = loadProjectRegistryFromConfig()
    if (registry === undefined) return undefined
    for (const [key, entry] of Object.entries(registry)) {
        if (entry.project_number === projectNumber) return key
    }
    return undefined
}

function sameRegistryWorkspace(left: string, right: string): boolean {
    const registry = loadProjectRegistryFromConfig()
    const leftKey = findCanonicalRegistryKey(left, registry) ?? left
    const rightKey = findCanonicalRegistryKey(right, registry) ?? right
    return leftKey.toLowerCase() === rightKey.toLowerCase()
}

function resolveImportedFileContext(
    file: ParsedFile,
    options: ImportOptions
): { effectiveWsId: string | undefined; effectiveProjNum: number | undefined } {
    const { body, metadata } = file
    const rawWorkspaceId = options.workspaceId ?? metadata.workspace_id
    if (rawWorkspaceId?.trim() === '*') {
        throw new Error("Workspace '*' cannot be used for import writes")
    }

    const lockedWorkspace = concreteCallerWorkspace(options.workspaceId)
    let fileProject = metadata.project_number
    if (lockedWorkspace !== undefined && fileProject !== undefined) {
        const owner = registryWorkspaceForProject(fileProject)
        if (owner !== undefined && !sameRegistryWorkspace(lockedWorkspace, owner)) {
            fileProject = undefined
        }
    }
    const rawProjectNumber = options.project_number ?? fileProject
    const resolved = resolveProjectContext({
        workspace_id: rawWorkspaceId,
        project_number: rawProjectNumber,
        content: body,
        tags: metadata.tags,
    })
    const effectiveWsId = resolved.workspaceId
    const effectiveProjNum = resolved.projectNumber
    return { effectiveWsId, effectiveProjNum }
}

function upsertParsedFile(
    file: ParsedFile,
    db: IDatabaseAdapter,
    options: ImportOptions,
    result: ImportResult
): { entryId: number; workspaceId: string | undefined } {
    const { body, metadata } = file
    const { author } = options
    const { effectiveWsId, effectiveProjNum } = resolveImportedFileContext(file, options)
    const entryType: EntryType = toEntryType(metadata.entry_type) ?? 'personal_reflection'

    if (metadata.mj_id !== undefined) {
        const existing = db.getEntryById(metadata.mj_id, effectiveWsId)
        if (existing) {
            assertImportAuthorOwnership(db, metadata.mj_id, author)
            db.updateEntry(metadata.mj_id, {
                content: body,
                entryType: toEntryType(metadata.entry_type),
                tags: metadata.tags,
                ...(metadata.significance !== undefined && {
                    significanceType: metadata.significance,
                }),
                ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
                workspaceId: effectiveWsId,
            })
            result.updated++
            return { entryId: metadata.mj_id, workspaceId: effectiveWsId }
        }
    }

    const resolvedAuthor = author ?? metadata.author
    const newEntry = db.createEntry({
        content: body,
        entryType,
        tags: metadata.tags,
        ...(metadata.timestamp !== undefined && { timestamp: metadata.timestamp }),
        ...(metadata.significance !== undefined && {
            significanceType: metadata.significance as SignificanceType,
        }),
        ...(resolvedAuthor !== undefined && { author: resolvedAuthor }),
        ...(effectiveProjNum !== undefined && { projectNumber: effectiveProjNum }),
        workspaceId: effectiveWsId,
    })
    result.created++
    return { entryId: newEntry.id, workspaceId: effectiveWsId }
}

function linkImportedRelationships(
    db: IDatabaseAdapter,
    entryId: number,
    relationships: { type: string; target_id: number }[] | undefined,
    workspaceId: string | undefined,
    idRemap: ReadonlyMap<number, number>
): { linked: number; rejected: string[] } {
    if (relationships === undefined) return { linked: 0, rejected: [] }
    let linked = 0
    const existingRels =
        typeof db.getRelationships === 'function'
            ? db.getRelationships(entryId, workspaceId)
            : []
    const rejected: string[] = []
    for (const rel of relationships) {
        if (!VALID_RELATIONSHIP_TYPES.has(rel.type)) {
            rejected.push(rel.type)
            continue
        }
        const targetId = idRemap.get(rel.target_id) ?? rel.target_id
        if (targetId === entryId) continue
        const alreadyExists = existingRels.some(
            (r) =>
                r.fromEntryId === entryId &&
                r.toEntryId === targetId &&
                r.relationshipType === rel.type
        )
        if (alreadyExists) continue
        const targetExists = db.getEntryById(targetId, workspaceId)
        if (targetExists) {
            if (workspaceId !== undefined) {
                db.linkEntries(
                    entryId,
                    targetId,
                    rel.type as RelationshipType,
                    undefined,
                    workspaceId
                )
            } else {
                db.linkEntries(entryId, targetId, rel.type as RelationshipType)
            }
            existingRels.push({
                id: 0,
                fromEntryId: entryId,
                toEntryId: targetId,
                relationshipType: rel.type as RelationshipType,
                description: null,
                createdAt: '',
            })
            linked++
        }
    }
    return { linked, rejected }
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
    const { dry_run = false, workspaceId } = options

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

    const vectorQueue: { entryId: number; filename: string; workspaceId: string | undefined }[] = []

    db.executeInTransaction(() => {
        const idRemap = new Map<number, number>()
        const pendingLinks: {
            entryId: number
            relationships: { type: string; target_id: number }[] | undefined
            workspaceId: string | undefined
        }[] = []

        for (const file of parsedFiles) {
            const { filename, metadata } = file

            if (dry_run) {
                const { effectiveWsId } = resolveImportedFileContext(file, options)
                if (
                    metadata.mj_id !== undefined &&
                    db.getEntryById(metadata.mj_id, effectiveWsId ?? workspaceId)
                ) {
                    result.updated++
                } else {
                    result.created++
                }
                continue
            }

            const { entryId, workspaceId: entryWsId } = upsertParsedFile(file, db, options, result)
            if (metadata.mj_id !== undefined) {
                idRemap.set(metadata.mj_id, entryId)
            }
            pendingLinks.push({
                entryId,
                relationships: metadata.relationships,
                workspaceId: entryWsId,
            })
            vectorQueue.push({ entryId, filename, workspaceId: entryWsId })
        }

        for (const pending of pendingLinks) {
            const linked = linkImportedRelationships(
                db,
                pending.entryId,
                pending.relationships,
                pending.workspaceId,
                idRemap
            )
            result.relationshipsLinked += linked.linked
            for (const relType of linked.rejected) {
                result.errors.push({
                    file: '',
                    error: `Unknown relationship type '${relType}' was not linked`,
                })
                result.success = false
            }
        }
    })

    if (!dry_run && vectorManager) {
        let hasVectorErrors = false
        for (const { entryId, filename, workspaceId: entryWsId } of vectorQueue) {
            try {
                const entry = db.getEntryById(entryId, entryWsId)
                if (entry) {
                    await vectorManager.addEntry(entry)
                    result.vectorsIndexed++
                }
            } catch (err) {
                hasVectorErrors = true
                result.errors.push({
                    file: filename,
                    error: err instanceof Error ? err.message : String(err),
                })
            }
        }
        if (hasVectorErrors) {
            result.success = false
        }
    }

    return result
}
