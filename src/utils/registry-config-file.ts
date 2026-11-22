import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { assertSafeConfigWriteTargetSync, readSafeRegularConfigTextSync } from './config-file-safety.js'

/**
 * Thrown when a project-registry file exists but cannot be trusted.
 * Callers must not replace the file with an empty registry after this error.
 */
export class RegistryConfigError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message, options)
        this.name = 'RegistryConfigError'
    }
}

interface CachedRegistryFile {
    mtimeMs: number
    size: number
    parsed: Record<string, unknown>
}

const REGISTRY_FILE_CACHE_MAX = 32
const registryFileCache = new Map<string, CachedRegistryFile>()

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isYamlPath(configPath: string): boolean {
    return /\.ya?ml$/i.test(configPath)
}

/**
 * Parse raw JSON or YAML content from a config file path.
 * Throws `RegistryConfigError` on syntax errors.
 */
export function parseConfigObjectContent(configPath: string, raw: string): unknown {
    const yamlMode = isYamlPath(configPath)
    try {
        return yamlMode ? (parseYaml as (text: string) => unknown)(raw) : JSON.parse(raw)
    } catch (err) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: invalid ${yamlMode ? 'YAML' : 'JSON'}`,
            { cause: err }
        )
    }
}

/**
 * Read and parse a config file object with `(mtimeMs, size)` caching; returns `undefined` on `ENOENT`.
 */
export function readCachedConfigObject(configPath: string): Record<string, unknown> | undefined {
    const resolved = path.resolve(configPath)
    const preStat = fs.lstatSync(resolved, { throwIfNoEntry: false })
    if (preStat === undefined) {
        registryFileCache.delete(resolved)
        return undefined
    }
    if (preStat.isSymbolicLink() || !preStat.isFile()) {
        registryFileCache.delete(resolved)
        throw new RegistryConfigError(
            `Refusing to load project registry from symlink or non-regular file: ${resolved}`
        )
    }
    const preCached = registryFileCache.get(resolved)
    if (preCached?.mtimeMs === preStat.mtimeMs && preCached.size === preStat.size) {
        return preCached.parsed
    }

    let safe: { content: string; stat: fs.Stats } | undefined
    try {
        safe = readSafeRegularConfigTextSync(resolved)
    } catch (err) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err }
        )
    }
    if (safe === undefined) {
        registryFileCache.delete(resolved)
        return undefined
    }
    const { content: raw, stat } = safe
    const cached = registryFileCache.get(resolved)
    if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.parsed
    }
    const parsed = parseConfigObjectContent(resolved, raw)
    if (!isRecord(parsed)) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${resolved}: config root must be an object`
        )
    }
    if (registryFileCache.size >= REGISTRY_FILE_CACHE_MAX) {
        registryFileCache.clear()
    }
    registryFileCache.set(resolved, { mtimeMs: stat.mtimeMs, size: stat.size, parsed })
    return parsed
}

/**
 * Atomically persist a JSON or YAML registry config file via temp file + rename.
 */
export function writeProjectRegistryFile(configPath: string, config: Record<string, unknown>): void {
    const resolved = path.resolve(configPath)
    registryFileCache.delete(resolved)
    try {
        assertSafeConfigWriteTargetSync(resolved)
    } catch (err) {
        throw new RegistryConfigError(
            `Refusing to write project registry to ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err }
        )
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 })
    const serialized = isYamlPath(resolved)
        ? (stringifyYaml as (value: unknown) => string)(config)
        : JSON.stringify(config, null, 4)
    const tmpPath = `${resolved}.${String(process.pid)}.${randomBytes(8).toString('hex')}.tmp`
    try {
        fs.writeFileSync(tmpPath, serialized, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
        fs.chmodSync(tmpPath, 0o600)
        registryFileCache.delete(resolved)
        fs.renameSync(tmpPath, resolved)
        try {
            const stat = fs.statSync(resolved)
            if (registryFileCache.size >= REGISTRY_FILE_CACHE_MAX) {
                registryFileCache.clear()
            }
            registryFileCache.set(resolved, { mtimeMs: stat.mtimeMs, size: stat.size, parsed: config })
        } catch {
            // Cache remains cleared if post-rename stat fails.
        }
    } catch (writeErr) {
        try {
            fs.rmSync(tmpPath, { force: true })
        } catch {
            // [SIDE-EFFECT] Best-effort temp cleanup; rethrow original write error below.
        }
        throw writeErr
    }
}

/**
 * Read a project registry config.
 * A missing file is an empty registry. Invalid JSON/YAML, a non-object payload,
 * or a permission error throws so callers cannot write the fallback back.
 */
export function readProjectRegistryFile(configPath: string): {
    config: Record<string, unknown>
    registry: Record<string, unknown>
} {
    let parsed: Record<string, unknown> | undefined
    try {
        parsed = readCachedConfigObject(configPath)
    } catch (err) {
        if (err instanceof RegistryConfigError) throw err
        const detail = err instanceof Error ? err.message : String(err)
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: ${detail}`,
            { cause: err }
        )
    }
    if (parsed === undefined) {
        const registry: Record<string, unknown> = {}
        return { config: { projectRegistry: registry }, registry }
    }

    const cloned: Record<string, unknown> = { ...parsed }
    const existing = cloned['projectRegistry']
    if (existing === undefined) {
        const registry: Record<string, unknown> = {}
        cloned['projectRegistry'] = registry
        return { config: cloned, registry }
    }
    if (!isRecord(existing)) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: projectRegistry must be an object`
        )
    }
    const registryClone: Record<string, unknown> = { ...existing }
    cloned['projectRegistry'] = registryClone
    return { config: cloned, registry: registryClone }
}
