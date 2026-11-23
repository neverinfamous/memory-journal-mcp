import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import type { ProjectRegistryEntry } from '../types/index.js'
import type { ConfigResolver } from '../utils/config-resolver.js'
import type { CatchConfig } from './server-options-groups.js'
import {
    findCaseInsensitiveKeyConflict,
    findProjectNumberConflict,
    isForbiddenProjectKey,
    isValidProjectPath,
} from '../utils/project-registry-guards.js'
import { parsePositiveProjectNumber } from '../utils/safe-positive-int.js'

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
        const registrySchema = z.record(z.string(), z.object({ path: z.string().min(1), project_number: z.number().optional() }).strict())
        const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
        const safeParsed = JSON.parse(JSON.stringify(parsed)) as unknown // Deep clean
        const validated = registrySchema.parse(safeParsed) as Record<string, ProjectRegistryEntry>
        for (const key of Object.keys(validated)) {
            if (isForbiddenProjectKey(key)) {
                throw new Error(`Invalid project registry key: '${key}'`)
            }
            const keyConflict = findCaseInsensitiveKeyConflict(validated, key, key)
            if (keyConflict !== undefined) {
                throw new Error(`Duplicate project registry key '${key}' conflicts with '${keyConflict}'`)
            }
            const entry = validated[key]
            if (entry === undefined) continue
            if (entry.project_number !== undefined) {
                if (parsePositiveProjectNumber(entry.project_number) === undefined) {
                    throw new Error(`Invalid project_number for project '${key}': expected a positive safe integer`)
                }
                const numConflict = findProjectNumberConflict(validated, entry.project_number, [key])
                if (numConflict !== undefined) {
                    throw new Error(`Duplicate project_number ${String(entry.project_number)} in project '${key}' conflicts with '${numConflict}'`)
                }
            }
            if (!entry.path) continue
            if (!path.isAbsolute(entry.path)) throw new Error(`Project registry path must be an absolute path: ${entry.path}`)
            if (!isValidProjectPath(entry.path)) {
                throw new Error(`Invalid or unsafe project registry path for '${key}': ${entry.path}`)
            }
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

/** Validate a normalized [0, 1] importance threshold option. */
export function parseImportanceThresholdOption(
    val: unknown,
    name: string,
    fallback: number,
    options?: { rejectBlank?: boolean }
): number {
    if (val === undefined || val === null) return fallback
    let num: number
    if (typeof val === 'number') {
        num = val
    } else if (typeof val === 'string') {
        const trimmed = val.trim()
        if (trimmed === '') {
            if (options?.rejectBlank === true) {
                throw new Error(
                    `Invalid ${name} ''. Expected a finite number between 0 and 1.`
                )
            }
            return fallback
        }
        // [INVARIANT] Match `coerceFiniteNumberString` canonical decimal syntax (reject `.5`, `00.5`, `-0`).
        num =
            trimmed !== '-0' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)
                ? Number(trimmed)
                : Number.NaN
    } else {
        num = Number.NaN
    }
    if (!Number.isFinite(num) || num < 0 || num > 1) {
        const display =
            typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
                ? String(val)
                : typeof val
        throw new Error(
            `Invalid ${name} '${display}'. Expected a finite number between 0 and 1.`
        )
    }
    return num
}

/** Validate and normalize a CLI log level option. */
export function parseLogLevelOption(
    raw: unknown
): 'debug' | 'info' | 'warning' | 'error' | undefined {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== 'string') {
        throw new Error(`Invalid log level type '${typeof raw}'. Use debug, info, warning, or error.`)
    }
    const str = raw.trim()
    if (str === '') return undefined
    if (str === 'debug' || str === 'info' || str === 'warning' || str === 'error') return str
    throw new Error(`Invalid log level '${str}'. Use debug, info, warning, or error.`)
}

