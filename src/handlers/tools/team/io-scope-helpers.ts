/**
 * Scope and external-file helpers for Team IO Tools (`team_import_markdown`, `team_import_external`).
 * Extracted from `io-tools.ts` to keep the main tool definition module well under the 500-line ceiling.
 */

import * as fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import * as path from 'node:path'
import type { ToolContext } from '../../../types/index.js'
import { getAuthContext } from '../../../auth/auth-context.js'
import { resolveAuthenticatedAuthor } from '../../../utils/security-utils.js'
import { sendProgress } from '../../../utils/progress-utils.js'
import { resolveTeamCreateAuthor } from './admin-tools/batch-create-helpers.js'
import { isCallerTeamAdmin, resolveScopedTeamRole } from './rbac.js'
import { resolveWorkspaceFromFilePath } from '../../../utils/workspace-resolver.js'
import { activeProjectRegistry, uniqueWorkspaceForProject } from '../../../utils/write-scope.js'
import { resolveWriteWorkspaceId } from '../write-workspace.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
} from '../../../utils/security-utils.js'
import { convertFile } from '../../../markdown/index.js'
import type { ParsedFile, SourceFormat } from '../../../markdown/index.js'
import type { EntryType } from '../../../types/index.js'
import { MAX_IMPORT_FILE_BYTES } from '../io/tools.js'
import { resolveTeamProjectNumber } from './helpers.js'

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

export async function readAndConvertExternalMarkdownFiles(
    sourceDir: string,
    limit: number,
    sourceFormat: SourceFormat,
    defaultEntryType: EntryType | undefined,
    allowedRoots: string[],
    progress: ToolContext['progress']
): Promise<{ parsedFiles: ParsedFile[]; errors: { file: string; error: string }[]; skipped: number }> {
    assertSafeDirectoryPath(sourceDir, allowedRoots)
    const allMdFiles: string[] = []
    const dir = await fs.opendir(sourceDir)
    for await (const dirent of dir) {
        if (dirent.isFile() && dirent.name.endsWith('.md')) {
            allMdFiles.push(dirent.name)
        }
    }
    allMdFiles.sort((a, b) => a.localeCompare(b))
    const mdFiles = allMdFiles.slice(0, limit)

    await sendProgress(progress, 1, 3, 'Converting external formats...')
    const parsedFiles: ParsedFile[] = []
    const errors: { file: string; error: string }[] = []
    let skipped = 0

    for (const filename of mdFiles) {
        let handle
        try {
            const filepath = path.join(sourceDir, filename)
            assertSafeFilePath(filepath, allowedRoots)
            handle = await fs.open(filepath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
            const stats = await handle.stat()
            if (stats.size > MAX_IMPORT_FILE_BYTES) {
                throw new Error(
                    `File exceeds maximum size limit of ${String(MAX_IMPORT_FILE_BYTES / (1024 * 1024))}MB (${stats.size} bytes)`
                )
            }
            const content = await handle.readFile('utf-8')
            const converted = convertFile(content, filename, sourceFormat, defaultEntryType)
            if (converted.body.trim()) {
                parsedFiles.push({
                    filename,
                    body: converted.body,
                    metadata: converted.metadata,
                })
            } else {
                skipped++
            }
        } catch (err) {
            errors.push({
                file: filename,
                error: err instanceof Error ? err.message : String(err),
            })
        } finally {
            if (handle) await handle.close()
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
