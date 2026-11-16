/**
 * Filesystem directory search helpers used by the grep_search dummy-healing fallback.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ValidationError } from '../../../../types/errors.js'
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

const MAX_USER_REGEX_LENGTH = 256
const NESTED_QUANTIFIER_REGEX = /(?:[+*?}]|\{\d+,?\d*\})\s*\)[+*?{]/
const BACKREFERENCE_REGEX = /\\[1-9]/

/** Reject over-long regexes, nested quantifiers (ReDoS), and backreferences. */
export function isSafeUserRegex(pattern: string): boolean {
    if (pattern.length > MAX_USER_REGEX_LENGTH) return false
    if (NESTED_QUANTIFIER_REGEX.test(pattern)) return false
    if (BACKREFERENCE_REGEX.test(pattern)) return false
    return true
}

function buildMatcher(query: string, options: SearchDirectoryOptions): RegExp {
    const flags = options.caseInsensitive === true ? 'i' : ''
    if (options.isRegex === true) {
        if (!isSafeUserRegex(query)) {
            throw new ValidationError(
                `Unsafe regex pattern '${query}': max ${String(MAX_USER_REGEX_LENGTH)} chars, no nested quantifiers or backreferences.`
            )
        }
        try {
            return new RegExp(query, flags)
        } catch (err) {
            throw new ValidationError(
                `Invalid regex pattern '${query}': ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }
    return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}

function compileFilePatternMatcher(filePattern?: string): ((entryName: string) => boolean) | null {
    if (filePattern === undefined || filePattern.length === 0) return null
    const pattern = filePattern.toLowerCase().replace(/\*{2,}/g, '*')
    if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) {
        const suffix = pattern.slice(1)
        return (entryName: string) => entryName.toLowerCase().endsWith(suffix)
    }
    if (!pattern.includes('*')) {
        return (entryName: string) => entryName.toLowerCase() === pattern
    }
    const expression = `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
    const compiled = new RegExp(expression)
    return (entryName: string) => compiled.test(entryName.toLowerCase())
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

/** Search a single regular file without traversing any parent or sibling directory. */
export async function searchSingleFileAsync(
    filePath: string,
    query: string,
    options: SearchDirectoryOptions
): Promise<GrepMatch[]> {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const matcher = buildMatcher(query, options)
    const fileMatcher = compileFilePatternMatcher(options.filePattern)
    if (fileMatcher !== null && !fileMatcher(path.basename(filePath))) {
        return results
    }
    let handle: fs.promises.FileHandle | undefined
    try {
        handle = await fs.promises.open(
            filePath,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
        )
        const stat = await handle.stat()
        if (stat.isFile() && stat.size <= 2 * 1024 * 1024) {
            const content = await handle.readFile('utf-8')
            scanContentLines(filePath, content, matcher, results, maxResults)
        }
    } finally {
        await handle?.close()
    }
    return results
}

export async function searchDirectoryAsync(
    dir: string,
    query: string,
    options: SearchDirectoryOptions
): Promise<GrepMatch[]> {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const matcher = buildMatcher(query, options)
    const fileMatcher = compileFilePatternMatcher(options.filePattern)

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
            } else if (entry.isFile() && (fileMatcher === null || fileMatcher(entry.name))) {
                let handle: fs.promises.FileHandle | undefined
                try {
                    handle = await fs.promises.open(
                        fullPath,
                        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
                    )
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
    const fileMatcher = compileFilePatternMatcher(options.filePattern)

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
            } else if (entry.isFile() && (fileMatcher === null || fileMatcher(entry.name))) {
                let fd: number | undefined
                try {
                    fd = fs.openSync(
                        fullPath,
                        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
                    )
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