/**
 * Clear an inherited (non-CLI) project number when a CLI workspace override selects `'default'`,
 * a workspace mapped to another project number, or a workspace differing from another project's ID.
 */
export function resolveUnconflictedDefaultProject(
    defaultWorkspaceId: string | undefined,
    defaultProjectNumber: number | undefined,
    projectRegistry: Record<string, ProjectRegistryEntry> | undefined,
    workspaceFromCli: boolean,
    projectFromCli: boolean
): number | undefined {
    if (
        !workspaceFromCli ||
        projectFromCli ||
        defaultWorkspaceId === undefined ||
        defaultProjectNumber === undefined
    ) {
        return defaultProjectNumber
    }
    const lowerWs = defaultWorkspaceId.toLowerCase()
    if (lowerWs === 'default') return undefined
    const entries = projectRegistry !== undefined ? Object.entries(projectRegistry) : []
    const matched = entries.find(([key]) => key.toLowerCase() === lowerWs)
    if (matched !== undefined) {
        const regNum = matched[1].project_number
        return regNum !== undefined && regNum !== null && regNum !== defaultProjectNumber
            ? undefined
            : defaultProjectNumber
    }
    const collidesOther = entries.some(([, entry]) => entry.project_number === defaultProjectNumber)
    return collidesOther ? undefined : defaultProjectNumber
}

/**
 * Clear an inherited (non-CLI) workspace ID when a CLI `--default-project` override selects
 * a project registered to another workspace or conflicting with a workspace's registered number.
 */
export function resolveUnconflictedDefaultWorkspace(
    defaultWorkspaceId: string | undefined,
    defaultProjectNumber: number | undefined,
    projectRegistry: Record<string, ProjectRegistryEntry> | undefined,
    workspaceFromCli: boolean,
    projectFromCli: boolean
): string | undefined {
    if (
        !projectFromCli ||
        workspaceFromCli ||
        defaultWorkspaceId === undefined ||
        defaultProjectNumber === undefined
    ) {
        return defaultWorkspaceId
    }
    const lowerWs = defaultWorkspaceId.toLowerCase()
    const entries = projectRegistry !== undefined ? Object.entries(projectRegistry) : []
    const matched = entries.find(([key]) => key.toLowerCase() === lowerWs)
    if (matched !== undefined) {
        const regNum = matched[1].project_number
        return regNum !== undefined && regNum !== null && regNum !== defaultProjectNumber
            ? undefined
            : defaultWorkspaceId
    }
    const collidesOther = entries.some(([, entry]) => entry.project_number === defaultProjectNumber)
    return collidesOther ? undefined : defaultWorkspaceId
}

const transportSchema = z.enum(['stdio', 'http'])

/** Resolve CLI/env/config transport precedence with explicit CLI and `TRANSPORT` env priority over config booleans. */
export function resolveTransportOption(resolver: ConfigResolver, catchConfig: CatchConfig): 'stdio' | 'http' {
    return catchConfig((): 'stdio' | 'http' => {
        if (resolver.isCliProvided('http') && resolver.resolveBool('http') === true) return 'http'
        if (resolver.isCliProvided('stdio') && resolver.resolveBool('stdio') === true) return 'stdio'
        const envTransport = process.env['TRANSPORT']?.trim()
        const raw = resolver.isCliProvided('transport')
            ? resolver.resolve<string>('transport')
            : envTransport !== undefined && envTransport !== ''
              ? envTransport
              : undefined
        if (raw === undefined) {
            if (resolver.resolveBool('http')) return 'http'
            if (resolver.resolveBool('stdio')) return 'stdio'
        }
        const cand = raw ?? resolver.resolve<string>('transport', 'TRANSPORT') ?? 'stdio'
        const parsed = transportSchema.safeParse(cand)
        if (!parsed.success) {
            throw new Error(`Invalid transport '${cand}'. Use 'stdio' or 'http'.`)
        }
        return parsed.data
    }, 'stdio')
}
