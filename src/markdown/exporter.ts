/**
 * memory-journal-mcp — Markdown Exporter
 *
 * Converts journal entries to frontmattered `.md` files.
 * Deterministic filenames allow re-export to overwrite identically.
 */

import { mkdir, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { constants, realpathSync } from 'node:fs'
import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { serializeFrontmatter } from './frontmatter.js'
import type { FrontmatterAnchor, FrontmatterData } from './frontmatter.js'
import { logger } from '../utils/logger.js'

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
    workspaceId?: string
    projectNumber?: number
}

/** Result of an export operation */
export interface ExportResult {
    success: boolean
    exported_count: number
    output_dir: string
    files: string[]
    skipped: number
    errors?: { file: string; error: string }[]
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

interface ExportRelationshipRef {
    relationshipType: string
    fromEntryId: number
    toEntryId: number
}

function buildExportFileContent(
    entry: ExportableEntry,
    relationships: readonly ExportRelationshipRef[],
    anchors?: readonly FrontmatterAnchor[]
): string {
    const fmData: FrontmatterData = {
        mj_id: entry.id,
        entry_type: entry.entryType,
        timestamp: entry.timestamp,
        // [INVARIANT] Emit 'default' explicitly so round-trip imports cannot be re-scoped by CWD/keywords.
        ...(entry.workspaceId !== undefined && entry.workspaceId.trim() !== ''
            ? { workspace_id: entry.workspaceId }
            : {}),
        ...(entry.projectNumber !== undefined &&
        Number.isSafeInteger(entry.projectNumber) &&
        entry.projectNumber > 0
            ? { project_number: entry.projectNumber }
            : {}),
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
    const outgoing = relationships.filter((r) => r.fromEntryId === entry.id)
    if (outgoing.length > 0) {
        fmData.relationships = outgoing.map((r) => ({
            type: r.relationshipType,
            target_id: r.toEntryId,
        }))
    }
    if (anchors !== undefined && anchors.length > 0) {
        fmData.anchors = [...anchors]
    }
    return serializeFrontmatter(fmData) + '\n' + entry.content + '\n'
}

function filesystemErrorCode(err: unknown): string | undefined {
    if (typeof err !== 'object' || err === null || !('code' in err)) return undefined
    const code = err.code
    return typeof code === 'string' ? code : undefined
}

async function writeExportFile(
    resolvedOutputDir: string,
    filename: string,
    fileContent: string
): Promise<'written' | { error: string }> {
    const filepath = join(resolvedOutputDir, filename)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
        handle = await open(
            filepath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
            0o600
        )
        await handle.writeFile(fileContent, 'utf-8')
        return 'written'
    } catch (err: unknown) {
        const code = filesystemErrorCode(err)
        const errMessage =
            code === 'ELOOP' || code === 'EEXIST'
                ? 'Refusing to overwrite symlink during export'
                : err instanceof Error
                  ? err.message
                  : String(err)
        if (code === 'ELOOP' || code === 'EEXIST') {
            logger.warning('Refusing to overwrite symlink during export', { module: 'Exporter', filepath })
        } else {
            logger.error('Failed to write markdown file', {
                module: 'Exporter',
                filepath,
                error: errMessage,
            })
        }
        return { error: errMessage }
    } finally {
        if (handle !== undefined) {
            await handle.close()
        }
    }
}

function loadExportRelationships(
    db: IDatabaseAdapter,
    entries: ExportableEntry[]
): ReturnType<IDatabaseAdapter['getRelationshipsForEntries']> {
    const idsByWorkspace = new Map<string, number[]>()
    for (const entry of entries) {
        const workspaceId = entry.workspaceId ?? 'default'
        const ids = idsByWorkspace.get(workspaceId)
        if (ids === undefined) idsByWorkspace.set(workspaceId, [entry.id])
        else ids.push(entry.id)
    }

    if (idsByWorkspace.size <= 1) {
        const onlyWorkspace = idsByWorkspace.keys().next().value
        const scope = typeof onlyWorkspace === 'string' ? onlyWorkspace : '*'
        return db.getRelationshipsForEntries(
            entries.map((entry) => entry.id),
            scope
        )
    }

    const merged: ReturnType<IDatabaseAdapter['getRelationshipsForEntries']> = new Map()
    for (const [workspaceId, ids] of idsByWorkspace) {
        const part = db.getRelationshipsForEntries(ids, workspaceId)
        for (const [entryId, relationships] of part) {
            const existing = merged.get(entryId)
            if (existing === undefined) merged.set(entryId, [...relationships])
            else existing.push(...relationships)
        }
    }
    return merged
}

function loadExportAnchors(
    db: IDatabaseAdapter,
    entries: ExportableEntry[]
): Map<number, FrontmatterAnchor[]> {
    const result = new Map<number, FrontmatterAnchor[]>()
    if (entries.length === 0 || typeof db.getAnchorsByEntryIds !== 'function') return result

    const idsByWorkspace = new Map<string, number[]>()
    for (const entry of entries) {
        const workspaceId = entry.workspaceId ?? 'default'
        const ids = idsByWorkspace.get(workspaceId)
        if (ids === undefined) idsByWorkspace.set(workspaceId, [entry.id])
        else ids.push(entry.id)
    }

    for (const [workspaceId, ids] of idsByWorkspace) {
        const part = db.getAnchorsByEntryIds(ids, workspaceId)
        for (const [entryId, anchors] of part) {
            const serializedAnchors: FrontmatterAnchor[] = anchors.map((a) => {
                if (
                    a.anchorType === 'file' &&
                    (a.status === undefined || a.status === 'pending' || a.status === 'valid')
                ) {
                    return a.anchorPath
                }
                return {
                    anchor_path: a.anchorPath,
                    anchor_type: a.anchorType,
                    ...(a.status !== undefined ? { status: a.status } : {}),
                }
            })
            if (serializedAnchors.length === 0) continue
            const existing = result.get(entryId)
            if (existing === undefined) result.set(entryId, serializedAnchors)
            else existing.push(...serializedAnchors)
        }
    }
    return result
}

async function prepareSafeExportDir(outputDir: string, allowedRoots: string[]): Promise<string> {
    assertSafeDirectoryPath(outputDir, allowedRoots)

    const resolvedOutputDir = resolve(outputDir)
    const resolvedTmpDir = resolve(tmpdir())
    let realTmpDir = resolvedTmpDir
    try {
        realTmpDir = realpathSync.native(resolvedTmpDir)
    } catch {
        // Use resolvedTmpDir when realpath lookup fails
    }
    const isWin32 = process.platform === 'win32'
    const isInsideTmp = (candidate: string): boolean => {
        for (const tmpRoot of [resolvedTmpDir, realTmpDir]) {
            const relToTmp = relative(
                isWin32 ? tmpRoot.toLowerCase() : tmpRoot,
                isWin32 ? candidate.toLowerCase() : candidate
            )
            if (
                relToTmp === '' ||
                (relToTmp !== '..' && !relToTmp.startsWith('..' + sep) && !isAbsolute(relToTmp))
            ) {
                return true
            }
        }
        return false
    }
    const resolveNearestExistingRealPath = (target: string): string => {
        let cur = target
        while (true) {
            try {
                return realpathSync.native(cur)
            } catch {
                const parent = resolve(cur, '..')
                if (parent === cur) return cur
                cur = parent
            }
        }
    }
    if (isInsideTmp(resolvedOutputDir) || isInsideTmp(resolveNearestExistingRealPath(resolvedOutputDir))) {
        throw new Error('Refusing to export markdown files into the OS temporary directory')
    }

    await mkdir(resolvedOutputDir, { recursive: true })
    if (isInsideTmp(realpathSync.native(resolvedOutputDir))) {
        throw new Error('Refusing to export markdown files into the OS temporary directory')
    }
    return resolvedOutputDir
}

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
    const resolvedOutputDir = await prepareSafeExportDir(outputDir, allowedRoots)

