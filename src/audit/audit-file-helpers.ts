/**
 * Symlink-safe filesystem, backward-seek, and rotation helpers for `audit-logger.ts`.
 * Extracted from `audit-query-helpers.ts` to keep file lengths <= 450 lines.
 */

import { constants as fsConstants } from 'node:fs'
import { lstat, open, rename } from 'node:fs/promises'
import { logger } from '../utils/logger.js'
import type { getRequestContext } from '../utils/request-context.js'
import { getErrnoCode, isRecord } from '../utils/type-guards.js'
import type { AuditEntry, AuditSearchFilters } from './types.js'
import {
    compileAuditSearchFilters,
    matchesAuditFilters,
    type CompiledAuditSearchFilters,
} from './audit-filter-helpers.js'
import {
    applyActiveSessionScopeFallback,
    extractAuditScopeFromArgs,
    extractAuditScopeFromUriDetails,
    iterAuditUriEntries,
    parseAuditLine,
    type AuditScopeMetadata,
} from './audit-query-helpers.js'

const AUDIT_SEARCH_CHUNK_BYTES = 65_536

/** Extract `err.code` when `err` is an error-like object with a string `code`. */
export { getErrnoCode as nodeErrorCode }

/**
 * Returns true if `filePath` exists as a symbolic link or non-regular file (directory, FIFO, device).
 * Returns false on `ENOENT` so callers can create new log files normally.
 */
export async function isUnsafeSymlinkOrSpecialFile(filePath: string): Promise<boolean> {
    try {
        const info = await lstat(filePath)
        return info.isSymbolicLink() || !info.isFile()
    } catch (err: unknown) {
        if (getErrnoCode(err) === 'ENOENT') return false
        return true
    }
}

function decodeReversedAuditChunk(
    chunkSlice: Buffer,
    trailingBytes: Buffer,
    startOffset: number
): { chunkText: string | undefined; trailingBytes: Buffer; overflowSkipped: number } {
    const combined =
        trailingBytes.length > 0 ? Buffer.concat([chunkSlice, trailingBytes]) : chunkSlice
    const firstNl = combined.indexOf(0x0a)
    if (startOffset === 0) {
        if (firstNl === -1 && combined.length > 1_048_576) {
            return { chunkText: undefined, trailingBytes: Buffer.alloc(0), overflowSkipped: 1 }
        }
        return { chunkText: combined.toString('utf-8'), trailingBytes: Buffer.alloc(0), overflowSkipped: 0 }
    }
    if (firstNl === -1) {
        if (combined.length > 1_048_576) {
            return { chunkText: undefined, trailingBytes: Buffer.alloc(0), overflowSkipped: 1 }
        }
        return {
            chunkText: undefined,
            trailingBytes: trailingBytes.length > 0 ? combined : Buffer.from(chunkSlice),
            overflowSkipped: 0,
        }
    }
    return {
        chunkText: combined.subarray(firstNl + 1).toString('utf-8'),
        trailingBytes: Buffer.from(combined.subarray(0, firstNl)),
        overflowSkipped: 0,
    }
}

function processDecodedAuditLines(
    chunkText: string,
    compiledFilters: CompiledAuditSearchFilters,
    remainingLimit: number,
    results: AuditEntry[]
): { skippedLines: number; limitReached: boolean } {
    let skippedLines = 0
    const lines = chunkText.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
        const rawLine = lines[i]
        if (rawLine === undefined || rawLine.length === 0) continue
        const entry = parseAuditLine(rawLine)
        if (entry === null) {
            skippedLines++
            continue
        }
        if (!matchesAuditFilters(entry, compiledFilters)) continue
        results.push(entry)
        if (results.length >= remainingLimit) {
            return { skippedLines, limitReached: true }
        }
    }
    return { skippedLines, limitReached: false }
}

