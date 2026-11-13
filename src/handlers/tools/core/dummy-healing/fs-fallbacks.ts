import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../../types/index.js'
import { getSearchTools } from '../../search/index.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
    PathTraversalError,
} from '../../../../utils/security-utils.js'
import { ErrorFieldsMixin } from '../../error-fields-mixin.js'
import {
    DUMMY_GREP_SEARCH_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_DIR_LIST_TOOL_NAMES,
} from './alias-catalog.js'
import { handleReadResource } from './mcp-fallbacks.js'

const FLEXIBLE_PASSTHROUGH_SCHEMA = z.looseObject({ ...ErrorFieldsMixin.shape })

export { searchDirectory, searchDirectoryAsync } from './directory-search.js'
export type { GrepMatch, SearchDirectoryOptions } from './directory-search.js'
import { searchDirectoryAsync } from './directory-search.js'

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
        try {
            new RegExp(query)
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

    const allowedRoots = context?.config?.allowedIoRoots ?? []
    let searchPath = rawPath
    if (typeof searchPath === 'string' && searchPath.trim() !== '') {
        searchPath = path.resolve(searchPath.trim())
    }

    if (typeof searchPath === 'string') {
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
    }

    if (typeof searchPath === 'string') {
        let stat: fs.Stats | null
        try {
            stat = await fs.promises.stat(searchPath)
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
        if (stat !== null) {
            try {
                const targetDir = stat.isDirectory() ? searchPath : path.dirname(searchPath)
                if (stat.isFile()) assertSafeFilePath(searchPath, allowedRoots)
                const targetPattern =
                    stat.isFile() && filePattern === undefined ? path.basename(searchPath) : filePattern
                const matches = await searchDirectoryAsync(targetDir, query, {
                    filePattern: targetPattern,
                    caseInsensitive,
                    isRegex,
                })
                return {
                    success: true,
                    matches,
                    totalMatches: matches.length,
                    searchPath: targetDir,
                    _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. The search was performed on the filesystem and results returned successfully.`,
                }
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to execute grep search on '${searchPath}': ${err instanceof Error ? err.message : String(err)}`,
                    code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'SEARCH_ERROR',
                    category: err instanceof PathTraversalError ? 'validation' : 'search',
                    recoverable: !(err instanceof PathTraversalError),
                }
            }
        }
    }

    if (context !== undefined && query.trim() !== '') {
        const searchTools = getSearchTools(context)
        const searchTool = searchTools.find((t: ToolDefinition) => t.name === 'search_entries')
        if (searchTool !== undefined) {
            try {
                const wsArg = pickFirstString(rawArgs, ['workspace_id', 'workspaceId'])
                const projArg = rawArgs['project_number'] ?? rawArgs['projectNumber']
                const searchPayload: Record<string, unknown> = {
                    query,
                    ...(wsArg !== undefined ? { workspace_id: wsArg } : {}),
                    ...(projArg !== undefined ? { project_number: projArg } : {}),
                }
                const searchResult = await Promise.resolve(searchTool.handler(searchPayload))
                if (
                    typeof searchResult === 'object' &&
                    searchResult !== null &&
                    (searchResult as Record<string, unknown>)['success'] !== false
                ) {
                    return {
                        success: true,
                        ...(searchResult as Record<string, unknown>),
                        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked as an MCP tool without a local directory path. It was automatically routed to journal 'search_entries' and executed successfully.`,
                    }
                }
            } catch {
                // Fall through to empty matches
            }
        }
    }

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

    if (targetPath.includes('://')) return handleReadResource(params, toolName, context)

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

    let handle: fs.promises.FileHandle | undefined
    try {
        try {
            handle = await fs.promises.open(resolved, fs.constants.O_RDONLY)
        } catch {
            return {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: File not found at '${targetPath}'.`,
                code: 'NOT_FOUND',
                category: 'filesystem',
                recoverable: true,
            }
        }
        const stat = await handle.stat()
        if (stat.size > 2 * 1024 * 1024) {
            return {
                success: false,
                error: 'File exceeds maximum size limit of 2MB',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: false,
            }
        }
        const content = await handle.readFile('utf-8')
        const startLine =
            typeof rawArgs['start_line'] === 'number'
                ? rawArgs['start_line']
                : typeof rawArgs['StartLine'] === 'number'
                  ? rawArgs['StartLine']
                  : undefined
        const endLine =
            typeof rawArgs['end_line'] === 'number'
                ? rawArgs['end_line']
                : typeof rawArgs['EndLine'] === 'number'
                  ? rawArgs['EndLine']
                  : undefined

        let outputContent = content
        if (startLine !== undefined || endLine !== undefined) {
            const lines = content.split('\n')
            const start = Math.max(1, startLine ?? 1) - 1
            const end = Math.min(lines.length, endLine ?? lines.length)
            outputContent = lines.slice(start, end).join('\n')
        }

        return {
            success: true,
            path: resolved,
            content: outputContent,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. File read successfully from disk.`,
        }
    } catch (err) {
        return {
            success: false,
            error: `Failed to read file '${targetPath}': ${err instanceof Error ? err.message : String(err)}`,
            code: 'IO_ERROR',
            category: 'filesystem',
            recoverable: true,
        }
    } finally {
        await handle?.close()
    }
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

    const dirToRead =
        typeof targetDir === 'string' && targetDir.trim() !== ''
            ? path.resolve(targetDir.trim())
            : process.cwd()
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
    } catch {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: Directory not found at '${dirToRead}'.`,
            code: 'NOT_FOUND',
            category: 'filesystem',
            recoverable: true,
        }
    }

    try {
        const dirents = await fs.promises.readdir(dirToRead, { withFileTypes: true })
        const entries = dirents.map((d) => ({
            name: d.name,
            isDirectory: d.isDirectory(),
            isFile: d.isFile(),
        }))
        return {
            success: true,
            path: dirToRead,
            entries,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. Directory listed successfully from disk.`,
        }
    } catch (err) {
        return {
            success: false,
            error: `Failed to list directory '${dirToRead}': ${err instanceof Error ? err.message : String(err)}`,
            code: 'IO_ERROR',
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
