/**
 * Filesystem directory search helpers used by the grep_search dummy-healing fallback.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../../../../utils/logger.js'

export interface GrepMatch {
    file: string
    line: number
    text: string
}

export interface SearchDirectoryOptions {
    filePattern?: string | undefined
    caseInsensitive?: boolean | undefined
    isRegex?: boolean | undefined
    maxResults?: number | undefined
}

const IGNORED_DIRS = new Set([
    'node_modules', '.git', '.test-output', 'dist', '.cache', 'coverage', '.turbo',
])

function buildMatcher(query: string, options: SearchDirectoryOptions): RegExp {
    const flags = options.caseInsensitive === true ? 'i' : ''
    try {
        if (options.isRegex === true) return new RegExp(query, flags)
        return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    } catch {
        return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    }
}

function matchesFilePattern(entryName: string, filePattern?: string): boolean {
    if (filePattern === undefined || filePattern.length === 0) return true
    const pattern = filePattern.toLowerCase()
    const name = entryName.toLowerCase()
    if (pattern.startsWith('*.')) return name.endsWith(pattern.slice(1))
    if (!pattern.includes('*')) return name === pattern
    const expression = `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
    return new RegExp(expression).test(name)
}

function scanContentLines(
    fullPath: string,
    content: string,
    matcher: RegExp,
    results: GrepMatch[],
    maxResults: number
): void {
    if (content.length > 2 * 1024 * 1024) return
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break
        const line = lines[i]
        if (typeof line === 'string' && matcher.test(line)) {
            results.push({ file: fullPath, line: i + 1, text: line.trimEnd() })
        }
    }
}

export async function searchDirectoryAsync(
    dir: string,
    query: string,
    options: SearchDirectoryOptions
): Promise<GrepMatch[]> {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const matcher = buildMatcher(query, options)

    async function traverse(currentDir: string): Promise<void> {
        if (results.length >= maxResults) return
        let entries: fs.Dirent[]
        try {
            entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
        } catch (err) {
            logger.debug('Skipping unreadable directory during search', {
                module: 'DirectorySearch',
                dir: currentDir,
                error: err instanceof Error ? err.message : String(err),
            })
            return
        }
        for (const entry of entries) {
            if (results.length >= maxResults) break
            if (entry.isSymbolicLink()) continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) await traverse(fullPath)
            } else if (entry.isFile() && matchesFilePattern(entry.name, options.filePattern)) {
                let handle: fs.promises.FileHandle | undefined
                try {
                    handle = await fs.promises.open(fullPath, fs.constants.O_RDONLY)
                    const stat = await handle.stat()
                    if (stat.size <= 2 * 1024 * 1024) {
                        const content = await handle.readFile('utf-8')
                        scanContentLines(fullPath, content, matcher, results, maxResults)
                    }
                } catch (err) {
                    logger.debug('Skipping unreadable or locked file during search', {
                        module: 'DirectorySearch',
                        file: fullPath,
                        error: err instanceof Error ? err.message : String(err),
                    })
                } finally {
                    await handle?.close()
                }
            }
        }
    }

    await traverse(dir)
    return results
}

export function searchDirectory(
    dir: string,
    query: string,
    options: SearchDirectoryOptions
): GrepMatch[] {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const matcher = buildMatcher(query, options)

    function traverse(currentDir: string): void {
        if (results.length >= maxResults) return
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true })
        } catch (err) {
            if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'ENOENT') {
                logger.debug('Skipping unreadable directory during search', {
                    module: 'DirectorySearch',
                    dir: currentDir,
                    error: err instanceof Error ? err.message : String(err),
                })
            }
            return
        }
        for (const entry of entries) {
            if (results.length >= maxResults) break
            if (entry.isSymbolicLink()) continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) traverse(fullPath)
            } else if (entry.isFile() && matchesFilePattern(entry.name, options.filePattern)) {
                let fd: number | undefined
                try {
                    fd = fs.openSync(fullPath, fs.constants.O_RDONLY)
                    const stat = fs.fstatSync(fd)
                    if (stat.size <= 2 * 1024 * 1024) {
                        const content = fs.readFileSync(fd, 'utf-8')
                        scanContentLines(fullPath, content, matcher, results, maxResults)
                    }
                } catch (err) {
                    logger.debug('Skipping unreadable or locked file during search', {
                        module: 'DirectorySearch',
                        file: fullPath,
                        error: err instanceof Error ? err.message : String(err),
                    })
                } finally {
                    if (fd !== undefined) fs.closeSync(fd)
                }
            }
        }
    }

    traverse(dir)
    return results
}
