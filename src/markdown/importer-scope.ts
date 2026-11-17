/**
 * memory-journal-mcp — Markdown Importer Scope Helpers
 *
 * Isolates workspace/project validation and pairing rules for markdown imports.
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import { PermissionError, ValidationError } from '../types/errors.js'
import {
    findCanonicalRegistryKey,
    resolveProjectContext,
} from '../utils/workspace-resolver.js'
import { effectiveWorkspace } from '../database/workspace-scope.js'
import { activeProjectRegistry, pairStoredScope } from '../utils/write-scope.js'
import type { ImportOptions, ImportResult, ParsedFile } from './importer.js'

export interface ImportedVectorItem {
    entryId: number
    filename: string
    workspaceId: string | undefined
}

/**
 * [INVARIANT] An explicit caller workspace — including the real `default` workspace — locks
 * ownership checks. Only `*` and blanks are unscoped.
 */
function concreteCallerWorkspace(workspaceId: string | undefined): string | undefined {
    if (workspaceId === undefined) return undefined
    const trimmed = workspaceId.trim()
    if (trimmed === '' || trimmed === '*') return undefined
    return trimmed
}

function sameRegistryWorkspace(
    left: string,
    right: string,
    registry: Parameters<typeof findCanonicalRegistryKey>[1]
): boolean {
    const leftKey = findCanonicalRegistryKey(left, registry) ?? left
    const rightKey = findCanonicalRegistryKey(right, registry) ?? right
    return leftKey.toLowerCase() === rightKey.toLowerCase()
}

function assertExplicitImportScopeMatchesRegistry(
    explicitWs: string,
    rawProjectNumber: number,
    effectiveRegistry: NonNullable<ReturnType<typeof activeProjectRegistry>>
): void {
    const owner = Object.entries(effectiveRegistry).find(
        ([, entry]) => entry.project_number === rawProjectNumber
    )?.[0]
    if (owner !== undefined && !sameRegistryWorkspace(explicitWs, owner, effectiveRegistry)) {
        throw new ValidationError(
            `project_number ${String(rawProjectNumber)} belongs to workspace '${owner}', not '${explicitWs}'.`
        )
    }
    const canonicalExplicit = findCanonicalRegistryKey(explicitWs, effectiveRegistry)
    const registeredProject =
        canonicalExplicit !== undefined ? effectiveRegistry[canonicalExplicit]?.project_number : undefined
    if (registeredProject !== undefined && registeredProject !== rawProjectNumber) {
        throw new ValidationError(
            `project_number ${String(rawProjectNumber)} does not match registered project ${String(registeredProject)} for workspace '${explicitWs}'.`
        )
    }
    pairStoredScope(explicitWs, rawProjectNumber, effectiveRegistry)
}

export function resolveImportedFileContext(
    file: ParsedFile,
    options: ImportOptions
): { effectiveWsId: string | undefined; effectiveProjNum: number | undefined } {
    const { metadata } = file
    const rawWorkspaceId = options.workspaceId ?? metadata.workspace_id
    if (rawWorkspaceId?.trim() === '*' || metadata.workspace_id?.trim() === '*') {
        throw new ValidationError("Workspace '*' cannot be used for import writes")
    }

    const fileProject = metadata.project_number
    if (
        (options.project_number !== undefined && options.project_number <= 0) ||
        (fileProject !== undefined && fileProject <= 0)
    ) {
        throw new ValidationError('project_number must be a positive integer')
    }

    const effectiveRegistry = activeProjectRegistry(options.config?.projectRegistry)
    const lockedWorkspace = concreteCallerWorkspace(options.workspaceId)
    const fileWorkspace = concreteCallerWorkspace(metadata.workspace_id)
    if (
        lockedWorkspace !== undefined &&
        fileWorkspace !== undefined &&
        !sameRegistryWorkspace(lockedWorkspace, fileWorkspace, effectiveRegistry)
    ) {
        throw new ValidationError(
            `Frontmatter workspace_id '${fileWorkspace}' conflicts with target workspace '${lockedWorkspace}'.`
        )
    }
    if (
        options.project_number !== undefined &&
        fileProject !== undefined &&
        options.project_number !== fileProject
    ) {
        throw new ValidationError(
            `Frontmatter project_number ${String(fileProject)} conflicts with target project_number ${String(options.project_number)}.`
        )
    }

    const explicitWs = lockedWorkspace ?? fileWorkspace
    const rawProjectNumber = options.project_number ?? fileProject
    if (explicitWs !== undefined && rawProjectNumber !== undefined && effectiveRegistry !== undefined) {
        assertExplicitImportScopeMatchesRegistry(explicitWs, rawProjectNumber, effectiveRegistry)
    }

    const effectiveInputWs =
        concreteCallerWorkspace(options.workspaceId) ?? concreteCallerWorkspace(metadata.workspace_id)
    const resolved = resolveProjectContext(
        {
            ...(effectiveInputWs !== undefined ? { workspace_id: effectiveInputWs } : {}),
            ...(rawProjectNumber !== undefined ? { project_number: rawProjectNumber } : {}),
        },
        options.config
    )
    const paired = pairStoredScope(resolved.workspaceId, resolved.projectNumber, effectiveRegistry)
    const effectiveWsId = (paired.workspaceId ?? resolved.workspaceId).trim()
    if (effectiveWsId === '*') {
        throw new ValidationError(
            "Wildcard workspace_id '*' cannot be used when importing entries. Specify a concrete workspace_id."
        )
    }
    return {
        effectiveWsId,
        effectiveProjNum: paired.projectNumber ?? undefined,
    }
}

