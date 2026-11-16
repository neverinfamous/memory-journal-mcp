import * as fs from 'node:fs'
import * as path from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readErrorCode(err: unknown): string | undefined {
    if (typeof err !== 'object' || err === null || !('code' in err)) return undefined
    return typeof err.code === 'string' ? err.code : undefined
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
 * Atomically persist a JSON or YAML registry config file via temp file + rename.
 */
export function writeProjectRegistryFile(configPath: string, config: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    const serialized = isYamlPath(configPath)
        ? (stringifyYaml as (value: unknown) => string)(config)
        : JSON.stringify(config, null, 4)
    const tmpPath = `${configPath}.${String(process.pid)}.${String(Date.now())}.tmp`
    try {
        fs.writeFileSync(tmpPath, serialized, 'utf-8')
        fs.renameSync(tmpPath, configPath)
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
    let raw: string
    try {
        raw = fs.readFileSync(configPath, 'utf-8')
    } catch (err) {
        if (readErrorCode(err) === 'ENOENT') {
            const registry: Record<string, unknown> = {}
            return { config: { projectRegistry: registry }, registry }
        }
        const detail = err instanceof Error ? err.message : String(err)
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: ${detail}`,
            { cause: err }
        )
    }

    const parsed = parseConfigObjectContent(configPath, raw)

    if (!isRecord(parsed)) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: config root must be an object`
        )
    }

    const existing = parsed['projectRegistry']
    if (existing === undefined) {
        const registry: Record<string, unknown> = {}
        parsed['projectRegistry'] = registry
        return { config: parsed, registry }
    }
    if (!isRecord(existing)) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: projectRegistry must be an object`
        )
    }
    return { config: parsed, registry: existing }
}
