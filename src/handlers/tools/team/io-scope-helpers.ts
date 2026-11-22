/**
 * Scope and external-file helpers for Team IO Tools (`team_import_markdown`, `team_import_external`).
 * Extracted from `io-tools.ts` to keep the main tool definition module well under the 500-line ceiling.
 */

import * as fs from 'node:fs/promises'
import { constants as fsConstants, realpathSync } from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { EntryType, JournalEntry, ToolContext } from '../../../types/index.js'
import { AggregateMcpError, ValidationError } from '../../../types/errors.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveTeamCreateAuthor } from './admin-tools/batch-create-helpers.js'
import { enforceTeamRbac, getCallerIdentity, isCallerTeamAdmin, resolveScopedTeamRole } from './rbac.js'
import { resolveWorkspaceFromFilePath } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
} from '../../../utils/security-utils.js'
import { convertFile, exportEntriesToMarkdown } from '../../../markdown/index.js'
import type { ExportableEntry, ParsedFile, SourceFormat } from '../../../markdown/index.js'
import { MAX_IMPORT_FILE_BYTES } from '../io/tools.js'
import {
    coerceIntString,
    DATE_FORMAT_MESSAGE,
    DATE_FORMAT_REGEX,
    DATE_MAX_SENTINEL,
    DATE_MIN_SENTINEL,
    StrictProjectNumberSchema,
} from '../schemas.js'
import { batchFetchAuthors, resolveTeamProjectNumber } from './helpers.js'

export const TeamExportMarkdownSchema = z
    .object({
        output_dir: z.string().min(1),
        start_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        end_date: z.string().regex(DATE_FORMAT_REGEX, DATE_FORMAT_MESSAGE).optional(),
        tags: z.array(z.string()).optional(),
        project_number: StrictProjectNumberSchema.optional(),
        limit: z.preprocess(coerceIntString, z.number().int().min(1).max(500)).optional().default(100),
        workspace_id: z.string().max(255).optional(),
    })
    .strict()

type TeamExportMarkdownInput = z.infer<typeof TeamExportMarkdownSchema>

function buildTeamExportableEntries(
    teamDb: NonNullable<ToolContext['teamDb']>,
    entries: JournalEntry[]
): ExportableEntry[] {
    const authorMap = batchFetchAuthors(
        teamDb,
        entries.map((e) => e.id)
    )
    return entries.map((e) => {
        const author = authorMap.get(e.id)
        return {
            id: e.id,
            content: e.content,
            entryType: e.entryType,
            timestamp: e.timestamp,
            tags: e.tags,
            ...(e.significanceType !== null ? { significance: e.significanceType } : {}),
            ...(author !== undefined && author !== null ? { author } : {}),
            ...(e.workspaceId !== undefined ? { workspaceId: e.workspaceId } : {}),
            ...(e.projectNumber !== undefined && e.projectNumber !== null
                ? { projectNumber: e.projectNumber }
                : {}),
        }
    })
}

export async function executeTeamExportMarkdown(
    context: ToolContext,
    teamDb: NonNullable<ToolContext['teamDb']>,
    input: TeamExportMarkdownInput
): Promise<unknown> {
    if (input.workspace_id?.trim() === '*') {
        // [BOUNDARY] Per-file export cannot attribute a mixed-workspace batch to one output tree.
        return {
            success: false,
            error: "workspace_id '*' is not supported by team_export_markdown. Export each workspace separately.",
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion: 'Pass a concrete workspace_id or project_number.',
            recoverable: true,
        }
    }
    const hasExplicitWs = input.workspace_id !== undefined && input.workspace_id.trim() !== ''
    const dirMatch =
        !hasExplicitWs && input.project_number === undefined
            ? resolveWorkspaceFromFilePath(input.output_dir, context.config)
            : undefined
    const effectiveWsInput = hasExplicitWs ? input.workspace_id : dirMatch?.workspaceId
    const effectivePnInput = input.project_number ?? dirMatch?.projectNumber
    const wsId = resolveWriteWorkspaceId(effectiveWsInput, effectivePnInput, context.config)
    enforceTeamRbac(context, getCallerIdentity(), 'member', wsId)
    const projectNumber =
        resolveTeamProjectNumber(context, wsId, effectivePnInput, effectiveWsInput) ?? undefined
    if (projectNumber === undefined) {
        return missingTeamIoProjectNumberError(effectiveWsInput)
    }
    if (
        input.start_date !== undefined &&
        input.end_date !== undefined &&
        input.start_date > input.end_date
    ) {
        throw new ValidationError('start_date cannot be after end_date')
    }

    const { progress } = context
    const allowedRoots = context.config?.allowedIoRoots ?? []
    await sendProgress(progress, 0, 3, 'Fetching team entries...')

    const entries =
        input.start_date || input.end_date
            ? teamDb.searchByDateRange(
                  input.start_date ?? DATE_MIN_SENTINEL,
                  input.end_date ?? DATE_MAX_SENTINEL,
                  { tags: input.tags, limit: input.limit, projectNumber, workspaceId: wsId }
              ).entries
            : teamDb.searchEntries('', {
                  tags: input.tags,
                  limit: input.limit,
                  projectNumber,
                  workspaceId: wsId,
              }).entries

    await sendProgress(progress, 1, 3, `Exporting ${String(entries.length)} team entries...`)
    const exportable = buildTeamExportableEntries(teamDb, entries)

    await sendProgress(progress, 2, 3, 'Writing markdown files...')
    const result = await exportEntriesToMarkdown(exportable, input.output_dir, teamDb, allowedRoots)
    if (!result.success && result.errors !== undefined && result.errors.length > 0) {
        const total = result.exported_count + result.errors.length
        throw new AggregateMcpError(
            `Exporting ${String(total)} team entries: ${String(result.exported_count)} succeeded, ${String(result.errors.length)} failed.`,
            result.errors.map((e) => ({ message: e.error, file: e.file })),
            { result }
        )
    }
    await sendProgress(progress, 3, 3, 'Team export complete')
    return result
}

