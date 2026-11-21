/**
 * Filesystem directory search helpers used by the grep_search dummy-healing fallback.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { ValidationError } from '../../../../types/errors.js'
import { logger } from '../../../../utils/logger.js'
import { isSafeUserRegex, MAX_USER_REGEX_LENGTH } from './regex-safety.js'

export { isSafeUserRegex }

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

const MAX_REGEX_LINE_LENGTH = 4096
const MAX_FILE_PATTERN_WILDCARDS = 8
const MAX_SEARCH_DIRENTS = 10_000
const MAX_SEARCH_FILES = 1_000
const MAX_SEARCH_DEPTH = 16

function buildMatcher(query: string, options: SearchDirectoryOptions): RegExp {
    const flags = options.caseInsensitive === true ? 'i' : ''
    if (options.isRegex === true) {
        if (!isSafeUserRegex(query)) {
            throw new ValidationError(
                `Unsafe regex pattern '${query}': max ${String(MAX_USER_REGEX_LENGTH)} chars, no nested quantifiers, repeated wildcards, or backreferences.`
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

function matchesWildcardPattern(text: string, pattern: string): boolean {
    let ti = 0
    let pi = 0
    let starIdx = -1
    let matchIdx = 0

    while (ti < text.length) {
        if (pi < pattern.length && pattern[pi] === text[ti]) {
            ti++
            pi++
        } else if (pi < pattern.length && pattern[pi] === '*') {
            starIdx = pi
            matchIdx = ti
            pi++
        } else if (starIdx !== -1) {
            pi = starIdx + 1
            matchIdx++
            ti = matchIdx
        } else {
            return false
        }
    }

    while (pi < pattern.length && pattern[pi] === '*') {
        pi++
    }
    return pi === pattern.length
}

function compileFilePatternMatcher(filePattern?: string): ((entryName: string) => boolean) | null {
    if (filePattern === undefined || filePattern.length === 0) return null
    if (filePattern.length > MAX_USER_REGEX_LENGTH) {
        throw new ValidationError(
            `filePattern exceeds maximum length of ${String(MAX_USER_REGEX_LENGTH)} characters.`
        )
    }
    const pattern = filePattern.toLowerCase().replace(/\*{2,}/g, '*')
    const wildcardCount = pattern.split('*').length - 1
    if (wildcardCount > MAX_FILE_PATTERN_WILDCARDS) {
        throw new ValidationError(
            `filePattern exceeds maximum wildcard count of ${String(MAX_FILE_PATTERN_WILDCARDS)}.`
        )
    }
    if (pattern.startsWith('*.') && !pattern.slice(2).includes('*')) {
        const suffix = pattern.slice(1)
        return (entryName: string) => entryName.toLowerCase().endsWith(suffix)
    }
    if (!pattern.includes('*')) {
        return (entryName: string) => entryName.toLowerCase() === pattern
    }
    return (entryName: string) => matchesWildcardPattern(entryName.toLowerCase(), pattern)
}

function scanContentLines(
    fullPath: string,
    content: string,
    matcher: RegExp,
    results: GrepMatch[],
    maxResults: number,
    isRegex = false
): void {
    if (content.length > 2 * 1024 * 1024) return
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
        if (results.length >= maxResults) break
        const line = lines[i]
        if (typeof line !== 'string') continue
        const targetLine = isRegex && line.length > MAX_REGEX_LINE_LENGTH ? line.slice(0, MAX_REGEX_LINE_LENGTH) : line
        if (matcher.test(targetLine)) {
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
    const isRegex = options.isRegex === true
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
            scanContentLines(filePath, content, matcher, results, maxResults, isRegex)
        }
    } finally {
        if (handle !== undefined) await Promise.resolve(handle.close()).catch(() => undefined)
    }
    return results
}

async function readAndScanFileAsync(
    fullPath: string,
    matcher: RegExp,
    results: GrepMatch[],
    maxResults: number,
    isRegex: boolean
): Promise<void> {
    let handle: fs.promises.FileHandle | undefined
    try {
        handle = await fs.promises.open(
            fullPath,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
        )
        const stat = await handle.stat()
        if (stat.isFile() && stat.size <= 2 * 1024 * 1024) {
            const content = await handle.readFile('utf-8')
            scanContentLines(fullPath, content, matcher, results, maxResults, isRegex)
        }
    } catch (err) {
        logger.debug('Skipping unreadable or locked file during search', {
            module: 'DirectorySearch',
            file: fullPath,
            error: err instanceof Error ? err.message : String(err),
        })
    } finally {
        if (handle !== undefined) await Promise.resolve(handle.close()).catch(() => undefined)
    }
}

export async function searchDirectoryAsync(
    dir: string,
    query: string,
    options: SearchDirectoryOptions
): Promise<GrepMatch[]> {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const isRegex = options.isRegex === true
    const matcher = buildMatcher(query, options)
    const fileMatcher = compileFilePatternMatcher(options.filePattern)
    const state = { dirents: 0, files: 0 }

    async function traverse(currentDir: string, depth: number): Promise<void> {
        if (
            depth > MAX_SEARCH_DEPTH ||
            results.length >= maxResults ||
            state.dirents >= MAX_SEARCH_DIRENTS ||
            state.files >= MAX_SEARCH_FILES
        ) {
            return
        }
        let dirHandle: fs.Dir
        try {
            dirHandle = await fs.promises.opendir(currentDir)
        } catch (err) {
            logger.debug('Skipping unreadable directory during search', {
                module: 'DirectorySearch',
                dir: currentDir,
                error: err instanceof Error ? err.message : String(err),
            })
            return
        }
        const subdirs: string[] = []
        for await (const entry of dirHandle) {
            if (
                ++state.dirents > MAX_SEARCH_DIRENTS ||
                state.files >= MAX_SEARCH_FILES ||
                results.length >= maxResults
            ) {
                break
            }
            if (entry.isSymbolicLink()) continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) subdirs.push(fullPath)
            } else if (entry.isFile() && (fileMatcher === null || fileMatcher(entry.name))) {
                if (++state.files > MAX_SEARCH_FILES) break
                await readAndScanFileAsync(fullPath, matcher, results, maxResults, isRegex)
            }
        }
        for (const sub of subdirs) {
            if (results.length >= maxResults || state.dirents >= MAX_SEARCH_DIRENTS || state.files >= MAX_SEARCH_FILES) {
                break
            }
            await traverse(sub, depth + 1)
        }
    }

    await traverse(dir, 0)
    return results
}

function readAndScanFileSync(
    fullPath: string,
    matcher: RegExp,
    results: GrepMatch[],
    maxResults: number,
    isRegex: boolean
): void {
    let fd: number | undefined
    try {
        fd = fs.openSync(fullPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
        const stat = fs.fstatSync(fd)
        if (stat.isFile() && stat.size <= 2 * 1024 * 1024) {
            const content = fs.readFileSync(fd, 'utf-8')
            scanContentLines(fullPath, content, matcher, results, maxResults, isRegex)
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

export function searchDirectory(
    dir: string,
    query: string,
    options: SearchDirectoryOptions
): GrepMatch[] {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500
    const isRegex = options.isRegex === true
    const matcher = buildMatcher(query, options)
    const fileMatcher = compileFilePatternMatcher(options.filePattern)
    const state = { dirents: 0, files: 0 }

    function traverse(currentDir: string, depth: number): void {
        if (
            depth > MAX_SEARCH_DEPTH ||
            results.length >= maxResults ||
            state.dirents >= MAX_SEARCH_DIRENTS ||
            state.files >= MAX_SEARCH_FILES
        ) {
            return
        }
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
            if (
                ++state.dirents > MAX_SEARCH_DIRENTS ||
                state.files >= MAX_SEARCH_FILES ||
                results.length >= maxResults
            ) {
                break
            }
            if (entry.isSymbolicLink()) continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) traverse(fullPath, depth + 1)
            } else if (entry.isFile() && (fileMatcher === null || fileMatcher(entry.name))) {
                if (++state.files > MAX_SEARCH_FILES) break
                readAndScanFileSync(fullPath, matcher, results, maxResults, isRegex)
            }
        }
    }

    traverse(dir, 0)
    return results
}
