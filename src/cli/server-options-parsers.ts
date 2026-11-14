import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import type { ProjectRegistryEntry } from '../types/index.js'

/**
 * Pure parsers/validators for structured server options (project registry, additional team DBs,
 * allowed IO roots). Extracted from buildServerOptions; each throws a descriptive Error on invalid input.
 */

function isNodeErrorCode(err: unknown, code: string): boolean {
    if (typeof err !== 'object' || err === null || !('code' in err)) return false
    return err.code === code
}

/**
 * Reject symlink team-db paths. A missing path is allowed so a database
 * file can be created later. Every other lstat failure propagates.
 */
export function assertAdditionalTeamDbIsNotSymlink(
    resolvedPath: string,
    lstat: (targetPath: string) => { isSymbolicLink: () => boolean }
): void {
    let stat: { isSymbolicLink: () => boolean }
    try {
        stat = lstat(resolvedPath)
    } catch (err: unknown) {
        if (isNodeErrorCode(err, 'ENOENT')) return
        throw err
    }
    if (stat.isSymbolicLink()) {
        throw new Error(`Additional team DB path cannot be a symlink: ${resolvedPath}`)
    }
}

/** Validate and normalise a project registry object without mutating process.env. */
export function validateProjectRegistryObject(
    raw: unknown
): Record<string, ProjectRegistryEntry> | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined
    if (typeof raw === 'string' && raw.length > 51200) throw new Error('PROJECT_REGISTRY environment variable exceeds size limit (50KB)')
    try {
        const registrySchema = z.record(z.string(), z.object({ path: z.string().min(1), project_number: z.number().nullable().optional() }).strict())
        const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
        const safeParsed = JSON.parse(JSON.stringify(parsed)) as unknown // Deep clean
        const validated = registrySchema.parse(safeParsed) as Record<string, ProjectRegistryEntry>
        for (const key of Object.keys(validated)) {
            const entry = validated[key]
            if (!entry?.path) continue
            if (!path.isAbsolute(entry.path)) throw new Error(`Project registry path must be an absolute path: ${entry.path}`)
            const resolvedPath = path.resolve(entry.path)
            try {
                const stat = fs.lstatSync(resolvedPath)
                if (stat.isSymbolicLink()) throw new Error(`Project registry path cannot be a symlink: ${resolvedPath}`)
                if (!stat.isDirectory()) throw new Error(`Project registry path is not a directory: ${resolvedPath}`)
            } catch (e) {
                if (!isNodeErrorCode(e, 'ENOENT')) {
                    throw new Error(`Project registry path error: ${resolvedPath}`, { cause: e })
                }
            }
            entry.path = resolvedPath
        }
        return validated
    } catch (e: unknown) {
        throw new Error(`Failed to parse PROJECT_REGISTRY: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
}

/** Validate and normalise PROJECT_REGISTRY; also mirrors the validated value into process.env. */
export function parseProjectRegistryOption(
    raw: unknown
): Record<string, ProjectRegistryEntry> | undefined {
    const validated = validateProjectRegistryObject(raw)
    if (validated !== undefined) {
        process.env['PROJECT_REGISTRY'] = JSON.stringify(validated)
    }
    return validated
}

/** Validate ADDITIONAL_TEAM_DBS (label -> absolute path, no symlinks). */
export function parseAdditionalTeamDbsOption(raw: unknown): Record<string, string> | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined
    if (typeof raw === 'string' && raw.length > 51200) throw new Error('ADDITIONAL_TEAM_DBS exceeds size limit')
    try {
        const dbSchema = z.record(z.string().min(1), z.string().min(1))
        const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
        const validated = dbSchema.parse(JSON.parse(JSON.stringify(parsed)) as unknown)
        for (const [label, dbPath] of Object.entries(validated)) {
            if (!path.isAbsolute(dbPath)) throw new Error(`Additional team DB path must be absolute: ${dbPath}`)
            const resolvedPath = path.resolve(dbPath)
            assertAdditionalTeamDbIsNotSymlink(resolvedPath, (targetPath) => fs.lstatSync(targetPath))
            validated[label] = resolvedPath
        }
        return validated
    } catch (e) {
        throw new Error(`Failed to parse ADDITIONAL_TEAM_DBS: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
}

/** Validate ALLOWED_IO_ROOTS (JSON array or comma-separated list of absolute paths). */
export function parseAllowedIoRootsOption(raw: unknown): string[] | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined
    if (typeof raw === 'string' && raw.length > 51200) throw new Error('ALLOWED_IO_ROOTS configuration exceeds size limit (50KB)')
    try {
        let parsed: unknown = raw
        if (typeof raw === 'string') {
            if (raw.trim().startsWith('[')) {
                parsed = JSON.parse(raw) as unknown
            } else {
                parsed = raw.split(',').map((s) => s.trim()).filter(Boolean)
            }
        }
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
            return parsed as string[]
        }
        if (Array.isArray(parsed)) {
            throw new Error('All paths must be absolute')
        }
        throw new Error('Must be an array of absolute paths')
    } catch (e: unknown) {
        throw new Error(`Invalid ALLOWED_IO_ROOTS configuration: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
    }
}