export const TEAM_IO_NOT_CONFIGURED = {
    success: false,
    error: 'Team collaboration is not configured. Set TEAM_DB_PATH to enable.',
}

export const MISSING_PROJECT_NUMBER_IO_ERROR = {
    success: false,
    error: 'Missing project_number. You MUST provide a valid project_number (e.g., 1) or configure DEFAULT_PROJECT_NUMBER on the server.',
    code: 'VALIDATION_ERROR',
    category: 'validation',
    suggestion:
        'Specify the project_number in your tool call, or ensure DEFAULT_PROJECT_NUMBER is configured on the server.',
    recoverable: true,
}

export function missingTeamIoProjectNumberError(explicitWs?: string): typeof MISSING_PROJECT_NUMBER_IO_ERROR {
    if (explicitWs?.trim().toLowerCase() === 'default') {
        return {
            success: false,
            error: "Explicit workspace_id 'default' requires a numeric project_number for team IO operations (team entries cannot inherit DEFAULT_PROJECT_NUMBER onto 'default').",
            code: 'VALIDATION_ERROR',
            category: 'validation',
            suggestion: 'Specify a concrete workspace_id or pass a valid project_number.',
            recoverable: true,
        }
    }
    return MISSING_PROJECT_NUMBER_IO_ERROR
}

export function resolveTeamImportScope(
    sourceDir: string,
    explicitWs: string | undefined,
    explicitPn: number | undefined,
    context: ToolContext
): {
    wsId: string
    projectNumber: number | undefined
    lockedWsId: string | undefined
} {
    const trimmedWs = explicitWs?.trim()
    const hasExplicitWs = trimmedWs !== undefined && trimmedWs !== '' && trimmedWs !== '*'
    const dirMatch =
        !hasExplicitWs && explicitPn === undefined
            ? resolveWorkspaceFromFilePath(sourceDir, context.config)
            : undefined
    const effectiveRegistry = activeProjectRegistry(context.config?.projectRegistry)
    const projectOwner =
        !hasExplicitWs && dirMatch === undefined && explicitPn !== undefined
            ? uniqueWorkspaceForProject(explicitPn, effectiveRegistry)
            : undefined
    const wsId = resolveWriteWorkspaceId(
        explicitWs ?? dirMatch?.workspaceId,
        explicitPn ?? dirMatch?.projectNumber,
        context.config
    )
    const rbacActive = context.teamDb?.isTeamRbacActive?.() === true
    const resolvedExplicitOrDir =
        (hasExplicitWs ? trimmedWs : undefined) ?? dirMatch?.workspaceId ?? projectOwner
    const lockedWsId = rbacActive ? (resolvedExplicitOrDir ?? wsId) : resolvedExplicitOrDir
    const projectNumber =
        resolveTeamProjectNumber(context, wsId, explicitPn ?? dirMatch?.projectNumber, explicitWs) ??
        undefined
    return { wsId, projectNumber, lockedWsId }
}

type ExternalReadOutcome =
    | { status: 'parsed'; file: ParsedFile }
    | { status: 'skipped' }
    | { status: 'error'; file: string; error: string }