async function readAuditChunksBackward(
    fh: Awaited<ReturnType<typeof open>>,
    buf: Buffer,
    initialPos: number,
    compiledFilters: CompiledAuditSearchFilters,
    remainingLimit: number,
    results: AuditEntry[]
): Promise<{ skippedLines: number; limitReached: boolean }> {
    let pos = initialPos
    let trailingBytes: Buffer = Buffer.alloc(0)
    let skippedLines = 0
    while (pos > 0) {
        const readLen = Math.min(AUDIT_SEARCH_CHUNK_BYTES, pos)
        const startOffset = pos - readLen
        // eslint-disable-next-line no-await-in-loop -- sequential backward chunk read with early limitReached exit
        const { bytesRead } = await fh.read(buf, 0, readLen, startOffset)
        if (bytesRead > 0) {
            const decoded = decodeReversedAuditChunk(
                buf.subarray(0, bytesRead),
                trailingBytes,
                startOffset
            )
            trailingBytes = decoded.trailingBytes
            skippedLines += decoded.overflowSkipped
            if (decoded.chunkText !== undefined) {
                const lineRes = processDecodedAuditLines(
                    decoded.chunkText,
                    compiledFilters,
                    remainingLimit,
                    results
                )
                skippedLines += lineRes.skippedLines
                if (lineRes.limitReached) {
                    return { skippedLines, limitReached: true }
                }
            }
        }
        pos = startOffset
    }
    return { skippedLines, limitReached: false }
}

export async function searchAuditFileBackward(
    filePath: string,
    filters: AuditSearchFilters | CompiledAuditSearchFilters,
    remainingLimit: number,
    results: AuditEntry[]
): Promise<{ skippedLines: number; limitReached: boolean }> {
    if (remainingLimit <= 0) {
        return { skippedLines: 0, limitReached: true }
    }
    if (await isUnsafeSymlinkOrSpecialFile(filePath)) {
        return { skippedLines: 0, limitReached: false }
    }
    let fh: Awaited<ReturnType<typeof open>>
    try {
        fh = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
    } catch (err: unknown) {
        const code = getErrnoCode(err)
        if (code === 'ENOENT' || code === 'EISDIR' || code === 'ELOOP') {
            return { skippedLines: 0, limitReached: false }
        }
        throw err
    }

    try {
        const info = await fh.stat()
        if (info.size === 0 || !info.isFile()) return { skippedLines: 0, limitReached: false }

        const compiled =
            'filters' in filters && 'startRaw' in filters
                ? filters
                : compileAuditSearchFilters(filters)
        const buf = Buffer.alloc(Math.min(AUDIT_SEARCH_CHUNK_BYTES, info.size))
        return await readAuditChunksBackward(fh, buf, info.size, compiled, remainingLimit, results)
    } finally {
        await Promise.resolve(fh.close()).catch(() => undefined)
    }
}

/**
 * Append `payload` to a regular non-symlink file using `O_NOFOLLOW` + handle `fstat`/`chmod`,
 * preventing symlink TOCTOU races between `lstat` and path-based `appendFile`/`chmod`.
 */
export async function appendRegularFileNoFollow(filePath: string, payload: string): Promise<void> {
    if (await isUnsafeSymlinkOrSpecialFile(filePath)) {
        throw new Error(`Refusing to write log to symlink or non-regular file: ${filePath}`)
    }
    const fh = await open(
        filePath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | (fsConstants.O_NOFOLLOW ?? 0),
        0o600
    )
    try {
        const info = await fh.stat()
        if (!info.isFile()) {
            throw new Error(`Refusing to write log to non-regular file: ${filePath}`)
        }
        await fh.writeFile(payload, 'utf-8')
        if ((info.mode & 0o777) !== 0o600) {
            await fh.chmod(0o600).catch(() => undefined)
        }
    } finally {
        await fh.close().catch(() => undefined)
    }
}

