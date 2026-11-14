/**
 * Scope and external-file helpers for Team IO Tools (`team_import_markdown`, `team_import_external`).
 * Extracted from `io-tools.ts` to keep the main tool definition module well under the 500-line ceiling.
 */

import * as fs from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import * as path from 'node:path'
import type { ToolContext } from '../../../types/index.js'
import { sendProgress } from '../../../utils/progress-utils.js'
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
    const lockedWsId = (hasExplicitWs ? trimmedWs : undefined) ?? dirMatch?.workspaceId ?? projectOwner
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
): Promise<{ parsedFiles: ParsedFile[]; errors: { file: string; error: string }[] }> {
    assertSafeDirectoryPath(sourceDir, allowedRoots)
    const mdFiles: string[] = []
    const dir = await fs.opendir(sourceDir)
    for await (const dirent of dir) {
        if (dirent.isFile() && dirent.name.endsWith('.md')) {
            mdFiles.push(dirent.name)
            if (mdFiles.length >= limit) break
        }
    }

    await sendProgress(progress, 1, 3, 'Converting external formats...')
    const parsedFiles: ParsedFile[] = []
    const errors: { file: string; error: string }[] = []

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

    return { parsedFiles, errors }
}
