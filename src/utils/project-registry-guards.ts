import fs from 'node:fs'
import path from 'node:path'
import { assertSafeDirectoryPath } from './security-utils.js'

const FORBIDDEN_PROJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const SYSTEM_DIR_EXACT = new Set([
    '/usr',
    '/bin',
    '/sbin',
    '/var/run',
    '/etc',
    '/proc',
    '/sys',
    '/dev',
    'c:/windows',
])

const SYSTEM_DIR_PREFIXES = ['/etc/', '/proc/', '/sys/', '/dev/', 'c:/windows/']

/** Return true when a workspace/registry key is empty, wildcard, or a prototype pollution key. */
export function isForbiddenProjectKey(key: string): boolean {
    const trimmed = key.trim()
    return trimmed === '' || trimmed === '*' || FORBIDDEN_PROJECT_KEYS.has(trimmed)
}

function isSystemOrRootDirectory(rawInput: string, resolvedPath: string): boolean {
    const parsedRoot = path.parse(resolvedPath).root.replace(/[\\/]+$/, '').toLowerCase()
    const resolvedFolded = resolvedPath.replace(/[\\/]+$/, '').toLowerCase()
    if (resolvedFolded === '' || resolvedFolded === parsedRoot) {
        return true
    }

    const forwardResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const forwardRaw = path.posix.normalize(rawInput.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase()
    const driveStripped = forwardResolved.replace(/^[a-z]:/, '')

    for (const candidate of [forwardResolved, forwardRaw, driveStripped]) {
        if (candidate === '' || SYSTEM_DIR_EXACT.has(candidate)) {
            return true
        }
        if (SYSTEM_DIR_PREFIXES.some((prefix) => candidate.startsWith(prefix))) {
            return true
        }
    }
    return false
}

function hasUnsafeExistingAncestor(resolvedPath: string): boolean {
    let current = resolvedPath
    let checkedDeepestExisting = false
    while (true) {
        try {
            const stat = fs.lstatSync(current)
            if (stat.isSymbolicLink()) return true
            if (!checkedDeepestExisting) {
                checkedDeepestExisting = true
                if (!stat.isDirectory()) return true
            }
        } catch (err: unknown) {
            if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
                return true
            }
        }
        const parent = path.dirname(current)
        if (parent === current) {
            return false
        }
        current = parent
    }
}

/**
 * Validate a project directory path: rejects relative paths, UNC shares, traversal segments,
 * filesystem roots, OS system directories, symlinks/non-directory ancestors, and `allowedRoots` escapes.
 */
export function isValidProjectPath(p: string, allowedRoots?: string[]): boolean {
    if (p === '' || p.includes('\0') || p.startsWith('\\\\') || p.startsWith('//')) {
        return false
    }
    const slashSplit = p.replace(/\\/g, '/').split('/')
    const normalizedSplit = path.normalize(p).split(path.sep)
    if (slashSplit.includes('..') || normalizedSplit.includes('..')) {
        return false
    }
    if (!path.isAbsolute(p)) {
        return false
    }

    const resolved = path.resolve(p)
    if (isSystemOrRootDirectory(p, resolved)) {
        return false
    }
    if (hasUnsafeExistingAncestor(resolved)) {
        return false
    }

    if (allowedRoots !== undefined) {
        try {
            assertSafeDirectoryPath(p, allowedRoots)
        } catch {
            return false
        }
    }
    return true
}

/**
 * Return an existing registry key that collides case-insensitively with `candidateName`
 * (excluding `ignoreExactKey` when updating an entry in place).
 */
export function findCaseInsensitiveKeyConflict(
    registry: Record<string, { path?: string; project_number?: number } | undefined>,
    candidateName: string,
    ignoreExactKey?: string
): string | undefined {
    const lowerCandidate = candidateName.trim().toLowerCase()
    for (const key of Object.keys(registry)) {
        if (key === ignoreExactKey) continue
        if (key.trim().toLowerCase() === lowerCandidate) {
            return key
        }
    }
    return undefined
}

/**
 * Return the key of another registered project already using `projectNumber`
 * (excluding any keys in `ignoreKeys`).
 */
export function findProjectNumberConflict(
    registry: Record<string, { path?: string; project_number?: number } | undefined>,
    projectNumber: number,
    ignoreKeys: readonly string[] = []
): string | undefined {
    const ignored = new Set(ignoreKeys.map((k) => k.trim().toLowerCase()))
    for (const [key, entry] of Object.entries(registry)) {
        if (entry === undefined) continue
        if (ignored.has(key.trim().toLowerCase())) continue
        if (entry.project_number === projectNumber) {
            return key
        }
    }
    return undefined
}