async function rotateArchiveSlot(logPath: string, index: number): Promise<boolean> {
    const oldFile = `${logPath}.${String(index)}`
    const newFile = `${logPath}.${String(index + 1)}`
    const [oldUnsafe, newUnsafe] = await Promise.all([
        isUnsafeSymlinkOrSpecialFile(oldFile),
        isUnsafeSymlinkOrSpecialFile(newFile),
    ])
    if (oldUnsafe || newUnsafe) {
        logger.error('Refusing to rotate over symlink or non-regular audit archive', { module: 'Audit' })
        return false
    }
    await rename(oldFile, newFile).catch((err: unknown) => {
        if (getErrnoCode(err) === 'ENOENT') return
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Audit log rotation failed: ${message}`, { module: 'Audit' })
        throw err
    })
    return true
}

async function rotateArchivesSequentially(logPath: string, index: number): Promise<boolean> {
    if (index < 1) return true
    if (!(await rotateArchiveSlot(logPath, index))) return false
    return rotateArchivesSequentially(logPath, index - 1)
}

/**
 * Rotate the audit log file if its size meets or exceeds `maxSizeBytes`,
 * returning the updated approximate size in bytes or `null` on failure.
 */
export async function rotateAuditLogFiles(
    logPath: string,
    maxSizeBytes: number,
    maxArchives: number
): Promise<number | null> {
    try {
        const info = await lstat(logPath).catch((err: unknown) => {
            if (getErrnoCode(err) !== 'ENOENT') {
                const message = err instanceof Error ? err.message : String(err)
                logger.debug(`Audit log stat failed before rotation: ${message}`, {
                    module: 'Audit',
                })
            }
            return null
        })
        if (info !== null && (info.isSymbolicLink() || !info.isFile())) {
            logger.error('Refusing to rotate symlink or non-regular audit log file', { module: 'Audit' })
            return null
        }
        const currentSize = info?.size ?? 0
        if (!info || info.size < maxSizeBytes) return currentSize

        if (!(await rotateArchivesSequentially(logPath, maxArchives - 1))) {
            return null
        }

        const firstArchive = `${logPath}.1`
        if (await isUnsafeSymlinkOrSpecialFile(firstArchive)) {
            logger.error('Refusing to overwrite symlink or non-regular .1 audit archive', { module: 'Audit' })
            return null
        }
        await rename(logPath, firstArchive)
        const archiveFh = await open(
            firstArchive,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
        ).catch(() => null)
        if (archiveFh !== null) {
            try {
                const archiveStat = await archiveFh.stat()
                if (archiveStat.isFile()) {
                    await archiveFh.chmod(0o600).catch(() => undefined)
                }
            } finally {
                await archiveFh.close().catch(() => undefined)
            }
        }
        return 0
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Rotate failed: ${message}`, { module: 'Audit' })
        return null
    }
}

const MEMORY_URI_ROOT_PREFIXES = new Set([
    'briefing', 'agent-context', 'agent-id', 'graph', 'actions', 'github', 'milestones', 'kanban',
    'projects', 'commits', 'staleness', 'team', 'insights', 'metrics', 'help', 'recent',
    'significant', 'tags', 'statistics', 'rules', 'workflows', 'audit', 'health', 'search', 'entries',
    'tools', 'issues', 'prs', 'skills', 'instructions', 'journal', 'status', 'server',
])

let dynamicMemoryUriRootsResolver: (() => ReadonlySet<string>) | undefined
const resourceFallbackToolNames = new Set<string>(['read_resource'])

/** Register live resource root prefixes and fallback resource tool names for scheme-less audit URI resolution. */
export function registerDynamicMemoryUriRoots(
    resolver: () => ReadonlySet<string>,
    toolNames?: Iterable<string>
): void {
    dynamicMemoryUriRootsResolver = resolver
    if (toolNames !== undefined) {
        for (const name of toolNames) resourceFallbackToolNames.add(name)
    }
}

