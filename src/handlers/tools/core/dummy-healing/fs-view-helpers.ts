import * as fs from 'node:fs'

/** Maximum directory entries inspected by the `list_dir` dummy-healing fallback. */
export const MAX_LIST_DIR_ENTRIES = 10_000

/**
 * Slice line ranges requested by agent file-view shims (`start_line` / `end_line`).
 */
export function sliceViewedFileLines(content: string, rawArgs: Record<string, unknown>): string {
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
    if (startLine === undefined && endLine === undefined) return content
    const lines = content.split(/\r?\n/)
    const start = Math.max(1, startLine ?? 1) - 1
    const end = Math.min(lines.length, endLine ?? lines.length)
    return lines.slice(start, end).join('\n')
}

/**
 * Open a regular file read-only without following symlinks on POSIX hosts.
 */
export async function openSafeReadHandle(
    resolved: string
): Promise<fs.promises.FileHandle | undefined> {
    try {
        return await fs.promises.open(
            resolved,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
        )
    } catch {
        return undefined
    }
}

/**
 * Read a bounded regular file for dummy-healing `view_file` fallbacks.
 */
export async function readSafeViewFile(
    resolved: string,
    targetPath: string,
    toolName: string,
    rawArgs: Record<string, unknown>
): Promise<unknown> {
    const handle = await openSafeReadHandle(resolved)
    if (handle === undefined) {
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: File not found at '${targetPath}'.`,
            code: 'NOT_FOUND',
            category: 'filesystem',
            recoverable: true,
        }
    }
    try {
        const stat = await handle.stat()
        if (!stat.isFile()) {
            return {
                success: false,
                error: 'Refusing to read non-regular file',
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: false,
            }
        }
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
        return {
            success: true,
            path: resolved,
            content: sliceViewedFileLines(content, rawArgs),
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
        await Promise.resolve(handle.close()).catch(() => undefined)
    }
}

/**
 * List directory entries up to a bounded cap without materializing unbounded directories.
 */
export async function listBoundedDirectoryEntries(
    dirToRead: string,
    maxEntries = MAX_LIST_DIR_ENTRIES
): Promise<{ name: string; isDirectory: boolean; isFile: boolean }[]> {
    const dir = await fs.promises.opendir(dirToRead)
    const entries: { name: string; isDirectory: boolean; isFile: boolean }[] = []
    let scanned = 0
    try {
        for await (const d of dir) {
            if (++scanned > maxEntries) break
            entries.push({
                name: d.name,
                isDirectory: d.isDirectory(),
                isFile: d.isFile(),
            })
        }
    } finally {
        await dir.close().catch(() => {
            // Directory stream may already be closed after iteration.
        })
    }
    return entries
}
