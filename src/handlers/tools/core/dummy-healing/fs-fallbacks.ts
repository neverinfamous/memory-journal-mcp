import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getSearchTools } from '../../search/index.js'
import { findCachedOrFallbackTool } from './cached-tool-lookup.js'
import { assertSafeDirectoryPath, assertSafeFilePath, PathTraversalError } from '../../../../utils/security-utils.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import {
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
} from './alias-catalog.js'
import { tryHandleResourceUriFallback } from './mcp-fallbacks.js'

const FLEXIBLE_PASSTHROUGH_SCHEMA = z.looseObject({ ...ErrorFieldsMixin.shape })

export { searchDirectory, searchDirectoryAsync } from './directory-search.js'
export type { GrepMatch, SearchDirectoryOptions } from './directory-search.js'
import { isSafeUserRegex, searchDirectoryAsync, searchSingleFileAsync } from './directory-search.js'
import { listBoundedDirectoryEntries, readSafeViewFile } from './fs-view-helpers.js'
import { ValidationError } from '../../../../types/errors.js'
import { logger } from '../../../../utils/logger.js'

function normalizeStrippedArgs(params: unknown): Record<string, unknown> {
    const raw =
        typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const rawArgs: Record<string, unknown> = { ...raw }
    for (const [k, v] of Object.entries(raw)) {
        const stripped = k.replace(/^_+/, '')
        if (stripped.length > 0 && rawArgs[stripped] === undefined) rawArgs[stripped] = v
    }
    return rawArgs
}

function pickFirstString(rawArgs: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const val = rawArgs[key]
        if (typeof val === 'string') return val
    }
    return undefined
}

async function runFilesystemGrepSearch(
    searchPath: string,
    toolName: string,
    query: string,
    filePattern: string | undefined,
    caseInsensitive: boolean,
    isRegex: boolean,
    allowedRoots: string[]
): Promise<unknown> {
    let stat: fs.Stats | null
    try {
        stat = await fs.promises.lstat(searchPath)
    } catch {
        stat = null
    }
    // [INVARIANT] M5: an explicit-but-missing search_path is an error, not a silent reroute.
    if (stat === null) {
        return {
            success: false,
            error: `Search path not found: '${searchPath}'`,
            code: 'RESOURCE_NOT_FOUND',
            category: 'resource',
            recoverable: true,
            matches: [],
            totalMatches: 0,
            suggestion: "Provide an existing 'search_path', or use 'search_entries' for journal search.",
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was not executed because the explicit search_path does not exist.`,
        }
    }
    try {
        let matches
        if (stat.isFile()) {
            assertSafeFilePath(searchPath, allowedRoots)
            matches = await searchSingleFileAsync(searchPath, query, {
                filePattern,
                caseInsensitive,
                isRegex,
            })
        } else {
            assertSafeDirectoryPath(searchPath, allowedRoots)
            matches = await searchDirectoryAsync(searchPath, query, {
                filePattern,
                caseInsensitive,
                isRegex,
            })
        }
        return {
            success: true,
            matches,
            totalMatches: matches.length,
            searchPath,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. The search was performed on the filesystem and results returned successfully.`,
        }
    } catch (err) {
        const isValidation = err instanceof ValidationError || err instanceof PathTraversalError
        return {
            success: false,
            error: `Failed to execute grep search on '${searchPath}': ${err instanceof Error ? err.message : String(err)}`,
            code:
                err instanceof PathTraversalError
                    ? 'PATH_TRAVERSAL'
                    : err instanceof ValidationError
                      ? 'VALIDATION_ERROR'
                      : 'SEARCH_ERROR',
            category: isValidation ? 'validation' : 'search',
            recoverable: err instanceof ValidationError,
        }
    }
}