async function readAndConvertSingleExternalFile(
    sourceDir: string,
    filename: string,
    allowedRoots: string[],
    sourceFormat: Parameters<typeof convertFile>[2],
    defaultEntryType: EntryType | undefined
): Promise<ExternalReadOutcome> {
    let handle
    try {
        const filepath = path.join(sourceDir, filename)
        assertSafeFilePath(filepath, allowedRoots)
        handle = await fs.open(filepath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
        const stats = await handle.stat()
        if (!stats.isFile()) {
            throw new Error(`Refusing to import non-regular file: ${filename}`)
        }
        if (stats.size > MAX_IMPORT_FILE_BYTES) {
            throw new Error(
                `File exceeds maximum size limit of ${String(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB (${stats.size} bytes)`
            )
        }
        const content = await handle.readFile('utf-8')
        const converted = convertFile(content, filename, sourceFormat, defaultEntryType)
        if (converted.body.trim()) {
            return {
                status: 'parsed',
                file: { filename, body: converted.body, metadata: converted.metadata },
            }
        }
        return { status: 'skipped' }
    } catch (err) {
        return {
            status: 'error',
            file: filename,
            error: err instanceof Error ? err.message : String(err),
        }
    } finally {
        if (handle) await Promise.resolve(handle.close()).catch(() => undefined)
    }
}

export async function readAndConvertExternalMarkdownFiles(
    sourceDir: string,
    limit: number,
    sourceFormat: SourceFormat,
    defaultEntryType: EntryType | undefined,
    allowedRoots: string[],
    progress: ToolContext['progress']
): Promise<{ parsedFiles: ParsedFile[]; errors: { file: string; error: string }[]; skipped: number }> {
    assertSafeDirectoryPath(sourceDir, allowedRoots)
    const pinnedSourceDir = realpathSync.native(sourceDir)
    const MAX_DIRECTORY_SCAN_ENTRIES = 10_000
    const allMdFiles: string[] = []
    let scannedEntries = 0
    const dir = await fs.opendir(pinnedSourceDir)
    try {
        for await (const dirent of dir) {
            if (++scannedEntries > MAX_DIRECTORY_SCAN_ENTRIES) break
            if (dirent.isFile() && !dirent.isSymbolicLink() && dirent.name.endsWith('.md')) {
                allMdFiles.push(dirent.name)
                if (allMdFiles.length >= MAX_DIRECTORY_SCAN_ENTRIES) break
            }
        }
    } finally {
        await dir.close().catch(() => {
            // Directory stream may already be closed after iteration.
        })
    }
    allMdFiles.sort((a, b) => a.localeCompare(b))
    const mdFiles = allMdFiles.slice(0, limit)

    await sendProgress(progress, 1, 3, 'Converting external formats...')
    const parsedFiles: ParsedFile[] = []
    const errors: { file: string; error: string }[] = []
    let skipped = 0
    const READ_CONCURRENCY = 16
    for (let i = 0; i < mdFiles.length; i += READ_CONCURRENCY) {
        if (realpathSync.native(pinnedSourceDir) !== pinnedSourceDir) {
            throw new Error('Source directory realpath changed during import scan.')
        }
        const chunk = mdFiles.slice(i, i + READ_CONCURRENCY)
        const outcomes = await Promise.all(
            chunk.map((filename) =>
                readAndConvertSingleExternalFile(
                    pinnedSourceDir,
                    filename,
                    [pinnedSourceDir],
                    sourceFormat,
                    defaultEntryType
                )
            )
        )
        for (const outcome of outcomes) {
            if (outcome.status === 'parsed') parsedFiles.push(outcome.file)
            else if (outcome.status === 'skipped') skipped++
            else errors.push({ file: outcome.file, error: outcome.error })
        }
    }

    return { parsedFiles, errors, skipped }
}

export type TeamImportContextAuthor =
    | {
          author: string
          enforceStrictTeamOwnership: boolean
          allowAdminAuthorOverride: boolean
      }
    | { errorResponse: Record<string, unknown> }

/**
 * Resolves team import caller identity, enforcing non-viewer RBAC and OAuth authentication
 * while preserving the unauthenticated non-RBAC legacy author flow.
 */
export function resolveTeamImportContextAuthor(
    context: ToolContext,
    workspaceId?: string
): TeamImportContextAuthor {
    const teamDb = context.teamDb
    if (!teamDb) {
        return { errorResponse: TEAM_IO_NOT_CONFIGURED }
    }
    const rbacActive =
        typeof teamDb.isTeamRbacActive === 'function' && teamDb.isTeamRbacActive()
    const authCtx = getAuthContext()
    if (!rbacActive && authCtx?.authenticated !== true) {
        return {
            author: resolveAuthenticatedAuthor(),
            enforceStrictTeamOwnership: false,
            allowAdminAuthorOverride: false,
        }
    }
    const authorResult = resolveTeamCreateAuthor(undefined, teamDb, context.config, workspaceId)
    if ('errorResponse' in authorResult) {
        return authorResult
    }
    if (rbacActive) {
        const defaultRole = context.config?.teamDefaultRole ?? 'denied'
        const role = resolveScopedTeamRole(teamDb, authorResult.author, defaultRole, workspaceId)
        if (role === null || role === 'viewer') {
            return {
                errorResponse: {
                    success: false,
                    error: `Access denied: author '${authorResult.author}' (role '${role ?? 'denied'}') lacks permission to import team entries.`,
                    code: 'PERMISSION_DENIED',
                    category: 'auth',
                    recoverable: false,
                },
            }
        }
    }
    return {
        author: authorResult.author,
        enforceStrictTeamOwnership: true,
        allowAdminAuthorOverride: isCallerTeamAdmin(
            teamDb,
            authorResult.author,
            context.config,
            workspaceId
        ),
    }
}
