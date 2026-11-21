import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import { PermissionError } from '../types/errors.js'
import { sanitizeAuthor } from '../utils/security-utils.js'
import type { ImportOptions, ParsedFile } from './importer.js'

export function resolveCanonicalImportAuthor(
    db: IDatabaseAdapter,
    author: string | undefined,
    workspaceId?: string
): string | undefined {
    if (author === undefined) return undefined
    const sanitized = sanitizeAuthor(author).trim()
    if (sanitized === '') return undefined
    if (typeof db.resolveAuthor !== 'function') return sanitized
    const resolved =
        workspaceId !== undefined
            ? db.resolveAuthor(sanitized, workspaceId)
            : db.resolveAuthor(sanitized)
    return sanitizeAuthor(resolved)
}

export interface ImportBatchAuthorCache {
    authorsById?: ReadonlyMap<number, string | null>
    canonicalAuthors: Map<string, string | undefined>
}

export function createImportBatchAuthorCache(
    db: IDatabaseAdapter,
    parsedFiles: readonly ParsedFile[],
    options?: Pick<ImportOptions, 'author' | 'allowAdminAuthorOverride'>
): ImportBatchAuthorCache {
    const canonicalAuthors = new Map<string, string | undefined>()
    if (
        options?.author === undefined ||
        options.allowAdminAuthorOverride === true ||
        typeof db.getAuthorsForEntries !== 'function'
    ) {
        return { canonicalAuthors }
    }
    const ids: number[] = []
    for (const file of parsedFiles) {
        if (file.metadata.mj_id !== undefined) ids.push(file.metadata.mj_id)
    }
    if (ids.length === 0) return { canonicalAuthors }
    return { authorsById: db.getAuthorsForEntries(ids), canonicalAuthors }
}

export function resolveCanonicalImportAuthorCached(
    db: IDatabaseAdapter,
    author: string | undefined,
    workspaceId: string | undefined,
    cache?: ImportBatchAuthorCache
): string | undefined {
    if (author === undefined) return undefined
    if (cache === undefined) return resolveCanonicalImportAuthor(db, author, workspaceId)
    const key = `${workspaceId ?? ''}\0${author}`
    if (cache.canonicalAuthors.has(key)) return cache.canonicalAuthors.get(key)
    const resolved = resolveCanonicalImportAuthor(db, author, workspaceId)
    cache.canonicalAuthors.set(key, resolved)
    return resolved
}

export function assertImportAuthorOwnership(
    db: IDatabaseAdapter,
    entryId: number,
    author: string | undefined,
    workspaceId?: string,
    options?: Pick<ImportOptions, 'enforceStrictTeamOwnership' | 'allowAdminAuthorOverride'>,
    batchAuthorCache?: ImportBatchAuthorCache
): void {
    if (author === undefined || typeof db.getAuthorsForEntries !== 'function') return
    if (options?.allowAdminAuthorOverride === true) return
    const effectiveAuthor =
        resolveCanonicalImportAuthorCached(db, author, workspaceId, batchAuthorCache) ?? author
    const existingAuthor =
        batchAuthorCache?.authorsById !== undefined
            ? batchAuthorCache.authorsById.get(entryId)
            : db.getAuthorsForEntries([entryId]).get(entryId)
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
            batchAuthorCache?.authorsById !== undefined
                ? existingAuthor
                : (resolveCanonicalImportAuthorCached(db, existingAuthor, workspaceId, batchAuthorCache) ??
                  existingAuthor)
        if (canonicalExisting.toLowerCase() !== effectiveAuthor.toLowerCase()) {
            throw new PermissionError(
                `Permission denied: cannot overwrite entry ${String(entryId)} owned by '${existingAuthor}' during import by '${effectiveAuthor}'`
            )
        }
    }
}
