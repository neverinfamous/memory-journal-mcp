import fs from 'node:fs'
import path from 'node:path'
import {
    hasTrailingDotOrSpaceSegment,
    hasUnsafeAdsColon,
    hasWinReservedDeviceSegment,
} from './path-safety.js'
import { assertSafeDirectoryPath } from './security-utils.js'

const FORBIDDEN_PROJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const WIN_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/
const ENCODED_TRAVERSAL_RE = /%(?:2f|5c|2e|00)/i

const SYSTEM_DIR_EXACT = new Set([
    '/usr',
    '/bin',
    '/sbin',
    '/var/run',
    '/etc',
    '/proc',
    '/sys',
    '/dev',
    '/windows',
    'c:/windows',
])

const SYSTEM_DIR_PREFIXES = ['/etc/', '/proc/', '/sys/', '/dev/', '/windows/', 'c:/windows/']

/** Return true when a workspace/registry key is empty, wildcard, or a prototype pollution key. */
export function isForbiddenProjectKey(key: string): boolean {
    const trimmed = key.trim()
    return trimmed === '' || trimmed === '*' || FORBIDDEN_PROJECT_KEYS.has(trimmed)
}

function selectPathModule(rawPath: string): typeof path {
    return WIN_DRIVE_PATH_RE.test(rawPath) ? path.win32 : path
}

function isSystemOrRootDirectory(
    rawInput: string,
    resolvedPath: string,
    pathMod: typeof path
): boolean {
    const parsedRoot = pathMod.parse(resolvedPath).root.replace(/[\\/]+$/, '').toLowerCase()
    const resolvedFolded = resolvedPath.replace(/[\\/]+$/, '').toLowerCase()
    if (resolvedFolded === '' || resolvedFolded === parsedRoot) {
        return true
    }

    const forwardResolved = resolvedPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const forwardRaw = path.posix.normalize(rawInput.replace(/\\/g, '/')).replace(/\/+$/, '').toLowerCase()
    const driveStripped = forwardResolved.replace(/^[a-z]:/, '')

    for (const candidate of [forwardResolved, forwardRaw, driveStripped]) {
        const trimmedSegs = candidate
            .split('/')
            .map((s, i) => (i === 0 && /^[a-z]:$/.test(s) ? s : s.replace(/[. ]+$/, '')))
            .join('/')
        for (const variant of trimmedSegs !== candidate ? [candidate, trimmedSegs] : [candidate]) {
            if (variant === '' || SYSTEM_DIR_EXACT.has(variant)) {
                return true
            }
            if (SYSTEM_DIR_PREFIXES.some((prefix) => variant.startsWith(prefix))) {
                return true
            }
        }
    }
    return false
}

function hasUnsafeExistingAncestor(
    resolvedPath: string,
    pathMod: typeof path
): boolean {
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
        const parent = pathMod.dirname(current)
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
    if (p === '' || p.includes('\0') || /^[\\/]{2}/.test(p.trimStart())) {
        return false
    }
    if (
        ENCODED_TRAVERSAL_RE.test(p) ||
        hasUnsafeAdsColon(p) ||
        hasWinReservedDeviceSegment(p) ||
        hasTrailingDotOrSpaceSegment(p)
    ) {
        return false
    }
    const pathMod = selectPathModule(p)
    const slashSplit = p.replace(/\\/g, '/').split('/')
    const normalizedSplit = pathMod.normalize(p).split(pathMod.sep)
    if (slashSplit.includes('..') || normalizedSplit.includes('..')) {
        return false
    }
    if (!pathMod.isAbsolute(p)) {
        return false
    }

    const resolved = pathMod.resolve(p)
    if (isSystemOrRootDirectory(p, resolved, pathMod) || hasUnsafeExistingAncestor(resolved, pathMod)) {
        return false
    }

    let decoded: string
    try {
        decoded = decodeURIComponent(p)
    } catch {
        return false
    }
    if (decoded !== p) {
        if (
            decoded.includes('\0') ||
            /^[\\/]{2}/.test(decoded.trimStart()) ||
            hasUnsafeAdsColon(decoded) ||
            hasWinReservedDeviceSegment(decoded) ||
            hasTrailingDotOrSpaceSegment(decoded) ||
            decoded.replace(/\\/g, '/').split('/').includes('..')
        ) {
            return false
        }
        const decodedPathMod = selectPathModule(decoded)
        if (decodedPathMod.normalize(decoded).split(decodedPathMod.sep).includes('..')) {
            return false
        }
        const decodedResolved = decodedPathMod.resolve(decoded)
        if (
            isSystemOrRootDirectory(decoded, decodedResolved, decodedPathMod) ||
            hasUnsafeExistingAncestor(decodedResolved, decodedPathMod)
        ) {
            return false
        }
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