    const files: string[] = []
    const errors: { file: string; error: string }[] = []
    let skipped = 0

    const validEntries = entries.filter((e) => e.content.trim())
    skipped += entries.length - validEntries.length

    const relationshipsMap = loadExportRelationships(db, validEntries)
    const anchorsMap = loadExportAnchors(db, validEntries)

    const CHUNK_SIZE = 50
    for (let i = 0; i < validEntries.length; i += CHUNK_SIZE) {
        const chunk = validEntries.slice(i, i + CHUNK_SIZE)
        const preChunkRealpath = realpathSync.native(resolvedOutputDir)
        assertSafeDirectoryPath(preChunkRealpath, allowedRoots)

        await Promise.all(
            chunk.map(async (entry) => {
                const relationships = relationshipsMap.get(entry.id) ?? []
                const anchors = anchorsMap.get(entry.id)
                const fileContent = buildExportFileContent(entry, relationships, anchors)
                const filename = generateFilename(entry.id, entry.content)
                const outcome = await writeExportFile(preChunkRealpath, filename, fileContent)
                if (outcome === 'written') {
                    files.push(filename)
                } else {
                    skipped++
                    errors.push({ file: filename, error: outcome.error })
                }
            })
        )

        const postChunkRealpath = realpathSync.native(resolvedOutputDir)
        if (preChunkRealpath !== postChunkRealpath) {
            throw new Error(
                'Directory swapped during export operation! Aborting to prevent path traversal.'
            )
        }
        assertSafeDirectoryPath(postChunkRealpath, allowedRoots)
    }

    return {
        success: errors.length === 0,
        exported_count: files.length,
        output_dir: resolvedOutputDir,
        files,
        skipped,
        ...(errors.length > 0 ? { errors } : {}),
    }
}