async function tryJournalSearchFallback(
    context: ToolContext | undefined,
    rawArgs: Record<string, unknown>,
    toolName: string,
    query: string
): Promise<unknown> {
    if (context === undefined || query.trim() === '') return undefined
    const filterConfig = context.config?.filterConfig
    if (
        filterConfig !== null &&
        filterConfig !== undefined &&
        !filterConfig.enabledTools.has('search_entries')
    ) {
        return undefined
    }
    const searchTool = findCachedOrFallbackTool(context, 'search_entries', getSearchTools)
    if (searchTool === undefined) return undefined
    try {
        const wsArg = pickFirstString(rawArgs, ['workspace_id', 'workspaceId'])
        const projArg = rawArgs['project_number'] ?? rawArgs['projectNumber']
        const searchPayload: Record<string, unknown> = {
            query,
            ...(wsArg !== undefined ? { workspace_id: wsArg } : {}),
            ...(projArg !== undefined ? { project_number: projArg } : {}),
        }
        const searchResult = await Promise.resolve(searchTool.handler(searchPayload))
        if (typeof searchResult !== 'object' || searchResult === null) return undefined
        const searchRecord = searchResult as Record<string, unknown>
        if (searchRecord['success'] === false) return searchResult
        return {
            success: true,
            ...searchRecord,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked as an MCP tool without a local directory path. It was automatically routed to journal 'search_entries' and executed successfully.`,
        }
    } catch (err) {
        logger.debug('Dummy fs-fallback search_entries routing failed', {
            module: 'dummy-healing',
            toolName,
            error: err instanceof Error ? err.message : String(err),
        })
        return undefined
    }
}

function validateGrepRegexQuery(query: string): Record<string, unknown> | undefined {
    if (!isSafeUserRegex(query)) {
        return {
            success: false,
            error: 'Regex query rejected: pattern exceeds length limit (256) or contains unsafe constructs (nested quantifiers / backreferences)',
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
    try {
        new RegExp(query)
        return undefined
    } catch (err) {
        return {
            success: false,
            error: `Invalid regex pattern '${query}': ${err instanceof Error ? err.message : String(err)}`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
}

export async function handleGrepSearch(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs = normalizeStrippedArgs(params)
    const query = pickFirstString(rawArgs, ['query', 'Query', 'pattern', 'text', 'search', 'q']) ?? ''
    const rawPath = pickFirstString(rawArgs, [
        'search_path', 'SearchPath', 'searchPath', 'path', 'Path', 'dir', 'directory', 'cwd',
    ])
    const filePattern = pickFirstString(rawArgs, ['file_pattern', 'FilePattern', 'filePattern'])

    const caseInsensitive =
        rawArgs['case_insensitive'] === true ||
        rawArgs['CaseInsensitive'] === true ||
        rawArgs['caseInsensitive'] === true ||
        rawArgs['ignore_case'] === true
    const isRegex =
        rawArgs['is_regex'] === true || rawArgs['IsRegex'] === true || rawArgs['isRegex'] === true

    if (isRegex) {
        const regexError = validateGrepRegexQuery(query)
        if (regexError !== undefined) return regexError
    }

    const allowedRoots = context?.config?.allowedIoRoots ?? []
    const trimmedRawPath = typeof rawPath === 'string' ? rawPath.trim() : ''
    const searchPath = trimmedRawPath !== '' ? path.resolve(trimmedRawPath) : undefined

    if (searchPath !== undefined) {
        try {
            assertSafeDirectoryPath(searchPath, allowedRoots)
        } catch (err) {
            return {
                success: false,
                error: `Failed to execute grep search on '${searchPath}': ${err instanceof Error ? err.message : String(err)}`,
                code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'SEARCH_ERROR',
                category: err instanceof PathTraversalError ? 'validation' : 'search',
                recoverable: false,
            }
        }
        return await runFilesystemGrepSearch(
            searchPath,
            toolName,
            query,
            filePattern,
            caseInsensitive,
            isRegex,
            allowedRoots
        )
    }

    const fallbackResult = await tryJournalSearchFallback(context, rawArgs, toolName, query)
    if (fallbackResult !== undefined) return fallbackResult

    return {
        success: false,
        matches: [],
        totalMatches: 0,
        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was executed, but directory was not found or yielded 0 matches. For codebase search, provide a valid 'search_path'. For journal search, use 'search_entries'.`,
    }
}

export async function handleViewFile(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs = normalizeStrippedArgs(params)
    const targetPath = pickFirstString(rawArgs, [
        'path', 'Path', 'target_file', 'targetFile', 'target', 'Target',
        'absolute_path', 'AbsolutePath', 'file', 'File', 'filename', 'fileName',
    ])

    if (targetPath === undefined || targetPath.trim() === '') {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' requires a valid file path parameter ('path' or 'AbsolutePath').`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
    const uriRoute = await tryHandleResourceUriFallback(targetPath, rawArgs, toolName, context)
    if (uriRoute.handled) return uriRoute.result

    const resolved = path.resolve(targetPath.trim())
    const allowedRoots = context?.config?.allowedIoRoots ?? []
    try {
        assertSafeFilePath(resolved, allowedRoots)
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: false,
        }
    }
    return await readSafeViewFile(resolved, targetPath, toolName, rawArgs)
}

export async function handleListDir(
    params: unknown,
    toolName: string,
    context?: ToolContext
): Promise<unknown> {
    const rawArgs = normalizeStrippedArgs(params)
    const targetDir = pickFirstString(rawArgs, [
        'dir_path', 'dirPath', 'path', 'Path', 'directory', 'Directory', 'target', 'Target',
    ])
    if (targetDir === undefined && Object.keys(rawArgs).length > 0) {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' requires a directory path parameter ('dir_path' or 'path') when arguments are provided.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true,
        }
    }
    if (targetDir?.trim() === '') {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' requires a non-empty directory path for 'dir_path' or 'path'.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: false,
        }
    }

    const dirToRead = targetDir !== undefined ? path.resolve(targetDir.trim()) : process.cwd()
    const allowedRoots = context?.config?.allowedIoRoots ?? []
    try {
        assertSafeDirectoryPath(dirToRead, allowedRoots)
    } catch (err) {
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: false,
        }
    }

    try {
        await fs.promises.stat(dirToRead)
        const entries = await listBoundedDirectoryEntries(dirToRead)
        return {
            success: true,
            path: dirToRead,
            entries,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. Directory listed successfully from disk.`,
        }
    } catch (err) {
        const notFound = typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
        return {
            success: false,
            error: notFound ? `🛠️ AUTONOMOUS HEALING: Directory not found at '${dirToRead}'.` : `Failed to list directory '${dirToRead}': ${err instanceof Error ? err.message : String(err)}`,
            code: notFound ? 'NOT_FOUND' : 'IO_ERROR',
            category: 'filesystem',
            recoverable: true,
        }
    }
}

function makeFsFallbackList(
    names: string[],
    titlePrefix: string,
    descriptionSuffix: string,
    group: 'core' | 'search',
    fn: (params: unknown, name: string, context?: ToolContext) => Promise<unknown>,
    context?: ToolContext
): ToolDefinition[] {
    return names.map((name) => ({
        name,
        title: `${titlePrefix} (${name})`,
        description: `Fallback handler for \`${name}\` when called directly as an MCP tool. ${descriptionSuffix}`,
        group,
        inputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
        outputSchema: FLEXIBLE_PASSTHROUGH_SCHEMA,
        annotations: { readOnlyHint: true, openWorldHint: false },
        handler: async (params: unknown) => fn(params, name, context),
    }))
}

export function getFsFallbackToolDefinitions(context?: ToolContext): ToolDefinition[] {
    return [
        ...makeFsFallbackList(DUMMY_GREP_SEARCH_TOOL_NAMES, 'Grep Search Fallback', 'Performs filesystem search or routes to journal search.', 'search', handleGrepSearch, context),
        ...makeFsFallbackList(DUMMY_FILE_VIEW_TOOL_NAMES, 'View File Fallback', 'Reads file content from disk.', 'core', handleViewFile, context),
        ...makeFsFallbackList(DUMMY_DIR_LIST_TOOL_NAMES, 'List Directory Fallback', 'Lists directory entries from disk.', 'core', handleListDir, context),
    ]
}
