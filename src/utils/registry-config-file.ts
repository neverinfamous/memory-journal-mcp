import * as fs from 'node:fs'

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

/**
 * Read a project registry config.
 * A missing file is an empty registry. Invalid JSON, a non-object payload,
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

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: invalid JSON`,
            { cause: err }
        )
    }

    if (!isRecord(parsed)) {
        throw new RegistryConfigError(
            `Refusing to load project registry from ${configPath}: JSON value must be an object`
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
