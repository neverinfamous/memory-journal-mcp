/**
 * [BOUNDARY] Central `--dump-config` handling for every CLI command (H13).
 * Prints the effective configuration with secrets redacted, before any database is opened
 * or any mutation runs.
 */

const SENSITIVE_KEY_FRAGMENTS = ['token', 'secret', 'issuer', 'uri', 'password', 'key'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function maskSensitive(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase()
        const value = obj[key]
        if (typeof value === 'string' && SENSITIVE_KEY_FRAGMENTS.some((f) => lowerKey.includes(f))) {
            obj[key] = '[REDACTED]'
        } else if (isRecord(value)) {
            maskSensitive(value)
        }
    }
}

/** Deep-copy `config` via JSON and redact string values under sensitive-looking keys. */
export function redactConfig(config: unknown): unknown {
    const copy: unknown = JSON.parse(JSON.stringify(config ?? {}))
    if (isRecord(copy)) maskSensitive(copy)
    return copy
}

/** Write the redacted configuration to stdout and exit successfully. */
export function dumpConfigAndExit(config: unknown): never {
    process.stdout.write(JSON.stringify(redactConfig(config), null, 2) + '\n')
    process.exit(0)
}