export function resolveCanonicalImportAuthor(
    db: IDatabaseAdapter,
    author: string | undefined,
    workspaceId?: string
): string | undefined {
    if (author === undefined) return undefined
    if (typeof db.resolveAuthor !== 'function') return author
    return workspaceId !== undefined ? db.resolveAuthor(author, workspaceId) : db.resolveAuthor(author)
}

export function assertImportAuthorOwnership(
    db: IDatabaseAdapter,
    entryId: number,
    author: string | undefined,
    workspaceId?: string,
    options?: Pick<ImportOptions, 'enforceStrictTeamOwnership' | 'allowAdminAuthorOverride'>
): void {
    if (author === undefined || typeof db.getAuthorsForEntries !== 'function') return
    if (options?.allowAdminAuthorOverride === true) return
    const effectiveAuthor = resolveCanonicalImportAuthor(db, author, workspaceId) ?? author
    const existingAuthor = db.getAuthorsForEntries([entryId]).get(entryId)
    if (existingAuthor === null) {
        if (options?.enforceStrictTeamOwnership === true) {
            throw new PermissionError(
                `Permission denied: cannot overwrite entry ${String(entryId)} with no recorded author during non-admin team import by '${effectiveAuthor}'`
            )
        }
        return
    }
    if (existingAuthor !== undefined) {
        const canonicalExisting =
            resolveCanonicalImportAuthor(db, existingAuthor, workspaceId) ?? existingAuthor
        if (canonicalExisting.toLowerCase() !== effectiveAuthor.toLowerCase()) {
            throw new PermissionError(
                `Permission denied: cannot overwrite entry ${String(entryId)} owned by '${existingAuthor}' during import by '${effectiveAuthor}'`
            )
        }
    }
}

/** Fetch all referenced entries by ID once and apply workspace visibility matching crud-read. */
export function prefetchImportedEntriesById(
    db: IDatabaseAdapter,
    parsedFiles: readonly ParsedFile[]
): ReadonlyMap<number, NonNullable<ReturnType<IDatabaseAdapter['getEntryById']>>> | undefined {
    if (typeof db.getEntriesByIds !== 'function') return undefined
    const ids = parsedFiles.flatMap((f) =>
        f.metadata.mj_id !== undefined ? [f.metadata.mj_id] : []
    )
    return ids.length > 0 ? db.getEntriesByIds(ids, '*') : new Map()
}

/** Read and parse markdown files with bounded 16-way concurrency, preserving sorted file order. */
export async function readMarkdownFilesParallel<T>(
    filenames: readonly string[],
    reader: (filename: string) => Promise<{ parsed?: T; skipped?: boolean }>
): Promise<{
    parsedFiles: T[]
    skipped: number
    errors: { file: string; error: string }[]
}> {
    const parsedFiles: T[] = []
    let skipped = 0
    const errors: { file: string; error: string }[] = []
    const CONCURRENCY = 16
    for (let i = 0; i < filenames.length; i += CONCURRENCY) {
        const chunk = filenames.slice(i, i + CONCURRENCY)
        const outcomes = await Promise.all(
            chunk.map(async (filename) => {
                try {
                    return { filename, outcome: await reader(filename) }
                } catch (err) {
                    return {
                        filename,
                        error: err instanceof Error ? err.message : String(err),
                    }
                }
            })
        )
        for (const item of outcomes) {
            if ('error' in item && item.error !== undefined) {
                errors.push({ file: item.filename, error: item.error })
            } else if (item.outcome?.skipped) {
                skipped++
            } else if (item.outcome?.parsed !== undefined) {
                parsedFiles.push(item.outcome.parsed)
            }
        }
    }
    return { parsedFiles, skipped, errors }
}

/** Resolve an entry either from an ID-prefetched map (enforcing workspace scope) or via single DB lookup. */
export function resolvePrefetchedEntry(
    entryId: number,
    workspaceId: string | undefined,
    db: IDatabaseAdapter,
    prefetchedById?: ReturnType<typeof prefetchImportedEntriesById>
): ReturnType<IDatabaseAdapter['getEntryById']> {
    if (prefetchedById === undefined) {
        return db.getEntryById(entryId, workspaceId)
    }
    const hit = prefetchedById.get(entryId)
    if (!hit) return null
    const scopeId = effectiveWorkspace(workspaceId)
    return scopeId === '*' || hit.workspaceId === scopeId ? hit : null
}

/** Index imported entries in vectorManager, batching via `addEntries` with per-file error fallback. */
export async function indexImportedEntries(
    db: IDatabaseAdapter,
    vectorManager: VectorSearchManager,
    vectorQueue: readonly ImportedVectorItem[],
    result: Pick<ImportResult, 'vectorsIndexed' | 'errors' | 'success'>
): Promise<void> {
    if (vectorQueue.length === 0) return
    const prefetched =
        typeof db.getEntriesByIds === 'function'
            ? db.getEntriesByIds(
                  vectorQueue.map((v) => v.entryId),
                  '*'
              )
            : undefined
    const resolvedEntries = vectorQueue.map((item) => ({
        item,
        entry: resolvePrefetchedEntry(item.entryId, item.workspaceId, db, prefetched),
    }))

    const indexable = resolvedEntries.flatMap((r) => (r.entry ? [r.entry] : []))
    if (indexable.length > 1 && typeof vectorManager.addEntries === 'function') {
        try {
            await vectorManager.addEntries(indexable)
            result.vectorsIndexed += indexable.length
            return
        } catch {
            // Fall back per entry so per-file error attribution remains exact.
        }
    }

    let hasVectorErrors = false
    for (const { item, entry } of resolvedEntries) {
        try {
            if (entry) {
                await vectorManager.addEntry(entry)
                result.vectorsIndexed++
            }
        } catch (err) {
            hasVectorErrors = true
            result.errors.push({
                file: item.filename,
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }
    if (hasVectorErrors) {
        result.success = false
    }
}
