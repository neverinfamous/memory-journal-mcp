/**
 * [BOUNDARY] Central `--dump-config` handling for every CLI command (H13).
 * Prints the effective configuration with secrets redacted, before any database is opened
 * or any mutation runs.
 */

import { sanitizeErrorForLogging } from '../utils/security-utils.js'

const SENSITIVE_KEY_FRAGMENTS = [
    'token',
    'secret',
    'issuer',
    'uri',
    'password',
    'passphrase',
    'key',
    'auth',
    'webhook',
    'credential',
    'private',
    'cookie',
    'bearer',
    'dsn',
    'connectionstring',
] as const

const REDACTED_FLAG_VALUE_RE =
    /(--?[a-z0-9-]*(?:token|secret|password|passphrase|key|auth|webhook|issuer)[a-z0-9-]*(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s"']+)/gi

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redactScalarString(value: string, keySensitive: boolean): string {
    if (keySensitive && value.length > 0) return '[REDACTED]'
    return sanitizeErrorForLogging(value.replace(REDACTED_FLAG_VALUE_RE, '$1[REDACTED]'))
}

function maskSensitiveArray(items: unknown[], parentKeySensitive: boolean): void {
    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (typeof item === 'string') {
            items[i] = redactScalarString(item, parentKeySensitive)
        } else if (Array.isArray(item)) {
            maskSensitiveArray(item, parentKeySensitive)
        } else if (isRecord(item)) {
            maskSensitive(item, parentKeySensitive)
        }
    }
}

function maskSensitive(obj: Record<string, unknown>, parentKeySensitive = false): void {
    for (const key of Object.keys(obj)) {
        if (!Object.hasOwn(obj, key) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue
        }
        const lowerKey = key.toLowerCase()
        const keySensitive =
            parentKeySensitive || SENSITIVE_KEY_FRAGMENTS.some((f) => lowerKey.includes(f))
        const value = obj[key]
        if (typeof value === 'string') {
            obj[key] = redactScalarString(value, keySensitive)
        } else if (Array.isArray(value)) {
            maskSensitiveArray(value, keySensitive)
        } else if (isRecord(value)) {
            maskSensitive(value, keySensitive)
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