function canonicalizeMemorySchemeUri(raw: string, allowBareBriefing = false): string | undefined {
    const trimmed = raw.trim()
    if (trimmed === '') return undefined
    if (/^memory:\/\//i.test(trimmed)) {
        return `memory://${trimmed.slice('memory://'.length)}`
    }
    if (!trimmed.includes('://')) {
        const root = trimmed.split(/[/?#]/, 1)[0]?.toLowerCase() ?? ''
        const isKnownRoot =
            root !== '' &&
            (MEMORY_URI_ROOT_PREFIXES.has(root) || dynamicMemoryUriRootsResolver?.().has(root) === true)
        if (isKnownRoot) {
            return `memory://${trimmed}`
        }
        if (allowBareBriefing && root !== '') {
            return `memory://briefing/${trimmed}`
        }
    }
    return undefined
}

function findMemoryUriInArgs(args: unknown, allowBareBriefing = false): string | undefined {
    if (!isRecord(args)) return undefined
    for (const { val } of iterAuditUriEntries(args)) {
        if (typeof val !== 'string') continue
        const normalized = canonicalizeMemorySchemeUri(val, allowBareBriefing)
        if (normalized !== undefined) return normalized
    }
    return undefined
}

export function resolveToolCallAuditScope(
    toolName: string,
    args: unknown,
    canTargetResource: boolean,
    sensitiveTarget: string | undefined,
    reqCtx: ReturnType<typeof getRequestContext>,
    runtime?: object | null
): AuditScopeMetadata {
    const allowBareBriefing = resourceFallbackToolNames.has(toolName)
    const uriTarget =
        sensitiveTarget !== undefined && /^memory:\/\//i.test(sensitiveTarget)
            ? `memory://${sensitiveTarget.slice('memory://'.length)}`
            : /^memory:\/\//i.test(toolName)
              ? `memory://${toolName.slice('memory://'.length)}`
              : canTargetResource
                ? findMemoryUriInArgs(args, allowBareBriefing)
                : undefined
    if (uriTarget === undefined) {
        return extractAuditScopeFromArgs(args, reqCtx, runtime)
    }
    const uriDetails = extractAuditScopeFromUriDetails(uriTarget)
    const uriScope = uriDetails.scope
    const uriWildcard = uriDetails.explicitWildcardWorkspace
    const uriInvalidProj = uriDetails.explicitInvalidProject
    const rec = isRecord(args) ? args : undefined
    if (rec === undefined) {
        return applyActiveSessionScopeFallback(uriScope, reqCtx, uriWildcard, runtime, uriInvalidProj)
    }
    const rawWsArg = [rec['workspace_id'], rec['workspaceId'], rec['workspace']].find(
        (v): v is string => typeof v === 'string' && v.trim() !== ''
    )
    const hasExplicitWs = rawWsArg !== undefined
    const hasExplicitWildcard = rawWsArg?.trim() === '*'
    const rawProjArg = [rec['project_number'], rec['projectNumber']].find(
        (v) => v !== undefined && !(typeof v === 'string' && v.trim() === '')
    )
    const hasExplicitProj = rawProjArg !== undefined
    if (!hasExplicitWs && !hasExplicitProj) {
        return applyActiveSessionScopeFallback(uriScope, reqCtx, uriWildcard, runtime, uriInvalidProj)
    }
    const argScope = extractAuditScopeFromArgs(args, reqCtx, runtime, true)
    const mergedScope: AuditScopeMetadata = {
        ...(hasExplicitWs
            ? argScope.workspaceId !== undefined
                ? { workspaceId: argScope.workspaceId }
                : {}
            : uriScope.workspaceId !== undefined
              ? { workspaceId: uriScope.workspaceId }
              : {}),
        ...(hasExplicitProj
            ? argScope.projectNumber !== undefined
                ? { projectNumber: argScope.projectNumber }
                : {}
            : !hasExplicitWildcard && uriScope.projectNumber !== undefined
              ? { projectNumber: uriScope.projectNumber }
              : {}),
    }
    const suppressProj = hasExplicitProj ? argScope.projectNumber === undefined : uriInvalidProj
    const wildcardWs = hasExplicitWs ? hasExplicitWildcard : uriWildcard
    return applyActiveSessionScopeFallback(mergedScope, reqCtx, wildcardWs, runtime, suppressProj)
}
